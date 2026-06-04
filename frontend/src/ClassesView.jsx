// ClassesView.jsx
// ───────────────────────────────────────────────────────────────────────────
// Drop-in "Classes" view for the Organizer/Teacher dashboard.
// This is the piece that RECORDS daily attendance: a teacher opens a class,
// starts today's session, then scans each student's personal QR (or types the
// roll number). It also shows the full monthly attendance grid per class.
//
// It is fully self-contained (its own tiny UI helpers + apiFetch) so it drops
// into OrganizerDashboard.jsx with one import and two small edits. See the
// notes at the bottom of the chat message for the exact 3 lines to add.
//
// Endpoints used (all already exist in your server.js):
//   GET    /orgs/:orgId/classes
//   POST   /orgs/:orgId/classes
//   GET    /orgs/:orgId/classes/:classId/sessions
//   POST   /orgs/:orgId/classes/:classId/sessions
//   POST   /orgs/:orgId/classes/:classId/sessions/:sessionId/checkin
//   GET    /orgs/:orgId/classes/:classId/sessions/:sessionId/attendance
//   GET    /orgs/:orgId/classes/:classId/full-attendance
//   GET    /orgs/:orgId/attendees?all=true&group_label=<dept>
// ───────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from "react";

const BASE_URL = "https://attendiq-api.onrender.com/api/v1";

function getToken() { return localStorage.getItem("attendiq_token"); }

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

function todayISO() { return new Date().toISOString().slice(0, 10); }
function thisMonthISO() { return new Date().toISOString().slice(0, 7); } // YYYY-MM
function formatDate(d) { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function formatTime(d) { return new Date(d).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }); }

