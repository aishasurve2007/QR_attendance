// ─────────────────────────────────────────────────────────────────────────────
// AttendanceApp.jsx  —  Root component with role-based routing
// Changes from original:
//   1. SettingsView: added proper 3-field "Change Password" section
//      with live strength meter, show/hide toggles, and complexity enforcement
//   2. SettingsView: fixed handleSave (was referencing EventsView-scoped vars)
//   3. OrganizersView: "Reset PW" now opens a 3-field modal (old password
//      is not required for admin reset, but complexity IS enforced)
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, createContext, useContext, useRef } from "react";
import QRCodeLib from "qrcode";
import LoginPage from "./LoginPage";
import StudentDashboard from "./StudentDashboard";
import OrganizerDashboard from "./OrganizerDashboard";
import {
  ResponsiveContainer, BarChart, Bar, CartesianGrid,
  XAxis, YAxis, Tooltip, PieChart, Pie, Cell, Legend
} from "recharts";

// ─── Context ──────────────────────────────────────────────────────────────────
const OrgContext = createContext({
  orgId: "demo-org", orgName: "AttendIQ College",
  attendeeLabel: "Student", identifierLabel: "Roll No.", groupLabel: "Department",
  setOrgConfig: () => {},
});
function useOrgConfig() { return useContext(OrgContext); }

// ─── API ──────────────────────────────────────────────────────────────────────
const BASE_URL = "https://attendiq-api.onrender.com/api/v1";
const ADMIN_URL = "https://attendiq-api.onrender.com/admin";

function getToken() {
  return typeof localStorage !== "undefined" ? localStorage.getItem("attendiq_token") : null;
}
function clearAuth() {
  ["attendiq_token","attendiq_org_id","attendiq_role","attendiq_student_id","attendiq_user_name","attendiq_user_id"]
    .forEach(k => localStorage.removeItem(k));
}
let loggingOut = false;

async function apiFetch(url, options = {}) {
  // Check token expiry before every request
  const token = getToken();
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

// ─── Utilities ────────────────────────────────────────────────────────────────
function formatDate(d) { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function formatTime(d) { return new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }); }
function uid() { return Math.random().toString(36).slice(2, 9).toUpperCase(); }

// ─── Mock data ────────────────────────────────────────────────────────────────
const MOCK_STUDENTS = [
  { id: "STU001", name: "Aisha Rahman",  roll: "CS2021001", dept: "Computer Science",       email: "aisha@college.edu" },
  { id: "STU002", name: "Marcus Chen",   roll: "EE2021042", dept: "Electrical Engineering",  email: "marcus@college.edu" },
  { id: "STU003", name: "Priya Nair",    roll: "ME2022015", dept: "Mechanical Engineering",  email: "priya@college.edu" },
  { id: "STU004", name: "James Okafor", roll: "CS2022008", dept: "Computer Science",        email: "james@college.edu" },
  { id: "STU005", name: "Sofia Mendez", roll: "BIO2021031", dept: "Biotechnology",          email: "sofia@college.edu" },
];
const MOCK_EVENTS = [
  { id: "EVT001", name: "Tech Summit 2025",      event_date: "2025-03-15", event_time: "10:00", location: "Main Auditorium",   organizer: "CS Dept" },
  { id: "EVT002", name: "Cultural Fest Opening", event_date: "2025-03-18", event_time: "18:00", location: "Open Air Theatre",  organizer: "Student Council" },
  { id: "EVT003", name: "Research Symposium",    event_date: "2025-03-20", event_time: "09:00", location: "Conference Hall B", organizer: "Research Cell" },
];
const MOCK_ATTENDANCE = [
  { id: "ATT001", event_id: "EVT001", attendee_id: "STU001", checked_in_at: "2025-03-15T10:12:00" },
  { id: "ATT002", event_id: "EVT001", attendee_id: "STU002", checked_in_at: "2025-03-15T10:18:00" },
  { id: "ATT003", event_id: "EVT002", attendee_id: "STU001", checked_in_at: "2025-03-18T18:05:00" },
  { id: "ATT004", event_id: "EVT002", attendee_id: "STU003", checked_in_at: "2025-03-18T18:22:00" },
  { id: "ATT005", event_id: "EVT003", attendee_id: "STU004", checked_in_at: "2025-03-20T09:08:00" },
];

// ─── Password rules (shared across Admin + Organizer reset) ───────────────────
const PW_RULES = [
  { label: "At least 8 characters",    test: v => v.length >= 8 },
  { label: "Uppercase letter (A-Z)",   test: v => /[A-Z]/.test(v) },
  { label: "Lowercase letter (a-z)",   test: v => /[a-z]/.test(v) },
  { label: "Number (0-9)",              test: v => /\d/.test(v) },
  { label: "Symbol (!@#$%^&*…)",       test: v => /[\W_]/.test(v) },
];

