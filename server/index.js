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

let postgresPool = null;
let dbConnection = new sqlite3.Database(DB_PATH);

if (DATABASE_URL) {
  const postgresConfig = {
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('supabase.co') ? { rejectUnauthorized: false } : undefined,
  };
  postgresPool = new Pool(postgresConfig);
  dbConnection = null;
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'vishnavqa@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Vishnavqa02@';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'dev-admin-token-change-me';

// Interview hours: 8:00 AM to 10:00 PM, in minutes from midnight
const DAY_START_MIN = 8 * 60;
const DAY_END_MIN = 22 * 60;
const VALID_DURATIONS = [30, 60];
const DEFAULT_CABINS = ['Cabin 1', 'Cabin 2'];

function getDefaultData() {
  return { students: {}, bookings: [], blockedSlots: [], disabledCabins: [], cabins: DEFAULT_CABINS, activityHistory: [], interviewerAvailability: [] };
}

function loadLegacyData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      students: parsed.students || {},
      bookings: parsed.bookings || [],
      blockedSlots: parsed.blockedSlots || [],
      disabledCabins: parsed.disabledCabins || [],
      activityHistory: parsed.activityHistory || [],
      interviewerAvailability: parsed.interviewerAvailability || [],
      cabins: parsed.cabins || DEFAULT_CABINS,
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
      CREATE TABLE IF NOT EXISTS scheduler_settings (
        key TEXT PRIMARY KEY,
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
        CREATE TABLE IF NOT EXISTS scheduler_settings (
          key TEXT PRIMARY KEY,
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
            return postgresPool.query('SELECT key, data FROM scheduler_settings').then((settingsResult) => {
              const settings = {};
              settingsResult.rows.forEach(({ key, data }) => { settings[key] = data; });
              return { students, bookings, blockedSlots, disabledCabins: settings.disabledCabins || [], cabins: settings.cabins || DEFAULT_CABINS, activityHistory: settings.activityHistory || [], interviewerAvailability: settings.interviewerAvailability || [] };
            });
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

          dbConnection.all('SELECT key, data FROM scheduler_settings', (settingsError, settingsRows) => {
            if (settingsError) return reject(settingsError);
            const settings = {};
            settingsRows.forEach(({ key, data }) => { settings[key] = JSON.parse(data); });
            resolve({ students, bookings, blockedSlots, disabledCabins: settings.disabledCabins || [], cabins: settings.cabins || DEFAULT_CABINS, activityHistory: settings.activityHistory || [], interviewerAvailability: settings.interviewerAvailability || [] });
          });
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
    disabledCabins: data.disabledCabins || [],
    activityHistory: data.activityHistory || [],
    interviewerAvailability: data.interviewerAvailability || [],
    cabins: data.cabins || DEFAULT_CABINS,
  };

  if (postgresPool) {
    const client = await postgresPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM students');
      await client.query('DELETE FROM bookings');
      await client.query('DELETE FROM blocked_slots');
      await client.query('DELETE FROM scheduler_settings');

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
      await client.query('INSERT INTO scheduler_settings (key, data) VALUES ($1, $2)', ['disabledCabins', JSON.stringify(normalized.disabledCabins)]);
      await client.query('INSERT INTO scheduler_settings (key, data) VALUES ($1, $2)', ['activityHistory', JSON.stringify(normalized.activityHistory)]);
      await client.query('INSERT INTO scheduler_settings (key, data) VALUES ($1, $2)', ['interviewerAvailability', JSON.stringify(normalized.interviewerAvailability)]);
      await client.query('INSERT INTO scheduler_settings (key, data) VALUES ($1, $2)', ['cabins', JSON.stringify(normalized.cabins)]);

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
      dbConnection.run('DELETE FROM scheduler_settings');

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

      const settingsStmt = dbConnection.prepare('INSERT INTO scheduler_settings (key, data) VALUES (?, ?)');
      settingsStmt.run('disabledCabins', JSON.stringify(normalized.disabledCabins));
      settingsStmt.run('activityHistory', JSON.stringify(normalized.activityHistory));
      settingsStmt.run('interviewerAvailability', JSON.stringify(normalized.interviewerAvailability));
      settingsStmt.run('cabins', JSON.stringify(normalized.cabins));
      settingsStmt.finalize();

      dbConnection.run('SELECT 1', (error) => {
        if (error) return reject(error);
        resolve();
      });
    });
  });
}

