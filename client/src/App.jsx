import React, { useState, useEffect, useCallback, useMemo } from 'react';

const CABINS = ['Cabin 1', 'Cabin 2'];
const DAY_START_MIN = 8 * 60; // 8:00 AM
const DAY_END_MIN = 22 * 60; // 10:00 PM
const DURATIONS = [
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
];
const DAYS_AHEAD = 14;
const ADMIN_CONTACT = 'vishnavqa@gmail.com';
const APP_VERSION = '1.0.0';

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
  for (let m = DAY_START_MIN; m + duration <= DAY_END_MIN; m += duration) {
    slots.push(minutesToHHMM(m));
  }
  return slots;
}
function todayStr() {
  return dateKeyFromLocalDate(new Date());
}
function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dateKeyFromLocalDate(d);
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
function dateKeyFromLocalDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
function calendarDays(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return [
    ...Array(firstDay.getDay()).fill(null),
    ...Array.from({ length: daysInMonth }, (_, index) => dateKeyFromLocalDate(new Date(year, month, index + 1))),
  ];
}
function isPastSlot(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`).getTime() <= Date.now();
}

function statusLabel(status) {
  return status === 'approved' ? 'Approved' : status === 'rejected' ? 'Rejected' : status === 'cancelled' ? 'Cancelled' : 'Pending';
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
    rejected: { color: 'var(--rejected)', bg: 'var(--rejected-soft)' },
    cancelled: { color: 'var(--cancelled)', bg: 'var(--cancelled-soft)' },
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

function AppFooter() {
  return (
    <footer className="app-footer">
      <span>Interview Scheduler v{APP_VERSION}</span>
      <a href={`mailto:${ADMIN_CONTACT}`}>Support: {ADMIN_CONTACT}</a>
      <details>
        <summary>Help / FAQ</summary>
        <div className="faq-list">
          <p><strong>How do I book?</strong> Choose a date, duration, cabin, and available slot.</p>
          <p><strong>When is a booking confirmed?</strong> After an admin approves the request.</p>
          <p><strong>Can I change my booking?</strong> Use Reschedule or Cancel in your portal.</p>
        </div>
      </details>
    </footer>
  );
}

export default function App() {
  const [view, setView] = useState('landing');
  const [loading, setLoading] = useState(false);

  const [students, setStudents] = useState({});
  const [bookings, setBookings] = useState([]);
  const [blockedSlots, setBlockedSlots] = useState([]);
  const [disabledCabins, setDisabledCabins] = useState([]);
  const [activityHistory, setActivityHistory] = useState([]);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [loadError, setLoadError] = useState('');
  const [stateLoading, setStateLoading] = useState(false);

  const [regName, setRegName] = useState('');
  const [regDomain, setRegDomain] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [authError, setAuthError] = useState('');

  const [student, setStudent] = useState(null);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [duration, setDuration] = useState(30);
  const [studentCalendarMonth, setStudentCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [studentScheduleView, setStudentScheduleView] = useState('calendar');
  const [bookingSuccess, setBookingSuccess] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileDomain, setProfileDomain] = useState('');
  const [profileError, setProfileError] = useState('');
  const [cancelBooking, setCancelBooking] = useState(null);
  const [cancelReason, setCancelReason] = useState('');

  const [modalSlot, setModalSlot] = useState(null);
  const [company, setCompany] = useState('');
  const [round, setRound] = useState('');
  const [interviewer, setInterviewer] = useState('');
  const [modalError, setModalError] = useState('');

  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  const [adminToken, setAdminToken] = useState(null);
  const [adminFilter, setAdminFilter] = useState('all');
  const [adminDateFilter, setAdminDateFilter] = useState(null);
  const [adminCalendarMonth, setAdminCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [adminTab, setAdminTab] = useState('requests'); // requests, students, slots
  const [adminSlotDate, setAdminSlotDate] = useState(todayStr());
  const [adminSlotDuration, setAdminSlotDuration] = useState(30);
  const [adminActionError, setAdminActionError] = useState('');
  const [adminSearch, setAdminSearch] = useState('');
  const [adminCabinFilter, setAdminCabinFilter] = useState('all');
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatus, setHistoryStatus] = useState('all');
  const [adminStudentSearch, setAdminStudentSearch] = useState('');
  const [adminRequestPage, setAdminRequestPage] = useState(1);
  const [adminStudentPage, setAdminStudentPage] = useState(1);
  const [rescheduleBooking, setRescheduleBooking] = useState(null);
  const [rescheduleCabin, setRescheduleCabin] = useState(CABINS[0]);
  const [rescheduleDate, setRescheduleDate] = useState(todayStr());
  const [rescheduleTime, setRescheduleTime] = useState('09:00');
  const [rescheduleDuration, setRescheduleDuration] = useState(30);
  const PAGE_SIZE = 8;

  const refresh = useCallback(async () => {
    setStateLoading(true);
    try {
      const data = await apiGet('/state');
      setStudents(data.students || {});
      setBookings(data.bookings || []);
      setBlockedSlots(data.blockedSlots || []);
      setDisabledCabins(data.disabledCabins || []);
      setActivityHistory(data.activityHistory || []);
      setLastRefreshed(new Date());
      setLoadError('');
    } catch (e) {
      console.error('Failed to load state', e);
      setLoadError('We could not load the latest schedule.');
    } finally {
      setStateLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const savedPhone = localStorage.getItem('scheduler_student_phone');
    const savedAdminToken = sessionStorage.getItem('scheduler_admin_token');
    const savedAdminExpiry = Number(sessionStorage.getItem('scheduler_admin_expires') || 0);
    if (savedAdminToken && savedAdminExpiry > Date.now()) {
      setAdminToken(savedAdminToken);
      setView('admin');
    } else if (savedPhone) {
      apiGet(`/state`).then((data) => {
        const rec = data.students[savedPhone];
        if (rec && rec.active !== false) {
          setStudent(rec);
          setView('portal');
        }
      }).catch(() => setLoadError('We could not load your student account.'));
    }
  }, [refresh]);

  useEffect(() => {
    if (!adminToken) return undefined;
    const id = setInterval(() => {
      const expiry = Number(sessionStorage.getItem('scheduler_admin_expires') || 0);
      if (!expiry || expiry <= Date.now()) {
        setAdminToken(null);
        sessionStorage.removeItem('scheduler_admin_token');
        sessionStorage.removeItem('scheduler_admin_expires');
        setView('admin-login');
        setAdminError('Your admin session expired. Please sign in again.');
      }
    }, 10000);
    return () => clearInterval(id);
  }, [adminToken]);

  useEffect(() => {
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const dateOptions = useMemo(() => Array.from({ length: DAYS_AHEAD }, (_, i) => addDays(i)), []);
  const maxDate = dateOptions[dateOptions.length - 1];

  function isSlotFree(cabin, date, time, dur, list, blocked) {
    if (disabledCabins.includes(cabin)) return { free: false, mine: null, blocked: true, disabled: true };
    const bookingHit = (list || bookings).find(
      (b) => b.cabin === cabin && b.date === date && b.status !== 'rejected' && b.status !== 'cancelled' && rangesOverlap(b.time, b.duration || 30, time, dur)
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
    setModalError(''); setCompany(''); setRound(''); setInterviewer('');
    setModalSlot({ cabin, date, time, duration });
  }

  async function submitBooking(e) {
    e.preventDefault();
    setModalError('');
    if (!company.trim() || !round.trim()) {
      setModalError('Enter the company name and interview round.');
      return;
    }
    const studentClash = bookings.find((b) => b.phone === student.phone && b.status !== 'rejected' && b.status !== 'cancelled' &&
      b.date === modalSlot.date && rangesOverlap(b.time, b.duration || 30, modalSlot.time, modalSlot.duration));
    if (studentClash) {
      setModalError('You already have an interview booked during this time.');
      return;
    }
    setLoading(true);
    try {
      const { booking } = await apiPost('/bookings', {
        cabin: modalSlot.cabin,
        date: modalSlot.date,
        time: modalSlot.time,
        duration: modalSlot.duration,
        phone: student.phone,
        studentName: student.name,
        domain: student.domain,
        company: company.trim(),
        round: round.trim(),
        interviewer: interviewer.trim(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setModalSlot(null);
      setBookingSuccess({
        company: booking.company, round: booking.round, interviewer: booking.interviewer,
        cabin: booking.cabin, date: booking.date, time: booking.time,
        duration: booking.duration, status: booking.status,
      });
      await refresh();
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
      sessionStorage.setItem('scheduler_admin_expires', String(Date.now() + 30 * 60 * 1000));
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
    sessionStorage.removeItem('scheduler_admin_expires');
    setAdminEmail(''); setAdminPassword(''); setAdminError('');
    setView('landing');
  }

  async function setBookingStatus(id, status) {
    if (!window.confirm(`${status === 'approved' ? 'Approve' : status === 'rejected' ? 'Reject' : status === 'cancelled' ? 'Cancel' : 'Set pending'} this interview request?`)) return;
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

  function openReschedule(booking) {
    setRescheduleBooking(booking);
    setRescheduleCabin(booking.cabin);
    setRescheduleDate(booking.date);
    setRescheduleTime(booking.time);
    setRescheduleDuration(booking.duration || 30);
    setAdminActionError('');
  }

  function changeRescheduleDuration(value) {
    setRescheduleDuration(value);
    const nextTimes = slotsForDuration(value).filter((time) => !isPastSlot(rescheduleDate, time));
    if (nextTimes.length && !nextTimes.includes(rescheduleTime)) setRescheduleTime(nextTimes[0]);
  }

  async function saveReschedule(e) {
    e.preventDefault();
    if (!rescheduleBooking) return;
    if (isPastSlot(rescheduleDate, rescheduleTime)) {
      setModalError('Choose a future date and time.');
      return;
    }
    if (!window.confirm(`Reschedule this interview to ${formatDateLabel(rescheduleDate)} at ${formatTimeLabel(rescheduleTime)}?`)) return;
    setAdminActionError('');
    setLoading(true);
    try {
      const path = adminToken ? `/bookings/${encodeURIComponent(rescheduleBooking.id)}` : `/student/bookings/${encodeURIComponent(rescheduleBooking.id)}`;
      const body = adminToken
        ? { cabin: rescheduleCabin, date: rescheduleDate, time: rescheduleTime, duration: rescheduleDuration }
        : { phone: student.phone, cabin: rescheduleCabin, date: rescheduleDate, time: rescheduleTime, duration: rescheduleDuration, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
      await apiPatch(path, body, adminToken);
      await refresh();
      setRescheduleBooking(null);
    } catch (err) {
      setAdminActionError(err.message);
      setModalError(err.message);
    }
    setLoading(false);
  }

  async function cancelStudentBooking(booking) {
    setCancelBooking(booking);
    setCancelReason('');
    setModalError('');
  }

  async function submitCancellation(e) {
    e.preventDefault();
    if (!cancelBooking) return;
    if (!cancelReason.trim()) {
      setModalError('Please provide a reason for cancelling.');
      return;
    }
    if (!window.confirm(`Cancel your ${cancelBooking.company} interview on ${formatDateLabel(cancelBooking.date)} at ${formatTimeLabel(cancelBooking.time)}?`)) return;
    setLoading(true);
    setModalError('');
    try {
      await apiPatch(`/student/bookings/${encodeURIComponent(cancelBooking.id)}`, {
        phone: student.phone,
        action: 'cancel',
        cancelReason: cancelReason.trim(),
      });
      await refresh();
      setCancelBooking(null);
      setCancelReason('');
    } catch (err) {
      setModalError(err.message);
    }
    setLoading(false);
  }

  function openProfile() {
    setProfileName(student.name || '');
    setProfileDomain(student.domain || '');
    setProfileError('');
    setProfileOpen(true);
  }

  async function saveProfile(e) {
    e.preventDefault();
    if (!profileName.trim() || !profileDomain.trim()) {
      setProfileError('Name and domain are required.');
      return;
    }
    if (!window.confirm('Save these profile changes?')) return;
    setLoading(true);
    setProfileError('');
    try {
      const { student: updated } = await apiPatch(`/students/${encodeURIComponent(student.phone)}/profile`, {
        name: profileName.trim(),
        domain: profileDomain.trim(),
      });
      setStudent(updated);
      await refresh();
      setProfileOpen(false);
    } catch (err) {
      setProfileError(err.message);
    }
    setLoading(false);
  }

  async function toggleCabin(cabin) {
    setAdminActionError('');
    setLoading(true);
    try {
      await apiPatch(`/cabins/${encodeURIComponent(cabin)}`, { enabled: disabledCabins.includes(cabin) }, adminToken);
      await refresh();
    } catch (err) {
      setAdminActionError(err.message);
    }
    setLoading(false);
  }

  async function copyBookingDetails(booking) {
    const details = `${booking.company} · ${booking.round}\n${formatDateLabel(booking.date)} at ${formatTimeLabel(booking.time)}\n${booking.cabin} · ${booking.duration || 30} minutes\nInterviewer: ${booking.interviewer || 'Not assigned'}\nStatus: ${statusLabel(booking.status)}`;
    try {
      await navigator.clipboard.writeText(details);
      setBookingSuccess({ message: 'Booking details copied to your clipboard.' });
    } catch (error) {
      setBookingSuccess({ message: details });
    }

    function exportDailySchedule(date) {
      const rows = bookings.filter((booking) => booking.date === date && booking.status !== 'cancelled' && booking.status !== 'rejected');
      const headers = ['Date', 'Time', 'Cabin', 'Student', 'Phone', 'Company', 'Round', 'Interviewer', 'Duration', 'Status'];
      const values = rows.map((booking) => [booking.date, booking.time, booking.cabin, booking.studentName, booking.phone, booking.company, booking.round, booking.interviewer || '', booking.duration || 30, booking.status]);
      const csv = [headers, ...values].map((row) => row.map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `interview-schedule-${date}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    }
  }

  // ---------- LANDING ----------
  if (view === 'landing') {
    return (
      <div className="container landing-page">
        <section className="landing-hero">
          <div className="landing-copy">
            <p className="landing-eyebrow">PLACEMENT OPERATIONS PLATFORM</p>
            <h1 className="serif">Welcome to <span>Placement Assist</span></h1>
            <p className="landing-description">A simple, organized way to book, manage, and track interview schedules in real time.</p>
            <div className="landing-actions">
              <button className="btn btn-primary" onClick={() => setView('student-auth')}>Student login</button>
              <button className="btn btn-outline" onClick={() => setView('admin-login')}>Admin login</button>
            </div>
            <p className="landing-trust">Secure scheduling · Live availability · Clear status updates</p>
          </div>
          <div className="landing-visual" aria-hidden="true">
            <div className="landing-calendar-icon">▦</div>
            <strong>Interview day,<br />organized.</strong>
            <span>Pick a date. Find a slot. Stay on track.</span>
          </div>
        </section>
        <div className="landing-features">
          <div><strong>01</strong><span>Easy booking</span><small>Choose a suitable date and time.</small></div>
          <div><strong>02</strong><span>Live availability</span><small>See open cabins before booking.</small></div>
          <div><strong>03</strong><span>Clear updates</span><small>Track approval and interview status.</small></div>
        </div>
        <AppFooter />
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
        <AppFooter />
      </div>
    );
  }

  // ---------- STUDENT PORTAL ----------
  if (view === 'portal' && student) {
    const myBookings = bookings
      .filter((b) => b.phone === student.phone)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const historyBookings = myBookings.filter((b) => (
      (!historyStatus || historyStatus === 'all' || b.status === historyStatus) &&
      (!historySearch.trim() || [b.company, b.round].some((value) => String(value || '').toLowerCase().includes(historySearch.trim().toLowerCase())))
    ));
    const upcomingBookings = historyBookings.filter((b) => !isPastSlot(b.date, b.time));
    const pastBookings = historyBookings.filter((b) => isPastSlot(b.date, b.time));

    const times = slotsForDuration(duration).filter((time) => !isPastSlot(selectedDate, time));
    const studentCalendarCounts = myBookings.reduce((counts, booking) => {
      if (!counts[booking.date]) counts[booking.date] = { total: 0, statuses: {} };
      counts[booking.date].total += 1;
      counts[booking.date].statuses[booking.status] = (counts[booking.date].statuses[booking.status] || 0) + 1;
      return counts;
    }, {});
    const studentCalendarDates = calendarDays(studentCalendarMonth);
    const availableSlotCount = times.reduce((count, time) => (
      count + CABINS.reduce((cabinCount, cabin) => (
        cabinCount + (isSlotFree(cabin, selectedDate, time, duration).free ? 1 : 0)
      ), 0)
    ), 0);
    const availableByCabin = CABINS.reduce((counts, cabin) => {
      counts[cabin] = times.filter((time) => isSlotFree(cabin, selectedDate, time, duration).free).length;
      return counts;
    }, {});
    const upcomingApproved = myBookings.find((booking) => booking.status === 'approved' && new Date(`${booking.date}T${booking.time}:00`).getTime() > now);
    const countdownLabel = upcomingApproved ? (() => {
      const seconds = Math.max(0, Math.floor((new Date(`${upcomingApproved.date}T${upcomingApproved.time}:00`).getTime() - now) / 1000));
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${days ? `${days}d ` : ''}${hours}h ${minutes}m`;
    })() : '';
    const orderedTimes = [...times].sort((a, b) => {
      const availableA = CABINS.filter((cabin) => isSlotFree(cabin, selectedDate, a, duration).free).length;
      const availableB = CABINS.filter((cabin) => isSlotFree(cabin, selectedDate, b, duration).free).length;
      return availableB - availableA || a.localeCompare(b);
    });
    const rescheduleTimes = slotsForDuration(rescheduleDuration).filter((time) => !isPastSlot(rescheduleDate, time));
    const reschedulePast = isPastSlot(rescheduleDate, rescheduleTime);

    return (
      <div className="container">
        <div className="student-header">
          <div>
            <h2 className="serif student-welcome-title">Welcome to <span>Placement Assist</span></h2>
            <p className="student-greeting">Hello, <strong>{student.name}</strong></p>
            <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{student.domain} · {student.phone}</p>
            <p className="loading-text">Last refreshed: {lastRefreshed ? lastRefreshed.toLocaleTimeString() : '—'}</p>
          </div>
          {loadError && (
            <div className="card retry-banner">
              <span>{loadError}</span>
              <button className="btn btn-small btn-outline" onClick={refresh}>Retry</button>
            </div>
          )}
          {stateLoading && <p className="loading-text">Refreshing schedule…</p>}
          <button className="btn btn-small btn-outline" onClick={logoutStudent}>Sign out</button>
        </div>
        <div className="student-actions">
          <button className="btn btn-small btn-outline" onClick={openProfile}>Edit profile</button>
          <button className="btn btn-small btn-outline" onClick={refresh} disabled={stateLoading}>
            {stateLoading ? 'Refreshing…' : 'Refresh schedule'}
          </button>
        </div>
        {bookingSuccess && (
          <div className="card success-banner" role="status">
            {bookingSuccess.message ? <span style={{ whiteSpace: 'pre-wrap' }}>{bookingSuccess.message}</span> : (
              <div>
                <strong>Booking request sent — confirmation details</strong>
                <div style={{ marginTop: 6, fontSize: '0.85rem' }}>{bookingSuccess.company} · {bookingSuccess.round} · {formatDateLabel(bookingSuccess.date)} · {formatTimeLabel(bookingSuccess.time)} · {bookingSuccess.cabin} · {bookingSuccess.duration} min</div>
                <div style={{ marginTop: 4, fontSize: '0.8rem' }}>Interviewer: {bookingSuccess.interviewer || 'Not assigned'} · Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</div>
                <div style={{ marginTop: 4, fontSize: '0.8rem' }}>Status: Pending approval</div>
              </div>
            )}
            <button className="link-btn" onClick={() => setBookingSuccess(null)} aria-label="Dismiss booking success message">Dismiss</button>
          </div>
        )}

        <div className="card student-upcoming" style={{ marginBottom: 16 }}>
          <strong>Upcoming interview</strong>
          {upcomingApproved ? (
            <p style={{ margin: '8px 0 0', fontSize: '0.9rem' }}>{upcomingApproved.company} · {formatDateLabel(upcomingApproved.date)} at {formatTimeLabel(upcomingApproved.time)} — starts in <strong>{countdownLabel}</strong></p>
          ) : <p style={{ margin: '8px 0 0', color: 'var(--ink-soft)', fontSize: '0.85rem' }}>No approved interviews scheduled yet.</p>}
        </div>

        <div className="schedule-view-toggle" role="tablist" aria-label="Schedule view">
          <button className={`admin-tab ${studentScheduleView === 'calendar' ? 'active' : ''}`} onClick={() => setStudentScheduleView('calendar')}>Calendar</button>
          <button className={`admin-tab ${studentScheduleView === 'list' ? 'active' : ''}`} onClick={() => setStudentScheduleView('list')}>List</button>
        </div>
        {studentScheduleView === 'calendar' && <div className="card admin-section" style={{ marginBottom: 24 }}>
          <div className="calendar-heading">
            <h3 className="serif" style={{ fontSize: '1.15rem', margin: 0 }}>Your interview calendar</h3>
            <div className="calendar-navigation">
              <button className="btn btn-small btn-outline" onClick={() => {
                const today = new Date();
                setStudentCalendarMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                setSelectedDate(todayStr());
              }}>Today</button>
              <button className="btn btn-small btn-outline" onClick={() => setStudentCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Previous month">←</button>
              <strong>{studentCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong>
              <button className="btn btn-small btn-outline" onClick={() => setStudentCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Next month">→</button>
            </div>
          </div>
          <div className="calendar-grid calendar-weekdays">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div key={day} className="calendar-weekday">{day}</div>)}
            {studentCalendarDates.map((date, index) => date ? (
              <button key={date} disabled={date < todayStr()} className={`calendar-day ${selectedDate === date ? 'selected' : ''} ${date === todayStr() ? 'today' : ''} ${date < todayStr() ? 'past' : ''}`} onClick={() => {
                setSelectedDate(date);
                setStudentCalendarMonth(new Date(`${date}T00:00:00`));
              }}>
                <span>{Number(date.slice(-2))}</span>
                {studentCalendarCounts[date] ? (
                  <span className="calendar-statuses" aria-label={`${studentCalendarCounts[date].total} interviews`}>
                    {Object.entries(studentCalendarCounts[date].statuses).map(([status, count]) => <i key={status} className={`calendar-status status-${status}`} title={`${count} ${status}`} />)}
                  </span>
                ) : <span />}
              </button>
            ) : <div key={`student-empty-${index}`} className="calendar-day empty" />)}
          </div>
          <div className="calendar-selection">
            <strong>{formatDateLabel(selectedDate)}</strong>
            <span>{(studentCalendarCounts[selectedDate] || { total: 0 }).total} interview{(studentCalendarCounts[selectedDate] || { total: 0 }).total === 1 ? '' : 's'} scheduled</span>
            {myBookings.filter((booking) => booking.date === selectedDate).map((booking) => (
              <div className="calendar-interview-details" key={`calendar-${booking.id}`}>
                <div><strong>{formatTimeLabel(booking.time)} · {booking.company}</strong><span>{statusLabel(booking.status)}</span></div>
                <div><span>Round</span><strong>{booking.round}</strong></div>
                <div><span>Cabin · Duration</span><strong>{booking.cabin} · {booking.duration || 30} min</strong></div>
                <div><span>Interviewer</span><strong>{booking.interviewer || 'Not assigned'}</strong></div>
                <div><span>Timezone</span><strong>{booking.timezone || 'local'}</strong></div>
              </div>
            ))}
            {myBookings.filter((booking) => booking.date === selectedDate).length === 0 && (
              <p className="empty-state" style={{ margin: '12px 0 0' }}>No interviews scheduled for this date.</p>
            )}
          </div>
        </div>}

        <div className="booking-section-heading">
          <div>
            <h3 className="serif">Book an interview</h3>
            <p>Choose a date and duration to see available cabins.</p>
          </div>
        </div>
        <div className="student-booking-panel">
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
          {formatDateLabel(selectedDate)} · {availableSlotCount} available slot{availableSlotCount === 1 ? '' : 's'} · Showing {duration === 60 ? '1-hour' : '30-minute'} time slots · Interview hours 8:00 AM – 10:00 PM · Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
        </p>
        <div className="filter-row">
          {CABINS.map((cabin) => <span key={cabin} className="filter-chip">{cabin}: {availableByCabin[cabin]} available</span>)}
        </div>

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

        <div className="table slot-table" style={{ marginBottom: 32 }}>
          <div className="table-header">
            <div className="table-cell label" style={{ fontWeight: 500 }}>Time</div>
            {CABINS.map((c) => (
              <div key={c} className="table-cell" style={{ fontWeight: 500 }}>{c}</div>
            ))}
          </div>
          {orderedTimes.map((time) => {
            return (
              <div key={time} className="table-row">
                <div className="table-cell label">{formatTimeLabel(time)}</div>
                {CABINS.map((cabin) => {
                  const { free, mine, blocked, disabled } = isSlotFree(cabin, selectedDate, time, duration);
                  let content;
                  if (mine && mine.phone === student.phone) {
                    content = (
                      <div style={{ fontSize: '0.75rem', textAlign: 'center' }}>
                        <Badge text={statusLabel(mine.status)} kind={mine.status} />
                        <div style={{ marginTop: 4, color: 'var(--ink-soft)' }}>{mine.company} · {mine.round}</div>
                      </div>
                    );
                  } else if (!free) {
                    content = <Badge text={disabled ? 'Cabin disabled' : blocked ? 'Unavailable' : 'Full'} kind="booked" />;
                  } else {
                    content = (
                      <button className="btn btn-small" style={{ background: 'var(--accent-soft)', color: 'var(--accent-dark)' }}
                        onClick={() => openBookingModal(cabin, selectedDate, time)}>
                        Book now
                      </button>
                    );
                  }
                  return <div key={cabin} className="table-cell">{content}</div>;
                })}
              </div>
            );
          })}
        </div>
        {availableSlotCount === 0 && (
          <div className="card empty-state" role="status">
            No available slots for {formatDateLabel(selectedDate)}. Try another date or choose a different duration. <a href={`mailto:${ADMIN_CONTACT}`}>Contact admin</a> if you need help.
          </div>
        )}
        </div>

        <h3 className="serif" style={{ fontSize: '1.1rem', marginBottom: 12 }}>Your interview history</h3>
        <div className="search-row" style={{ display: 'flex', gap: 8 }}>
          <input className="search-input" value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} placeholder="Search company or round…" aria-label="Search interview history" />
          <select className="search-input" style={{ width: 150 }} value={historyStatus} onChange={(e) => setHistoryStatus(e.target.value)}>
            <option value="all">All statuses</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option>
          </select>
        </div>
        {historyBookings.length === 0 ? (
          <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)' }}>No matching interview history. Book a slot above.</p>
        ) : (
          <div className="history-groups">
            {[
              ['Upcoming', upcomingBookings],
              ['Past interviews', pastBookings],
            ].map(([groupLabel, groupBookings]) => groupBookings.length > 0 && <section key={groupLabel}>
              <h4>{groupLabel}</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {groupBookings.map((b) => (
              <div key={b.id} className="card booking-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '0.9rem' }}>
                  <div style={{ fontWeight: 500 }}>{b.company} · {b.round}</div>
                  <div style={{ color: 'var(--ink-soft)' }}>
                {b.cabin} · {formatDateLabel(b.date)} · {formatTimeLabel(b.time)} · {b.duration || 30} min · {b.timezone || 'local'}
                  </div>
                  <div style={{ color: 'var(--ink-soft)', marginTop: 4 }}>Interviewer: {b.interviewer || 'Not assigned'}</div>
                  {b.status === 'cancelled' && b.cancelReason && <div className="cancel-reason">Cancellation reason: {b.cancelReason}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Badge text={statusLabel(b.status)} kind={b.status} />
                  <button className="btn btn-small btn-outline" onClick={() => copyBookingDetails(b)}>Copy details</button>
                  </div>
                  {b.status !== 'cancelled' && !isPastSlot(b.date, b.time) && (
                    <>
                      <button className="btn btn-small btn-outline" onClick={() => openReschedule(b)}>Reschedule</button>
                      <button className="btn btn-small btn-outline" style={{ color: 'var(--danger)' }} onClick={() => cancelStudentBooking(b)}>Cancel</button>
                    </>
                  )}
                </div>
                <div className="status-help">{b.status === 'pending' ? 'Pending: the admin is reviewing your request.' : b.status === 'approved' ? 'Approved: your slot is confirmed.' : b.status === 'rejected' ? <>Rejected: no slot was approved. <a href={`mailto:${ADMIN_CONTACT}`}>Contact admin</a> for help.</> : 'Cancelled: this slot is no longer reserved.'}</div>
              </div>
            ))}
              </div>
            </section>)}
          </div>
        )}

        {rescheduleBooking && !adminToken && (
          <div className="modal-backdrop">
            <div className="modal">
              <h3 className="serif" style={{ fontSize: '1.2rem', marginBottom: 12 }}>Reschedule interview</h3>
              <form onSubmit={saveReschedule}>
                <div className="field"><label>Cabin</label><select value={rescheduleCabin} onChange={(e) => setRescheduleCabin(e.target.value)}>{CABINS.map((cabin) => <option key={cabin} value={cabin} disabled={disabledCabins.includes(cabin)}>{cabin}{disabledCabins.includes(cabin) ? ' (disabled)' : ''}</option>)}</select></div>
                <div className="field"><label>Date</label><input type="date" min={todayStr()} max={maxDate} value={rescheduleDate} onChange={(e) => {
                  const nextDate = e.target.value;
                  setRescheduleDate(nextDate);
                  const nextTimes = slotsForDuration(rescheduleDuration).filter((time) => !isPastSlot(nextDate, time));
                  if (nextTimes.length && !nextTimes.includes(rescheduleTime)) setRescheduleTime(nextTimes[0]);
                }} /></div>
                <div className="field"><label>Start time</label><select value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)}>{rescheduleTimes.map((t) => <option key={t} value={t}>{formatTimeLabel(t)}</option>)}</select></div>
                {reschedulePast && <p className="warning-text">That time has already passed. Choose a future time.</p>}
                <div className="field"><label>Duration</label><select value={rescheduleDuration} onChange={(e) => changeRescheduleDuration(Number(e.target.value))}>{DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></div>
                {modalError && <p className="error-text">{modalError}</p>}
                <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-primary" disabled={loading || reschedulePast}>Save</button><button type="button" className="btn btn-outline" onClick={() => setRescheduleBooking(null)}>Close</button></div>
              </form>
            </div>
          </div>
        )}

        {profileOpen && (
          <div className="modal-backdrop">
            <div className="modal">
              <h3 className="serif" style={{ fontSize: '1.2rem', marginBottom: 12 }}>Edit profile</h3>
              <form onSubmit={saveProfile}>
                <div className="field"><label>Full name</label><input value={profileName} onChange={(e) => setProfileName(e.target.value)} /></div>
                <div className="field"><label>Domain</label><input value={profileDomain} onChange={(e) => setProfileDomain(e.target.value)} /></div>
                <div className="field"><label>Phone number</label><input value={student.phone} disabled /></div>
                {profileError && <p className="error-text">{profileError}</p>}
                <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-primary" disabled={loading}>{loading ? 'Saving…' : 'Save profile'}</button><button type="button" className="btn btn-outline" onClick={() => setProfileOpen(false)}>Close</button></div>
              </form>
            </div>
          </div>
        )}

        {cancelBooking && (
          <div className="modal-backdrop">
            <div className="modal">
              <h3 className="serif" style={{ fontSize: '1.2rem', marginBottom: 8 }}>Cancel interview</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--ink-soft)' }}>{cancelBooking.company} · {formatDateLabel(cancelBooking.date)} · {formatTimeLabel(cancelBooking.time)}</p>
              <form onSubmit={submitCancellation}>
                <div className="field"><label>Reason for cancellation</label><textarea className="text-area" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows="3" placeholder="Tell the admin why you need to cancel" /></div>
                {modalError && <p className="error-text">{modalError}</p>}
                <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-primary" disabled={loading}>{loading ? 'Cancelling…' : 'Confirm cancellation'}</button><button type="button" className="btn btn-outline" onClick={() => setCancelBooking(null)}>Keep interview</button></div>
              </form>
            </div>
          </div>
        )}

        {modalSlot && (
          <div className="modal-backdrop">
            <div className="modal">
              <h3 className="serif" style={{ fontSize: '1.2rem', marginBottom: 4 }}>Confirm your slot</h3>
              <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)', marginBottom: 16 }}>
                {modalSlot.cabin} · {formatDateLabel(modalSlot.date)} · {formatTimeLabel(modalSlot.time)} · {modalSlot.duration} min
              </p>
               {bookings.some((b) => b.phone === student.phone && b.status !== 'rejected' && b.status !== 'cancelled' &&
                b.date === modalSlot.date && rangesOverlap(b.time, b.duration || 30, modalSlot.time, modalSlot.duration)) && (
                <p className="warning-text">You already have an interview during this time. Choose another slot.</p>
               )}
              <form onSubmit={submitBooking}>
                <div className="field">
                  <label>Company name</label>
                  <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. Northwind Traders" />
                </div>
                <div className="field">
                  <label>Interview round</label>
                  <input value={round} onChange={(e) => setRound(e.target.value)} placeholder="e.g. Technical round 1" />
                </div>
                <div className="field">
                  <label>Interviewer (optional)</label>
                  <input value={interviewer} onChange={(e) => setInterviewer(e.target.value)} placeholder="e.g. Priya Sharma" />
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
        <AppFooter />
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
        <AppFooter />
      </div>
    );
  }

  // ---------- ADMIN DASHBOARD ----------
  if (view === 'admin' && adminToken) {
    const todayBookings = bookings.filter((b) => b.date === todayStr());
    const total = todayBookings.length;
    const pendingCount = todayBookings.filter((b) => b.status === 'pending').length;
    const approvedCount = todayBookings.filter((b) => b.status === 'approved').length;
    const availableToday = slotsForDuration(30).reduce((count, time) => count + CABINS.filter((cabin) => isSlotFree(cabin, todayStr(), time, 30).free).length, 0);

    const filtered = bookings
      .filter((b) => {
        if (adminDateFilter && b.date !== adminDateFilter) return false;
        if (adminCabinFilter !== 'all' && b.cabin !== adminCabinFilter) return false;
        if (adminFilter === 'today') return b.date === todayStr();
        if (!(adminFilter === 'all' || b.status === adminFilter)) return false;
        if (!adminSearch.trim()) return true;
        const query = adminSearch.trim().toLowerCase();
        return [b.studentName, b.phone, b.company, b.round, b.domain, b.cabin, b.interviewer, b.cancelReason].some((value) => String(value || '').toLowerCase().includes(query));
      })
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const pagedBookings = filtered.slice((adminRequestPage - 1) * PAGE_SIZE, adminRequestPage * PAGE_SIZE);

    const filters = [
      { key: 'all', label: 'All' },
      { key: 'today', label: "Today's interviews" },
      { key: 'pending', label: 'Pending' },
      { key: 'approved', label: 'Approved' },
      { key: 'rejected', label: 'Rejected' },
      { key: 'cancelled', label: 'Cancelled' },
    ];

    const tabs = [
      { key: 'requests', label: 'Requests' },
      { key: 'students', label: 'Students' },
      { key: 'slots', label: 'Slot availability' },
      { key: 'activity', label: 'Activity history' },
      { key: 'settings', label: 'Settings' },
    ];

    const studentList = Object.values(students)
      .filter((s) => !adminStudentSearch.trim() || [s.name, s.domain, s.phone].some((value) => String(value || '').toLowerCase().includes(adminStudentSearch.trim().toLowerCase())))
      .sort((a, b) => a.name.localeCompare(b.name));
    const pagedStudents = studentList.slice((adminStudentPage - 1) * PAGE_SIZE, adminStudentPage * PAGE_SIZE);
    const adminTimes = slotsForDuration(adminSlotDuration);
    const adminRescheduleTimes = slotsForDuration(rescheduleDuration).filter((time) => !isPastSlot(rescheduleDate, time));
    const adminReschedulePast = isPastSlot(rescheduleDate, rescheduleTime);
    const dailyInterviewCounts = dateOptions.map((date) => {
      const dayBookings = bookings.filter((booking) => booking.date === date);
      return {
        date,
        total: dayBookings.length,
        pending: dayBookings.filter((booking) => booking.status === 'pending').length,
        approved: dayBookings.filter((booking) => booking.status === 'approved').length,
        rejected: dayBookings.filter((booking) => booking.status === 'rejected').length,
        cancelled: dayBookings.filter((booking) => booking.status === 'cancelled').length,
      };
    });
    const selectedDateStudentCounts = adminDateFilter
      ? Object.values(bookings
        .filter((booking) => booking.date === adminDateFilter)
        .reduce((counts, booking) => {
          const key = booking.phone || booking.studentName;
          if (!counts[key]) counts[key] = { name: booking.studentName || 'Unknown student', count: 0 };
          counts[key].count += 1;
          return counts;
        }, {}))
        .sort((a, b) => a.name.localeCompare(b.name))
      : [];
    const calendarDateCounts = bookings.reduce((counts, booking) => {
      if (!counts[booking.date]) counts[booking.date] = { total: 0, statuses: {} };
      counts[booking.date].total += 1;
      counts[booking.date].statuses[booking.status] = (counts[booking.date].statuses[booking.status] || 0) + 1;
      return counts;
    }, {});
    const calendarDates = calendarDays(adminCalendarMonth);
    const selectedCalendarBookings = adminDateFilter ? bookings.filter((booking) => booking.date === adminDateFilter) : [];
    const activeCabinCounts = CABINS.reduce((counts, cabin) => {
      counts[cabin] = bookings.filter((booking) => booking.cabin === cabin && booking.status !== 'rejected' && booking.status !== 'cancelled' && booking.date >= todayStr()).length;
      return counts;
    }, {});

    return (
      <div className="container admin-container">
        <div className="admin-header">
          <div>
            <h2 className="serif" style={{ fontSize: '1.5rem', marginBottom: 4 }}>Admin dashboard</h2>
            <p className="admin-kicker">OPERATIONS OVERVIEW</p>
            <p className="loading-text">Updated {lastRefreshed ? lastRefreshed.toLocaleTimeString() : '—'}</p>
          </div>
          <div className="admin-header-actions">
            <button className="btn btn-small btn-outline" onClick={refresh} disabled={stateLoading}>
              {stateLoading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="link-btn" onClick={logoutAdmin}>Sign out</button>
          </div>
        </div>
        {loadError && (
          <div className="card retry-banner">
            <span>{loadError}</span>
            <button className="btn btn-small btn-outline" onClick={refresh}>Retry</button>
          </div>
        )}
        {stateLoading && <p className="loading-text">Refreshing schedule…</p>}

        <div className="stat-grid admin-summary">
          {[
            ["Today's total", total, 'var(--ink)'],
            ["Today's approved", approvedCount, 'var(--approved)'],
            ["Today's pending", pendingCount, 'var(--pending)'],
            ['Available slots', availableToday, 'var(--accent)'],
          ].map(([label, val, color]) => (
            <div key={label} className="stat-box">
              <div className="serif stat-value" style={{ color }}>{val}</div>
              <div className="stat-label">{label}</div>
            </div>
          ))}
        </div>
        <p className="loading-text">Today's availability: {CABINS.map((cabin) => `${cabin} ${slotsForDuration(30).filter((time) => isSlotFree(cabin, todayStr(), time, 30).free).length}`).join(' · ')} free 30-minute slots</p>
        <div className="filter-row admin-quick-actions">
          <button className="filter-chip" onClick={() => { setAdminDateFilter(todayStr()); setAdminFilter('all'); setAdminTab('requests'); }}>Today</button>
          <button className="filter-chip" onClick={() => { setAdminDateFilter(null); setAdminFilter('pending'); setAdminTab('requests'); }}>Pending</button>
          <button className="filter-chip" onClick={() => { setAdminDateFilter(null); setAdminFilter('approved'); setAdminTab('requests'); }}>Approved</button>
          <button className="btn btn-small btn-outline" onClick={() => exportDailySchedule(adminDateFilter || todayStr())}>Export {adminDateFilter || 'today'} CSV</button>
        </div>
        {todayBookings.filter((booking) => booking.status !== 'cancelled' && booking.status !== 'rejected').length === 0 && (
          <div className="card empty-state" style={{ margin: '0 0 20px' }}>No interviews today.</div>
        )}

        <div className="card admin-section student-calendar" style={{ marginBottom: 24 }}>
          <div className="calendar-heading">
            <h3 className="serif" style={{ fontSize: '1.15rem', margin: 0 }}>Interview calendar</h3>
            <div className="calendar-navigation">
              <button className="btn btn-small btn-outline" onClick={() => {
                const now = new Date();
                setAdminCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1));
                setAdminDateFilter(todayStr());
                setAdminFilter('all');
                setAdminTab('requests');
                setAdminRequestPage(1);
              }}>Today</button>
              <button
                className="btn btn-small btn-outline"
                onClick={() => setAdminCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                aria-label="Previous month"
              >
                ←
              </button>
              <strong>
                {adminCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </strong>
              <button
                className="btn btn-small btn-outline"
                onClick={() => setAdminCalendarMonth((month) => new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                aria-label="Next month"
              >
                →
              </button>
            </div>
          </div>
          <div className="calendar-grid calendar-weekdays">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="calendar-weekday">{day}</div>
            ))}
            {calendarDates.map((date, index) => (
              date ? (
                <button
                  key={date}
                  className={`calendar-day ${adminDateFilter === date ? 'selected' : ''}`}
                  onClick={() => {
                    setAdminDateFilter(date);
                    setAdminFilter('all');
                    setAdminTab('requests');
                    setAdminRequestPage(1);
                  }}
                >
                  <span>{Number(date.slice(-2))}</span>
                  {calendarDateCounts[date] ? (
                    <span className="calendar-statuses" aria-label={`${calendarDateCounts[date].total} interviews`}>
                      {Object.entries(calendarDateCounts[date].statuses).map(([status, count]) => (
                        <i key={status} className={`calendar-status status-${status}`} title={`${count} ${status}`} />
                      ))}
                    </span>
                  ) : <span />}
                </button>
              ) : <div key={`empty-${index}`} className="calendar-day empty" />
            ))}
          </div>
          {adminDateFilter && (
            <div className="calendar-selection">
              <strong>{formatDateLabel(adminDateFilter)}</strong>
              <span>{calendarDateCounts[adminDateFilter] ? calendarDateCounts[adminDateFilter].total : 0} interview{calendarDateCounts[adminDateFilter] && calendarDateCounts[adminDateFilter].total === 1 ? '' : 's'}</span>
              <div className="calendar-student-names">
                {selectedDateStudentCounts.length
                  ? selectedDateStudentCounts.map((studentCount) => (
                    <span key={studentCount.name}>{studentCount.name}</span>
                  ))
                  : <span>No students scheduled.</span>}
              </div>
              <div className="calendar-interview-details">
                {selectedCalendarBookings.length === 0 ? <span>No interview details for this date.</span> : selectedCalendarBookings.map((booking) => (
                  <div key={booking.id}><strong>{formatTimeLabel(booking.time)} · {booking.company}</strong><span>{booking.studentName} · {booking.round} · {booking.cabin} · {booking.duration || 30} min · {booking.interviewer || 'Interviewer unassigned'} · {statusLabel(booking.status)}</span></div>
                ))}
              </div>
            </div>
          )}
          <AppFooter />
        </div>

        <div className="card admin-section" style={{ marginBottom: 24 }}>
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
                  setAdminRequestPage(1);
                }}
              >
                <div>
                  <div style={{ fontWeight: 500 }}>{formatDateLabel(day.date)}</div>
                  <div style={{ color: 'var(--ink-soft)', fontSize: '0.75rem' }}>
                    {day.approved} approved · {day.pending} pending · {day.rejected} rejected · {day.cancelled} cancelled
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
            <>
              <div className="daily-student-counts">
                <div style={{ fontWeight: 500, fontSize: '0.85rem' }}>
                  {formatDateLabel(adminDateFilter)} — interviews per student
                </div>
                {selectedDateStudentCounts.length === 0 ? (
                  <div style={{ color: 'var(--ink-soft)', fontSize: '0.8rem' }}>No interviews scheduled.</div>
                ) : (
                  selectedDateStudentCounts.map((studentCount) => (
                    <div key={studentCount.name} className="daily-student-count">
                      <span>{studentCount.name}</span>
                      <strong>{studentCount.count}</strong>
                    </div>
                  ))
                )}
              </div>
              <button className="link-btn" style={{ marginTop: 10 }} onClick={() => setAdminDateFilter(null)}>
                Show all dates
              </button>
            </>
          )}
        </div>

        <nav className="admin-tabs" aria-label="Admin workspace navigation">
          {tabs.map((t) => (
            <button key={t.key} className={`admin-tab ${adminTab === t.key ? 'active' : ''}`} onClick={() => setAdminTab(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>

        {adminActionError && <p className="error-text" style={{ marginBottom: 16 }}>{adminActionError}</p>}

        {adminTab === 'settings' && (
          <div className="settings-grid">
            <section className="card admin-section settings-card">
              <p className="admin-kicker">ACCOUNT</p>
              <h3 className="serif">Administrator profile</h3>
              <p className="settings-description">Your administrator account is securely managed by the deployment environment.</p>
              <div className="settings-row"><span>Email</span><strong>{adminEmail || 'Configured administrator'}</strong></div>
              <div className="settings-row"><span>Access</span><strong><Badge text="Administrator" kind="approved" /></strong></div>
            </section>
            <section className="card admin-section settings-card">
              <p className="admin-kicker">SECURITY</p>
              <h3 className="serif">Session security</h3>
              <p className="settings-description">Admin sessions expire automatically after 30 minutes of inactivity.</p>
              <div className="settings-row"><span>Session status</span><strong><Badge text="Active" kind="approved" /></strong></div>
              <div className="settings-row"><span>Password</span><strong>Managed securely by deployment settings</strong></div>
              <p className="settings-note">To change the administrator password, update the <code>ADMIN_PASSWORD</code> environment variable and restart the server.</p>
            </section>
          </div>
        )}

        {adminTab === 'requests' && (
          <>
            <details className="admin-filters" open>
              <summary>Search and filter requests</summary>
              <div className="filter-row">
                {filters.map((f) => (
                  <button
                    key={f.key}
                    className={`filter-chip ${adminFilter === f.key ? 'active' : ''}`}
                    onClick={() => {
                      setAdminFilter(f.key);
                      setAdminRequestPage(1);
                      if (f.key === 'all' || f.key === 'today') setAdminDateFilter(null);
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="search-row">
                <div className="admin-filter-fields">
                  <input className="search-input" value={adminSearch} onChange={(e) => { setAdminSearch(e.target.value); setAdminRequestPage(1); }} placeholder="Search student, company, phone, round…" aria-label="Search interviews" />
                  <select className="search-input" value={adminCabinFilter} onChange={(e) => { setAdminCabinFilter(e.target.value); setAdminRequestPage(1); }}>
                    <option value="all">All cabins</option>{CABINS.map((cabin) => <option key={cabin} value={cabin}>{cabin}</option>)}
                  </select>
                  <input className="search-input" type="date" value={adminDateFilter || ''} onChange={(e) => { setAdminDateFilter(e.target.value || null); setAdminRequestPage(1); }} aria-label="Filter by date" />
                </div>
              </div>
            </details>

            {filtered.length === 0 ? (
              <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)' }}>No requests in this view.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {pagedBookings.map((b) => (
                  <div key={b.id} className="card booking-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: '0.9rem' }}>
                        <div style={{ fontWeight: 500 }}>
                          {b.studentName} <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>· {b.domain}</span>
                        </div>
                        <div style={{ color: 'var(--ink-soft)' }}>{b.phone}</div>
                        <div style={{ marginTop: 4 }}>{b.company} · {b.round}</div>
                        <div style={{ color: 'var(--ink-soft)' }}>
                          {b.cabin} · {formatDateLabel(b.date)} · {formatTimeLabel(b.time)} · {b.duration || 30} min · {b.timezone || 'local'}
                        </div>
                        <div style={{ color: 'var(--ink-soft)', marginTop: 4 }}>Interviewer: {b.interviewer || 'Not assigned'}</div>
                        {b.status === 'cancelled' && b.cancelReason && <div className="cancel-reason">Cancellation reason: {b.cancelReason}</div>}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                        <Badge text={statusLabel(b.status)} kind={b.status} />
                        {b.status === 'pending' && (
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn btn-small" style={{ background: 'var(--approved)', color: '#fff' }} onClick={() => setBookingStatus(b.id, 'approved')}>
                              Give access
                            </button>
                            <button className="btn btn-small btn-outline" onClick={() => setBookingStatus(b.id, 'rejected')}>
                              Reject
                            </button>
                            <button className="btn btn-small btn-outline" onClick={() => openReschedule(b)}>
                              Reschedule
                            </button>
                           <button className="btn btn-small btn-outline" style={{ color: 'var(--danger)' }} onClick={() => setBookingStatus(b.id, 'cancelled')}>
                             Cancel
                           </button>
                           <button className="btn btn-small btn-outline" style={{ color: 'var(--danger)' }} onClick={() => deleteBooking(b)}>
                             Delete
                           </button>
                          </div>
                        )}
                        {b.status !== 'pending' && (
                          <div style={{ display: 'flex', gap: 8 }}>
                            {b.status !== 'cancelled' && <button className="btn btn-small btn-outline" onClick={() => openReschedule(b)}>Reschedule</button>}
                            {b.status !== 'cancelled' && <button className="btn btn-small btn-outline" style={{ color: 'var(--danger)' }} onClick={() => setBookingStatus(b.id, 'cancelled')}>Cancel</button>}
                            <button className="btn btn-small btn-outline" style={{ color: 'var(--danger)' }} onClick={() => deleteBooking(b)}>Delete</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {filtered.length > PAGE_SIZE && (
              <div className="pagination">
                <button className="btn btn-small btn-outline" disabled={adminRequestPage === 1} onClick={() => setAdminRequestPage((page) => page - 1)}>Previous</button>
                <span>Page {adminRequestPage} of {Math.ceil(filtered.length / PAGE_SIZE)}</span>
                <button className="btn btn-small btn-outline" disabled={adminRequestPage >= Math.ceil(filtered.length / PAGE_SIZE)} onClick={() => setAdminRequestPage((page) => page + 1)}>Next</button>
              </div>
            )}
          </>
        )}

        {adminTab === 'students' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="search-row">
              <input className="search-input" value={adminStudentSearch} onChange={(e) => { setAdminStudentSearch(e.target.value); setAdminStudentPage(1); }} placeholder="Search name, domain, or phone…" aria-label="Search students" />
            </div>
            {studentList.length === 0 ? (
              <p style={{ fontSize: '0.9rem', color: 'var(--ink-soft)' }}>No students registered yet.</p>
            ) : (
              pagedStudents.map((s) => (
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
            {studentList.length > PAGE_SIZE && (
              <div className="pagination">
                <button className="btn btn-small btn-outline" disabled={adminStudentPage === 1} onClick={() => setAdminStudentPage((page) => page - 1)}>Previous</button>
                <span>Page {adminStudentPage} of {Math.ceil(studentList.length / PAGE_SIZE)}</span>
                <button className="btn btn-small btn-outline" disabled={adminStudentPage >= Math.ceil(studentList.length / PAGE_SIZE)} onClick={() => setAdminStudentPage((page) => page + 1)}>Next</button>
              </div>
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
            <div className="cabin-management">
              {CABINS.map((cabin) => {
                const enabled = !disabledCabins.includes(cabin);
                const activeCount = activeCabinCounts[cabin] || 0;
                return <div key={cabin} className="card cabin-row">
                  <span><strong>{cabin}</strong><small>{enabled ? 'Enabled for booking' : 'Disabled for all new bookings'}</small>{enabled && activeCount > 0 && <small className="warning-text">Has {activeCount} active interview{activeCount === 1 ? '' : 's'} — reschedule or cancel first.</small>}</span>
                  <button className="btn btn-small btn-outline" disabled={enabled && activeCount > 0} onClick={() => toggleCabin(cabin)}>{enabled ? 'Disable cabin' : 'Enable cabin'}</button>
                </div>;
              })}
            </div>

            <div className="table slot-table">
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
                    const { free, mine, blocked, disabled } = isSlotFree(cabin, adminSlotDate, time, adminSlotDuration);
                    let content;
                    if (disabled) {
                      content = <button className="btn btn-small" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }} onClick={() => toggleCabin(cabin)}>Cabin disabled</button>;
                    } else if (mine) {
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
        {adminTab === 'activity' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h3 className="serif" style={{ fontSize: '1.1rem', margin: 0 }}>Activity history</h3>
            {activityHistory.length === 0 ? <p style={{ color: 'var(--ink-soft)', fontSize: '0.9rem' }}>No approval, cancellation, or deletion activity yet.</p> : activityHistory.map((activity) => (
              <div className="card" key={activity.id} style={{ fontSize: '0.85rem' }}>
                <strong>{activity.action[0].toUpperCase() + activity.action.slice(1)}</strong>
                <span style={{ color: 'var(--ink-soft)' }}> · {new Date(activity.at).toLocaleString()}</span>
                <div style={{ marginTop: 4 }}>{activity.studentName || 'Unknown student'}{activity.company ? ` · ${activity.company}` : ''}{activity.date ? ` · ${formatDateLabel(activity.date)} ${formatTimeLabel(activity.time)}` : ''}</div>
                <div style={{ color: 'var(--ink-soft)', marginTop: 3 }}>{activity.details}</div>
              </div>
            ))}
          </div>
        )}
        {rescheduleBooking && adminToken && (
          <div className="modal-backdrop">
            <div className="modal">
              <h3 className="serif" style={{ fontSize: '1.2rem', marginBottom: 12 }}>Reschedule interview</h3>
              <form onSubmit={saveReschedule}>
                <div className="field"><label>Cabin</label><select value={rescheduleCabin} onChange={(e) => setRescheduleCabin(e.target.value)}>{CABINS.map((cabin) => <option key={cabin} value={cabin} disabled={disabledCabins.includes(cabin)}>{cabin}{disabledCabins.includes(cabin) ? ' (disabled)' : ''}</option>)}</select></div>
                <div className="field"><label>Date</label><input type="date" min={todayStr()} max={maxDate} value={rescheduleDate} onChange={(e) => {
                  const nextDate = e.target.value;
                  setRescheduleDate(nextDate);
                  const nextTimes = slotsForDuration(rescheduleDuration).filter((time) => !isPastSlot(nextDate, time));
                  if (nextTimes.length && !nextTimes.includes(rescheduleTime)) setRescheduleTime(nextTimes[0]);
                }} /></div>
                <div className="field"><label>Start time</label><select value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)}>{adminRescheduleTimes.map((t) => <option key={t} value={t}>{formatTimeLabel(t)}</option>)}</select></div>
                {adminReschedulePast && <p className="warning-text">That time has already passed. Choose a future time.</p>}
                <div className="field"><label>Duration</label><select value={rescheduleDuration} onChange={(e) => changeRescheduleDuration(Number(e.target.value))}>{DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}</select></div>
                {adminActionError && <p className="error-text">{adminActionError}</p>}
                <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-primary" disabled={loading || adminReschedulePast}>Save</button><button type="button" className="btn btn-outline" onClick={() => setRescheduleBooking(null)}>Close</button></div>
              </form>
            </div>
          </div>
        )}
        <AppFooter />
      </div>
    );
  }

  return null;
}
