// AdminStudentAttendanceView.jsx
// ───────────────────────────────────────────────────────────────────────────
// Admin report, STUDENT-WISE (not class-wise). One row per student showing how
// many class sessions they attended this month across ALL their classes, with a
// percentage. Click a student to expand the per-class breakdown. Filter by
// month / department, search by name or roll, sort by lowest attendance, export.
//
// A student is considered "in" a class when their group_label matches the
// class's group_label (the only enrollment link the schema has).
//
// Drop-in for AttendanceApp.jsx admin nav (import + nav item + render line).
//
// Endpoints used (all already exist):
//   GET /orgs/:orgId/attendees?all=true
//   GET /orgs/:orgId/classes
//   GET /orgs/:orgId/classes/:classId/full-attendance
// ───────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useMemo } from "react";

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

export default function AdminStudentAttendanceView({ orgId = "demo-org" }) {
  const [students, setStudents] = useState([]);        // roster
  const [classes, setClasses] = useState([]);          // [{id,name,code,group_label, sessions:[], attendedMap:{}}]
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [month, setMonth] = useState(thisMonthISO());
  const [groupFilter, setGroupFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("name"); // "name" | "lowest"
  const [expanded, setExpanded] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [roster, classList] = await Promise.all([
        apiFetch(`${BASE_URL}/orgs/${orgId}/attendees?all=true`),
        apiFetch(`${BASE_URL}/orgs/${orgId}/classes`),
      ]);
      // pull full attendance per class (parallel)
      const enriched = await Promise.all(
        classList.map(async (c) => {
          try {
            const full = await apiFetch(`${BASE_URL}/orgs/${orgId}/classes/${c.id}/full-attendance`);
            const attendedMap = {};
            for (const st of full.students || []) {
              attendedMap[st.attendee_id] = new Set((st.sessions_attended || []).map(x => x.session_id));
            }
            return { id: c.id, name: c.name, code: c.code, group_label: c.group_label, sessions: full.sessions || [], attendedMap };
          } catch {
            return { id: c.id, name: c.name, code: c.code, group_label: c.group_label, sessions: [], attendedMap: {} };
          }
        })
      );
      setStudents(Array.isArray(roster) ? roster : (roster.items || []));
      setClasses(enriched);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    const set = new Set();
    students.forEach(s => s.group_label && set.add(s.group_label));
    return Array.from(set).sort();
  }, [students]);

  // ── compute per-student rollup for the chosen month ──
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students
      .filter(s => groupFilter === "all" || s.group_label === groupFilter)
      .filter(s => !q || (s.name || "").toLowerCase().includes(q) || (s.identifier || "").toLowerCase().includes(q))
      .map(s => {
        // Link a student to a class if their dept/section matches it OR they've
        // actually attended a session in it. The second clause prevents real
        // check-ins from disappearing when dept labels don't match exactly.
        const myClasses = classes.filter(c =>
          (c.group_label && c.group_label === s.group_label) ||
          (c.attendedMap[s.id] && c.attendedMap[s.id].size > 0)
        );
        const breakdown = myClasses.map(c => {
          const inMonth = c.sessions.filter(ss => (ss.session_date || "").slice(0, 7) === month);
          const att = c.attendedMap[s.id] || new Set();
          const present = inMonth.filter(ss => att.has(ss.id)).length;
          return { classId: c.id, name: c.name, code: c.code, inMonth, present, held: inMonth.length, att };
        }).filter(b => b.held > 0);
        const held = breakdown.reduce((n, b) => n + b.held, 0);
        const present = breakdown.reduce((n, b) => n + b.present, 0);
        const pct = held ? Math.round((present / held) * 100) : null;
        return { ...s, held, present, pct, breakdown };
      })
      .sort((a, b) => {
        if (sortBy === "lowest") {
          const pa = a.pct === null ? 999 : a.pct;
          const pb = b.pct === null ? 999 : b.pct;
          if (pa !== pb) return pa - pb;
        }
        return (a.name || "").localeCompare(b.name || "");
      });
  }, [students, classes, month, groupFilter, search, sortBy]);

  function exportCSV() {
    const header = ["Name", "Roll No.", "Dept", "Present", "Held", "%"];
    const body = rows.map(r => [r.name, r.identifier, r.group_label || "", r.present, r.held, r.pct === null ? "—" : r.pct + "%"]);
    const csv = [header, ...body].map(line => line.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `student-attendance-${month}.csv`;
    a.click();
  }

  const heading = { margin: 0, fontSize: 24, fontWeight: 900, fontFamily: "'Playfair Display', serif", color: "#111" };
  const selStyle = { padding: "8px 12px", borderRadius: 9, border: "1.5px solid #e8e8e8", fontFamily: "inherit", fontSize: 13, background: "#fff" };

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h2 style={heading}>Student Attendance</h2>
        <p style={{ color: "#888", margin: "4px 0 0", fontSize: 13 }}>Monthly class attendance, one row per student.</p>
      </div>

      {/* controls */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} style={selStyle} />
        <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)} style={selStyle}>
          <option value="all">All departments</option>
          {groups.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={selStyle}>
          <option value="name">Sort: Name</option>
          <option value="lowest">Sort: Lowest %</option>
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or roll…"
          style={{ ...selStyle, flex: 1, minWidth: 160 }} />
        <button onClick={exportCSV} disabled={!rows.length}
          style={{ background: "#dcfce7", color: "#166534", border: "none", borderRadius: 9, padding: "9px 16px", fontWeight: 700, fontSize: 13, cursor: rows.length ? "pointer" : "not-allowed", fontFamily: "inherit", opacity: rows.length ? 1 : 0.6 }}>
          ⬇ Export CSV
        </button>
      </div>

      {error && <div style={{ background: "#fee2e2", color: "#991b1b", borderRadius: 9, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>⚠️ {error}</div>}

      <div style={{ fontSize: 12, color: "#aaa", marginBottom: 10 }}>{monthLabel(month)} · {rows.length} student{rows.length !== 1 ? "s" : ""}</div>

      {loading ? (
        <div style={{ color: "#bbb", padding: 40, textAlign: "center" }}>Loading…</div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #f0f0f0", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#fafafa", borderBottom: "2px solid #f0f0f0" }}>
                {["", "Student", "Roll No.", "Dept", "Present / Held", "Attendance"].map((h, i) => (
                  <th key={i} style={{ textAlign: i >= 4 ? "center" : "left", padding: "12px 16px", color: "#aaa", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#ccc" }}>No students match these filters.</td></tr>
              ) : rows.map(r => {
                const isOpen = expanded === r.id;
                return (
                  <>
                    <tr key={r.id} onClick={() => setExpanded(isOpen ? null : r.id)} style={{ borderBottom: "1px solid #f8f8f8", cursor: "pointer", background: isOpen ? "#fafaff" : "transparent" }}>
                      <td style={{ padding: "11px 16px", color: "#bbb", width: 24 }}>{isOpen ? "▾" : "▸"}</td>
                      <td style={{ padding: "11px 16px", fontWeight: 600, color: "#222" }}>{r.name}</td>
                      <td style={{ padding: "11px 16px", color: "#888", fontFamily: "'DM Mono', monospace", fontSize: 12 }}>{r.identifier}</td>
                      <td style={{ padding: "11px 16px", color: "#666" }}>{r.group_label || "—"}</td>
                      <td style={{ padding: "11px 16px", textAlign: "center", color: "#555" }}>{r.held ? `${r.present} / ${r.held}` : "—"}</td>
                      <td style={{ padding: "11px 16px", textAlign: "center" }}>
                        {r.pct === null ? (
                          <span style={{ color: "#ccc", fontSize: 12 }}>no sessions</span>
                        ) : (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 80, height: 6, borderRadius: 99, background: "#f0f0f0", overflow: "hidden" }}>
                              <div style={{ width: `${r.pct}%`, height: "100%", background: pctColor(r.pct) }} />
                            </div>
                            <span style={{ fontWeight: 800, color: pctColor(r.pct), minWidth: 34 }}>{r.pct}%</span>
                          </div>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={r.id + "-d"} style={{ background: "#fafaff" }}>
                        <td colSpan={6} style={{ padding: "4px 16px 16px 56px" }}>
                          {r.breakdown.length === 0 ? (
                            <div style={{ color: "#bbb", fontSize: 13, padding: "8px 0" }}>No classes with sessions this month{r.group_label ? "" : " (no department set for this student)"}.</div>
                          ) : r.breakdown.map(b => (
                            <div key={b.classId} style={{ padding: "10px 0", borderBottom: "1px solid #f0f0f0" }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                <div style={{ fontWeight: 700, color: "#333", fontSize: 13 }}>{b.name}{b.code ? ` · ${b.code}` : ""}</div>
                                <div style={{ fontSize: 12, color: pctColor(Math.round((b.present / b.held) * 100)), fontWeight: 700 }}>
                                  {b.present}/{b.held} · {Math.round((b.present / b.held) * 100)}%
                                </div>
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                                {b.inMonth.slice().sort((x, y) => x.session_date.localeCompare(y.session_date)).map(ss => {
                                  const here = b.att.has(ss.id);
                                  return (
                                    <div key={ss.id} title={formatDate(ss.session_date)} style={{
                                      width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                                      fontSize: 11, fontWeight: 700,
                                      background: here ? "#dcfce7" : "#fef2f2", color: here ? "#166534" : "#dc2626",
                                      border: `1px solid ${here ? "#bbf7d0" : "#fecaca"}`,
                                    }}>{dayNum(ss.session_date)}</div>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: 11, color: "#bbb", marginTop: 10 }}>
        Click a student to see their per-class breakdown. Students are linked to classes by matching department/section. Green = present, red = absent.
      </p>
    </div>
  );
}