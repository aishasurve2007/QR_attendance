import { useState, useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";
import ClassesView from "./ClassesView";
const BASE_URL = "https://attendiq-api.onrender.com/api/v1";
const ORG_ID = "demo-org";

function getToken()  { return localStorage.getItem("attendiq_token"); }
function getUserId() { return localStorage.getItem("attendiq_user_id"); }

async function apiFetch(url, options = {}) {
  const token = getToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json.data ?? json;
}

function formatDate(d) { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function formatTime(d) { return new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }); }

// ── Shared UI ──────────────────────────────────────────────────────────────────
function Badge({ color = "green", children }) {
  const colors = { green: { bg: "#dcfce7", text: "#166534" }, purple: { bg: "#f3e8ff", text: "#6b21a8" }, blue: { bg: "#dbeafe", text: "#1e40af" }, amber: { bg: "#fef9c3", text: "#92400e" }, red: { bg: "#fee2e2", text: "#991b1b" } };
  const c = colors[color] || colors.green;
  return <span style={{ background: c.bg, color: c.text, padding: "2px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>{children}</span>;
}

function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div className="iq-modal" style={{ background: "#fff", borderRadius: 20, padding: 28, width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, fontFamily: "'Playfair Display', serif" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Input({ label, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 5, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</label>}
      <input
        style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e8e8e8", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
        onFocus={e => e.target.style.borderColor = "#6366f1"}
        onBlur={e => e.target.style.borderColor = "#e8e8e8"}
        {...props}
      />
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", small, disabled }) {
  const v = {
    primary:   { background: "#6366f1", color: "#fff", border: "none" },
    secondary: { background: "#f5f5f5", color: "#333", border: "none" },
    danger:    { background: "#fee2e2", color: "#991b1b", border: "none" },
    success:   { background: "#dcfce7", color: "#166534", border: "none" },
    ghost:     { background: "transparent", color: "#6366f1", border: "1.5px solid #6366f1" },
  };
  return (
    <button
      style={{ ...v[variant], borderRadius: small ? 8 : 10, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 700, padding: small ? "7px 14px" : "10px 20px", fontSize: small ? 12 : 13, display: "inline-flex", alignItems: "center", gap: 6, opacity: disabled ? 0.6 : 1 }}
      onMouseEnter={e => !disabled && (e.currentTarget.style.opacity = "0.85")}
      onMouseLeave={e => !disabled && (e.currentTarget.style.opacity = "1")}
      onClick={!disabled ? onClick : undefined}
    >
      {children}
    </button>
  );
}

// ── Password helpers ───────────────────────────────────────────────────────────
const PW_RULES = [
  { label: "At least 8 characters",  test: v => v.length >= 8 },
  { label: "Uppercase letter (A-Z)", test: v => /[A-Z]/.test(v) },
  { label: "Lowercase letter (a-z)", test: v => /[a-z]/.test(v) },
  { label: "Number (0-9)",            test: v => /\d/.test(v) },
  { label: "Symbol (!@#$%…)",        test: v => /[\W_]/.test(v) },
];

function PasswordStrength({ value }) {
  if (!value) return null;
  const passed = PW_RULES.filter(r => r.test(value)).length;
  const bar = ["#ef4444","#f97316","#eab308","#84cc16","#22c55e"];
  const lbl = ["Very weak","Weak","Fair","Good","Strong"];
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        {PW_RULES.map((_, i) => <div key={i} style={{ flex: 1, height: 4, borderRadius: 99, background: i < passed ? bar[passed-1] : "#e8e8e8", transition: "background 0.3s" }} />)}
      </div>
      <div style={{ fontSize: 11, color: bar[passed-1] || "#aaa", fontWeight: 700, marginBottom: 6 }}>{passed > 0 ? lbl[passed-1] : ""}</div>
      {PW_RULES.map(r => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: r.test(value) ? "#166534" : "#aaa" }}>
          <span>{r.test(value) ? "✓" : "○"}</span><span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function PwInput({ label, value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 5, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</label>}
      <div style={{ position: "relative" }}>
        <input
          type={show ? "text" : "password"} value={value} onChange={onChange} placeholder={placeholder}
          onFocus={e => e.target.style.borderColor = "#6366f1"}
          onBlur={e => e.target.style.borderColor = "#e8e8e8"}
          style={{ width: "100%", padding: "10px 42px 10px 14px", borderRadius: 10, border: "1.5px solid #e8e8e8", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
        />
        <button onClick={() => setShow(s => !s)} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "#bbb", padding: 0 }}>
          {show ? "🙈" : "👁"}
        </button>
      </div>
    </div>
  );
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
export default function OrganizerDashboard({ onLogout }) {
  const userName = localStorage.getItem("attendiq_user_name") || "Organizer";
  // userId comes from the JWT on the backend — we only use it for display,
  // NOT passed to the backend body. The backend reads identity from the token.
  const userId = localStorage.getItem("attendiq_user_id");

  const [events,     setEvents]     = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [view,       setView]       = useState("events");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Event form
  const [showCreate, setShowCreate] = useState(false);
  const [editId,     setEditId]     = useState(null);
  const [form,       setForm]       = useState({ name: "", date: "", time: "", location: "", organizer: "" });
  const [saving,     setSaving]     = useState(false);
  const [formError,  setFormError]  = useState(null);

  // Scanner
  const [showScanner,  setShowScanner]  = useState(null);
  const [scanInput,    setScanInput]    = useState("");
  const [scanMsg,      setScanMsg]      = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const scannerRef = useRef(null);

  // Reports
  const [selectedEvent, setSelectedEvent] = useState("all");

  // Change password
  const [showPwModal, setShowPwModal] = useState(false);
  const [pwForm,  setPwForm]   = useState({ current: "", next: "", confirm: "" });
  const [pwError, setPwError]  = useState(null);
  const [pwOk,    setPwOk]     = useState(false);
  const [pwSaving,setPwSaving] = useState(false);

  // ── Fetch ONLY this organizer's events (backend enforces via JWT) ──────────
  useEffect(() => {
    setLoading(true);
    apiFetch(`${BASE_URL}/orgs/${ORG_ID}/events`)
      .then(async (evts) => {
        setEvents(evts);
        const allAtt = await Promise.all(
          evts.map(e =>
            apiFetch(`${BASE_URL}/orgs/${ORG_ID}/events/${e.id}/attendance`).catch(() => [])
          )
        );
        setAttendance(allAtt.flat());
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []); // no userId dep — token handles identity server-side

  // ── Event CRUD ─────────────────────────────────────────────────────────────
  async function handleSaveEvent() {
    if (!form.name || !form.date) return;
    setSaving(true); setFormError(null);
    try {
      const payload = {
        name: form.name,
        event_date: form.date,
        event_time: form.time || null,
        location:   form.location || null,
        organizer:  form.organizer || null,
        description: null,
        // Do NOT send _created_by — backend reads userId from JWT
      };
      if (editId) {
        const updated = await apiFetch(`${BASE_URL}/orgs/${ORG_ID}/events/${editId}`, { method: "PUT", body: payload });
        setEvents(ev => ev.map(e => e.id === editId ? { ...e, ...updated } : e));
      } else {
        const created = await apiFetch(`${BASE_URL}/orgs/${ORG_ID}/events`, { method: "POST", body: payload });
        setEvents(ev => [...ev, created]);
      }
      setForm({ name: "", date: "", time: "", location: "", organizer: "" });
      setEditId(null); setShowCreate(false);
    } catch (e) { setFormError(e.message); }
    finally { setSaving(false); }
  }

  async function handleDeleteEvent(id) {
    if (!window.confirm("Delete this event?")) return;
    try {
      await apiFetch(`${BASE_URL}/orgs/${ORG_ID}/events/${id}`, { method: "DELETE" });
      setEvents(ev => ev.filter(e => e.id !== id));
      setAttendance(a => a.filter(x => x.event_id !== id));
    } catch (e) { alert(e.message); }
  }

  // ── QR Scanner ─────────────────────────────────────────────────────────────
 async function startCamera() {
  try {
    setCameraActive(true); setScanMsg(null);
    const { Html5Qrcode } = await import("html5-qrcode");
    const scanner = new Html5Qrcode("org-qr-reader");
    scannerRef.current = scanner;

    // Try back camera first, fall back to front camera for desktop
    try {
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (text) => { setScanInput(text); setScanMsg({ type: "success", text: "✓ QR Scanned!" }); stopCamera(); },
        () => {}
      );
    } catch {
      await scanner.start(
        { facingMode: "user" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (text) => { setScanInput(text); setScanMsg({ type: "success", text: "✓ QR Scanned!" }); stopCamera(); },
        () => {}
      );
    }
  } catch (e) {
    setScanMsg({ type: "error", text: `Camera error: ${e?.message || "Permission denied"}` });
    setCameraActive(false);
  }
}

  async function stopCamera() {
    try { if (scannerRef.current) { await scannerRef.current.stop(); scannerRef.current = null; } } catch {}
    setCameraActive(false);
  }

  async function handleScan() {
    const val = scanInput.trim();
    if (!val) return;
    try {
      const record = await apiFetch(`${BASE_URL}/orgs/${ORG_ID}/events/${showScanner}/checkin`, {
        method: "POST",
        // Do NOT send _checked_in_by — backend reads from JWT
        body: { identifier: val, method: "qr" },
      });
      setAttendance(a => [...a, record]);
      setScanMsg({ type: "success", text: "✓ Checked in successfully!" });
      setScanInput("");
    } catch (e) { setScanMsg({ type: "error", text: e.message }); }
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  function exportCSV() {
    const eventParam = selectedEvent !== "all" ? `&eventId=${selectedEvent}` : "";
    window.open(`${BASE_URL}/orgs/${ORG_ID}/reports/export?fmt=csv${eventParam}`, "_blank");
  }

  async function exportPDF() {
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    doc.setFontSize(18); doc.setTextColor(99, 102, 241);
    doc.text("AttendIQ — Attendance Report", 14, 20);
    doc.setFontSize(10); doc.setTextColor(120);
    doc.text(`Organizer: ${userName}`, 14, 30);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 36);
    doc.text(`Event: ${selectedEvent === "all" ? "All My Events" : events.find(e => e.id === selectedEvent)?.name}`, 14, 42);
    const filtered = selectedEvent === "all" ? attendance : attendance.filter(a => a.event_id === selectedEvent);
    const tableRows = filtered.map(a => {
      const evt = events.find(e => e.id === a.event_id);
      const ts = a.checked_in_at;
      return [a.name, a.identifier, a.group_label, evt?.name, ts ? formatDate(ts) : "—", ts ? formatTime(ts) : "—"];
    });
    autoTable(doc, {
      startY: 50,
      head: [["Student", "Roll No.", "Dept", "Event", "Date", "Time"]],
      body: tableRows,
      headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 248, 255] },
      styles: { fontSize: 9, cellPadding: 3 },
    });
    doc.save("attendance_report.pdf");
  }

  // ── Change Password ─────────────────────────────────────────────────────────
  async function handleChangePassword() {
    setPwError(null); setPwOk(false);
    const { current, next, confirm } = pwForm;
    if (!current || !next || !confirm) return setPwError("All three fields are required.");
    if (next !== confirm) return setPwError("New passwords don't match.");
    if (!PW_RULES.every(r => r.test(next))) return setPwError("New password doesn't meet all complexity requirements.");
    setPwSaving(true);
    try {
      await apiFetch(`https://attendiq-api.onrender.com/admin/change-password`, {
        method: "PUT",
        body: { currentPassword: current, newPassword: next },
      });
      setPwOk(true);
      setPwForm({ current: "", next: "", confirm: "" });
    } catch (e) { setPwError(e.message); }
    finally { setPwSaving(false); }
  }

  const filteredAtt = selectedEvent === "all"
    ? attendance
    : attendance.filter(a => a.event_id === selectedEvent);

  const EVENT_COLORS = ["#6366f1","#f59e0b","#10b981","#ec4899","#3b82f6"];

  const navItems = [
    { id: "events",     label: "My Events",  icon: "📅" },
    { id: "classes",    label: "Classes",    icon: "📚" },
    { id: "attendance", label: "Attendance", icon: "✅" },
    { id: "reports",    label: "Reports",    icon: "📊" },
    { id: "security",   label: "Security",   icon: "🔐" },
  ];

  return (
    <div className="iq-shell" style={{ fontFamily: "'DM Sans', system-ui, sans-serif", background: "#f7f7f8", minHeight: "100vh", display: "flex" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; }

        /* Mobile responsive (drawer pattern) */
        .iq-topbar { display: none; }
        @media (max-width: 768px) {
          .iq-sidebar { position: fixed !important; top: 0; left: 0; height: 100vh !important; z-index: 1100; transform: translateX(-100%); transition: transform 0.25s ease; box-shadow: 0 0 50px rgba(0,0,0,0.20); }
          .iq-sidebar.iq-open { transform: translateX(0); }
          .iq-topbar { display: flex !important; }
          .iq-content { padding: 16px !important; max-height: none !important; overflow: visible !important; }
          .iq-grid-2 { grid-template-columns: 1fr !important; }
          .iq-content table { display: block; overflow-x: auto; white-space: nowrap; -webkit-overflow-scrolling: touch; }
          .iq-modal { padding: 20px !important; }
          .iq-content h2 { font-size: 22px !important; }
        }
        @media (max-width: 480px) {
          .iq-content { padding: 12px !important; }
          .iq-stat { flex: 1 1 100% !important; }
          .iq-content select { width: 100% !important; min-width: 0 !important; }
          .iq-content h2 { font-size: 20px !important; }
          .iq-modal { padding: 16px !important; }
          .iq-sidebar { width: 84vw !important; max-width: 300px; }
        }
        /* Data tables -> stacked light-grey cards on phones */
        @media (max-width: 600px) {
          .iq-reflow { display: block !important; white-space: normal !important; overflow-x: visible !important; }
          .iq-reflow thead { display: none; }
          .iq-reflow tbody, .iq-reflow tr, .iq-reflow td { display: block; width: 100%; }
          .iq-reflow tr { background: #fafafa !important; border: 1px solid #f0f0f0 !important; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
          .iq-reflow td { padding: 5px 0 !important; border: none !important; display: flex; justify-content: space-between; align-items: center; gap: 12px; text-align: left !important; }
          .iq-reflow td::before { content: attr(data-label); font-weight: 700; color: #aaa; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; flex-shrink: 0; }
          .iq-reflow td.iq-rf-title { display: block; font-weight: 800; font-size: 14px; color: #111; margin-bottom: 4px; padding-bottom: 8px !important; border-bottom: 1px solid #eee !important; }
          .iq-reflow td.iq-rf-title::before { content: none; }
          .iq-reflow td[colspan] { display: block; }
          .iq-reflow td[colspan]::before { content: none; }
        }
      `}</style>

      {mobileNavOpen && (
        <div onClick={() => setMobileNavOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.40)", zIndex: 1099 }} />
      )}

      {/* Sidebar (drawer on mobile) */}
      <div className={`iq-sidebar${mobileNavOpen ? " iq-open" : ""}`} style={{ width: 210, background: "#fff", borderRight: "1px solid #f0f0f0", display: "flex", flexDirection: "column", padding: "20px 0", position: "sticky", top: 0, height: "100vh" }}>
        <div style={{ padding: "0 18px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📋</div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 14, color: "#111", fontFamily: "'Playfair Display', serif" }}>AttendIQ</div>
              <div style={{ fontSize: 10, color: "#bbb", letterSpacing: "0.06em", textTransform: "uppercase" }}>Organizer</div>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, padding: "0 10px" }}>
          {navItems.map(item => (
            <button key={item.id} onClick={() => { setView(item.id); setMobileNavOpen(false); }} style={{
              width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 9,
              border: "none", cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, marginBottom: 2,
              background: view === item.id ? "#f0f0ff" : "transparent",
              color: view === item.id ? "#6366f1" : "#666",
            }}>
              <span>{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>

        <div style={{ padding: "14px 18px", borderTop: "1px solid #f5f5f5" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#333", marginBottom: 2 }}>{userName}</div>
          <div style={{ fontSize: 10, color: "#bbb", marginBottom: 10 }}>Event Organizer</div>
          <button onClick={onLogout} style={{ background: "none", border: "1px solid #e8e8e8", borderRadius: 7, padding: "5px 12px", fontSize: 11, fontWeight: 600, color: "#888", cursor: "pointer" }}>Sign out ↩</button>
        </div>
      </div>

      {/* Main */}
      <div className="iq-content" style={{ flex: 1, padding: 28, overflowY: "auto", maxHeight: "100vh" }}>
        <div className="iq-topbar" style={{ alignItems: "center", gap: 12, marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid #f0f0f0", position: "sticky", top: 0, background: "#f7f7f8", zIndex: 50 }}>
          <button onClick={() => setMobileNavOpen(true)} aria-label="Open menu" style={{ width: 40, height: 40, borderRadius: 10, border: "1px solid #eee", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#333", flexShrink: 0 }}>☰</button>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>📋</div>
            <span style={{ fontWeight: 900, fontSize: 15, color: "#111", fontFamily: "'Playfair Display', serif" }}>AttendIQ</span>
          </div>
        </div>

        {/* ── MY EVENTS ── */}
        {view === "classes" && <ClassesView orgId={ORG_ID} />}
        {view === "events" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900, fontFamily: "'Playfair Display', serif", color: "#111" }}>My Events</h2>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 13 }}>
                  {events.length} event{events.length !== 1 ? "s" : ""} · {attendance.length} total check-ins
                </p>
              </div>
              <Btn onClick={() => { setShowCreate(true); setEditId(null); setForm({ name: "", date: "", time: "", location: "", organizer: "" }); }}>＋ New Event</Btn>
            </div>

            {loading ? (
              <div style={{ color: "#bbb", padding: 40, textAlign: "center" }}>Loading…</div>
            ) : events.length === 0 ? (
              <div style={{ background: "#fff", borderRadius: 16, padding: 60, textAlign: "center", border: "1px solid #f0f0f0", color: "#ccc" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>No events yet</div>
                <div style={{ fontSize: 13 }}>Create your first event to get started</div>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))", gap: 16 }}>
                {events.map((e, i) => {
                  const count = attendance.filter(a => a.event_id === e.id).length;
                  const isPast = new Date(e.event_date) < new Date();
                  return (
                    <div key={e.id} style={{ background: "#fff", borderRadius: 16, overflow: "hidden", border: "1px solid #f0f0f0" }}>
                      <div style={{ height: 5, background: EVENT_COLORS[i % EVENT_COLORS.length] }} />
                      <div style={{ padding: 20 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#111", flex: 1 }}>{e.name}</h3>
                          <Badge color={isPast ? "amber" : "purple"}>{count} in</Badge>
                        </div>
                        <div style={{ fontSize: 12, color: "#888", display: "flex", flexDirection: "column", gap: 5 }}>
                          <span>📅 {formatDate(e.event_date)}{e.event_time ? ` at ${e.event_time}` : ""}</span>
                          {e.location && <span>📍 {e.location}</span>}
                          {e.organizer && <span>👤 {e.organizer}</span>}
                          <Badge color={isPast ? "amber" : "blue"}>{isPast ? "Past" : "Upcoming"}</Badge>
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                          <Btn small variant="primary" onClick={() => { setShowScanner(e.id); setScanMsg(null); setScanInput(""); }}>🔍 Scan QR</Btn>
                          <Btn small variant="secondary" onClick={() => { setForm({ name: e.name, date: e.event_date, time: e.event_time || "", location: e.location || "", organizer: e.organizer || "" }); setEditId(e.id); setShowCreate(true); }}>Edit</Btn>
                          <Btn small variant="danger" onClick={() => handleDeleteEvent(e.id)}>Delete</Btn>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── ATTENDANCE ── */}
        
        {view === "attendance" && (
          <div>
            <div style={{ marginBottom: 22 }}>
              <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900, fontFamily: "'Playfair Display', serif", color: "#111" }}>Attendance</h2>
              <p style={{ color: "#888", margin: "4px 0 0", fontSize: 13 }}>Check-ins across your events only</p>
            </div>
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #f0f0f0", overflow: "hidden" }}>
              <table className="iq-reflow" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#fafafa", borderBottom: "2px solid #f0f0f0" }}>
                    {["Student","Roll No.","Dept","Event","Checked In At","Method"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "12px 16px", color: "#aaa", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {attendance.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#ccc" }}>No check-ins yet</td></tr>
                  ) : attendance.map(a => {
                    const evt = events.find(e => e.id === a.event_id);
                    return (
                      <tr key={a.id} style={{ borderBottom: "1px solid #f8f8f8" }}
                        onMouseEnter={e => e.currentTarget.style.background = "#fafafa"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <td className="iq-rf-title" style={{ padding: "12px 16px", fontWeight: 600, color: "#111" }}>{a.name}</td>
                        <td data-label="Roll No." style={{ padding: "12px 16px", color: "#888", fontFamily: "monospace", fontSize: 12 }}>{a.identifier}</td>
                        <td data-label="Dept" style={{ padding: "12px 16px", color: "#666" }}>{a.group_label || "—"}</td>
                        <td data-label="Event" style={{ padding: "12px 16px", color: "#555" }}>{evt?.name || "—"}</td>
                        <td data-label="Checked In" style={{ padding: "12px 16px", color: "#888", fontSize: 12 }}>{a.checked_in_at ? `${formatDate(a.checked_in_at)} ${formatTime(a.checked_in_at)}` : "—"}</td>
                        <td data-label="Method" style={{ padding: "12px 16px" }}><Badge color="blue">{a.method || "manual"}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── REPORTS ── */}
        {view === "reports" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900, fontFamily: "'Playfair Display', serif", color: "#111" }}>Reports</h2>
                <p style={{ color: "#888", margin: "4px 0 0", fontSize: 13 }}>Scoped to your events only</p>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <select value={selectedEvent} onChange={e => setSelectedEvent(e.target.value)}
                  style={{ padding: "9px 12px", borderRadius: 9, border: "1.5px solid #e8e8e8", fontSize: 13, fontFamily: "inherit", outline: "none" }}>
                  <option value="all">All My Events</option>
                  {events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <Btn variant="success" onClick={exportCSV}>⬇ CSV</Btn>
                <Btn variant="primary" onClick={exportPDF}>⬇ PDF</Btn>
              </div>
            </div>

            <div style={{ display: "flex", gap: 14, marginBottom: 22 }}>
              {[
                { icon: "📋", label: "Records",         value: filteredAtt.length,                                              accent: "#6366f1" },
                { icon: "🎓", label: "Unique Students",  value: new Set(filteredAtt.map(a => a.attendee_id)).size,              accent: "#10b981" },
                { icon: "📅", label: "Events",           value: selectedEvent === "all" ? events.length : 1,                   accent: "#f59e0b" },
              ].map(stat => (
                <div key={stat.label} style={{ flex: 1, background: "#fff", borderRadius: 14, padding: "18px 20px", border: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 10, background: stat.accent + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{stat.icon}</div>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "#111", fontFamily: "'Playfair Display', serif" }}>{stat.value}</div>
                    <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{stat.label}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #f0f0f0", overflow: "hidden" }}>
              <table className="iq-reflow" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#fafafa", borderBottom: "2px solid #f0f0f0" }}>
                    {["Student","Roll No.","Dept","Event","Check-in Time"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "12px 16px", color: "#aaa", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredAtt.length === 0 ? (
                    <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#ccc" }}>No records</td></tr>
                  ) : filteredAtt.map(a => {
                    const evt = events.find(e => e.id === a.event_id);
                    return (
                      <tr key={a.id} style={{ borderBottom: "1px solid #f8f8f8" }}>
                        <td className="iq-rf-title" style={{ padding: "11px 16px", fontWeight: 600 }}>{a.name}</td>
                        <td data-label="Roll No." style={{ padding: "11px 16px", color: "#888", fontFamily: "monospace", fontSize: 12 }}>{a.identifier}</td>
                        <td data-label="Dept" style={{ padding: "11px 16px", color: "#666" }}>{a.group_label || "—"}</td>
                        <td data-label="Event" style={{ padding: "11px 16px", color: "#555" }}>{evt?.name || "—"}</td>
                        <td data-label="Check-in" style={{ padding: "11px 16px", color: "#888", fontSize: 12 }}>{a.checked_in_at ? `${formatDate(a.checked_in_at)} ${formatTime(a.checked_in_at)}` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── SECURITY ── */}
        {view === "security" && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900, fontFamily: "'Playfair Display', serif", color: "#111" }}>Security</h2>
              <p style={{ color: "#888", margin: "4px 0 0", fontSize: 13 }}>Manage your account password</p>
            </div>

            <div style={{ background: "#fff", borderRadius: 16, padding: 28, border: "1px solid #f0f0f0", maxWidth: 460 }}>
              <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "'Playfair Display', serif", marginBottom: 20, color: "#111" }}>🔐 Change Password</div>

              {pwError && <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 9, padding: "10px 14px", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>⚠️ {pwError}</div>}
              {pwOk    && <div style={{ background: "#dcfce7", color: "#166534", borderRadius: 9, padding: "10px 14px", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>✅ Password changed successfully!</div>}

              <PwInput label="Current Password"    value={pwForm.current} onChange={e => setPwForm(f => ({...f, current: e.target.value}))} placeholder="Your current password" />
              <PwInput label="New Password"         value={pwForm.next}    onChange={e => setPwForm(f => ({...f, next: e.target.value}))}    placeholder="Choose a strong new password" />
              <PasswordStrength value={pwForm.next} />
              <PwInput label="Confirm New Password" value={pwForm.confirm} onChange={e => setPwForm(f => ({...f, confirm: e.target.value}))} placeholder="Repeat new password" />

              {pwForm.next && pwForm.confirm && (
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: pwForm.next === pwForm.confirm ? "#166534" : "#991b1b" }}>
                  {pwForm.next === pwForm.confirm ? "✓ Passwords match" : "✗ Passwords don't match"}
                </div>
              )}

              <Btn onClick={handleChangePassword} disabled={pwSaving}>
                {pwSaving ? "Updating…" : "Update Password"}
              </Btn>

              <div style={{ marginTop: 16, padding: "12px 14px", background: "#f8f7ff", borderRadius: 9, fontSize: 12, color: "#6366f1" }}>
                💡 Use uppercase, lowercase, numbers and symbols for a strong password.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Create/Edit Modal ── */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={editId ? "Edit Event" : "New Event"}>
        {formError && <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 8, padding: "10px 14px", fontSize: 13, marginBottom: 14 }}>⚠️ {formError}</div>}
        <Input label="Event Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Tech Summit 2025" />
        <div className="iq-grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Input label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          <Input label="Time" type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
        </div>
        <Input label="Location"       value={form.location}  onChange={e => setForm(f => ({ ...f, location: e.target.value }))}  placeholder="Main Auditorium" />
        <Input label="Organizer Name" value={form.organizer} onChange={e => setForm(f => ({ ...f, organizer: e.target.value }))} placeholder="CS Department" />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Btn>
          <Btn onClick={handleSaveEvent}>{saving ? "Saving…" : editId ? "Save Changes" : "Create Event"}</Btn>
        </div>
      </Modal>

      {/* ── Scanner Modal ── */}
      <Modal open={!!showScanner} onClose={() => { setShowScanner(null); stopCamera(); }} title={`Check-in: ${events.find(e => e.id === showScanner)?.name || ""}`}>
        <div style={{ background: "#f8f7ff", border: "2px dashed #c4b5fd", borderRadius: 14, padding: 16, marginBottom: 16, textAlign: "center" }}>
          {cameraActive ? (
            <div>
              <div id="org-qr-reader" style={{ width: "100%", borderRadius: 10 }} />
              <button onClick={stopCamera} style={{ marginTop: 10, background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, cursor: "pointer", width: "100%", fontFamily: "inherit" }}>Stop Camera</button>
            </div>
          ) : (
            <div style={{ padding: 16 }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>📷</div>
              <p style={{ color: "#888", fontSize: 13, margin: "0 0 12px" }}>Scan student QR or enter roll number</p>
              <Btn onClick={startCamera}>Start Camera</Btn>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={scanInput} onChange={e => setScanInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleScan()}
            placeholder="Roll number or Student ID"
            style={{ flex: 1, padding: "10px 14px", borderRadius: 9, border: "1.5px solid #e8e8e8", fontSize: 14, fontFamily: "inherit", outline: "none" }}
            autoFocus
          />
          <Btn onClick={handleScan}>Check In</Btn>
        </div>
        {scanMsg && (
          <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: scanMsg.type === "success" ? "#dcfce7" : "#fee2e2", color: scanMsg.type === "success" ? "#166534" : "#991b1b" }}>
            {scanMsg.text}
          </div>
        )}
        <div style={{ marginTop: 14, fontSize: 12, color: "#aaa" }}>
          Checked in: {attendance.filter(a => a.event_id === showScanner).length}
        </div>
      </Modal>
    </div>
  );
}