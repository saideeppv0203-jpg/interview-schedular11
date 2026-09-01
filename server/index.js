require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// DATA_DIR lets you point storage at a mounted persistent disk in production
// (e.g. Render persistent disks). Defaults to this folder for local dev.
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'data.sqlite');
const DATABASE_URL = process.env.DATABASE_URL || '';
fs.mkdirSync(DATA_DIR, { recursive: true });

const postgresPool = DATABASE_URL ? new Pool({ connectionString: DATABASE_URL }) : null;
const dbConnection = !postgresPool ? new sqlite3.Database(DB_PATH) : null;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'vishnavqa@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Vishnavqa02@';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-admin-token-change-me';

// Interview hours: 8:00 AM to 10:00 PM, in minutes from midnight
const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 22 * 60;
const VALID_DURATIONS = [30, 60];

function getDefaultData() {
  return { students: {}, bookings: [], blockedSlots: [] };
}

function loadLegacyData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      students: parsed.students || {},
      bookings: parsed.bookings || [],
      blockedSlots: parsed.blockedSlots || [],
    };
  } catch (e) {
    return null;
  }
}

function ensureSchema() {
  if (postgresPool) {
    return postgresPool.query(`
      CREATE TABLE IF NOT EXISTS students (
        phone TEXT PRIMARY KEY,
        data JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS blocked_slots (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL
      );
    `);
  }

  return new Promise((resolve, reject) => {
    dbConnection.exec(
      `
        CREATE TABLE IF NOT EXISTS students (
          phone TEXT PRIMARY KEY,
          data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS bookings (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS blocked_slots (
          id TEXT PRIMARY KEY,
          data TEXT NOT NULL
        );
      `,
      (error) => (error ? reject(error) : resolve())
    );
  });
}

function loadDataFromDatabase() {
  if (postgresPool) {
    return postgresPool
      .query('SELECT phone, data FROM students')
      .then((studentResult) => {
        const students = {};
        studentResult.rows.forEach(({ phone, data }) => {
          students[phone] = data;
        });

        return postgresPool.query('SELECT data FROM bookings').then((bookingResult) => {
          const bookings = bookingResult.rows.map(({ data }) => data);

          return postgresPool.query('SELECT data FROM blocked_slots').then((blockedResult) => {
            const blockedSlots = blockedResult.rows.map(({ data }) => data);
            return { students, bookings, blockedSlots };
          });
        });
      });
  }

  return new Promise((resolve, reject) => {
    const students = {};
    const bookings = [];
    const blockedSlots = [];

    dbConnection.all('SELECT phone, data FROM students', (studentError, rows) => {
      if (studentError) return reject(studentError);

      rows.forEach(({ phone, data }) => {
        students[phone] = JSON.parse(data);
      });

      dbConnection.all('SELECT data FROM bookings', (bookingError, bookingRows) => {
        if (bookingError) return reject(bookingError);

        bookingRows.forEach(({ data }) => {
          bookings.push(JSON.parse(data));
        });

        dbConnection.all('SELECT data FROM blocked_slots', (blockedError, blockedRows) => {
          if (blockedError) return reject(blockedError);

          blockedRows.forEach(({ data }) => {
            blockedSlots.push(JSON.parse(data));
          });

          resolve({ students, bookings, blockedSlots });
        });
      });
    });
  });
}