// ── tiny UI helpers (kept local so the file is drop-in) ─────────────────────
function Badge({ color = "green", children }) {
  const colors = {
    green: { bg: "#dcfce7", text: "#166534" }, purple: { bg: "#f3e8ff", text: "#6b21a8" },
    blue: { bg: "#dbeafe", text: "#1e40af" }, amber: { bg: "#fef9c3", text: "#92400e" },
    red: { bg: "#fee2e2", text: "#991b1b" }, gray: { bg: "#f3f4f6", text: "#374151" },
  };
  const c = colors[color] || colors.green;
  return <span style={{ background: c.bg, color: c.text, padding: "2px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>{children}</span>;
}

function Btn({ children, onClick, variant = "primary", small, disabled }) {
  const v = {
    primary: { background: "#6366f1", color: "#fff", border: "none" },
    secondary: { background: "#f5f5f5", color: "#333", border: "none" },
    danger: { background: "#fee2e2", color: "#991b1b", border: "none" },
    success: { background: "#dcfce7", color: "#166534", border: "none" },
    ghost: { background: "transparent", color: "#6366f1", border: "1.5px solid #6366f1" },
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

function Input({ label, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 5, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</label>}
      <input
        style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1.5px solid #e8e8e8", fontSize: 14, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
        onFocus={e => (e.target.style.borderColor = "#6366f1")}
        onBlur={e => (e.target.style.borderColor = "#e8e8e8")}
        {...props}
      />
    </div>
  );
}

function Modal({ open, onClose, title, children, wide }) {
  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: "#fff", borderRadius: 20, padding: 28, width: "100%", maxWidth: wide ? 760 : 480, boxShadow: "0 20px 60px rgba(0,0,0,0.18)", maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, fontFamily: "'Playfair Display', serif" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "#f5f5f5", border: "none", borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 16 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────
export default function ClassesView({ orgId = "demo-org" }) {
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // create class modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", code: "", group_label: "", description: "" });
  const [saving, setSaving] = useState(false);

  // selected class + its sessions
  const [selected, setSelected] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [detailTab, setDetailTab] = useState("sessions"); // "sessions" | "grid"

  // start-session modal
  const [showSession, setShowSession] = useState(false);
  const [sessForm, setSessForm] = useState({ session_date: todayISO(), session_time: "", location: "" });

  // scanner modal
  const [scanSession, setScanSession] = useState(null); // session object
  const [scanInput, setScanInput] = useState("");
  const [scanMsg, setScanMsg] = useState(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [roster, setRoster] = useState([]);
  const scannerRef = useRef(null);

  // monthly grid
  const [grid, setGrid] = useState({ sessions: [], students: [] });
  const [loadingGrid, setLoadingGrid] = useState(false);
  const [month, setMonth] = useState(thisMonthISO());

  // ── load classes ──
  const loadClasses = useCallback(() => {
    setLoading(true);
    apiFetch(`${BASE_URL}/orgs/${orgId}/classes`)
      .then(setClasses)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [orgId]);
  useEffect(() => { loadClasses(); }, [loadClasses]);

  async function handleCreateClass() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const created = await apiFetch(`${BASE_URL}/orgs/${orgId}/classes`, {
        method: "POST",
        body: {
          name: form.name.trim(),
          code: form.code.trim() || undefined,
          group_label: form.group_label.trim() || undefined,
          description: form.description.trim() || null,
        },
      });
      setClasses(c => [created, ...c]);
      setForm({ name: "", code: "", group_label: "", description: "" });
      setShowCreate(false);
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  }

  // ── sessions ──
  const loadSessions = useCallback(async (classId) => {
    setLoadingSessions(true);
    try { setSessions(await apiFetch(`${BASE_URL}/orgs/${orgId}/classes/${classId}/sessions`)); }
    catch (e) { setError(e.message); }
    finally { setLoadingSessions(false); }
  }, [orgId]);

  function openClass(c) {
    setSelected(c);
    setDetailTab("sessions");
    loadSessions(c.id);
  }

  async function handleStartSession() {
    if (!selected) return;
    try {
      await apiFetch(`${BASE_URL}/orgs/${orgId}/classes/${selected.id}/sessions`, {
        method: "POST",
        body: {
          session_date: sessForm.session_date,
          session_time: sessForm.session_time || null,
          location: sessForm.location || null,
        },
      });
      setShowSession(false);
      setSessForm({ session_date: todayISO(), session_time: "", location: "" });
      loadSessions(selected.id);
    } catch (e) { alert(e.message); }
  }

  async function handleDeleteSession(sessionId) {
    if (!window.confirm("Delete this session and its attendance?")) return;
    try {
      await apiFetch(`${BASE_URL}/orgs/${orgId}/classes/${selected.id}/sessions/${sessionId}`, { method: "DELETE" });
      loadSessions(selected.id);
    } catch (e) { alert(e.message); }
  }

  // ── scanner / check-in ──
  const loadRoster = useCallback(async (sessionId) => {
    try { setRoster(await apiFetch(`${BASE_URL}/orgs/${orgId}/classes/${selected.id}/sessions/${sessionId}/attendance`)); }
    catch { setRoster([]); }
  }, [orgId, selected]);

  function openScanner(session) {
    setScanSession(session);
    setScanInput(""); setScanMsg(null);
    loadRoster(session.id);
  }

  async function startCamera() {
    try {
      setCameraActive(true); setScanMsg(null);
      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode("class-qr-reader");
      scannerRef.current = scanner;
      const onScan = (text) => { setScanInput(text); doCheckin(text); stopCamera(); };
      try {
        await scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScan, () => {});
      } catch {
        await scanner.start({ facingMode: "user" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScan, () => {});
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

  async function doCheckin(value) {
    const val = (value ?? scanInput).trim();
    if (!val || !scanSession) return;
    try {
      await apiFetch(`${BASE_URL}/orgs/${orgId}/classes/${selected.id}/sessions/${scanSession.id}/checkin`, {
        method: "POST",
        body: { identifier: val, method: "qr" },
      });
      setScanMsg({ type: "success", text: "✓ Marked present!" });
      setScanInput("");
      loadRoster(scanSession.id);
      setSessions(ss => ss.map(s => s.id === scanSession.id ? { ...s, checkin_count: Number(s.checkin_count || 0) + 1 } : s));
    } catch (e) {
      setScanMsg({ type: e.message.includes("already") ? "warn" : "error", text: e.message });
    }
  }

  function closeScanner() { stopCamera(); setScanSession(null); setRoster([]); }

  // ── monthly grid ──
  const loadGrid = useCallback(async () => {
    if (!selected) return;
    setLoadingGrid(true);
    try {
      const full = await apiFetch(`${BASE_URL}/orgs/${orgId}/classes/${selected.id}/full-attendance`);
      // attended map: attendee_id -> Set(session_id)
      const attendedMap = {};
      for (const st of full.students || []) {
        attendedMap[st.attendee_id] = new Set((st.sessions_attended || []).map(x => x.session_id));
      }
      // build the full roster (includes students who never attended) via group_label
      let roster = (full.students || []).map(st => ({
        attendee_id: st.attendee_id, name: st.name, identifier: st.identifier, group_label: st.group_label,
      }));
      if (selected.group_label) {
        try {
          const enrolled = await apiFetch(`${BASE_URL}/orgs/${orgId}/attendees?all=true&group_label=${encodeURIComponent(selected.group_label)}`);
          const seen = new Set(roster.map(r => r.attendee_id));
          for (const a of enrolled) {
            if (!seen.has(a.id)) roster.push({ attendee_id: a.id, name: a.name, identifier: a.identifier, group_label: a.group_label });
          }
        } catch { /* fall back to attended-only roster */ }
      }
      roster.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setGrid({ sessions: full.sessions || [], students: roster, attendedMap });
    } catch (e) { setError(e.message); }
    finally { setLoadingGrid(false); }
  }, [orgId, selected]);

  useEffect(() => { if (detailTab === "grid") loadGrid(); }, [detailTab, loadGrid]);

  // sessions inside the chosen month
  const monthSessions = (grid.sessions || []).filter(s => (s.session_date || "").slice(0, 7) === month);

  function exportMonthCSV() {
    const header = ["Name", "Roll No.", "Dept", ...monthSessions.map(s => formatDate(s.session_date)), "Present", "Held", "%"];
    const rows = (grid.students || []).map(st => {
      const att = grid.attendedMap?.[st.attendee_id] || new Set();
      const marks = monthSessions.map(s => (att.has(s.id) ? "P" : "A"));
      const present = marks.filter(m => m === "P").length;
      const pct = monthSessions.length ? Math.round((present / monthSessions.length) * 100) : 0;
      return [st.name, st.identifier, st.group_label || "", ...marks, present, monthSessions.length, pct + "%"];
    });
    const csv = [header, ...rows].map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${selected.code || selected.name}-${month}-attendance.csv`;
    a.click();
  }

  // ════════════════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════════════════
  if (!selected) {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900, fontFamily: "'Playfair Display', serif", color: "#111" }}>My Classes</h2>
            <p style={{ color: "#888", margin: "4px 0 0", fontSize: 13 }}>{classes.length} class{classes.length !== 1 ? "es" : ""} · daily attendance by QR</p>
          </div>
          <Btn onClick={() => setShowCreate(true)}>＋ New Class</Btn>
        </div>

        {error && <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 9, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>⚠️ {error}</div>}

        {loading ? (
          <div style={{ color: "#bbb", padding: 40, textAlign: "center" }}>Loading…</div>
        ) : classes.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: 16, padding: 60, textAlign: "center", border: "1px solid #f0f0f0", color: "#ccc" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📚</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6, color: "#999" }}>No classes yet</div>
            <div style={{ fontSize: 13 }}>Create a class, then start a daily session and scan student QRs.</div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 16 }}>
            {classes.map((c, i) => {
              const colors = ["#6366f1", "#f59e0b", "#10b981", "#ec4899", "#3b82f6"];
              return (
                <div key={c.id} onClick={() => openClass(c)} style={{ background: "#fff", borderRadius: 16, overflow: "hidden", border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", cursor: "pointer" }}>
                  <div style={{ height: 5, background: colors[i % colors.length] }} />
                  <div style={{ padding: 20 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: "#111" }}>{c.name}</h3>
                      {c.code && <Badge color="purple">{c.code}</Badge>}
                    </div>
                    <div style={{ fontSize: 12, color: "#888", display: "flex", flexDirection: "column", gap: 5 }}>
                      {c.group_label && <span>🏷 {c.group_label}</span>}
                      <span>🗓 {c.session_count || 0} session{Number(c.session_count) !== 1 ? "s" : ""}</span>
                    </div>
                    <div style={{ marginTop: 14 }}><Btn small variant="ghost">Open →</Btn></div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Class">
          <Input label="Class Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Data Structures" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Input label="Code" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="CS201" />
            <Input label="Dept / Section" value={form.group_label} onChange={e => setForm(f => ({ ...f, group_label: e.target.value }))} placeholder="CSE-A" />
          </div>
          <div style={{ marginTop: 4, marginBottom: 14, padding: "10px 12px", background: "#f8f7ff", borderRadius: 9, fontSize: 12, color: "#6366f1" }}>
            💡 Dept / Section should match students' group, so the roster auto-fills.
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <Btn variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Btn>
            <Btn onClick={handleCreateClass} disabled={saving}>{saving ? "Creating…" : "Create Class"}</Btn>
          </div>
        </Modal>
      </div>
    );
  }

  // ── Class detail ──
  return (
    <div>
      <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "#6366f1", fontWeight: 700, fontSize: 13, cursor: "pointer", marginBottom: 14, fontFamily: "inherit", padding: 0 }}>← All classes</button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 900, fontFamily: "'Playfair Display', serif", color: "#111" }}>{selected.name}</h2>
          <p style={{ color: "#888", margin: "4px 0 0", fontSize: 13 }}>
            {selected.code ? `${selected.code} · ` : ""}{selected.group_label || "No section"}
          </p>
        </div>
        <Btn onClick={() => { setSessForm({ session_date: todayISO(), session_time: "", location: "" }); setShowSession(true); }}>＋ Start Session</Btn>
      </div>

      <div style={{ display: "flex", gap: 4, background: "#f5f5f5", borderRadius: 10, padding: 4, marginBottom: 20, maxWidth: 320 }}>
        {[["sessions", "🗓 Sessions"], ["grid", "📊 Monthly Grid"]].map(([id, label]) => (
          <button key={id} onClick={() => setDetailTab(id)} style={{ flex: 1, padding: "8px 0", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", background: detailTab === id ? "#fff" : "transparent", color: detailTab === id ? "#6366f1" : "#888", boxShadow: detailTab === id ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>{label}</button>
        ))}
      </div>

      {/* ── SESSIONS LIST ── */}
      {detailTab === "sessions" && (
        loadingSessions ? (
          <div style={{ color: "#bbb", padding: 40, textAlign: "center" }}>Loading…</div>
        ) : sessions.length === 0 ? (
          <div style={{ background: "#fff", borderRadius: 16, padding: 50, textAlign: "center", border: "1px solid #f0f0f0", color: "#ccc" }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>🗓</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#999" }}>No sessions yet — start one to take attendance.</div>
          </div>
        ) : (
          <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #f0f0f0", overflow: "hidden" }}>
            {sessions.map((s, i) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", borderBottom: i < sessions.length - 1 ? "1px solid #f8f8f8" : "none" }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: "#f0f0ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📅</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: "#111", fontSize: 14 }}>
                    {formatDate(s.session_date)} {s.session_date === todayISO() && <Badge color="green">Today</Badge>}
                  </div>
                  <div style={{ fontSize: 12, color: "#aaa", marginTop: 3 }}>
                    {s.session_time ? `${s.session_time} · ` : ""}{s.location || "No location"} · {s.checkin_count || 0} present
                  </div>
                </div>
                <Btn small onClick={() => openScanner(s)}>📷 Take Attendance</Btn>
                <Btn small variant="danger" onClick={() => handleDeleteSession(s.id)}>Delete</Btn>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── MONTHLY GRID ── */}
      {detailTab === "grid" && (
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#555" }}>Month</label>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={{ padding: "8px 12px", borderRadius: 9, border: "1.5px solid #e8e8e8", fontFamily: "inherit", fontSize: 13 }} />
            <div style={{ flex: 1 }} />
            <Btn small variant="success" onClick={exportMonthCSV} disabled={!monthSessions.length}>⬇ Export CSV</Btn>
          </div>

          {loadingGrid ? (
            <div style={{ color: "#bbb", padding: 40, textAlign: "center" }}>Loading…</div>
          ) : monthSessions.length === 0 ? (
            <div style={{ background: "#fff", borderRadius: 16, padding: 50, textAlign: "center", border: "1px solid #f0f0f0", color: "#ccc" }}>No sessions in this month.</div>
          ) : (
            <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #f0f0f0", overflow: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%" }}>
                <thead>
                  <tr style={{ background: "#fafafa", borderBottom: "2px solid #f0f0f0" }}>
                    <th style={{ textAlign: "left", padding: "10px 14px", color: "#aaa", fontWeight: 700, fontSize: 11, textTransform: "uppercase", position: "sticky", left: 0, background: "#fafafa" }}>Student</th>
                    {monthSessions.map(s => (
                      <th key={s.id} style={{ padding: "10px 6px", color: "#aaa", fontWeight: 700, fontSize: 10, whiteSpace: "nowrap" }}>{new Date(s.session_date).getDate()}</th>
                    ))}
                    <th style={{ padding: "10px 12px", color: "#aaa", fontWeight: 700, fontSize: 11, textTransform: "uppercase" }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.students.map(st => {
                    const att = grid.attendedMap?.[st.attendee_id] || new Set();
                    const present = monthSessions.filter(s => att.has(s.id)).length;
                    const pct = Math.round((present / monthSessions.length) * 100);
                    return (
                      <tr key={st.attendee_id} style={{ borderBottom: "1px solid #f8f8f8" }}>
                        <td style={{ padding: "9px 14px", fontWeight: 600, color: "#222", position: "sticky", left: 0, background: "#fff", whiteSpace: "nowrap" }}>
                          {st.name}<div style={{ fontSize: 10, color: "#bbb", fontFamily: "monospace" }}>{st.identifier}</div>
                        </td>
                        {monthSessions.map(s => (
                          <td key={s.id} style={{ textAlign: "center", padding: "9px 6px" }}>
                            {att.has(s.id)
                              ? <span style={{ color: "#16a34a", fontWeight: 800 }}>●</span>
                              : <span style={{ color: "#e5e5e5", fontWeight: 800 }}>○</span>}
                          </td>
                        ))}
                        <td style={{ padding: "9px 12px", textAlign: "center" }}>
                          <span style={{ fontWeight: 800, color: pct >= 75 ? "#16a34a" : pct >= 50 ? "#d97706" : "#dc2626" }}>{pct}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: 11, color: "#bbb", marginTop: 10 }}>● present · ○ absent · % = sessions attended this month. Roster fills from students whose group matches “{selected.group_label || "—"}”.</p>
        </div>
      )}

      {/* ── Start session modal ── */}
      <Modal open={showSession} onClose={() => setShowSession(false)} title="Start a Session">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Input label="Date" type="date" value={sessForm.session_date} onChange={e => setSessForm(f => ({ ...f, session_date: e.target.value }))} />
          <Input label="Time" type="time" value={sessForm.session_time} onChange={e => setSessForm(f => ({ ...f, session_time: e.target.value }))} />
        </div>
        <Input label="Location" value={sessForm.location} onChange={e => setSessForm(f => ({ ...f, location: e.target.value }))} placeholder="Room 204" />
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={() => setShowSession(false)}>Cancel</Btn>
          <Btn onClick={handleStartSession}>Start</Btn>
        </div>
      </Modal>

      {/* ── Scanner modal ── */}
      <Modal open={!!scanSession} onClose={closeScanner} wide title={`Attendance · ${scanSession ? formatDate(scanSession.session_date) : ""}`}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {/* left: scanner */}
          <div>
            <div style={{ background: "#f8f7ff", border: "2px dashed #c4b5fd", borderRadius: 14, padding: 16, marginBottom: 14, textAlign: "center" }}>
              {cameraActive ? (
                <div>
                  <div id="class-qr-reader" style={{ width: "100%", borderRadius: 10 }} />
                  <button onClick={stopCamera} style={{ marginTop: 10, background: "#fee2e2", color: "#991b1b", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 700, cursor: "pointer", width: "100%", fontFamily: "inherit" }}>Stop Camera</button>
                </div>
              ) : (
                <div style={{ padding: 14 }}>
                  <div style={{ fontSize: 38, marginBottom: 8 }}>📷</div>
                  <p style={{ color: "#888", fontSize: 13, margin: "0 0 12px" }}>Scan student QR or type roll number</p>
                  <Btn onClick={startCamera}>Start Camera</Btn>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={e => e.key === "Enter" && doCheckin()} placeholder="Roll number or Student ID"
                style={{ flex: 1, padding: "10px 14px", borderRadius: 9, border: "1.5px solid #e8e8e8", fontSize: 14, fontFamily: "inherit", outline: "none" }} />
              <Btn onClick={() => doCheckin()}>Mark</Btn>
            </div>
            {scanMsg && (
              <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: scanMsg.type === "success" ? "#dcfce7" : scanMsg.type === "warn" ? "#fef9c3" : "#fee2e2", color: scanMsg.type === "success" ? "#166534" : scanMsg.type === "warn" ? "#92400e" : "#991b1b" }}>
                {scanMsg.text}
              </div>
            )}
          </div>
          {/* right: live roster */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, color: "#111", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Present ({roster.length})</div>
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {roster.length === 0 ? (
                <div style={{ color: "#ccc", fontSize: 13, padding: 20, textAlign: "center" }}>No one yet</div>
              ) : roster.map(r => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f5f5f5" }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#dcfce7", color: "#166534", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>✓</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#222" }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: "#aaa", fontFamily: "monospace" }}>{r.identifier} · {formatTime(r.checked_in_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