async function fallbackToSqlite(reason) {
  if (!postgresPool) return false;

  console.warn('PostgreSQL unavailable, falling back to SQLite. Reason:', reason && reason.message ? reason.message : reason);

  try {
    await postgresPool.end();
  } catch (cleanupError) {
    console.warn('Failed to close PostgreSQL pool:', cleanupError.message || cleanupError);
  }

  postgresPool = null;
  dbConnection = new sqlite3.Database(DB_PATH);
  return true;
}

async function initializeDatabase() {
  try {
    await ensureSchema();

    const dbFromDatabase = await loadDataFromDatabase().catch(() => getDefaultData());
    const legacyData = loadLegacyData();

    let nextDb = getDefaultData();
    if (Object.keys(dbFromDatabase.students).length || dbFromDatabase.bookings.length || dbFromDatabase.blockedSlots.length || dbFromDatabase.disabledCabins.length || dbFromDatabase.activityHistory.length) {
      nextDb = dbFromDatabase;
    } else if (legacyData) {
      nextDb = legacyData;
    }

    db = nextDb;
    await saveData(db);
  } catch (error) {
    if (postgresPool) {
      const didFallback = await fallbackToSqlite(error);
      if (didFallback) {
        return initializeDatabase();
      }
    }

    throw error;
  }
}

let db = getDefaultData();

function persistData() {
  return saveData(db).catch((error) => {
    console.error('Failed to save data:', error);
  });
}

function recordActivity(action, booking, details) {
  if (!db.activityHistory) db.activityHistory = [];
  db.activityHistory.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    action,
    bookingId: booking && booking.id,
    studentName: booking && booking.studentName,
    phone: booking && booking.phone,
    company: booking && booking.company,
    date: booking && booking.date,
    time: booking && booking.time,
    details: details || '',
    at: new Date().toISOString(),
  });
  db.activityHistory = db.activityHistory.slice(0, 200);
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

