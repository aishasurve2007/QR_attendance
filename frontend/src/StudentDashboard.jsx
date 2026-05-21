import { useState, useEffect, useRef } from "react";
import QRCodeLib from "qrcode";

const BASE_URL = "http://localhost:3001/api/v1";

function getToken() { return localStorage.getItem("attendiq_token"); }

function clearAuth() {
  ["attendiq_token","attendiq_org_id","attendiq_role","attendiq_student_id","attendiq_user_name","attendiq_user_id"]
    .forEach(k => localStorage.removeItem(k));
}

let loggingOut = false;

async function apiFetch(url, options = {}) {
  const token = getToken();

  // Check expiry before hitting the server
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (payload.exp * 1000 < Date.now()) {
        if (!loggingOut) {
          loggingOut = true;
          clearAuth();
          window.location.reload();
        }
        return;
      }
    } catch {
      clearAuth();
      window.location.reload();
      return;
    }
  }

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
  if (!res.ok) {
    if (res.status === 401 && !loggingOut) {
      loggingOut = true;
      clearAuth();
      setTimeout(() => { window.location.reload(); }, 100);
    }
    throw new Error(json.error || "Request failed");
  }
  loggingOut = false;
  return json.data ?? json;
}

function formatDate(d) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function formatTime(d) {
  return new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function QRCode({ value, size = 160 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (canvasRef.current && value) {
      QRCodeLib.toCanvas(canvasRef.current, value, {
        width: size, margin: 2, color: { dark: "#0a0a0a", light: "#ffffff" }
      }).catch(console.error);
    }
  }, [value, size]);
  return <canvas ref={canvasRef} style={{ borderRadius: 4 }} />;
}

function Badge({ color = "green", children }) {
  const colors = {
    green:  { bg: "#dcfce7", text: "#166534" },
    blue:   { bg: "#dbeafe", text: "#1e40af" },
    purple: { bg: "#f3e8ff", text: "#6b21a8" },
    amber:  { bg: "#fef9c3", text: "#92400e" },
    gray:   { bg: "#f3f4f6", text: "#374151" },
    red:    { bg: "#fee2e2", text: "#991b1b" },
  };
  const c = colors[color] || colors.green;
  return (
    <span style={{
      background: c.bg, color: c.text, padding: "2px 10px",
      borderRadius: 99, fontSize: 11, fontWeight: 700,
      letterSpacing: "0.04em", textTransform: "uppercase",
    }}>{children}</span>
  );
}

const PW_RULES = [
  { label: "At least 8 characters",  test: v => v.length >= 8 },
  { label: "Uppercase letter (A-Z)", test: v => /[A-Z]/.test(v) },
  { label: "Lowercase letter (a-z)", test: v => /[a-z]/.test(v) },
  { label: "Number (0-9)",           test: v => /\d/.test(v) },
  { label: "Symbol (!@#$%^&*…)",    test: v => /[\W_]/.test(v) },
];