async function saveData(data) {
  const normalized = {
    students: data.students || {},
    bookings: data.bookings || [],
    blockedSlots: data.blockedSlots || [],
  };

  if (postgresPool) {
    const client = await postgresPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM students');
      await client.query('DELETE FROM bookings');
      await client.query('DELETE FROM blocked_slots');

      const studentValues = Object.entries(normalized.students).map(([phone, record]) => [phone, JSON.stringify(record)]);
      if (studentValues.length) {
        const insertStudents = `INSERT INTO students (phone, data) VALUES ${studentValues.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(', ')}`;
        const studentParams = studentValues.flat();
        await client.query(insertStudents, studentParams);
      }

      const bookingValues = normalized.bookings.map((booking) => [booking.id, JSON.stringify(booking)]);
      if (bookingValues.length) {
        const insertBookings = `INSERT INTO bookings (id, data) VALUES ${bookingValues.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(', ')}`;
        const bookingParams = bookingValues.flat();
        await client.query(insertBookings, bookingParams);
      }

      const blockedValues = normalized.blockedSlots.map((slot, index) => [`${slot.cabin}-${slot.date}-${slot.time}-${slot.duration || 30}-${index}`, JSON.stringify(slot)]);
      if (blockedValues.length) {
        const insertBlocked = `INSERT INTO blocked_slots (id, data) VALUES ${blockedValues.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(', ')}`;
        const blockedParams = blockedValues.flat();
        await client.query(insertBlocked, blockedParams);
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  return new Promise((resolve, reject) => {
    dbConnection.serialize(() => {
      dbConnection.run('DELETE FROM students');
      dbConnection.run('DELETE FROM bookings');
      dbConnection.run('DELETE FROM blocked_slots');

      const studentStmt = dbConnection.prepare('INSERT INTO students (phone, data) VALUES (?, ?)');
      Object.entries(normalized.students).forEach(([phone, record]) => {
        studentStmt.run(phone, JSON.stringify(record));
      });
      studentStmt.finalize();

      const bookingStmt = dbConnection.prepare('INSERT INTO bookings (id, data) VALUES (?, ?)');
      normalized.bookings.forEach((booking) => {
        bookingStmt.run(booking.id, JSON.stringify(booking));
      });
      bookingStmt.finalize();

      const blockedStmt = dbConnection.prepare('INSERT INTO blocked_slots (id, data) VALUES (?, ?)');
      normalized.blockedSlots.forEach((slot, index) => {
        blockedStmt.run(`${slot.cabin}-${slot.date}-${slot.time}-${slot.duration || 30}-${index}`, JSON.stringify(slot));
      });
      blockedStmt.finalize();

      dbConnection.run('SELECT 1', (error) => {
        if (error) return reject(error);
        resolve();
      });
    });
  });
}

async function initializeDatabase() {
  await ensureSchema();

  const dbFromDatabase = await loadDataFromDatabase().catch(() => getDefaultData());
  const legacyData = loadLegacyData();

  let nextDb = getDefaultData();
  if (Object.keys(dbFromDatabase.students).length || dbFromDatabase.bookings.length || dbFromDatabase.blockedSlots.length) {
    nextDb = dbFromDatabase;
  } else if (legacyData) {
    nextDb = legacyData;
  }

  db = nextDb;
  await saveData(db);
}

let db = getDefaultData();

function persistData() {
  return saveData(db).catch((error) => {
    console.error('Failed to save data:', error);
  });
}

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function rangesOverlap(startA, durA, startB, durB) {
  const aS = toMinutes(startA);
  const aE = aS + durA;
  const bS = toMinutes(startB);
  const bE = bS + durB;
  return aS < bE && bS < aE;
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Full app state: student directory + all bookings + admin-blocked slots
app.get('/api/state', (req, res) => {
  res.json({ students: db.students, bookings: db.bookings, blockedSlots: db.blockedSlots });
});

// Register a new student, or log an existing one in by phone number
app.post('/api/register', (req, res) => {
  const { name, domain, phone } = req.body || {};
  if (!phone || !phone.trim()) {
    return res.status(400).json({ error: 'Phone number is required.' });
  }
  const cleanPhone = phone.trim();

  if (db.students[cleanPhone]) {
    const existing = db.students[cleanPhone];
    if (existing.active === false) {
      return res.status(403).json({ error: 'Your account has been disabled by the admin. Contact them for help.' });
    }
    return res.json({ student: existing });
  }

  if (!name || !name.trim() || !domain || !domain.trim()) {
    return res.status(400).json({ error: 'Name and domain are required to register.' });
  }

  const record = {
    name: name.trim(),
    domain: domain.trim(),
    phone: cleanPhone,
    active: true,
    registeredAt: new Date().toISOString(),
  };
  db.students[cleanPhone] = record;
  persistData();
  res.json({ student: record });
});

// Create a booking request for a slot
app.post('/api/bookings', (req, res) => {
  const { cabin, date, time, duration, phone, studentName, domain, company, round } = req.body || {};
  if (!cabin || !date || !time || !phone || !company || !round) {
    return res.status(400).json({ error: 'Missing required booking fields.' });
  }

  const dur = Number(duration);
  if (!VALID_DURATIONS.includes(dur)) {
    return res.status(400).json({ error: 'Slot duration must be 30 or 60 minutes.' });
  }

  const startMin = toMinutes(time);
  if (Number.isNaN(startMin) || startMin < DAY_START_MIN || startMin + dur > DAY_END_MIN) {
    return res.status(400).json({ error: 'Slot must fall between 8:00 AM and 10:00 PM.' });
  }

  const slotDateTime = new Date(`${date}T${time}:00`);
  if (Number.isNaN(slotDateTime.getTime()) || slotDateTime.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'You cannot book a past date or time.' });
  }

  const student = db.students[phone];
  if (!student) {
    return res.status(404).json({ error: 'Student not found. Please register again.' });
  }
  if (student.active === false) {
    return res.status(403).json({ error: 'Your account has been disabled by the admin.' });
  }

  const blockedHit = db.blockedSlots.find(
    (s) => s.cabin === cabin && s.date === date && rangesOverlap(s.time, s.duration || 30, time, dur)
  );
  if (blockedHit) {
    return res.status(409).json({ error: 'This slot has been marked unavailable by the admin.' });
  }

  const clash = db.bookings.find(
    (b) =>
      b.cabin === cabin &&
      b.date === date &&
      b.status !== 'rejected' &&
      rangesOverlap(b.time, b.duration || 30, time, dur)
  );
  if (clash) {
    return res.status(409).json({ error: 'That slot was just taken. Pick another slot.' });
  }

  const booking = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    cabin,
    date,
    time,
    duration: dur,
    phone,
    studentName: studentName || '',
    domain: domain || '',
    company,
    round,
    status: 'pending',
    requestedAt: new Date().toISOString(),
  };
  db.bookings.push(booking);
  persistData();
  res.json({ booking });
});