function isPastInTimezone(date, time, timezone) {
  if (!timezone || timezone === 'local') {
    return new Date(`${date}T${time}:00`).getTime() <= Date.now();
  }
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const current = {};
    parts.forEach((part) => { current[part.type] = part.value; });
    return `${date}T${time}` <= `${current.year}-${current.month}-${current.day}T${current.hour}:${current.minute}`;
  } catch (error) {
    return new Date(`${date}T${time}:00`).getTime() <= Date.now();
  }
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Full app state: student directory + all bookings + admin-blocked slots
app.get('/api/state', (req, res) => {
  res.json({ students: db.students, bookings: db.bookings, blockedSlots: db.blockedSlots, disabledCabins: db.disabledCabins || [], cabins: db.cabins || DEFAULT_CABINS, activityHistory: db.activityHistory || [], interviewerAvailability: db.interviewerAvailability || [] });
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
  const { cabin, date, time, duration, phone, studentName, domain, company, round, interviewer, timezone } = req.body || {};
  if (!cabin || !date || !time || !phone || !company || !round) {
    return res.status(400).json({ error: 'Missing required booking fields.' });
  }
  if (!(db.cabins || DEFAULT_CABINS).includes(cabin)) {
    return res.status(400).json({ error: 'Invalid cabin.' });
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
  if (Number.isNaN(slotDateTime.getTime()) || isPastInTimezone(date, time, timezone)) {
    return res.status(400).json({ error: 'You cannot book a past date or time.' });
  }

  const student = db.students[phone];
  if (!student) {
    return res.status(404).json({ error: 'Student not found. Please register again.' });
  }
  if (student.active === false) {
    return res.status(403).json({ error: 'Your account has been disabled by the admin.' });
  }
  if ((db.disabledCabins || []).includes(cabin)) {
    return res.status(409).json({ error: `${cabin} is currently unavailable.` });
  }

  const duplicate = db.bookings.find(
    (b) => b.phone === phone && b.date === date && b.status !== 'rejected' && b.status !== 'cancelled' &&
      rangesOverlap(b.time, b.duration || 30, time, dur)
  );
  if (duplicate) {
    return res.status(409).json({ error: 'You already have an interview booked during this time.' });
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
      b.status !== 'rejected' && b.status !== 'cancelled' &&
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
    interviewer: interviewer || '',
    status: 'pending',
    requestedAt: new Date().toISOString(),
    timezone: timezone || 'local',
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

app.post('/api/admin/students', requireAdmin, (req, res) => {
  const { name, domain, phone } = req.body || {};
  const cleanPhone = String(phone || '').trim();
  if (!name || !domain || !cleanPhone) return res.status(400).json({ error: 'Name, domain, and phone are required.' });
  if (db.students[cleanPhone]) return res.status(409).json({ error: 'A student with this phone number already exists.' });
  const student = { name: String(name).trim(), domain: String(domain).trim(), phone: cleanPhone, active: true, registeredAt: new Date().toISOString() };
  db.students[cleanPhone] = student;
  persistData();
  res.json({ student });
});

// Approve / reject a booking (admin only)
app.patch('/api/bookings/:id', requireAdmin, (req, res) => {
  const { status, date, time, duration, phone, cabin, cancelReason } = req.body || {};
  if (date || time || duration || cabin) {
    const dur = Number(duration || bookingDuration(req.params.id));
    const bookingToMove = db.bookings.find((b) => b.id === req.params.id);
    if (!bookingToMove) return res.status(404).json({ error: 'Booking not found.' });
    const targetCabin = cabin || bookingToMove.cabin;
    if (!(db.cabins || DEFAULT_CABINS).includes(targetCabin)) return res.status(400).json({ error: 'Invalid cabin.' });
    if ((db.disabledCabins || []).includes(targetCabin)) return res.status(409).json({ error: `${targetCabin} is currently unavailable.` });
    const validation = validateSchedule(date || bookingToMove.date, time || bookingToMove.time, dur, bookingToMove.timezone);
    if (validation) return res.status(400).json({ error: validation });
    const blocked = db.blockedSlots.find((slot) => slot.cabin === targetCabin &&
      slot.date === (date || bookingToMove.date) &&
      rangesOverlap(slot.time, slot.duration || 30, time || bookingToMove.time, dur));
    if (blocked) return res.status(409).json({ error: 'That slot is marked unavailable.' });
    const clash = db.bookings.find((b) => b.id !== bookingToMove.id && b.status !== 'rejected' && b.status !== 'cancelled' &&
      b.cabin === targetCabin && b.date === (date || bookingToMove.date) &&
      rangesOverlap(b.time, b.duration || 30, time || bookingToMove.time, dur));
    if (clash) return res.status(409).json({ error: 'That cabin slot overlaps another booking.' });
    const studentClash = db.bookings.find((b) => b.id !== bookingToMove.id && b.phone === bookingToMove.phone &&
      b.status !== 'rejected' && b.status !== 'cancelled' && b.date === (date || bookingToMove.date) &&
      rangesOverlap(b.time, b.duration || 30, time || bookingToMove.time, dur));
    if (studentClash) return res.status(409).json({ error: 'This student already has an interview during that time.' });
    bookingToMove.date = date || bookingToMove.date;
    bookingToMove.time = time || bookingToMove.time;
    bookingToMove.duration = dur;
    bookingToMove.cabin = targetCabin;
    if (phone) bookingToMove.phone = phone;
    const previousStatus = bookingToMove.status;
    if (status) bookingToMove.status = status;
    if (status === 'cancelled' && cancelReason) bookingToMove.cancelReason = String(cancelReason).trim();
    if (status && status !== previousStatus) recordActivity(status === 'approved' ? 'approved' : status === 'cancelled' ? 'cancelled' : status, bookingToMove, `Admin changed status from ${previousStatus} to ${status}.`);
    persistData();
    return res.json({ booking: bookingToMove });
  }
  if (!['approved', 'rejected', 'pending', 'cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status.' });
  }
  const booking = db.bookings.find((b) => b.id === req.params.id);
  if (!booking) return res.status(404).json({ error: 'Booking not found.' });
  if (status === 'approved') {
    const cabinClash = db.bookings.find((b) => b.id !== booking.id &&
      b.status !== 'rejected' && b.status !== 'cancelled' &&
      b.cabin === booking.cabin && b.date === booking.date &&
      rangesOverlap(b.time, b.duration || 30, booking.time, booking.duration || 30));
    if (cabinClash) return res.status(409).json({ error: 'That cabin slot overlaps another active booking.' });
    const studentClash = db.bookings.find((b) => b.id !== booking.id &&
      b.phone === booking.phone && b.status !== 'rejected' && b.status !== 'cancelled' &&
      b.date === booking.date &&
      rangesOverlap(b.time, b.duration || 30, booking.time, booking.duration || 30));
    if (studentClash) return res.status(409).json({ error: 'This student already has an overlapping booking.' });
  }
  const previousStatus = booking.status;
  booking.status = status;
  if (status === 'cancelled' && cancelReason) booking.cancelReason = String(cancelReason).trim();
  if (status !== previousStatus) recordActivity(status === 'approved' ? 'approved' : status === 'cancelled' ? 'cancelled' : status, booking, `Admin changed status from ${previousStatus} to ${status}.`);
  persistData();
  res.json({ booking });
});

app.post('/api/bookings/bulk-status', requireAdmin, (req, res) => {
  const { ids, status } = req.body || {};
  if (!Array.isArray(ids) || !ids.length || !['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Booking ids and approved or rejected status are required.' });
  }
  const selected = db.bookings.filter((booking) => ids.includes(booking.id) && booking.status === 'pending');
  if (selected.length !== ids.length) return res.status(409).json({ error: 'Some selected requests are no longer pending.' });
  if (status === 'approved') {
    for (const booking of selected) {
      const conflict = db.bookings.find((other) => other.id !== booking.id && other.status !== 'rejected' && other.status !== 'cancelled' &&
        ((other.cabin === booking.cabin && other.date === booking.date && rangesOverlap(other.time, other.duration || 30, booking.time, booking.duration || 30)) ||
         (other.phone === booking.phone && other.date === booking.date && rangesOverlap(other.time, other.duration || 30, booking.time, booking.duration || 30))));
      if (conflict) return res.status(409).json({ error: `Cannot approve ${booking.studentName}: it overlaps an active booking.` });
    }
  }
  selected.forEach((booking) => {
    booking.status = status;
    recordActivity(status, booking, `Admin bulk changed status to ${status}.`);
  });
  persistData();
  res.json({ updated: selected.length });
});

function validateSchedule(date, time, duration, timezone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) {
    return 'A valid date and time are required.';
  }
  const startMin = toMinutes(time);
  if (!VALID_DURATIONS.includes(Number(duration)) || Number.isNaN(startMin) ||
      startMin < DAY_START_MIN || startMin + Number(duration) > DAY_END_MIN) {
    return 'Slot must fall between 8:00 AM and 10:00 PM.';
  }
  const slotDateTime = new Date(`${date}T${time}:00`);
  if (Number.isNaN(slotDateTime.getTime()) || isPastInTimezone(date, time, timezone)) {
    return 'You cannot use a past date or time.';
  }
  return null;
}

function bookingDuration(id) {
  const booking = db.bookings.find((b) => b.id === id);
  return booking ? booking.duration || 30 : 30;
}

// Students may reschedule or cancel only their own booking.
app.patch('/api/student/bookings/:id', (req, res) => {
  const { phone, action, date, time, duration, timezone, cabin, cancelReason } = req.body || {};
  const booking = db.bookings.find((b) => b.id === req.params.id);
  if (!booking || !phone || booking.phone !== phone) return res.status(404).json({ error: 'Booking not found.' });
  if (action === 'cancel') {
    if (!cancelReason || !String(cancelReason).trim()) {
      return res.status(400).json({ error: 'A cancellation reason is required.' });
    }
    booking.status = 'cancelled';
    booking.cancelReason = String(cancelReason).trim();
    booking.cancelledAt = new Date().toISOString();
    recordActivity('cancelled', booking, 'Student cancelled the interview.');
    persistData();
    return res.json({ booking });
  }
  const dur = Number(duration || booking.duration || 30);
  const targetCabin = cabin || booking.cabin;
  if (!(db.cabins || DEFAULT_CABINS).includes(targetCabin)) return res.status(400).json({ error: 'Invalid cabin.' });
  const validation = validateSchedule(date, time, dur, timezone || booking.timezone);
  if (validation) return res.status(400).json({ error: validation });
  if ((db.disabledCabins || []).includes(targetCabin)) return res.status(409).json({ error: `${targetCabin} is currently unavailable.` });
  const clash = db.bookings.find((b) => b.id !== booking.id && b.status !== 'rejected' && b.status !== 'cancelled' &&
    b.cabin === targetCabin && b.date === date && rangesOverlap(b.time, b.duration || 30, time, dur));
  if (clash) return res.status(409).json({ error: 'That cabin slot overlaps another booking.' });
  const studentClash = db.bookings.find((b) => b.id !== booking.id && b.phone === phone &&
    b.status !== 'rejected' && b.status !== 'cancelled' && b.date === date &&
    rangesOverlap(b.time, b.duration || 30, time, dur));
  if (studentClash) return res.status(409).json({ error: 'You already have an interview booked during this time.' });
  booking.date = date;
  booking.time = time;
  booking.duration = dur;
  booking.cabin = targetCabin;
  booking.status = 'pending';
  persistData();
  res.json({ booking });
});

// Students may remove only their own completed interviews from their history.
app.delete('/api/student/bookings/:id', (req, res) => {
  const phone = String(req.body && req.body.phone || '').trim();
  const index = db.bookings.findIndex((booking) => booking.id === req.params.id && booking.phone === phone);
  if (index < 0) return res.status(404).json({ error: 'Completed interview not found.' });
  const booking = db.bookings[index];
  const isPast = new Date(`${booking.date}T${booking.time}:00`).getTime() <= Date.now();
  if (!isPast || booking.status === 'cancelled' || booking.status === 'rejected') {
    return res.status(400).json({ error: 'Only completed interviews can be deleted.' });
  }
  db.bookings.splice(index, 1);
  recordActivity('deleted', booking, 'Student deleted a completed interview from their history.');
  persistData();
  res.json({ deleted: true });
});

// Students can update their profile details; the phone number remains their account identifier.
app.patch('/api/students/:phone/profile', (req, res) => {
  const student = db.students[req.params.phone];
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  if (student.active === false) return res.status(403).json({ error: 'Your account has been disabled by the admin.' });
  const name = String(req.body && req.body.name || '').trim();
  const domain = String(req.body && req.body.domain || '').trim();
  if (!name || !domain) return res.status(400).json({ error: 'Name and domain are required.' });
  student.name = name;
  student.domain = domain;
  db.bookings.forEach((booking) => {
    if (booking.phone === student.phone) {
      booking.studentName = name;
      booking.domain = domain;
    }
  });
  persistData();
  res.json({ student });
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

app.patch('/api/cabins/:cabin', requireAdmin, (req, res) => {
  const cabin = req.params.cabin;
  if (!(db.cabins || DEFAULT_CABINS).includes(cabin) || typeof req.body.enabled !== 'boolean') {
    return res.status(400).json({ error: 'Cabin and enabled state are required.' });
  }
  const disabled = new Set(db.disabledCabins || []);
  if (!req.body.enabled) {
    const activeInterview = db.bookings.find((booking) => booking.cabin === cabin && booking.status !== 'rejected' && booking.status !== 'cancelled' && booking.date >= new Date().toISOString().slice(0, 10));
    if (activeInterview) {
      return res.status(409).json({ error: `${cabin} has active interviews. Reschedule or cancel them before disabling the cabin.` });
    }
  }
  if (req.body.enabled) disabled.delete(cabin); else disabled.add(cabin);
  db.disabledCabins = Array.from(disabled);
  persistData();
  res.json({ cabin, enabled: req.body.enabled });
});

app.post('/api/cabins', requireAdmin, (req, res) => {
  const cabin = String(req.body && req.body.cabin || '').trim();
  if (!cabin || cabin.length > 40) return res.status(400).json({ error: 'Enter a cabin name up to 40 characters.' });
  db.cabins = db.cabins || DEFAULT_CABINS;
  if (db.cabins.some((item) => item.toLowerCase() === cabin.toLowerCase())) return res.status(409).json({ error: 'That cabin already exists.' });
  db.cabins.push(cabin);
  persistData();
  res.json({ cabins: db.cabins });
});

// Delete a booking (admin only)
app.delete('/api/bookings/:id', requireAdmin, (req, res) => {
  const index = db.bookings.findIndex((booking) => booking.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Booking not found.' });
  const booking = db.bookings[index];
  db.bookings.splice(index, 1);
  recordActivity('deleted', booking, 'Admin deleted the booking.');
  persistData();
  res.json({ deleted: true });
});

// Delete a student and their bookings (admin only)
app.delete('/api/students/:phone', requireAdmin, (req, res) => {
  const phone = req.params.phone;
  if (!db.students[phone]) return res.status(404).json({ error: 'Student not found.' });
  const deletedBookings = db.bookings.filter((booking) => booking.phone === phone);
  delete db.students[phone];
  db.bookings = db.bookings.filter((booking) => booking.phone !== phone);
  deletedBookings.forEach((booking) => recordActivity('deleted', booking, 'Admin deleted the student and booking.'));
  if (deletedBookings.length === 0) recordActivity('deleted', { studentName: student.name, phone }, 'Admin deleted the student account.');
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
    (b) => b.cabin === cabin && b.date === date && b.status !== 'rejected' && b.status !== 'cancelled' && rangesOverlap(b.time, b.duration || 30, time, dur)
  );
  if (bookedHit) {
    return res.status(409).json({ error: 'A student already has this slot booked. Reject their request first.' });
  }

  db.blockedSlots.push({ cabin, date, time, duration: dur });
  persistData();
  res.json({ blocked: true });
});

app.post('/api/interviewer-availability/toggle', requireAdmin, (req, res) => {
  const { interviewer, date, time, duration } = req.body || {};
  if (!interviewer || !date || !time) return res.status(400).json({ error: 'Interviewer, date and time are required.' });
  db.interviewerAvailability = db.interviewerAvailability || [];
  const dur = VALID_DURATIONS.includes(Number(duration)) ? Number(duration) : 30;
  const index = db.interviewerAvailability.findIndex((item) => item.interviewer === interviewer && item.date === date && item.time === time && (item.duration || 30) === dur);
  if (index >= 0) {
    db.interviewerAvailability.splice(index, 1);
    persistData();
    return res.json({ available: false });
  }
  db.interviewerAvailability.push({ interviewer: String(interviewer).trim(), date, time, duration: dur });
  persistData();
  res.json({ available: true });
});

// Keep unknown API requests JSON instead of allowing the frontend fallback to return HTML.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
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
