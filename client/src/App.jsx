import React, { useState, useEffect, useCallback, useMemo } from 'react';

const CABINS = ['Cabin 1', 'Cabin 2'];
const DAY_START_MIN = 8 * 60; // 8:00 AM
const DAY_END_MIN = 22 * 60; // 10:00 PM
const DURATIONS = [
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
];
const DAYS_AHEAD = 14;

function pad2(n) { return n.toString().padStart(2, '0'); }
function minutesToHHMM(mins) {
  return `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;
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
function slotsForDuration(duration) {
  const slots = [];
  for (let m = DAY_START_MIN; m + duration <= DAY_END_MIN; m += 30) {
    slots.push(minutesToHHMM(m));
  }
  return slots;
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function formatDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function formatTimeLabel(t) {
  const [h, m] = t.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}
function isPastSlot(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`).getTime() <= Date.now();
}

// ---- API helpers ----
async function apiGet(path) {
  const res = await fetch(`/api${path}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function apiPost(path, body, token) {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function apiPatch(path, body, token) {
  const res = await fetch(`/api${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function apiDelete(path, token) {
  const res = await fetch(`/api${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function Badge({ text, kind }) {
  const map = {
    approved: { color: 'var(--approved)', bg: 'var(--approved-soft)' },
    rejected: { color: 'var(--danger)', bg: 'var(--danger-soft)' },
    pending: { color: 'var(--pending)', bg: 'var(--pending-soft)' },
    booked: { color: 'var(--booked)', bg: 'var(--booked-soft)' },
  };
  const s = map[kind] || map.pending;
  return (
    <span className="badge" style={{ color: s.color, background: s.bg }}>
      {text}
    </span>
  );
}

export default function App() {
  const [view, setView] = useState('landing');
  const [loading, setLoading] = useState(false);

  const [students, setStudents] = useState({});
  const [bookings, setBookings] = useState([]);
  const [blockedSlots, setBlockedSlots] = useState([]);

  const [regName, setRegName] = useState('');
  const [regDomain, setRegDomain] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [authError, setAuthError] = useState('');

  const [student, setStudent] = useState(null);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [duration, setDuration] = useState(30);

  const [modalSlot, setModalSlot] = useState(null);
  const [company, setCompany] = useState('');
  const [round, setRound] = useState('');
  const [modalError, setModalError] = useState('');

  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminToken, setAdminToken] = useState(null);
  const [adminFilter, setAdminFilter] = useState('all');
  const [adminDateFilter, setAdminDateFilter] = useState(null);
  const [adminTab, setAdminTab] = useState('requests'); // requests, students, slots
  const [adminSlotDate, setAdminSlotDate] = useState(todayStr());
  const [adminSlotDuration, setAdminSlotDuration] = useState(30);
  const [adminActionError, setAdminActionError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet('/state');
      setStudents(data.students || {});
      setBookings(data.bookings || []);
      setBlockedSlots(data.blockedSlots || []);
    } catch (e) {
      console.error('Failed to load state', e);
    }
  }, []);

  useEffect(() => {
    refresh();
    const savedPhone = localStorage.getItem('scheduler_student_phone');
    const savedAdminToken = sessionStorage.getItem('scheduler_admin_token');
    if (savedAdminToken) {
      setAdminToken(savedAdminToken);
      setView('admin');
    } else if (savedPhone) {
      apiGet(`/state`).then((data) => {
        const rec = data.students[savedPhone];
        if (rec && rec.active !== false) {
          setStudent(rec);
          setView('portal');
        }
      });
    }
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const dateOptions = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(i)), []);
  const maxDate = dateOptions[dateOptions.length - 1];

  function isSlotFree(cabin, date, time, dur, list, blocked) {
    const bookingHit = (list || bookings).find(
      (b) => b.cabin === cabin && b.date === date && b.status !== 'rejected' && rangesOverlap(b.time, b.duration || 30, time, dur)
    );
    if (bookingHit) return { free: false, mine: bookingHit, blocked: false };
    const blockedHit = (blocked || blockedSlots).find(
      (s) => s.cabin === cabin && s.date === date && rangesOverlap(s.time, s.duration || 30, time, dur)
    );
    if (blockedHit) return { free: false, mine: null, blocked: true };
    return { free: true, mine: null, blocked: false };
  }

  async function handleRegisterLogin(e) {
    e.preventDefault();
    setAuthError('');
    const phone = regPhone.trim();
    if (!phone) { setAuthError('Enter your phone number to continue.'); return; }
    if (!/^[0-9+\-\s]{7,15}$/.test(phone)) { setAuthError('Enter a valid phone number.'); return; }
    setLoading(true);
    try {
      const { student: rec } = await apiPost('/register', {
        name: regName.trim(),
        domain: regDomain.trim(),
        phone,
      });
      setStudent(rec);
      localStorage.setItem('scheduler_student_phone', rec.phone);
      await refresh();
      setView('portal');
    } catch (err) {
      setAuthError(err.message);
    }
    setLoading(false);
  }

  function logoutStudent() {
    setStudent(null);
    localStorage.removeItem('scheduler_student_phone');
    setRegName(''); setRegDomain(''); setRegPhone(''); setAuthError('');
    setView('landing');
  }

  function openBookingModal(cabin, date, time) {
    setModalError(''); setCompany(''); setRound('');
    setModalSlot({ cabin, date, time, duration });
  }

  async function submitBooking(e) {
    e.preventDefault();
    setModalError('');
    if (!company.trim() || !round.trim()) {
      setModalError('Enter the company name and interview round.');
      return;
    }
    setLoading(true);
    try {
      await apiPost('/bookings', {
        cabin: modalSlot.cabin,
        date: modalSlot.date,
        time: modalSlot.time,
        duration: modalSlot.duration,
        phone: student.phone,
        studentName: student.name,
        domain: student.domain,
        company: company.trim(),
        round: round.trim(),
      });
      await refresh();
      setModalSlot(null);
    } catch (err) {
      setModalError(err.message);
    }
    setLoading(false);
  }

  async function handleAdminLogin(e) {
    e.preventDefault();
    setAdminError('');
    setLoading(true);
    try {
      const { token } = await apiPost('/admin/login', { email: adminEmail, password: adminPassword });
      setAdminToken(token);
      sessionStorage.setItem('scheduler_admin_token', token);
      await refresh();
      setView('admin');
    } catch (err) {
      setAdminError(err.message);
    }
    setLoading(false);
  }

  function logoutAdmin() {
    setAdminToken(null);
    sessionStorage.removeItem('scheduler_admin_token');
    setAdminEmail(''); setAdminPassword(''); setAdminError('');
    setView('landing');
  }

  async function setBookingStatus(id, status) {
    setLoading(true);
    try {
      await apiPatch(`/bookings/${id}`, { status }, adminToken);
      await refresh();
    } catch (err) {
      alert(err.message);
    }
    setLoading(false);
  }

  async function toggleStudentActive(phone, active) {
    setAdminActionError('');
    setLoading(true);
    try {
      await apiPatch(`/students/${encodeURIComponent(phone)}`, { active }, adminToken);
      await refresh();
    } catch (err) {
      setAdminActionError(err.message);
    }
    setLoading(false);
  }

  async function deleteBooking(booking) {
    if (!window.confirm(`Delete the ${booking.status} booking for ${booking.studentName}?`)) return;
    setAdminActionError('');
    setLoading(true);
    try {
      await apiDelete(`/bookings/${encodeURIComponent(booking.id)}`, adminToken);
      await refresh();
    } catch (err) {
      setAdminActionError(err.message);
    }
    setLoading(false);
  }

  async function deleteStudent(studentRecord) {
    if (!window.confirm(`Delete ${studentRecord.name} and all of their bookings?`)) return;
    setAdminActionError('');
    setLoading(true);
    try {
      await apiDelete(`/students/${encodeURIComponent(studentRecord.phone)}`, adminToken);
      await refresh();
    } catch (err) {
      setAdminActionError(err.message);
    }
    setLoading(false);
  }

  async function toggleSlotBlocked(cabin, date, time, dur) {
    setAdminActionError('');
    setLoading(true);
    try {
      await apiPost('/slots/toggle', { cabin, date, time, duration: dur }, adminToken);
      await refresh();
    } catch (err) {
      setAdminActionError(err.message);
    }
    setLoading(false);
  }

  // ---------- LANDING ----------
  if (view === 'landing') {
    return (
      <div className="container">
        <h1 className="serif" style={{ fontSize: '2rem', lineHeight: 1.15, marginBottom: 8 }}>
          Book your interview slot
        </h1>
        <p style={{ color: 'var(--ink-soft)', maxWidth: 420, marginBottom: 32 }}>
          Two interview cabins, real-time availability, 8:00 AM to 10:00 PM. Register once,
          then pick a free slot and enter the company and round you're interviewing for.
        </p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={() => setView('student-auth')}>
            Continue as a student
          </button>
          <button className="btn btn-outline" onClick={() => setView('admin-login')}>
            Admin sign in
          </button>
        </div>
      </div>
    );
  }

  // ---------- STUDENT AUTH ----------
  if (view === 'student-auth') {
    return (
      <div className="container">
        <button className="link-btn" style={{ marginBottom: 24 }} onClick={() => setView('landing')}>
          ← Back
        </button>
        <h2 className="serif" style={{ fontSize: '1.5rem', marginBottom: 4 }}>Student sign in</h2>
        <p style={{ color: 'var(--ink-soft)', fontSize: '0.9rem', marginBottom: 24 }}>
          Already registered? Just enter your phone number. First time? Fill in all three fields.
        </p>
        <form onSubmit={handleRegisterLogin} style={{ maxWidth: 360 }}>
          <div className="field">
            <label>Full name</label>
            <input value={regName} onChange={(e) => setRegName(e.target.value)} placeholder="e.g. Ananya Rao" />
          </div>
          <div className="field">
            <label>Domain</label>
            <input value={regDomain} onChange={(e) => setRegDomain(e.target.value)} placeholder="e.g. Frontend Development" />
          </div>
          <div className="field">
            <label>Phone number</label>
            <input value={regPhone} onChange={(e) => setRegPhone(e.target.value)} placeholder="e.g. 9876543210" />
          </div>
          {authError && <p className="error-text" style={{ marginBottom: 12 }}>{authError}</p>}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Please wait…' : 'Continue'}
          </button>
        </form>
      </div>
    );
  }

  // ---------- STUDENT PORTAL ----------
  if (view === 'portal' && student) {
    const myBookings = bookings
      .filter((b) => b.phone === student.phone)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    const times = slotsForDuration(duration);

    return (
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h2 className="serif" style={{ fontSize: '1.4rem' }}>Hi, {student.name}</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{student.domain}</p>
          </div>
          <button className="link-btn" onClick={logoutStudent}>Sign out</button>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
          <div className="field" style={{ maxWidth: 220 }}>
            <label>Pick a date</label>
            <input
              type="date"
              value={selectedDate}
              min={todayStr()}
              max={maxDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <div className="field" style={{ maxWidth: 200 }}>
            <label>Slot length</label>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => (
                <option key={d.value} value={d.value}>{d.label}</option>
              ))}
            </select>
          </div>
        </div>
        <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: 16 }}>
          {formatDateLabel(selectedDate)} · Interview hours 8:00 AM – 10:00 PM
        </p>

        {myBookings.filter((b) => b.status === 'approved').map((b) => (
          <div
            key={`notice-${b.id}`}
            className="card"
            style={{ marginBottom: 12, background: 'var(--approved-soft)', borderColor: 'var(--approved)' }}
          >
            <p style={{ margin: 0, lineHeight: 1.6, fontSize: '0.9rem' }}>
              Hi, {student.name}! Your {b.company} interview request has been approved and scheduled for{' '}
              {b.date === todayStr() ? 'today' : formatDateLabel(b.date)} at {formatTimeLabel(b.time)} for {b.duration || 30} minutes.
              Please join the interview at the scheduled time. All the best!
            </p>
          </div>
        ))}

        <div className="table" style={{ marginBottom: 32 }}>
          <div className="table-header">
            <div className="table-cell label" style={{ fontWeight: 500 }}>Time</div>
            {CABINS.map((c) => (
              <div key={c} className="table-cell" style={{ fontWeight: 500 }}>{c}</div>
            ))}
          </div>
          {times.map((time) => {
            const past = isPastSlot(selectedDate, time);
            return (
              <div key={time} className="table-row">
                <div className="table-cell label">{formatTimeLabel(time)}</div>
                {CABINS.map((cabin) => {
                  const { free, mine, blocked } = isSlotFree(cabin, selectedDate, time, duration);
                  let content;
                  if (past) {
                    content = <span style={{ fontSize: '0.75rem', color: 'var(--ink-soft)' }}>Past</span>;
                  } else if (mine && mine.phone === student.phone) {
                    content = (
                      <div style={{ fontSize: '0.75rem', textAlign: 'center' }}>
                        <Badge text={mine.status === 'approved' ? 'Approved' : mine.status === 'rejected' ? 'Rejected' : 'Pending'} kind={mine.status} />
                        <div style={{ marginTop: 4, color: 'var(--ink-soft)' }}>{mine.company}</div>
                      </div>
                    );
                  } else if (!free) {
                    content = <Badge text={blocked ? 'Unavailable' : 'Full'} kind="booked" />;
                  } else {
                    content = (
                      <button className="btn btn-small" style={{ background: 'var(--accent-soft)', color: 'var(--accent-dark)' }}
                        onClick={() => openBookingModal(cabin, selectedDate, time)}>
                        Book
                      </button>
                    );
                  }
                  return <div key={cabin} className="table-cell">{content}</div>;
                })}
              </div>
            );
          })}
        </div>

        <h3 className="serif" style={{ fontSize: '1.1rem', marginBottom: 12 }}>Your interview requests</h3>
        {myBookings.length === 0 ? (
          <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)' }}>No requests yet. Book a slot above.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {myBookings.map((b) => (
              <div key={b.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.9rem' }}>
                  <div style={{ fontWeight: 500 }}>{b.company} · {b.round}</div>
                  <div style={{ color: 'var(--ink-soft)' }}>
                    {b.cabin} · {formatDateLabel(b.date)} · {formatTimeLabel(b.time)} · {b.duration || 30} min
                  </div>
                </div>
                <Badge text={b.status === 'approved' ? 'Approved' : b.status === 'rejected' ? 'Rejected' : 'Pending'} kind={b.status} />
              </div>
            ))}
          </div>
        )}

        {modalSlot && (
          <div className="modal-backdrop">
            <div className="modal">
              <h3 className="serif" style={{ fontSize: '1.2rem', marginBottom: 4 }}>Confirm your slot</h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', marginBottom: 16 }}>
                {modalSlot.cabin} · {formatDateLabel(modalSlot.date)} · {formatTimeLabel(modalSlot.time)} · {modalSlot.duration} min
              </p>
              <form onSubmit={submitBooking}>
                <div className="field">
                  <label>Company name</label>
                  <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Northwind Traders" />
                </div>
                <div className="field">
                  <label>Interview round</label>
                  <input value={round} onChange={(e) => setRound(e.target.value)} placeholder="e.g. Technical round 1" />
                </div>
                {modalError && <p className="error-text" style={{ marginBottom: 12 }}>{modalError}</p>}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? 'Booking…' : 'Book slot'}
                  </button>
                  <button type="button" className="btn btn-outline" onClick={() => setModalSlot(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------- ADMIN LOGIN ----------
  if (view === 'admin-login') {
    return (
      <div className="container">
        <button className="link-btn" style={{ marginBottom: 24 }} onClick={() => setView('landing')}>
          ← Back
        </button>
        <h2 className="serif" style={{ fontSize: '1.5rem', marginBottom: 24 }}>Admin sign in</h2>
        <form onSubmit={handleAdminLogin} style={{ maxWidth: 360 }}>
          <div className="field">
            <label>Email</label>
            <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
          </div>
          {adminError && <p className="error-text" style={{ marginBottom: 12 }}>{adminError}</p>}
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    );
  }

  // ---------- ADMIN DASHBOARD ----------
  if (view === 'admin' && adminToken) {
    const total = bookings.length;
    const pendingCount = bookings.filter((b) => b.status === 'pending').length;
    const approvedCount = bookings.filter((b) => b.status === 'approved').length;
    const rejectedCount = bookings.filter((b) => b.status === 'rejected').length;

    const filtered = bookings
      .filter((b) => {
        if (adminDateFilter && b.date !== adminDateFilter) return false;
        if (adminFilter === 'today') return b.date === todayStr();
        return adminFilter === 'all' || b.status === adminFilter;
      })
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    const filters = [
      { key: 'all', label: 'All' },
      { key: 'today', label: "Today's interviews" },
      { key: 'pending', label: 'Pending' },
      { key: 'approved', label: 'Approved' },
      { key: 'rejected', label: 'Rejected' },
    ];

    const tabs = [
      { key: 'requests', label: 'Requests' },
      { key: 'students', label: 'Students' },
      { key: 'slots', label: 'Slot availability' },
    ];

    const studentList = Object.values(students).sort((a, b) => a.name.localeCompare(b.name));
    const adminTimes = slotsForDuration(adminSlotDuration);
    const dailyInterviewCounts = dateOptions.map((date) => {
      const dayBookings = bookings.filter((booking) => booking.date === date);
      return {
        date,
        total: dayBookings.length,
        pending: dayBookings.filter((booking) => booking.status === 'pending').length,
        approved: dayBookings.filter((booking) => booking.status === 'approved').length,
        rejected: dayBookings.filter((booking) => booking.status === 'rejected').length,
      };
    });

    return (
      <div className="container">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 className="serif" style={{ fontSize: '1.5rem' }}>Admin dashboard</h2>
          <button className="link-btn" onClick={logoutAdmin}>Sign out</button>
        </div>

        <div className="stat-grid">
          {[
            ['Total interviews', total, 'var(--ink)'],
            ['Pending', pendingCount, 'var(--pending)'],
            ['Approved', approvedCount, 'var(--approved)'],
            ['Rejected', rejectedCount, 'var(--danger)'],
          ].map(([label, val, color]) => (
            <div key={label} className="stat-box">
              <div className="serif stat-value" style={{ color }}>{val}</div>
              <div className="stat-label">{label}</div>
            </div>
          ))}
        </div>

        <div className="card" style={{ marginBottom: 24 }}>
          <h3 className="serif" style={{ fontSize: '1.15rem', margin: '0 0 4px' }}>Interviews by day</h3>
          <p style={{ color: 'var(--ink-soft)', fontSize: '0.85rem', margin: '0 0 12px' }}>
            Upcoming interview requests for the next {DAYS_AHEAD} days
          </p>
          <div className="daily-count-list">
            {dailyInterviewCounts.map((day) => (
              <button
                key={day.date}
                className={`daily-count-row ${adminDateFilter === day.date ? 'selected' : ''}`}
                onClick={() => {
                  setAdminDateFilter(day.date);
                  setAdminFilter('all');
                  setAdminTab('requests');
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{formatDateLabel(day.date)}</div>
                  <div style={{ color: 'var(--ink-soft)', fontSize: '0.75rem' }}>
                    {day.approved} approved · {day.pending} pending · {day.rejected} rejected
                  </div>
                </div>
                <div className="daily-count-total">
                  <span className="serif">{day.total}</span>
                  <span>interview{day.total === 1 ? '' : 's'}</span>
                </div>
              </button>
            ))}
          </div>
          {adminDateFilter && (
            <button
              className="link-btn"
              style={{ marginTop: 10 }}
              onClick={() => setAdminDateFilter(null)}
            >
              Show all dates
            </button>
          )}
        </div>

        <div className="filter-row">
          {tabs.map((t) => (
            <button key={t.key} className={`filter-chip ${adminTab === t.key ? 'active' : ''}`} onClick={() => setAdminTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {adminActionError && <p className="error-text" style={{ marginBottom: 16 }}>{adminActionError}</p>}

        {adminTab === 'requests' && (
          <>
            <div className="filter-row">
              {filters.map((f) => (
                <button
                  key={f.key}
                  className={`filter-chip ${adminFilter === f.key ? 'active' : ''}`}
                  onClick={() => {
                    setAdminFilter(f.key);
                    if (f.key === 'all' || f.key === 'today') setAdminDateFilter(null);
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {filtered.length === 0 ? (
              <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)' }}>No requests in this view.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {filtered.map((b) => (
                  <div key={b.id} className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: '0.9rem' }}>
                        <div style={{ fontWeight: 500 }}>
                          {b.studentName} <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>· {b.domain}</span>
                        </div>
                        <div style={{ color: 'var(--ink-soft)' }}>{b.phone}</div>
                        <div style={{ marginTop: 4 }}>{b.company} · {b.round}</div>
                        <div style={{ color: 'var(--ink-soft)' }}>
                          {b.cabin} · {formatDateLabel(b.date)} · {formatTimeLabel(b.time)} · {b.duration || 30} min
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                        <Badge text={b.status === 'approved' ? 'Approved' : b.status === 'rejected' ? 'Rejected' : 'Pending'} kind={b.status} />
                        {b.status === 'pending' && (
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn btn-small" style={{ background: 'var(--approved)', color: '#fff' }} onClick={() => setBookingStatus(b.id, 'approved')}>
                              Give access
                            </button>
                            <button className="btn btn-small btn-outline" onClick={() => setBookingStatus(b.id, 'rejected')}>
                              Reject
                            </button>
                          </div>
                        )}
                        {b.status !== 'pending' && (
                          <button className="btn btn-small btn-outline" style={{ color: 'var(--danger)' }} onClick={() => deleteBooking(b)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {adminTab === 'students' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {studentList.length === 0 ? (
              <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)' }}>No students registered yet.</p>
            ) : (
              studentList.map((s) => (
                <div key={s.phone} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ fontSize: '0.9rem' }}>
                    <div style={{ fontWeight: 500 }}>{s.name} <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>· {s.domain}</span></div>
                    <div style={{ color: 'var(--ink-soft)' }}>{s.phone}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Badge text={s.active === false ? 'Disabled' : 'Active'} kind={s.active === false ? 'rejected' : 'approved'} />
                    <button
                      className="btn btn-small btn-outline"
                      onClick={() => toggleStudentActive(s.phone, s.active === false)}
                    >
                      {s.active === false ? 'Enable' : 'Disable'}
                    </button>
                    <button className="btn btn-small btn-outline" style={{ color: 'var(--danger)' }} onClick={() => deleteStudent(s)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {adminTab === 'slots' && (
          <div>
            <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)', marginBottom: 12 }}>
              Click an open slot to mark it unavailable (e.g. cabin closed, staff unavailable). Click again to reopen it.
              Slots already booked by a student can't be blocked here — reject their request first if needed.
            </p>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
              <div className="field" style={{ maxWidth: 220 }}>
                <label>Date</label>
                <input type="date" value={adminSlotDate} min={todayStr()} max={maxDate} onChange={(e) => setAdminSlotDate(e.target.value)} />
              </div>
              <div className="field" style={{ maxWidth: 200 }}>
                <label>Slot length</label>
                <select value={adminSlotDuration} onChange={(e) => setAdminSlotDuration(Number(e.target.value))}>
                  {DURATIONS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="table">
              <div className="table-header">
                <div className="table-cell label" style={{ fontWeight: 500 }}>Time</div>
                {CABINS.map((c) => (
                  <div key={c} className="table-cell" style={{ fontWeight: 500 }}>{c}</div>
                ))}
              </div>
              {adminTimes.map((time) => (
                <div key={time} className="table-row">
                  <div className="table-cell label">{formatTimeLabel(time)}</div>
                  {CABINS.map((cabin) => {
                    const { free, mine, blocked } = isSlotFree(cabin, adminSlotDate, time, adminSlotDuration);
                    let content;
                    if (mine) {
                      content = <Badge text="Booked" kind="booked" />;
                    } else if (blocked) {
                      content = (
                        <button className="btn btn-small" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
                          onClick={() => toggleSlotBlocked(cabin, adminSlotDate, time, adminSlotDuration)}>
                          Unavailable
                        </button>
                      );
                    } else {
                      content = (
                        <button className="btn btn-small btn-outline"
                          onClick={() => toggleSlotBlocked(cabin, adminSlotDate, time, adminSlotDuration)}>
                          Open
                        </button>
                      );
                    }
                    return <div key={cabin} className="table-cell">{content}</div>;
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