// Admin login: returns a bearer token used for admin-only calls
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body || {};
  if (
    email &&
    password &&
    email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase() &&
    password === ADMIN_PASSWORD
  ) {
    return res.json({ token: ADMIN_TOKEN });
  }
  res.status(401).json({ error: 'Incorrect email or password.' });
});

// Approve / reject a booking (admin only)
app.patch('/api/bookings/:id', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const booking = db.bookings.find((b) => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  booking.status = status;
  persistData();
  res.json({ booking });
});

// Enable / disable a student account (admin only)
app.patch('/api/students/:phone', requireAdmin, (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: '"active" must be true or false.' });
  }
  const student = db.students[req.params.phone];
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  student.active = active;
  persistData();
  res.json({ student });
});

// Delete a booking (admin only)
app.delete('/api/bookings/:id', requireAdmin, (req, res) => {
  const index = db.bookings.findIndex((booking) => booking.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Booking not found.' });
  db.bookings.splice(index, 1);
  persistData();
  res.json({ deleted: true });
});

// Delete a student and their bookings (admin only)
app.delete('/api/students/:phone', requireAdmin, (req, res) => {
  const phone = req.params.phone;
  if (!db.students[phone]) return res.status(404).json({ error: 'Student not found.' });
  delete db.students[phone];
  db.bookings = db.bookings.filter((booking) => booking.phone !== phone);
  persistData();
  res.json({ deleted: true });
});

// Toggle whether a specific cabin/date/time slot is blocked off (admin only)
app.post('/api/slots/toggle', requireAdmin, (req, res) => {
  const { cabin, date, time, duration } = req.body || {};
  if (!cabin || !date || !time) {
    return res.status(400).json({ error: 'cabin, date and time are required.' });
  }
  const dur = VALID_DURATIONS.includes(Number(duration)) ? Number(duration) : 30;

  const idx = db.blockedSlots.findIndex(
    (s) => s.cabin === cabin && s.date === date && s.time === time && (s.duration || 30) === dur
  );
  if (idx >= 0) {
    db.blockedSlots.splice(idx, 1);
    persistData();
    return res.json({ blocked: false });
  }

  const bookedHit = db.bookings.find(
    (b) => b.cabin === cabin && b.date === date && b.status !== 'rejected' && rangesOverlap(b.time, b.duration || 30, time, dur)
  );
  if (bookedHit) {
    return res.status(409).json({ error: 'A student already has this slot booked. Reject their request first.' });
  }

  db.blockedSlots.push({ cabin, date, time, duration: dur });
  persistData();
  res.json({ blocked: true });
});

// Serve the built React app in production (after `npm run build`)
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const PORT = process.env.PORT || 4000;
initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Interview scheduler server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize the database:', error);
    process.exit(1);
  });