function PasswordStrength({ value }) {
  if (!value) return null;
  const passed = PW_RULES.filter(r => r.test(value)).length;
  const colors = ["#ef4444","#f97316","#eab308","#84cc16","#22c55e"];
  const labels = ["Very weak","Weak","Fair","Good","Strong"];
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
        {PW_RULES.map((_, i) => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 99, background: i < passed ? colors[passed - 1] : "#e8e8e8", transition: "background 0.3s" }} />
        ))}
      </div>
      <div style={{ fontSize: 11, color: colors[passed - 1] || "#aaa", fontWeight: 700, marginBottom: 6 }}>
        {passed > 0 ? labels[passed - 1] : ""}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {PW_RULES.map(r => (
          <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: r.test(value) ? "#166534" : "#aaa" }}>
            <span>{r.test(value) ? "✓" : "○"}</span>
            <span>{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Shared UI components ─────────────────────────────────────────────────────
function Skeleton({ width = "100%", height = 18, radius = 8, style = {} }) {
  return <div style={{ width, height, borderRadius: radius, background: "linear-gradient(90deg,#f0f0f0 25%,#e8e8e8 50%,#f0f0f0 75%)", backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite", ...style }} />;
}
function TableSkeleton({ rows = 5, cols = 4 }) {
  return <div>{Array.from({ length: rows }).map((_, i) => (<div key={i} style={{ display: "flex", gap: 16, padding: "16px 18px", borderBottom: "1px solid #f8f8f8" }}>{Array.from({ length: cols }).map((_, j) => <Skeleton key={j} width={`${100 / cols}%`} height={14} />)}</div>))}</div>;
}
function QRCode({ value, size = 120 }) {
  const canvasRef = useRef(null);
  useEffect(() => { if (canvasRef.current && value) QRCodeLib.toCanvas(canvasRef.current, value, { width: size, margin: 2, color: { dark: "#0a0a0a", light: "#ffffff" } }).catch(console.error); }, [value, size]);
  return <canvas ref={canvasRef} style={{ borderRadius: 4 }} />;
}
function Badge({ color = "blue", children }) {
  const colors = { blue: { bg: "#dbeafe", text: "#1e40af" }, green: { bg: "#dcfce7", text: "#166534" }, amber: { bg: "#fef9c3", text: "#92400e" }, red: { bg: "#fee2e2", text: "#991b1b" }, purple: { bg: "#f3e8ff", text: "#6b21a8" }, teal: { bg: "#ccfbf1", text: "#134e4a" }, gray: { bg: "#f3f4f6", text: "#374151" } };
  const c = colors[color] || colors.blue;
  return <span style={{ background: c.bg, color: c.text, padding: "2px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>{children}</span>;
}
function StatCard({ icon, label, value, accent }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", border: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 16, flex: "1 1 160px" }}>
      <div style={{ width: 46, height: 46, borderRadius: 12, background: accent + "18", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 26, fontWeight: 800, color: "#111", fontFamily: "'Playfair Display', serif", lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: 12, color: "#888", marginTop: 3, fontWeight: 500 }}>{label}</div>
      </div>
    </div>
  );
}
function Modal({ open, onClose, title, children }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 32, width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", animation: "slideUp 0.22s ease", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, fontFamily: "'Playfair Display', serif" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Input({ label, ...props }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 6, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</label>}
      <input style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e8e8e8", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box", transition: "border 0.2s" }}
        onFocus={e => e.target.style.borderColor = "#6366f1"}
        onBlur={e => e.target.style.borderColor = "#e8e8e8"}
        {...props} />
    </div>
  );
}
function Btn({ children, onClick, variant = "primary", small, style: extraStyle = {}, disabled }) {
  const base = { border: "none", borderRadius: small ? 8 : 12, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", fontWeight: 700, letterSpacing: "0.02em", padding: small ? "7px 14px" : "11px 22px", fontSize: small ? 12 : 14, transition: "all 0.18s", display: "inline-flex", alignItems: "center", gap: 6, opacity: disabled ? 0.6 : 1 };
  const variants = { primary: { background: "#6366f1", color: "#fff" }, secondary: { background: "#f5f5f5", color: "#333" }, danger: { background: "#fee2e2", color: "#991b1b" }, success: { background: "#dcfce7", color: "#166534" }, ghost: { background: "transparent", color: "#6366f1", border: "1.5px solid #6366f1" } };
  return <button style={{ ...base, ...variants[variant], ...extraStyle }} onMouseEnter={e => !disabled && (e.currentTarget.style.opacity = "0.85")} onMouseLeave={e => !disabled && (e.currentTarget.style.opacity = "1")} onClick={!disabled ? onClick : undefined}>{children}</button>;
}
function ErrorBanner({ message }) {
  if (!message) return null;
  return <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 10, padding: "12px 16px", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>⚠️ {message}</div>;
}

// ─── Password Input with show/hide toggle ─────────────────────────────────────
function PwInput({ label, value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 6, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</label>}
      <div style={{ position: "relative" }}>
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
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

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN: Organizers Management View
// ─────────────────────────────────────────────────────────────────────────────
function OrganizersView() {
  const [organizers, setOrganizers] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [apiError, setApiError]     = useState(null);

  const [showAdd, setShowAdd]       = useState(false);
  const [addForm, setAddForm]       = useState({ email: "", password: "" });
  const [addSaving, setAddSaving]   = useState(false);
  const [addError, setAddError]     = useState(null);

  // ── Reset password — now 3-field with complexity ──────────────────────────
  const [showReset, setShowReset]       = useState(null);
  const [resetForm, setResetForm]       = useState({ newPw: "", confirmPw: "" });
  const [resetSaving, setResetSaving]   = useState(false);
  const [resetMsg, setResetMsg]         = useState(null);

  const [showEvents, setShowEvents] = useState(null);

  useEffect(() => { loadOrganizers(); }, []);

  async function loadOrganizers() {
    setLoading(true); setApiError(null);
    try {
      const data = await apiFetch(`${ADMIN_URL}/organizers`);
      setOrganizers(data);
    } catch (e) { setApiError(e.message); }
    finally { setLoading(false); }
  }

  async function handleAdd() {
    if (!addForm.email || !addForm.password) return;
    const allPassed = PW_RULES.every(r => r.test(addForm.password));
    if (!allPassed) { setAddError("Password doesn't meet complexity requirements."); return; }
    setAddSaving(true); setAddError(null);
    try {
      const created = await apiFetch(`${ADMIN_URL}/organizers`, { method: "POST", body: addForm });
      setOrganizers(o => [created, ...o]);
      setAddForm({ email: "", password: "" });
      setShowAdd(false);
    } catch (e) { setAddError(e.message); }
    finally { setAddSaving(false); }
  }

  async function handleToggleActive(org) {
    try {
      const endpoint = org.is_active ? "deactivate" : "activate";
      const updated = await apiFetch(`${ADMIN_URL}/organizers/${org.id}/${endpoint}`, { method: "PATCH" });
      setOrganizers(o => o.map(x => x.id === org.id ? { ...x, is_active: updated.is_active } : x));
    } catch (e) { alert(e.message); }
  }

  async function handleResetPassword() {
    const { newPw, confirmPw } = resetForm;
    if (!newPw || !confirmPw) { setResetMsg({ ok: false, text: "Both fields are required." }); return; }
    if (newPw !== confirmPw)  { setResetMsg({ ok: false, text: "Passwords don't match." }); return; }
    const allPassed = PW_RULES.every(r => r.test(newPw));
    if (!allPassed) { setResetMsg({ ok: false, text: "Password doesn't meet complexity requirements." }); return; }

    setResetSaving(true); setResetMsg(null);
    try {
      await apiFetch(`${ADMIN_URL}/organizers/${showReset.id}/reset-password`, { method: "PATCH", body: { password: newPw } });
      setResetMsg({ ok: true, text: "✓ Password reset successfully." });
      setResetForm({ newPw: "", confirmPw: "" });
    } catch (e) { setResetMsg({ ok: false, text: e.message }); }
    finally { setResetSaving(false); }
  }

  async function handleViewEvents(org) {
    try {
      const detail = await apiFetch(`${ADMIN_URL}/organizers/${org.id}`);
      setShowEvents(detail);
    } catch (e) { alert(e.message); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, fontFamily: "'Playfair Display', serif", color: "#111" }}>Organizers</h2>
          <p style={{ color: "#888", margin: "6px 0 0", fontSize: 14 }}>Manage event organizer accounts</p>
        </div>
        <Btn onClick={() => { setShowAdd(true); setAddError(null); setAddForm({ email: "", password: "" }); }}>＋ Add Organizer</Btn>
      </div>

      <ErrorBanner message={apiError} />

      {loading ? (
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", overflow: "hidden" }}>
          <TableSkeleton rows={4} cols={5} />
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa", borderBottom: "2px solid #f0f0f0" }}>
                {["Organizer", "Events Created", "Status", "Joined", "Actions"].map(h => (
                  <th key={h} style={{ textAlign: "left", padding: "14px 18px", color: "#aaa", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {organizers.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#ccc", fontSize: 14 }}>No organizers yet. Add one to get started.</td></tr>
              ) : organizers.map(org => (
                <tr key={org.id} style={{ borderBottom: "1px solid #f8f8f8" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#fafafa"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "14px 18px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: "50%", background: `hsl(${org.email.charCodeAt(0) * 7},60%,88%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: `hsl(${org.email.charCodeAt(0) * 7},50%,35%)` }}>
                        {org.email[0].toUpperCase()}
                      </div>
                      <span style={{ fontWeight: 600, color: "#111" }}>{org.email}</span>
                    </div>
                  </td>
                  <td style={{ padding: "14px 18px" }}>
                    <button onClick={() => handleViewEvents(org)} style={{ background: "none", border: "none", cursor: "pointer", color: "#6366f1", fontWeight: 700, fontSize: 13, fontFamily: "inherit", padding: 0 }}>
                      {org.event_count} event{org.event_count !== 1 ? "s" : ""} →
                    </button>
                  </td>
                  <td style={{ padding: "14px 18px" }}>
                    <Badge color={org.is_active ? "green" : "red"}>{org.is_active ? "Active" : "Inactive"}</Badge>
                  </td>
                  <td style={{ padding: "14px 18px", color: "#888", fontSize: 12, fontFamily: "'DM Mono', monospace" }}>
                    {formatDate(org.created_at)}
                  </td>
                  <td style={{ padding: "14px 18px" }}>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Btn small variant="ghost" onClick={() => { setShowReset(org); setResetForm({ newPw: "", confirmPw: "" }); setResetMsg(null); }}>Reset PW</Btn>
                      <Btn small variant={org.is_active ? "danger" : "success"} onClick={() => handleToggleActive(org)}>
                        {org.is_active ? "Deactivate" : "Activate"}
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Organizer Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add New Organizer">
        <ErrorBanner message={addError} />
        <Input label="Email" type="email" value={addForm.email} onChange={e => setAddForm(f => ({ ...f, email: e.target.value }))} placeholder="organizer@college.edu" />
        <PwInput label="Password" value={addForm.password} onChange={e => setAddForm(f => ({ ...f, password: e.target.value }))} placeholder="Set a strong password" />
        <PasswordStrength value={addForm.password} />
        <div style={{ background: "#f8f7ff", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#6366f1", marginBottom: 16 }}>
          💡 Share these credentials securely with the organizer.
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Btn>
          <Btn onClick={handleAdd}>{addSaving ? "Adding…" : "Add Organizer"}</Btn>
        </div>
      </Modal>

      {/* Reset Password Modal — 2 fields + strength meter */}
      <Modal open={!!showReset} onClose={() => setShowReset(null)} title={`Reset Password — ${showReset?.email}`}>
        <div style={{ background: "#fef9c3", borderRadius: 9, padding: "10px 14px", fontSize: 12, color: "#92400e", fontWeight: 600, marginBottom: 16 }}>
          ⚠️ As admin you can set a new password directly. The organizer should change it after logging in.
        </div>
        <PwInput label="New Password" value={resetForm.newPw} onChange={e => setResetForm(f => ({ ...f, newPw: e.target.value }))} placeholder="Enter new password" />
        <PasswordStrength value={resetForm.newPw} />
        <PwInput label="Confirm New Password" value={resetForm.confirmPw} onChange={e => setResetForm(f => ({ ...f, confirmPw: e.target.value }))} placeholder="Repeat new password" />
        {resetForm.newPw && resetForm.confirmPw && (
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 14, color: resetForm.newPw === resetForm.confirmPw ? "#166534" : "#991b1b" }}>
            {resetForm.newPw === resetForm.confirmPw ? "✓ Passwords match" : "✗ Passwords don't match"}
          </div>
        )}
        {resetMsg && (
          <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: resetMsg.ok ? "#dcfce7" : "#fee2e2", color: resetMsg.ok ? "#166534" : "#991b1b" }}>
            {resetMsg.text}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={() => setShowReset(null)}>Close</Btn>
          <Btn onClick={handleResetPassword} disabled={resetSaving}>{resetSaving ? "Resetting…" : "Reset Password"}</Btn>
        </div>
      </Modal>

      {/* View Events Modal */}
      <Modal open={!!showEvents} onClose={() => setShowEvents(null)} title={`Events by ${showEvents?.email}`}>
        {showEvents?.events?.length === 0 ? (
          <div style={{ textAlign: "center", padding: 30, color: "#ccc" }}>No events created yet</div>
        ) : (
          <div style={{ maxHeight: 360, overflowY: "auto" }}>
            {showEvents?.events?.map((e, i) => (
              <div key={e.id} style={{ padding: "12px 0", borderBottom: i < showEvents.events.length - 1 ? "1px solid #f5f5f5" : "none" }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#111", marginBottom: 4 }}>{e.name}</div>
                <div style={{ fontSize: 12, color: "#888", display: "flex", gap: 12 }}>
                  <span>📅 {formatDate(e.event_date)}</span>
                  {e.location && <span>📍 {e.location}</span>}
                  <span>👥 {e.attendance_count} checked in</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

// ─── Dashboard, EventsView, StudentsView, ReportsView, StudentPortal ──────────
// (unchanged from your original — only SettingsView is replaced below)
function Dashboard({ students, events, attendance, loading }) {
  const { attendeeLabel } = useOrgConfig();
  const recentAtt = [...attendance].sort((a, b) => new Date(b.time || b.checked_in_at) - new Date(a.time || a.checked_in_at)).slice(0, 6);
  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, fontFamily: "'Playfair Display', serif", color: "#111" }}>Overview</h2>
        <p style={{ color: "#888", margin: "6px 0 0", fontSize: 14 }}>Real-time attendance insights across all events</p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 28 }}>
        {loading ? Array(4).fill(0).map((_, i) => <div key={i} style={{ flex: "1 1 160px", background: "#fff", borderRadius: 16, padding: "20px 24px", border: "1px solid #f0f0f0" }}><Skeleton height={46} width={46} radius={12} style={{ marginBottom: 12 }} /><Skeleton height={26} width="60%" style={{ marginBottom: 6 }} /><Skeleton height={12} width="80%" /></div>) : (
          <>
            <StatCard icon="🎓" label={`Total ${attendeeLabel}s`} value={students.length} accent="#6366f1" />
            <StatCard icon="📅" label="Events Created" value={events.length} accent="#f59e0b" />
            <StatCard icon="✅" label="Check-ins" value={attendance.length} accent="#10b981" />
            <StatCard icon="📊" label="Avg. Attendance" value={events.length ? Math.round(attendance.length / events.length) : 0} accent="#ec4899" />
          </>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.07)", border: "1px solid #f0f0f0", gridColumn: "1 / -1" }}>
          <h4 style={{ margin: "0 0 18px", fontFamily: "'Playfair Display', serif", fontSize: 17 }}>Recent Check-ins</h4>
          {loading ? <TableSkeleton rows={5} cols={4} /> : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead><tr style={{ borderBottom: "2px solid #f0f0f0" }}>{[attendeeLabel, "Event", "Time", "Status"].map(h => <th key={h} style={{ textAlign: "left", padding: "6px 12px", color: "#aaa", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>)}</tr></thead>
              <tbody>{recentAtt.map((a) => {
                const stu = students.find(s => s.id === (a.studentId || a.attendee_id));
                const evt = events.find(e => e.id === (a.eventId || a.event_id));
                const ts = a.time || a.checked_in_at;
                return (
                  <tr key={a.id} style={{ borderBottom: "1px solid #f8f8f8" }} onMouseEnter={e => e.currentTarget.style.background = "#fafafa"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <td style={{ padding: "12px 12px" }}><div style={{ display: "flex", alignItems: "center", gap: 10 }}><div style={{ width: 32, height: 32, borderRadius: "50%", background: `hsl(${(stu?.name?.charCodeAt(0) || 65) * 5}, 60%, 88%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: `hsl(${(stu?.name?.charCodeAt(0) || 65) * 5}, 50%, 35%)` }}>{stu?.name?.[0]}</div><span style={{ fontWeight: 600, color: "#222" }}>{stu?.name || "Unknown"}</span></div></td>
                    <td style={{ padding: "12px 12px", color: "#555" }}>{evt?.name || "Unknown"}</td>
                    <td style={{ padding: "12px 12px", color: "#888", fontFamily: "'DM Mono', monospace", fontSize: 12 }}>{formatDate(ts)} {formatTime(ts)}</td>
                    <td style={{ padding: "12px 12px" }}><Badge color="green">Present</Badge></td>
                  </tr>
                );
              })}</tbody>
            </table>
          )}
        </div>
        <div style={{ background: "#fff", borderRadius: 16, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.07)", border: "1px solid #f0f0f0", gridColumn: "1 / -1" }}>
          <h4 style={{ margin: "0 0 18px", fontFamily: "'Playfair Display', serif", fontSize: 17 }}>Event Attendance Breakdown</h4>
          {loading ? <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{Array(3).fill(0).map((_, i) => <Skeleton key={i} height={20} />)}</div> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {events.map(e => {
                const count = attendance.filter(a => (a.eventId || a.event_id) === e.id).length;
                const pct = students.length ? Math.round((count / students.length) * 100) : 0;
                return (
                  <div key={e.id}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, fontSize: 13 }}><span style={{ fontWeight: 600, color: "#222" }}>{e.name}</span><span style={{ color: "#888", fontFamily: "'DM Mono', monospace" }}>{count}/{students.length}</span></div>
                    <div style={{ height: 8, background: "#f0f0f0", borderRadius: 99, overflow: "hidden" }}><div style={{ height: "100%", width: `${pct}%`, borderRadius: 99, background: "linear-gradient(90deg, #6366f1, #8b5cf6)", transition: "width 0.6s ease" }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EventsView({ events, setEvents, students, attendance, setAttendance, apiAvailable, orgId }) {
  const [showCreate, setShowCreate] = useState(false);
  const [showScanner, setShowScanner] = useState(null);
  const [scanInput, setScanInput] = useState("");
  const [scanMsg, setScanMsg] = useState(null);
  const [form, setForm] = useState({ name: "", date: "", time: "", location: "", organizer: "" });
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState(null);
  const scannerRef = useRef(null);
  const [cameraActive, setCameraActive] = useState(false);

  async function startCamera() {
    try {
      setCameraActive(true); setScanMsg(null);
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("qr-reader");
      scannerRef.current = scanner;
      await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => { setScanInput(decodedText); setScanMsg({ type: "success", text: "✓ QR Scanned!" }); stopCamera(); }, () => {});
    } catch (e) { setScanMsg({ type: "error", text: "Camera error: " + e.message }); setCameraActive(false); }
  }
  async function stopCamera() {
    try { if (scannerRef.current) { await scannerRef.current.stop(); scannerRef.current = null; } } catch {}
    setCameraActive(false);
  }
  async function handleSave() {
    if (!form.name || !form.date) return;
    setSaving(true); setApiError(null);
    try {
      const payload = { name: form.name, event_date: form.date, event_time: form.time || null, location: form.location || null, organizer: form.organizer || null, description: null };
      if (apiAvailable) {
        if (editId) { const updated = await apiFetch(`${BASE_URL}/orgs/${orgId}/events/${editId}`, { method: "PUT", body: payload }); setEvents(ev => ev.map(e => e.id === editId ? { ...e, ...updated } : e)); }
        else { const created = await apiFetch(`${BASE_URL}/orgs/${orgId}/events`, { method: "POST", body: payload }); setEvents(ev => [...ev, created]); }
      } else {
        if (editId) setEvents(ev => ev.map(e => e.id === editId ? { ...e, ...form } : e));
        else setEvents(ev => [...ev, { id: "EVT" + uid(), ...form }]);
      }
      setForm({ name: "", date: "", time: "", location: "", organizer: "" }); setEditId(null); setShowCreate(false);
    } catch (e) { setApiError(e.message); } finally { setSaving(false); }
  }
  async function handleDelete(id) {
    try { if (apiAvailable) await apiFetch(`${BASE_URL}/orgs/${orgId}/events/${id}`, { method: "DELETE" }); setEvents(ev => ev.filter(e => e.id !== id)); }
    catch (e) { setApiError(e.message); }
  }
  function handleEdit(e) { setForm({ name: e.name, date: e.date || e.event_date, time: e.time || e.event_time, location: e.location, organizer: e.organizer }); setEditId(e.id); setShowCreate(true); }
  async function handleScan() {
    const student = students.find(s => s.id === scanInput.trim() || s.roll === scanInput.trim() || s.identifier === scanInput.trim());
    if (!student) { setScanMsg({ type: "error", text: "Attendee not found." }); return; }
    const already = attendance.find(a => (a.eventId || a.event_id) === showScanner && (a.studentId || a.attendee_id) === student.id);
    if (already) { setScanMsg({ type: "warn", text: `${student.name} already checked in!` }); return; }
    try {
      if (apiAvailable) { const record = await apiFetch(`${BASE_URL}/orgs/${orgId}/events/${showScanner}/checkin`, { method: "POST", body: { identifier: student.identifier || student.roll, method: "manual" } }); setAttendance(a => [...a, record]); }
      else setAttendance(a => [...a, { id: "ATT" + uid(), eventId: showScanner, studentId: student.id, time: new Date().toISOString() }]);
      setScanMsg({ type: "success", text: `✓ ${student.name} checked in!` }); setScanInput("");
    } catch (e) { setScanMsg({ type: "error", text: e.message }); }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div><h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, fontFamily: "'Playfair Display', serif", color: "#111" }}>Events</h2><p style={{ color: "#888", margin: "6px 0 0", fontSize: 14 }}>{events.length} events • {attendance.length} total check-ins</p></div>
        <Btn onClick={() => { setShowCreate(true); setEditId(null); setForm({ name: "", date: "", time: "", location: "", organizer: "" }); }}>＋ New Event</Btn>
      </div>
      <ErrorBanner message={apiError} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 18 }}>
        {events.map(e => {
          const count = attendance.filter(a => (a.eventId || a.event_id) === e.id).length;
          const colors = ["#6366f1", "#f59e0b", "#10b981", "#ec4899", "#3b82f6"];
          const color = colors[events.indexOf(e) % colors.length];
          return (
            <div key={e.id} style={{ background: "#fff", borderRadius: 18, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", border: "1px solid #f0f0f0" }}>
              <div style={{ height: 6, background: color }} />
              <div style={{ padding: 22 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#111", lineHeight: 1.3, flex: 1 }}>{e.name}</h3>
                  <Badge color="purple">{count} in</Badge>
                </div>
                <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 7, fontSize: 13, color: "#666" }}>
                  <span>📅 {formatDate(e.date || e.event_date)} {(e.time || e.event_time) && `at ${e.time || e.event_time}`}</span>
                  <span>📍 {e.location}</span><span>👤 {e.organizer}</span>
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
                  <Btn small variant="primary" onClick={() => { setShowScanner(e.id); setScanMsg(null); setScanInput(""); }}>🔍 Scan QR</Btn>
                  <Btn small variant="secondary" onClick={() => handleEdit(e)}>Edit</Btn>
                  <Btn small variant="danger" onClick={() => handleDelete(e.id)}>Delete</Btn>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={editId ? "Edit Event" : "Create New Event"}>
        <ErrorBanner message={apiError} />
        <Input label="Event Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Tech Summit 2025" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Input label="Date" type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          <Input label="Time" type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))} />
        </div>
        <Input label="Location" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Main Auditorium" />
        <Input label="Organizer" value={form.organizer} onChange={e => setForm(f => ({ ...f, organizer: e.target.value }))} placeholder="CS Department" />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Btn>
          <Btn onClick={handleSave}>{saving ? "Saving..." : editId ? "Save Changes" : "Create Event"}</Btn>
        </div>
      </Modal>
      <Modal open={!!showScanner} onClose={() => { setShowScanner(null); stopCamera(); }} title={`Check-in: ${events.find(e => e.id === showScanner)?.name}`}>
        <div style={{ background: "#f8f7ff", border: "2px dashed #c4b5fd", borderRadius: 16, padding: 16, marginBottom: 16 }}>
          {cameraActive ? <div><div id="qr-reader" style={{ width: "100%", borderRadius: 10 }} /><Btn small variant="danger" onClick={stopCamera} style={{ marginTop: 10, width: "100%" }}>Stop Camera</Btn></div>
            : <div style={{ textAlign: "center", padding: 16 }}><div style={{ fontSize: 48, marginBottom: 8 }}>📷</div><p style={{ color: "#888", fontSize: 13, margin: "0 0 12px" }}>Click below to activate camera and scan a QR code</p><Btn variant="primary" onClick={startCamera}>Start Camera</Btn></div>}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <input value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={e => e.key === "Enter" && handleScan()} placeholder="Enter Attendee ID" style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e8e8e8", fontSize: 14, fontFamily: "inherit", outline: "none" }} autoFocus />
          <Btn onClick={handleScan}>Check In</Btn>
        </div>
        {scanMsg && <div style={{ marginTop: 14, padding: "12px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: scanMsg.type === "success" ? "#dcfce7" : scanMsg.type === "warn" ? "#fef9c3" : "#fee2e2", color: scanMsg.type === "success" ? "#166534" : scanMsg.type === "warn" ? "#92400e" : "#991b1b" }}>{scanMsg.text}</div>}
        <div style={{ marginTop: 18, fontSize: 12, color: "#aaa" }}>Checked in: {attendance.filter(a => (a.eventId || a.event_id) === showScanner).length} attendees</div>
      </Modal>
    </div>
  );
}

function StudentsView({ students, setStudents, attendance, events, loading, apiAvailable, orgId }) {
  const { attendeeLabel, identifierLabel, groupLabel } = useOrgConfig();
  const [showAdd, setShowAdd] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [showQR, setShowQR] = useState(null);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkCsv, setBulkCsv] = useState("");
  const [bulkMsg, setBulkMsg] = useState(null);
  const [form, setForm] = useState({ name: "", roll: "", dept: "", email: "" });
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState(null);

  async function handleAdd() {
    if (!form.name || !form.roll) return;
    setSaving(true); setApiError(null);
    try {
      if (apiAvailable) { const created = await apiFetch(`${BASE_URL}/orgs/${orgId}/attendees`, { method: "POST", body: { name: form.name, identifier: form.roll, group_label: form.dept, email: form.email } }); setStudents(s => [...s, { ...created, roll: created.identifier, dept: created.group_label }]); }
      else setStudents(s => [...s, { id: "STU" + uid(), ...form }]);
      setForm({ name: "", roll: "", dept: "", email: "" }); setShowAdd(false);
    } catch (e) { setApiError(e.message); } finally { setSaving(false); }
  }
  async function handleDeleteStudent(id) {
  if (!window.confirm("Remove this student? This cannot be undone.")) return;
  try {
    if (apiAvailable) {
      await apiFetch(`${BASE_URL}/orgs/${orgId}/attendees/${id}`, { method: "DELETE" });
    }
    setStudents(s => s.filter(x => x.id !== id));
  } catch (e) { alert(e.message); }
}

  async function handleBulkImport() {
    setBulkMsg(null);
    try {
      const lines = bulkCsv.trim().split("\n").filter(Boolean);
      const header = lines[0].split(",").map(h => h.trim().toLowerCase());
      const rows = lines.slice(1).map(line => { const vals = line.split(",").map(v => v.trim()); return Object.fromEntries(header.map((h, i) => [h, vals[i]])); });
      if (apiAvailable) { const result = await apiFetch(`${BASE_URL}/orgs/${orgId}/attendees/bulk`, { method: "POST", body: { attendees: rows } }); setStudents(s => [...s, ...result.map(r => ({ ...r, roll: r.identifier, dept: r.group_label }))]); setBulkMsg({ type: "success", text: `✓ Imported ${result.length} attendees` }); }
      else { const newOnes = rows.map(r => ({ id: "STU" + uid(), name: r.name, roll: r.identifier || r.roll, dept: r.group || r.dept, email: r.email })); setStudents(s => [...s, ...newOnes]); setBulkMsg({ type: "success", text: `✓ Imported ${newOnes.length} attendees (demo mode)` }); }
    } catch (e) { setBulkMsg({ type: "error", text: e.message }); }
  }

  const deptColors = { "Computer Science": "blue", "Electrical Engineering": "amber", "Mechanical Engineering": "teal", "Biotechnology": "green" };
  const filteredStudents = students.filter(student => {
    const rollNum = student.roll || student.identifier || "";
    const name = student.name || "";
    const dept = student.dept || student.group_label || "";

    const matchesSearch = name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          rollNum.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesDept = deptFilter === "all" || dept === deptFilter;

    return matchesSearch && matchesDept;
  });
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div><h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, fontFamily: "'Playfair Display', serif" }}>{attendeeLabel}s</h2><p style={{ color: "#888", margin: "6px 0 0", fontSize: 14 }}>{students.length} registered {attendeeLabel.toLowerCase()}s</p></div>
        <div style={{ display: "flex", gap: 10 }}><Btn variant="secondary" onClick={() => setShowBulk(true)}>⬆ Import CSV</Btn><Btn onClick={() => setShowAdd(true)}>＋ Add {attendeeLabel}</Btn></div>
      </div>
      <ErrorBanner message={apiError} />
      <div style={{ display: "flex", gap: 12, marginBottom: 16, maxWidth: 520 }}>
        <input 
          type="text" 
          placeholder={`Search by name or ${identifierLabel}...`}
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e8e8e8", fontSize: 13, outline: "none" }}
        />
        <select
          value={deptFilter}
          onChange={e => setDeptFilter(e.target.value)}
          style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e8e8e8", fontSize: 13, backgroundColor: "#fff", outline: "none", cursor: "pointer" }}
        >
          <option value="all">All {groupLabel}s</option>
          {/* Extract unique departments dynamically from your students array */}
          {[...new Set(students.map(s => s.dept || s.group_label).filter(Boolean))].map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#fafafa", borderBottom: "2px solid #f0f0f0" }}>{[attendeeLabel, identifierLabel, groupLabel, "Events Attended", "QR Code"].map(h => <th key={h} style={{ textAlign: "left", padding: "14px 18px", color: "#aaa", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5}><TableSkeleton rows={5} cols={5} /></td></tr> : filteredStudents.map(s => {
              const evtCount = attendance.filter(a => (a.studentId || a.attendee_id) === s.id).length;
              return (
                <tr key={s.id} style={{ borderBottom: "1px solid #f8f8f8" }} onMouseEnter={e => e.currentTarget.style.background = "#fafafa"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                  <td style={{ padding: "14px 18px" }}><div style={{ display: "flex", alignItems: "center", gap: 12 }}><div style={{ width: 36, height: 36, borderRadius: "50%", background: `hsl(${s.name.charCodeAt(0) * 5}, 60%, 88%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: `hsl(${s.name.charCodeAt(0) * 5}, 50%, 35%)` }}>{s.name[0]}</div><div><div style={{ fontWeight: 700, color: "#111" }}>{s.name}</div><div style={{ fontSize: 11, color: "#bbb", marginTop: 1 }}>{s.email}</div></div></div></td>
                  <td style={{ padding: "14px 18px", fontFamily: "'DM Mono', monospace", color: "#555", fontSize: 12 }}>{s.roll || s.identifier}</td>
                  <td style={{ padding: "14px 18px" }}><Badge color={deptColors[s.dept || s.group_label] || "blue"}>{s.dept || s.group_label}</Badge></td>
                  <td style={{ padding: "14px 18px" }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontWeight: 700, fontSize: 16, color: "#333" }}>{evtCount}</span><span style={{ fontSize: 11, color: "#aaa" }}>events</span></div></td>
                  <td style={{ padding: "14px 18px" }}>
  <div style={{ display: "flex", gap: 8 }}>
    <Btn small variant="ghost" onClick={() => setShowQR(s)}>View QR</Btn>
    <Btn small variant="danger" onClick={() => handleDeleteStudent(s.id)}>Remove</Btn>
  </div>
</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={`Add New ${attendeeLabel}`}>
        <ErrorBanner message={apiError} />
        <Input label="Full Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Jane Doe" />
        <Input label={identifierLabel} value={form.roll} onChange={e => setForm(f => ({ ...f, roll: e.target.value }))} placeholder="CS2025001" />
        <Input label={groupLabel} value={form.dept} onChange={e => setForm(f => ({ ...f, dept: e.target.value }))} placeholder="Computer Science" />
        <Input label="Email" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="jane@college.edu" />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}><Btn variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Btn><Btn onClick={handleAdd}>{saving ? "Adding..." : `Add ${attendeeLabel}`}</Btn></div>
      </Modal>
      <Modal open={showBulk} onClose={() => setShowBulk(false)} title={`Bulk Import ${attendeeLabel}s`}>
        <p style={{ color: "#888", fontSize: 13, margin: "0 0 12px" }}>Paste CSV with columns: <code style={{ background: "#f5f5f5", padding: "1px 5px", borderRadius: 4, fontSize: 12 }}>name, identifier, group, email</code></p>
        <textarea value={bulkCsv} onChange={e => setBulkCsv(e.target.value)} placeholder={"name,identifier,group,email\nJane Doe,CS001,Computer Science,jane@college.edu"} style={{ width: "100%", height: 160, padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e8e8e8", fontSize: 13, fontFamily: "'DM Mono', monospace", resize: "vertical", boxSizing: "border-box", outline: "none" }} />
        {bulkMsg && <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: bulkMsg.type === "success" ? "#dcfce7" : "#fee2e2", color: bulkMsg.type === "success" ? "#166534" : "#991b1b" }}>{bulkMsg.text}</div>}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 16 }}><Btn variant="secondary" onClick={() => setShowBulk(false)}>Cancel</Btn><Btn onClick={handleBulkImport}>Import</Btn></div>
      </Modal>
      <Modal open={!!showQR} onClose={() => setShowQR(null)} title={`${attendeeLabel} QR Code`}>
        {showQR && <div style={{ textAlign: "center" }}>
          <div id="qr-modal-canvas" style={{ display: "inline-flex", padding: 20, background: "#fff", borderRadius: 16, border: "2px solid #f0f0f0", marginBottom: 16 }}><QRCode value={showQR.id} size={160} /></div>
          <p style={{ fontWeight: 800, fontSize: 17, margin: "0 0 4px", fontFamily: "'Playfair Display', serif" }}>{showQR.name}</p>
          <p style={{ color: "#888", margin: "0 0 4px", fontSize: 13 }}>{showQR.roll || showQR.identifier} · {showQR.dept || showQR.group_label}</p>
          <p style={{ color: "#bbb", margin: 0, fontFamily: "'DM Mono', monospace", fontSize: 12 }}>ID: {showQR.id}</p>
          <div style={{ marginTop: 20 }}><Btn variant="primary" onClick={() => { const canvas = document.querySelector("#qr-modal-canvas canvas"); if (!canvas) return; const link = document.createElement("a"); link.download = `${showQR.name}-QR.png`; link.href = canvas.toDataURL("image/png"); link.click(); }}>⬇ Download QR</Btn></div>
        </div>}
      </Modal>
    </div>
  );
}

function AttendanceCharts({ students, events, attendance }) {
  const attendeeLabel = "Student";
  const eventData = events.map(e => ({ id: e.id, name: e.name, displayName: e.name.length > 18 ? e.name.slice(0, 18) + "..." : e.name, checkins: attendance.filter(a => (a.eventId || a.event_id) === e.id).length, capacity: students.length }));
  const groupData = {};
  attendance.forEach(a => { const student = students.find(s => s.id === (a.studentId || a.attendee_id)); const group = student?.dept || student?.group_label || "Unknown"; groupData[group] = (groupData[group] || 0) + 1; });
  const pieData = Object.entries(groupData).map(([name, value]) => ({ name, value }));
  const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ec4899", "#3b82f6", "#8b5cf6"];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 24 }}>
      <div style={{ background: "#fff", padding: 20 }}><h4>Check-ins Per Event</h4><ResponsiveContainer width="100%" height={220}><BarChart data={eventData} margin={{ bottom: 40 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" interval={0} angle={-25} textAnchor="end" height={60} tick={{ fontSize: 11 }} /><YAxis /><Tooltip /><Bar dataKey="checkins" fill="#6366f1" /></BarChart></ResponsiveContainer></div>
      <div style={{ background: "#fff", padding: 20 }}><h4>Attendance by {attendeeLabel}</h4><ResponsiveContainer width="100%" height={220}><PieChart><Pie data={pieData} dataKey="value">{pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div>
      <div style={{ gridColumn: "1 / -1", background: "#fff", padding: 20 }}><h4>Attendance vs Capacity</h4><ResponsiveContainer width="100%" height={220}><BarChart data={eventData}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="displayName" interval={0} angle={-25} textAnchor="end" height={60} tick={{ fontSize: 11 }} /><YAxis /><Tooltip /><Bar dataKey="checkins" fill="#10b981" /><Bar dataKey="capacity" fill="#e0e0e0" /></BarChart></ResponsiveContainer></div>
    </div>
  );
}

function ReportsView({ students, events, attendance, loading, orgId, apiAvailable }) {
  const { attendeeLabel, identifierLabel, groupLabel } = useOrgConfig();
  const [selectedEvent, setSelectedEvent] = useState("all");
  const filtered = selectedEvent === "all" ? attendance : attendance.filter(a => (a.eventId || a.event_id) === selectedEvent);

  async function exportCSV() {
    try { if (apiAvailable) { window.open(`${BASE_URL}/orgs/${orgId}/reports/export?fmt=csv${selectedEvent !== "all" ? `&eventId=${selectedEvent}` : ""}`, "_blank"); return; } } catch {}
    const rows = [[attendeeLabel + " Name", identifierLabel, groupLabel, "Event", "Date", "Time"]];
    filtered.forEach(a => { const s = students.find(x => x.id === (a.studentId || a.attendee_id)); const e = events.find(x => x.id === (a.eventId || a.event_id)); const ts = a.time || a.checked_in_at; rows.push([s?.name, s?.roll || s?.identifier, s?.dept || s?.group_label, e?.name, formatDate(ts), formatTime(ts)]); });
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "attendance_report.csv"; link.click();
  }
  async function exportPDF() {
    const { jsPDF } = await import("jspdf"); const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    doc.setFontSize(20); doc.setTextColor(99, 102, 241); doc.text("AttendIQ Attendance Report", 14, 20);
    doc.setFontSize(11); doc.setTextColor(100); doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 30); doc.text(`Event: ${selectedEvent === "all" ? "All Events" : events.find(e => e.id === selectedEvent)?.name}`, 14, 37);
    doc.setFontSize(12); doc.setTextColor(0); doc.text(`Total Records: ${filtered.length}`, 14, 50); doc.text(`Unique ${attendeeLabel}s: ${new Set(filtered.map(a => a.studentId || a.attendee_id)).size}`, 80, 50); doc.text(`Events: ${new Set(filtered.map(a => a.eventId || a.event_id)).size}`, 160, 50);
    const tableRows = filtered.map(a => { const s = students.find(x => x.id === (a.studentId || a.attendee_id)); const e = events.find(x => x.id === (a.eventId || a.event_id)); const ts = a.time || a.checked_in_at; return [s?.name, s?.roll || s?.identifier, s?.dept || s?.group_label, e?.name, formatDate(ts), formatTime(ts)]; });
    autoTable(doc, { startY: 58, head: [[attendeeLabel, identifierLabel, groupLabel, "Event", "Date", "Time"]], body: tableRows, headStyles: { fillColor: [99, 102, 241], textColor: 255, fontStyle: "bold" }, alternateRowStyles: { fillColor: [248, 248, 255] }, styles: { fontSize: 10, cellPadding: 4 } });
    doc.save("attendance_report.pdf");
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div><h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, fontFamily: "'Playfair Display', serif" }}>Reports</h2><p style={{ color: "#888", margin: "6px 0 0", fontSize: 14 }}>Export and analyze attendance data</p></div>
        <div style={{ display: "flex", gap: 10 }}>
          <select value={selectedEvent} onChange={e => setSelectedEvent(e.target.value)} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e8e8e8", fontSize: 13, fontFamily: "inherit", outline: "none", cursor: "pointer" }}><option value="all">All Events</option>{events.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
          <Btn onClick={exportCSV} variant="success">⬇ Export CSV</Btn><Btn onClick={exportPDF} variant="primary">⬇ Export PDF</Btn>
        </div>
      </div>
      <AttendanceCharts students={students} events={events} attendance={attendance} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 24 }}>
        {loading ? Array(3).fill(0).map((_, i) => <div key={i} style={{ flex: "1 1 160px", background: "#fff", borderRadius: 16, padding: "20px 24px", border: "1px solid #f0f0f0" }}><Skeleton height={40} /></div>) : <><StatCard icon="📋" label="Records Shown" value={filtered.length} accent="#6366f1" /><StatCard icon="🎓" label={`Unique ${attendeeLabel}s`} value={new Set(filtered.map(a => a.studentId || a.attendee_id)).size} accent="#10b981" /><StatCard icon="📅" label="Events Covered" value={new Set(filtered.map(a => a.eventId || a.event_id)).size} accent="#f59e0b" /></>}
      </div>
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.07)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#fafafa", borderBottom: "2px solid #f0f0f0" }}>{[attendeeLabel, identifierLabel, groupLabel, "Event", "Check-in Time"].map(h => <th key={h} style={{ textAlign: "left", padding: "14px 18px", color: "#aaa", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={5}><TableSkeleton rows={5} cols={5} /></td></tr> : filtered.length === 0 ? <tr><td colSpan={5} style={{ padding: 40, textAlign: "center", color: "#ccc", fontSize: 14 }}>No records found</td></tr> : filtered.map(a => {
              const s = students.find(x => x.id === (a.studentId || a.attendee_id)); const e = events.find(x => x.id === (a.eventId || a.event_id)); const ts = a.time || a.checked_in_at;
              return <tr key={a.id} style={{ borderBottom: "1px solid #f8f8f8" }} onMouseEnter={ev => ev.currentTarget.style.background = "#fafafa"} onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}><td style={{ padding: "12px 18px", fontWeight: 600, color: "#222" }}>{s?.name}</td><td style={{ padding: "12px 18px", fontFamily: "'DM Mono', monospace", color: "#888", fontSize: 12 }}>{s?.roll || s?.identifier}</td><td style={{ padding: "12px 18px", color: "#555" }}>{s?.dept || s?.group_label}</td><td style={{ padding: "12px 18px", color: "#555" }}>{e?.name}</td><td style={{ padding: "12px 18px", fontFamily: "'DM Mono', monospace", color: "#888", fontSize: 12 }}>{formatDate(ts)} {formatTime(ts)}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StudentPortal({ students, attendance, events, loading }) {
  const { attendeeLabel, groupLabel } = useOrgConfig();
  const [selectedId, setSelectedId] = useState(students[0]?.id || "");
  
  // 🆕 Search and Filter States
  const [portalSearch, setPortalSearch] = useState("");
  const [portalGroupFilter, setPortalGroupFilter] = useState("all");

  // 🆕 Filter the students array directly for the dropdown options
  const filteredDropdownStudents = (students || []).filter(student => {
    const name = student.name || "";
    const identifier = student.identifier || student.roll || "";
    const group = student.group_label || student.dept || "";

    const matchesSearch = name.toLowerCase().includes(portalSearch.toLowerCase()) || 
                          identifier.toLowerCase().includes(portalSearch.toLowerCase());
    
    const matchesGroup = portalGroupFilter === "all" || group === portalGroupFilter;

    return matchesSearch && matchesGroup;
  });

  const student = students.find(s => s.id === selectedId);
  const myAtt = attendance.filter(a => (a.studentId || a.attendee_id) === selectedId);

  // Auto-select the first student from the filtered list if the current one gets filtered out
  useEffect(() => { 
    if (filteredDropdownStudents.length > 0 && !filteredDropdownStudents.some(s => s.id === selectedId)) {
      setSelectedId(filteredDropdownStudents[0].id);
    } 
  }, [portalSearch, portalGroupFilter, students]);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, fontFamily: "'Playfair Display', serif" }}>{attendeeLabel} Portal</h2>
        <p style={{ color: "#888", margin: "6px 0 0", fontSize: 14 }}>View attendance history and QR code</p>
      </div>

      {/* 🆕 CONTROL BAR PLACEHERE: Search and Group Filter Input Elements */}
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", maxWidth: "500px" }}>
        <input 
          type="text" 
          placeholder={`Search by name or ${attendeeLabel} ID...`}
          value={portalSearch}
          onChange={e => setPortalSearch(e.target.value)}
          style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e8e8e8", fontSize: 13, outline: "none" }}
        />
        <select
          value={portalGroupFilter}
          onChange={e => setPortalGroupFilter(e.target.value)}
          style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e8e8e8", fontSize: 13, backgroundColor: "#fff", outline: "none", cursor: "pointer" }}
        >
          <option value="all">All {groupLabel}s</option>
          {[...new Set((students || []).map(s => s.group_label || s.dept).filter(Boolean))].map(g => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
      </div>
      
      <div style={{ marginBottom: 24 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#555", marginBottom: 8, letterSpacing: "0.05em", textTransform: "uppercase" }}>Select {attendeeLabel}</label>
        <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={{ padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e8e8e8", fontSize: 14, fontFamily: "inherit", outline: "none", minWidth: 280 }}>
          {/* 🔄 CHANGED: Now rendering filtered options instead of the full array */}
          {filteredDropdownStudents.length === 0 ? (
            <option value="">No matching profiles found</option>
          ) : (
            filteredDropdownStudents.map(s => (
              <option key={s.id} value={s.id}>{s.name} — {s.roll || s.identifier}</option>
            ))
          )}
        </select>
      </div>

      {loading && <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20 }}><Skeleton height={400} radius={20} /><Skeleton height={400} radius={20} /></div>}
      
      {!loading && student && (
        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 20 }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: 28, border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", textAlign: "center" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", margin: "0 auto 16px", background: `hsl(${student.name.charCodeAt(0) * 5}, 60%, 88%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 900, color: `hsl(${student.name.charCodeAt(0) * 5}, 50%, 35%)` }}>{student.name[0]}</div>
            <h3 style={{ margin: "0 0 4px", fontFamily: "'Playfair Display', serif", fontSize: 19 }}>{student.name}</h3>
            <p style={{ color: "#888", margin: "0 0 2px", fontSize: 13 }}>{student.roll || student.identifier}</p>
            <p style={{ color: "#bbb", margin: "0 0 20px", fontSize: 12 }}>{student.dept || student.group_label}</p>
            <div style={{ display: "inline-flex", padding: 16, background: "#f9f9f9", borderRadius: 14, border: "1.5px solid #eee", marginBottom: 16 }}><QRCode value={student.id} size={140} /></div>
            <p style={{ color: "#bbb", fontSize: 11, fontFamily: "'DM Mono', monospace", margin: 0 }}>{student.id}</p>
            <div style={{ marginTop: 16 }}><StatCard icon="✅" label="Events Attended" value={myAtt.length} accent="#6366f1" /></div>
          </div>

          <div style={{ background: "#fff", borderRadius: 20, border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", overflow: "hidden" }}>
            <div style={{ padding: "22px 24px", borderBottom: "1px solid #f5f5f5" }}><h4 style={{ margin: 0, fontFamily: "'Playfair Display', serif", fontSize: 17 }}>Attendance History</h4></div>
            {myAtt.length === 0 ? <div style={{ padding: 40, textAlign: "center", color: "#ccc" }}>No events attended yet</div> : myAtt.map(a => {
              const evt = events.find(e => e.id === (a.eventId || a.event_id)); const ts = a.time || a.checked_in_at;
              return <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 16, padding: "16px 24px", borderBottom: "1px solid #f8f8f8" }}><div style={{ width: 44, height: 44, borderRadius: 12, background: "#f0f0ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📅</div><div style={{ flex: 1 }}><div style={{ fontWeight: 700, color: "#111", fontSize: 14 }}>{evt?.name}</div><div style={{ fontSize: 12, color: "#aaa", marginTop: 3, fontFamily: "'DM Mono', monospace" }}>{formatDate(ts)} at {formatTime(ts)} · {evt?.location}</div></div><Badge color="green">Present</Badge></div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Settings View — FIXED & ENHANCED ────────────────────────────────────────
// Changes:
//   • Fixed handleSave (was referencing out-of-scope EventsView variables)
//   • Added full "Change Password" section with 3 fields + strength meter
function SettingsView({ orgId, setOrgConfig, apiAvailable }) {
  const { orgName, attendeeLabel, identifierLabel, groupLabel } = useOrgConfig();

  // ── Org settings form ──────────────────────────────────────────────────────
  const [form, setForm]   = useState({ orgName, attendeeLabel, identifierLabel, groupLabel });
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [apiError, setApiError] = useState(null);

  async function handleSave() {
    setSaving(true); setApiError(null); setSaved(false);
    try {
      if (apiAvailable) {
        await apiFetch(`${BASE_URL}/orgs/${orgId}`, {
          method: "PUT",
          body: {
            name: form.orgName,
            attendee_label: form.attendeeLabel,
            identifier_label: form.identifierLabel,
            group_label: form.groupLabel,
          },
        });
      }
      setOrgConfig({ orgName: form.orgName, attendeeLabel: form.attendeeLabel, identifierLabel: form.identifierLabel, groupLabel: form.groupLabel });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) { setApiError(e.message); }
    finally { setSaving(false); }
  }

  // ── Change Password form ───────────────────────────────────────────────────
  const [pwForm, setPwForm]     = useState({ current: "", next: "", confirm: "" });
  const [pwError, setPwError]   = useState(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  async function handleChangePassword() {
    setPwError(null); setPwSuccess(false);
    const { current, next, confirm } = pwForm;
    if (!current || !next || !confirm) return setPwError("All three fields are required.");
    if (next !== confirm) return setPwError("New password and confirmation don't match.");
    const allPassed = PW_RULES.every(r => r.test(next));
    if (!allPassed) return setPwError("New password doesn't meet all complexity requirements.");

    setPwSaving(true);
    try {
      await apiFetch(`${ADMIN_URL}/change-password`, {
        method: "PUT",
        body: { currentPassword: current, newPassword: next },
      });
      setPwSuccess(true);
      setPwForm({ current: "", next: "", confirm: "" });
      setTimeout(() => setPwSuccess(false), 5000);
    } catch (e) { setPwError(e.message); }
    finally { setPwSaving(false); }
  }

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900, fontFamily: "'Playfair Display', serif" }}>Settings</h2>
        <p style={{ color: "#888", margin: "6px 0 0", fontSize: 14 }}>Configure your organization and account security</p>
      </div>

      <ErrorBanner message={apiError} />

      {/* ── Org Settings ── */}
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", maxWidth: 520, marginBottom: 20 }}>
        <h4 style={{ margin: "0 0 20px", fontFamily: "'Playfair Display', serif", fontSize: 17 }}>Organization</h4>
        <Input label="Organization Name" value={form.orgName} onChange={e => setForm(f => ({ ...f, orgName: e.target.value }))} placeholder="e.g. Acme University" />
        <div style={{ height: 1, background: "#f0f0f0", margin: "20px 0" }} />
        <h4 style={{ margin: "0 0 6px", fontFamily: "'Playfair Display', serif", fontSize: 17 }}>Label Configuration</h4>
        <p style={{ color: "#aaa", fontSize: 12, margin: "0 0 18px" }}>Customize terminology to match your use case</p>
        <Input label="Attendee Label" value={form.attendeeLabel} onChange={e => setForm(f => ({ ...f, attendeeLabel: e.target.value }))} placeholder="e.g. Student, Employee, Member" />
        <Input label="Identifier Label" value={form.identifierLabel} onChange={e => setForm(f => ({ ...f, identifierLabel: e.target.value }))} placeholder="e.g. Roll No., Badge ID" />
        <Input label="Group Label" value={form.groupLabel} onChange={e => setForm(f => ({ ...f, groupLabel: e.target.value }))} placeholder="e.g. Department, Team, Track" />
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8 }}>
          <Btn onClick={handleSave}>{saving ? "Saving..." : "Save Settings"}</Btn>
          {saved && <span style={{ color: "#166534", fontSize: 13, fontWeight: 600 }}>✓ Saved!</span>}
        </div>
      </div>

      {/* ── Change Password ── */}
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", maxWidth: 520, marginBottom: 20 }}>
        <h4 style={{ margin: "0 0 6px", fontFamily: "'Playfair Display', serif", fontSize: 17 }}>🔐 Change Password</h4>
        <p style={{ color: "#aaa", fontSize: 12, margin: "0 0 20px" }}>Requires your current password plus a new strong password</p>

        {pwError && <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 9, padding: "10px 14px", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>⚠️ {pwError}</div>}
        {pwSuccess && <div style={{ background: "#dcfce7", color: "#166534", borderRadius: 9, padding: "10px 14px", fontSize: 13, fontWeight: 600, marginBottom: 16 }}>✅ Password changed successfully!</div>}

        <PwInput label="Current Password"    value={pwForm.current} onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} placeholder="Your current password" />
        <PwInput label="New Password"         value={pwForm.next}    onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))}    placeholder="Choose a strong new password" />

        <PasswordStrength value={pwForm.next} />

        <PwInput label="Confirm New Password" value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} placeholder="Repeat your new password" />

        {pwForm.next && pwForm.confirm && (
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 16, color: pwForm.next === pwForm.confirm ? "#166534" : "#991b1b" }}>
            {pwForm.next === pwForm.confirm ? "✓ Passwords match" : "✗ Passwords don't match"}
          </div>
        )}

        <Btn onClick={handleChangePassword} disabled={pwSaving}>
          {pwSaving ? "Updating…" : "Update Password"}
        </Btn>
      </div>

      {/* ── Connection Status ── */}
      <div style={{ background: "#fff", borderRadius: 16, padding: 28, border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", maxWidth: 520 }}>
        <h4 style={{ margin: "0 0 14px", fontFamily: "'Playfair Display', serif", fontSize: 17 }}>Connection Status</h4>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: apiAvailable ? "#10b981" : "#f59e0b" }} />
          <span style={{ fontSize: 13, color: "#555" }}>{apiAvailable ? "Connected to backend API" : "Running in demo mode (mock data)"}</span>
        </div>
        {!apiAvailable && <p style={{ color: "#aaa", fontSize: 12, margin: "10px 0 0" }}>To connect a real backend, deploy the Express API and set <code style={{ background: "#f5f5f5", padding: "1px 4px", borderRadius: 3 }}>BASE_URL</code> to your server address.</p>}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function AttendanceApp() {
  const ORG_ID = "demo-org";
  const [isLoggedIn, setIsLoggedIn] = useState(() => {
  const token = localStorage.getItem("attendiq_token");
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    if (payload.exp * 1000 < Date.now()) {
      clearAuth();
      return false;
    }
    return true;
  } catch {
    clearAuth();
    return false;
  }
});
  const [role, setRole]             = useState(() => localStorage.getItem("attendiq_role") || null);
  const [orgConfig, setOrgConfigState] = useState({ orgId: ORG_ID, orgName: "AttendIQ College", attendeeLabel: "Student", identifierLabel: "Roll No.", groupLabel: "Department" });
  const [apiAvailable, setApiAvailable] = useState(false);
  const [students,   setStudents]   = useState(MOCK_STUDENTS);
  const [events,     setEvents]     = useState(MOCK_EVENTS);
  const [attendance, setAttendance] = useState(MOCK_ATTENDANCE);
  const [loading,    setLoading]    = useState(false);
  const [view,       setView]       = useState("dashboard");

  useEffect(() => {
  apiFetch(`${BASE_URL}/orgs/${ORG_ID}`)
    .then(data => {
      setApiAvailable(true);
      setOrgConfigState(prev => ({
        ...prev,
        ...(data.attendee_label && { attendeeLabel: data.attendee_label }),
        ...(data.name && { orgName: data.name }),
      }));
    })
    .catch(() => setApiAvailable(false));
}, []);

  useEffect(() => {
    if (!apiAvailable || role !== "admin") return;
    setLoading(true);
    Promise.all([apiFetch(`${BASE_URL}/orgs/${ORG_ID}/attendees`), apiFetch(`${BASE_URL}/orgs/${ORG_ID}/events`)]).then(async ([att, evts]) => {
      setStudents(att.items || att); setEvents(evts.items || evts);
      const allAttendance = await Promise.all((evts.items || evts).map(e => apiFetch(`${BASE_URL}/orgs/${ORG_ID}/events/${e.id}/attendance`).catch(() => [])));
      setAttendance(allAttendance.flat());
    }).catch(() => {}).finally(() => setLoading(false));
  }, [apiAvailable, role]);

  function setOrgConfig(updates) { setOrgConfigState(prev => ({ ...prev, ...updates })); }
  function handleLogout() {
  clearAuth();
  setIsLoggedIn(false);
  setRole(null);
  window.location.href = "/";
}
  function handleLoginSuccess({ role: r }) {
  setRole(r);
  setIsLoggedIn(true);
}

  if (!isLoggedIn)          return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  if (role === "student")   return <StudentDashboard onLogout={handleLogout} />;
  if (role === "organizer") return <OrganizerDashboard onLogout={handleLogout} />;

  const navItems = [
    { id: "dashboard",  label: "Dashboard",                         icon: "▦" },
    { id: "events",     label: "Events",                            icon: "📅" },
    { id: "students",   label: `${orgConfig.attendeeLabel}s`,       icon: "🎓" },
    { id: "reports",    label: "Reports",                           icon: "📊" },
    { id: "portal",     label: `${orgConfig.attendeeLabel} Portal`, icon: "👤" },
    { id: "organizers", label: "Organizers",                        icon: "🏛" },
    { id: "settings",   label: "Settings",                          icon: "⚙️" },
  ];

  return (
    <OrgContext.Provider value={{ ...orgConfig, setOrgConfig }}>
      <div style={{ fontFamily: "'DM Sans', 'Inter', system-ui, sans-serif", background: "#f7f7f8", minHeight: "100vh", display: "flex" }}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;800;900&family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
          @keyframes slideUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
          @keyframes shimmer { 0% { background-position:200% 0; } 100% { background-position:-200% 0; } }
          * { box-sizing: border-box; }
          ::-webkit-scrollbar { width: 6px; }
          ::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 3px; }
        `}</style>

        {/* Sidebar */}
        <div style={{ width: 230, background: "#fff", borderRight: "1px solid #f0f0f0", display: "flex", flexDirection: "column", padding: "24px 0", position: "sticky", top: 0, height: "100vh" }}>
          <div style={{ padding: "0 22px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📋</div>
              <div><div style={{ fontWeight: 900, fontSize: 15, color: "#111", fontFamily: "'Playfair Display', serif", lineHeight: 1.1 }}>AttendIQ</div><div style={{ fontSize: 10, color: "#bbb", letterSpacing: "0.08em", textTransform: "uppercase" }}>{orgConfig.orgName}</div></div>
            </div>
          </div>
          <nav style={{ flex: 1, padding: "0 12px" }}>
            {navItems.map(item => (
              <button key={item.id} onClick={() => setView(item.id)} style={{ width: "100%", textAlign: "left", padding: "11px 14px", borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 10, fontSize: 13.5, fontWeight: 600, marginBottom: 2, transition: "all 0.15s", background: view === item.id ? "#f0f0ff" : "transparent", color: view === item.id ? "#6366f1" : "#666" }}>
                <span style={{ fontSize: 15 }}>{item.icon}</span>
                {item.label}
                {item.id === "organizers" && <span style={{ marginLeft: "auto", background: "#6366f1", color: "#fff", borderRadius: 99, fontSize: 10, fontWeight: 800, padding: "1px 7px" }}>NEW</span>}
              </button>
            ))}
          </nav>
          <div style={{ padding: "16px 22px", borderTop: "1px solid #f5f5f5" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 12, fontWeight: 800 }}>A</div>
              <div style={{ flex: 1 }}><div style={{ fontSize: 12, fontWeight: 700, color: "#333" }}>Admin</div><div style={{ fontSize: 10, color: "#bbb" }}>admin@college.edu</div></div>
              <button onClick={handleLogout} title="Sign out" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#bbb" }}>↩</button>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, padding: 32, overflowY: "auto", maxHeight: "100vh" }}>
          {view === "organizers" && <OrganizersView />}
          {view === "dashboard"  && <Dashboard students={students} events={events} attendance={attendance} loading={loading} />}
          {view === "events"     && <EventsView events={events} setEvents={setEvents} students={students} attendance={attendance} setAttendance={setAttendance} apiAvailable={apiAvailable} orgId={ORG_ID} />}
          {view === "students"   && <StudentsView students={students} setStudents={setStudents} attendance={attendance} events={events} loading={loading} apiAvailable={apiAvailable} orgId={ORG_ID} />}
          {view === "reports"    && <ReportsView students={students} events={events} attendance={attendance} loading={loading} orgId={ORG_ID} apiAvailable={apiAvailable} />}
          {view === "portal"     && <StudentPortal students={students} attendance={attendance} events={events} loading={loading} />}
          {view === "settings"   && <SettingsView orgId={ORG_ID} setOrgConfig={setOrgConfig} apiAvailable={apiAvailable} />}
        </div>
      </div>
    </OrgContext.Provider>
  );
}