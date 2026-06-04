// StudentClassesView.jsx
// ───────────────────────────────────────────────────────────────────────────
// Read-only "My Classes" tab for the StudentDashboard. Shows the logged-in
// student their own daily class attendance and a monthly percentage. Students
// do NOT mark anything here — attendance is recorded when a teacher scans their
// QR. This screen just lets them see where they stand.
//
// Drop-in: lives in the same folder as StudentDashboard.jsx and is wired with
// one import + one tab button + one render line (see chat for the exact edits).
//
// Endpoints used (all already exist):
//   GET /orgs/:orgId/classes                          (student sees all org classes)
//   GET /orgs/:orgId/classes/:classId/sessions
//   GET /orgs/:orgId/attendees/:id/my-class-attendance   (now behind auth)
// ───────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";

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

function thisMonthISO() { return new Date().toISOString().slice(0, 7); }
function monthLabel(iso) {
  const [y, m] = iso.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function dayNum(d) { return new Date(d).getDate(); }
function formatDate(d) { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }

function pctColor(p) { return p >= 75 ? "#16a34a" : p >= 50 ? "#d97706" : "#dc2626"; }

export default function StudentClassesView({ studentId, orgId = "demo-org", groupLabel }) {
  const [myClasses, setMyClasses] = useState([]);   // [{...class, sessions: [...]}]
  const [attended, setAttended] = useState(new Set()); // Set of session_id
  const [history, setHistory] = useState([]);          // raw my-class-attendance rows
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [month, setMonth] = useState(thisMonthISO());

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true); setError(null);
    try {
      // 1) my check-ins (also serves as a fallback "history")
      const att = await apiFetch(`${BASE_URL}/orgs/${orgId}/attendees/${studentId}/my-class-attendance`);
      setHistory(att);
      setAttended(new Set(att.map(r => r.session_id)));

      // 2) classes in my group, plus any class I've actually attended (the
      // attendance clause covers cases where my dept label doesn't match exactly)
      let classes = [];
      try {
        const all = await apiFetch(`${BASE_URL}/orgs/${orgId}/classes`);
        const attendedClassIds = new Set(att.map(r => r.class_id));
        classes = all.filter(c =>
          (groupLabel && c.group_label === groupLabel) || attendedClassIds.has(c.id)
        );
        if (!groupLabel && classes.length === 0) classes = all; // no dept set → show everything
      } catch { classes = []; }

      const withSessions = await Promise.all(
        classes.map(async (c) => {
          try {
            const sessions = await apiFetch(`${BASE_URL}/orgs/${orgId}/classes/${c.id}/sessions`);
            return { ...c, sessions };
          } catch { return { ...c, sessions: [] }; }
        })
      );
      setMyClasses(withSessions);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [studentId, orgId, groupLabel]);

  useEffect(() => { load(); }, [load]);

  const card = { background: "#fff", borderRadius: 16, border: "1px solid #f0f0f0", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", padding: 24, marginBottom: 16 };
  const heading = { margin: "0 0 4px", fontSize: 22, fontWeight: 900, fontFamily: "'Playfair Display', serif", color: "#111" };

  // ── month rollup across all my classes ──
  const perClass = myClasses.map(c => {
    const inMonth = (c.sessions || []).filter(s => (s.session_date || "").slice(0, 7) === month);
    const present = inMonth.filter(s => attended.has(s.id)).length;
    const pct = inMonth.length ? Math.round((present / inMonth.length) * 100) : 0;
    return { ...c, inMonth, present, pct };
  });
  const totalHeld = perClass.reduce((n, c) => n + c.inMonth.length, 0);
  const totalPresent = perClass.reduce((n, c) => n + c.present, 0);
  const overallPct = totalHeld ? Math.round((totalPresent / totalHeld) * 100) : 0;

  if (loading) return <div style={{ textAlign: "center", padding: 60, color: "#bbb" }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={heading}>My Classes</h2>
          <p style={{ margin: 0, fontSize: 13, color: "#888" }}>Your daily attendance, recorded when a teacher scans your QR.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 700, color: "#555" }}>Month</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 9, border: "1.5px solid #e8e8e8", fontFamily: "inherit", fontSize: 13 }} />
        </div>
      </div>

      {error && <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 9, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>⚠️ {error}</div>}

      {/* overall summary */}
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <div style={{ position: "relative", width: 92, height: 92, flexShrink: 0 }}>
          <svg viewBox="0 0 36 36" style={{ width: 92, height: 92, transform: "rotate(-90deg)" }}>
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f0f0f0" strokeWidth="3.2" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke={pctColor(overallPct)} strokeWidth="3.2"
              strokeDasharray={`${overallPct} ${100 - overallPct}`} strokeLinecap="round" />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 20, fontWeight: 800, color: "#111", fontFamily: "'Playfair Display', serif" }}>{overallPct}%</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 4 }}>{monthLabel(month)}</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#111" }}>
            Present at {totalPresent} of {totalHeld} class session{totalHeld !== 1 ? "s" : ""}
          </div>
          <div style={{ fontSize: 12, color: "#aaa", marginTop: 4 }}>
            Across {perClass.length} class{perClass.length !== 1 ? "es" : ""}{groupLabel ? ` in ${groupLabel}` : ""}
          </div>
        </div>
      </div>

      {/* per-class breakdown */}
      {perClass.length === 0 ? (
        history.length === 0 ? (
          <div style={{ ...card, textAlign: "center", color: "#ccc", padding: 50 }}>
            <div style={{ fontSize: 34, marginBottom: 10 }}>📚</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#999" }}>No class attendance yet</div>
            <div style={{ fontSize: 13 }}>Once a teacher scans your QR in class, it'll show up here.</div>
          </div>
        ) : (
          // fallback: show raw attended history grouped by class
          <div style={card}>
            <div style={{ fontSize: 15, fontWeight: 800, fontFamily: "'Playfair Display', serif", marginBottom: 16, color: "#111" }}>Recent attendance</div>
            {history.map((r, i) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0", borderBottom: i < history.length - 1 ? "1px solid #f5f5f5" : "none" }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, background: "#f0f0ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>📅</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: "#111", fontSize: 14 }}>{r.class_name} {r.class_code ? `· ${r.class_code}` : ""}</div>
                  <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>{formatDate(r.session_date)}</div>
                </div>
                <span style={{ background: "#dcfce7", color: "#166534", padding: "2px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>Present</span>
              </div>
            ))}
          </div>
        )
      ) : (
        perClass.map((c, i) => {
          const colors = ["#6366f1", "#f59e0b", "#10b981", "#ec4899", "#3b82f6"];
          return (
            <div key={c.id} style={{ ...card, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#111" }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: "#aaa", marginTop: 2 }}>{c.code || ""}{c.code && c.group_label ? " · " : ""}{c.group_label || ""}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: pctColor(c.pct), fontFamily: "'Playfair Display', serif" }}>{c.pct}%</div>
                  <div style={{ fontSize: 11, color: "#aaa" }}>{c.present}/{c.inMonth.length} present</div>
                </div>
              </div>
              {c.inMonth.length === 0 ? (
                <div style={{ fontSize: 12, color: "#ccc" }}>No sessions this month.</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {c.inMonth
                    .slice()
                    .sort((a, b) => a.session_date.localeCompare(b.session_date))
                    .map(s => {
                      const here = attended.has(s.id);
                      return (
                        <div key={s.id} title={formatDate(s.session_date)} style={{
                          width: 34, height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 12, fontWeight: 700,
                          background: here ? "#dcfce7" : "#fef2f2",
                          color: here ? "#166534" : "#dc2626",
                          border: `1px solid ${here ? "#bbf7d0" : "#fecaca"}`,
                        }}>
                          {dayNum(s.session_date)}
                        </div>
                      );
                    })}
                  <div style={{ marginLeft: "auto", height: 5, alignSelf: "center" }} />
                  <div style={{ height: 5, background: colors[i % colors.length] }} />
                </div>
              )}
            </div>
          );
        })
      )}

      <p style={{ fontSize: 11, color: "#bbb", marginTop: 8 }}>
        Green = present · Red = absent. Numbers are the day of the month. Your classes are matched by your group{groupLabel ? ` (“${groupLabel}”)` : ""}.
      </p>
    </div>
  );
}