function PasswordStrength({ value }) {
  if (!value) return null;
  const passed = PW_RULES.filter(r => r.test(value)).length;
  const colors = ["#ef4444","#f97316","#eab308","#84cc16","#22c55e"];
  const labels = ["Very weak","Weak","Fair","Good","Strong"];
  return (
    <div style={{ marginTop: 8, marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        {PW_RULES.map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 4, borderRadius: 99,
            background: i < passed ? colors[passed - 1] : "#e8e8e8",
            transition: "background 0.3s",
          }} />
        ))}
      </div>
      <div style={{ fontSize: 11, color: colors[passed - 1] || "#aaa", fontWeight: 700 }}>
        {passed > 0 ? labels[passed - 1] : ""}
      </div>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
        {PW_RULES.map(r => (
          <div key={r.label} style={{
            display: "flex", alignItems: "center", gap: 6,
            fontSize: 11, color: r.test(value) ? "#166534" : "#aaa",
          }}>
            <span>{r.test(value) ? "✓" : "○"}</span>
            <span>{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PwInput is OUTSIDE StudentDashboard — this is the fix ──────────────────
function PwInput({ label, field, value, showPw, onChange, onToggleShow, onKeyDown }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{
        display: "block", fontSize: 11, fontWeight: 700, color: "#555",
        marginBottom: 5, letterSpacing: "0.05em", textTransform: "uppercase",
      }}>
        {label}
      </label>
      <div style={{ position: "relative" }}>
        <input
          type={showPw ? "text" : "password"}
          value={value}
          placeholder={label}
          onChange={e => onChange(field, e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={e => (e.target.style.borderColor = "#6366f1")}
          onBlur={e  => (e.target.style.borderColor = "#e8e8e8")}
          style={{
            width: "100%", padding: "10px 42px 10px 14px",
            borderRadius: 10, border: "1.5px solid #e8e8e8",
            fontSize: 14, fontFamily: "inherit",
            outline: "none", boxSizing: "border-box",
          }}
        />
        <button
          type="button"
          onClick={() => onToggleShow(field)}
          style={{
            position: "absolute", right: 12, top: "50%",
            transform: "translateY(-50%)", background: "none",
            border: "none", cursor: "pointer", fontSize: 15,
            color: "#bbb", padding: 0,
          }}
          aria-label={showPw ? "Hide password" : "Show password"}
        >
          {showPw ? "🙈" : "👁"}
        </button>
      </div>
    </div>
  );
}

// ── StudentDashboard starts here ───────────────────────────────────────────
export default function StudentDashboard({ onLogout }) {
  const studentId   = localStorage.getItem("attendiq_student_id");
  const studentName = localStorage.getItem("attendiq_user_name") || "Student";
  const orgId       = localStorage.getItem("attendiq_org_id") || "demo-org";

  const [profile,    setProfile]    = useState(null);
  const [attended,   setAttended]   = useState([]);
  const [allEvents,  setAllEvents]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [activeTab,  setActiveTab]  = useState("home");

  const [pwForm,    setPwForm]    = useState({ current: "", next: "", confirm: "" });
  const [pwError,   setPwError]   = useState(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwSaving,  setPwSaving]  = useState(false);
  const [showPw,    setShowPw]    = useState({ current: false, next: false, confirm: false });

  useEffect(() => {
    if (!studentId) return;
    setLoading(true);
    Promise.all([
      apiFetch(`${BASE_URL}/orgs/${orgId}/attendees/${studentId}`),
      apiFetch(`${BASE_URL}/orgs/${orgId}/attendees/${studentId}/my-attendance`),
      apiFetch(`${BASE_URL}/orgs/${orgId}/events`),
    ]).then(([prof, att, evts]) => {
      setProfile(prof);
      setAttended(att);
      setAllEvents(evts);
    }).catch(console.error).finally(() => setLoading(false));
  }, [studentId]);

  async function handleChangePassword() {
    setPwError(null);
    setPwSuccess(false);
    const { current, next, confirm } = pwForm;
    if (!current || !next || !confirm)
      return setPwError("All three fields are required.");
    if (next === current)
      return setPwError("New password must differ from your current password.");
    if (next !== confirm)
      return setPwError("New password and confirmation don't match.");
    if (!PW_RULES.every(r => r.test(next)))
      return setPwError("New password doesn't meet all requirements below.");
    setPwSaving(true);
    try {
      await apiFetch(`${BASE_URL}/orgs/${orgId}/attendees/${studentId}/change-password`, {
  method: "PUT",
  body: { currentPassword: current, newPassword: next },
});
      setPwSuccess(true);
      setPwForm({ current: "", next: "", confirm: "" });
    } catch (e) {
      setPwError(e.message);
    } finally {
      setPwSaving(false);
    }
  }

  function handlePwChange(field, value) {
    setPwForm(f => ({ ...f, [field]: value }));
  }

  function handleToggleShow(field) {
    setShowPw(p => ({ ...p, [field]: !p[field] }));
  }

  function handlePwKeyDown(e) {
    if (e.key === "Enter") handleChangePassword();
  }

  const attendedEventIds = new Set(attended.map(a => a.event_id));
  const initial = studentName[0]?.toUpperCase() || "S";
  const hue = studentName.charCodeAt(0) * 5;
  const EVENT_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ec4899", "#3b82f6", "#8b5cf6"];

  const s = {
    page: { fontFamily: "'DM Sans', system-ui, sans-serif", background: "#f7f7f8", minHeight: "100vh" },
    header: {
      background: "#fff", borderBottom: "1px solid #f0f0f0",
      padding: "0 24px", height: 60,
      display: "flex", alignItems: "center", justifyContent: "space-between",
    },
    content: { maxWidth: 860, margin: "0 auto", padding: "24px 16px" },
    tabs: {
      display: "flex", background: "#f5f5f5", borderRadius: 10,
      padding: 4, marginBottom: 24, gap: 4, flexWrap: "wrap",
    },
    tab: (active) => ({
      flex: 1, padding: "9px 0", border: "none", borderRadius: 8,
      fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
      background: active ? "#fff" : "transparent",
      color: active ? "#6366f1" : "#888",
      boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
      transition: "all 0.15s",
      whiteSpace: "nowrap",
    }),
    card: {
      background: "#fff", borderRadius: 16,
      border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      padding: 24, marginBottom: 16,
    },
    statRow: { display: "flex", gap: 12, marginBottom: 20 },
    stat: {
      flex: 1, background: "#fff", borderRadius: 12,
      border: "1px solid #f0f0f0", padding: "16px 18px",
    },
    logoutBtn: {
      background: "none", border: "1px solid #e8e8e8", borderRadius: 8,
      padding: "6px 14px", fontSize: 12, fontWeight: 600,
      color: "#888", cursor: "pointer", fontFamily: "inherit",
    },
  };

  return (
    <div style={s.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; }
      `}</style>

      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg, #6366f1, #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📋</div>
          <span style={{ fontWeight: 900, fontSize: 15, color: "#111", fontFamily: "'Playfair Display', serif" }}>AttendIQ</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", background: `hsl(${hue},60%,88%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: `hsl(${hue},50%,35%)` }}>{initial}</div>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>{studentName}</span>
          <button style={s.logoutBtn} onClick={onLogout}>Sign out</button>
        </div>
      </div>

      <div style={s.content}>
        <div style={s.tabs}>
          <button style={s.tab(activeTab === "home")}     onClick={() => setActiveTab("home")}>🏠 Home</button>
          <button style={s.tab(activeTab === "events")}   onClick={() => setActiveTab("events")}>📅 All Events</button>
          <button style={s.tab(activeTab === "history")}  onClick={() => setActiveTab("history")}>✅ My Attendance</button>
          <button style={s.tab(activeTab === "qr")}       onClick={() => setActiveTab("qr")}>🔲 My QR Code</button>
          <button style={s.tab(activeTab === "security")} onClick={() => { setActiveTab("security"); setPwError(null); setPwSuccess(false); }}>🔐 Security</button>
        </div>

        {loading && <div style={{ textAlign: "center", padding: 60, color: "#bbb" }}>Loading…</div>}

        {/* ── HOME ── */}
        {!loading && activeTab === "home" && (
          <>
            <div style={{ ...s.card, textAlign: "center" }}>
              <div style={{ width: 72, height: 72, borderRadius: "50%", margin: "0 auto 16px", background: `hsl(${hue},60%,88%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 900, color: `hsl(${hue},50%,35%)` }}>{initial}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#111", fontFamily: "'Playfair Display', serif", marginBottom: 4 }}>{profile?.name || studentName}</div>
              <div style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>{profile?.identifier} · {profile?.group_label}</div>
              <div style={{ fontSize: 12, color: "#bbb", marginBottom: 16 }}>{profile?.email}</div>
              <Badge color="blue">🎓 Student</Badge>
            </div>
            <div style={s.statRow}>
              <div style={s.stat}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#111", fontFamily: "'Playfair Display', serif" }}>{attended.length}</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Events Attended</div>
              </div>
              <div style={s.stat}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#111", fontFamily: "'Playfair Display', serif" }}>{allEvents.length}</div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Total Events</div>
              </div>
              <div style={s.stat}>
                <div style={{ fontSize: 28, fontWeight: 800, color: "#111", fontFamily: "'Playfair Display', serif" }}>
                  {allEvents.length ? Math.round((attended.length / allEvents.length) * 100) : 0}%
                </div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>Attendance Rate</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setActiveTab("events")} style={{ flex: 1, padding: 13, background: "#f0f0ff", border: "none", borderRadius: 12, fontSize: 13, fontWeight: 700, color: "#6366f1", cursor: "pointer", fontFamily: "inherit" }}>📅 Browse All Events</button>
              <button onClick={() => setActiveTab("qr")} style={{ flex: 1, padding: 13, background: "#f0f0ff", border: "none", borderRadius: 12, fontSize: 13, fontWeight: 700, color: "#6366f1", cursor: "pointer", fontFamily: "inherit" }}>🔲 Show My QR Code</button>
            </div>
          </>
        )}

        {/* ── ALL EVENTS ── */}
        {!loading && activeTab === "events" && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 900, fontFamily: "'Playfair Display', serif", color: "#111" }}>All Events</h2>
              <p style={{ margin: 0, fontSize: 13, color: "#888" }}>{allEvents.length} events · You've attended {attended.length}</p>
            </div>
            {allEvents.length === 0 ? (
              <div style={{ ...s.card, textAlign: "center", color: "#ccc", padding: 60 }}>No events yet</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
                {allEvents.map((e, i) => {
                  const isAttended = attendedEventIds.has(e.id);
                  const isPast = new Date(e.event_date) < new Date();
                  const color = EVENT_COLORS[i % EVENT_COLORS.length];
                  return (
                    <div key={e.id} style={{ background: "#fff", borderRadius: 16, overflow: "hidden", border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
                      <div style={{ height: 5, background: color }} />
                      <div style={{ padding: 20 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#111", flex: 1, lineHeight: 1.3 }}>{e.name}</h3>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                            {isAttended && <Badge color="green">✓ Attended</Badge>}
                            {isPast && !isAttended && <Badge color="gray">Past</Badge>}
                            {!isPast && !isAttended && <Badge color="purple">Upcoming</Badge>}
                          </div>
                        </div>
                        <div style={{ fontSize: 12, color: "#888", display: "flex", flexDirection: "column", gap: 6 }}>
                          <span>📅 {formatDate(e.event_date)}{e.event_time ? ` at ${e.event_time}` : ""}</span>
                          {e.location && <span>📍 {e.location}</span>}
                          {e.organizer && <span>👤 {e.organizer}</span>}
                          <span style={{ color: "#aaa" }}>👥 {e.attendance_count || 0} checked in</span>
                        </div>
                        {isAttended && (
                          <div style={{ marginTop: 12, padding: "8px 12px", background: "#dcfce7", borderRadius: 8, fontSize: 12, color: "#166534", fontWeight: 600 }}>
                            ✅ You attended this event
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── MY ATTENDANCE ── */}
        {!loading && activeTab === "history" && (
          <div style={s.card}>
            <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "'Playfair Display', serif", marginBottom: 20, color: "#111" }}>My Attendance History</div>
            {attended.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, color: "#ccc", fontSize: 14 }}>You haven't attended any events yet.</div>
            ) : (
              attended.map((a, i) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 0", borderBottom: i < attended.length - 1 ? "1px solid #f5f5f5" : "none" }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: "#f0f0ff", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📅</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: "#111", fontSize: 14 }}>{a.event_name}</div>
                    <div style={{ fontSize: 12, color: "#aaa", marginTop: 3 }}>
                      {formatDate(a.checked_in_at)} at {formatTime(a.checked_in_at)}
                      {a.location && ` · ${a.location}`}
                    </div>
                  </div>
                  <Badge color="green">Present</Badge>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── QR CODE ── */}
        {!loading && activeTab === "qr" && (
          <div style={{ ...s.card, textAlign: "center" }}>
            <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "'Playfair Display', serif", marginBottom: 6, color: "#111" }}>Your QR Code</div>
            <p style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>Show this at the event entrance to check in instantly</p>
            <div style={{ display: "inline-flex", padding: 20, background: "#fff", borderRadius: 16, border: "2px solid #f0f0f0", marginBottom: 20 }} id="qr-wrap">
              <QRCode value={studentId || "no-id"} size={200} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, color: "#111", marginBottom: 4 }}>{profile?.name || studentName}</div>
            <div style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>{profile?.identifier} · {profile?.group_label}</div>
            <div style={{ fontSize: 11, color: "#bbb", fontFamily: "monospace", marginBottom: 20 }}>ID: {studentId}</div>
            <button onClick={() => {
              const canvas = document.querySelector("#qr-wrap canvas");
              if (!canvas) return;
              const link = document.createElement("a");
              link.download = `${studentName}-QR.png`;
              link.href = canvas.toDataURL("image/png");
              link.click();
            }} style={{ background: "#6366f1", color: "#fff", border: "none", borderRadius: 10, padding: "10px 24px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              ⬇ Download QR Code
            </button>
          </div>
        )}

        {/* ── SECURITY ── */}
        {!loading && activeTab === "security" && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 900, fontFamily: "'Playfair Display', serif", color: "#111" }}>Security</h2>
              <p style={{ margin: 0, fontSize: 13, color: "#888" }}>Update your password to keep your account safe</p>
            </div>
            <div style={{ ...s.card, maxWidth: 460 }}>
              <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "'Playfair Display', serif", marginBottom: 20, color: "#111" }}>
                🔐 Change Password
              </div>
              {pwError && (
                <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 9, padding: "10px 14px", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
                  ⚠️ {pwError}
                </div>
              )}
              {pwSuccess && (
                <div style={{ background: "#dcfce7", color: "#166534", borderRadius: 9, padding: "10px 14px", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
                  ✅ Password changed successfully!
                </div>
              )}
              <PwInput label="Current Password"     field="current" value={pwForm.current} showPw={showPw.current} onChange={handlePwChange} onToggleShow={handleToggleShow} onKeyDown={handlePwKeyDown} />
              <PwInput label="New Password"          field="next"    value={pwForm.next}    showPw={showPw.next}    onChange={handlePwChange} onToggleShow={handleToggleShow} onKeyDown={handlePwKeyDown} />
              <PasswordStrength value={pwForm.next} />
              <PwInput label="Confirm New Password"  field="confirm" value={pwForm.confirm} showPw={showPw.confirm} onChange={handlePwChange} onToggleShow={handleToggleShow} onKeyDown={handlePwKeyDown} />
              {pwForm.next && pwForm.confirm && (
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: pwForm.next === pwForm.confirm ? "#166534" : "#991b1b" }}>
                  {pwForm.next === pwForm.confirm ? "✓ Passwords match" : "✗ Passwords don't match"}
                </div>
              )}
              <button onClick={handleChangePassword} disabled={pwSaving} style={{ width: "100%", padding: "11px 0", background: "#6366f1", color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: pwSaving ? "not-allowed" : "pointer", fontFamily: "inherit", opacity: pwSaving ? 0.7 : 1 }}>
                {pwSaving ? "Updating…" : "Update Password"}
              </button>
              <div style={{ marginTop: 16, padding: "12px 14px", background: "#f8f7ff", borderRadius: 9, fontSize: 12, color: "#6366f1" }}>
                💡 Use a mix of uppercase, lowercase, numbers and symbols for a strong password.
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}