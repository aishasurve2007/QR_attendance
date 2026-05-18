import { useState } from "react";

const BASE_URL = "http://localhost:3001";

export default function LoginPage({ onLoginSuccess }) {
  const [tab, setTab] = useState("admin"); // "admin" | "student"
  const [email, setEmail] = useState("");
  const [rollNo, setRollNo] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  async function handleLogin(e) {
    e && e.preventDefault();
    setError(null);

    if (tab === "admin" && (!email.trim() || !password)) {
      setError("Please enter your email and password.");
      return;
    }
    if (tab === "student" && (!rollNo.trim() || !password)) {
      setError("Please enter your roll number and password.");
      return;
    }

    setLoading(true);
    try {
      let res, json;

      if (tab === "admin") {
        res = await fetch(`${BASE_URL}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        });
      } else {
        res = await fetch(`${BASE_URL}/auth/student-login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier: rollNo.trim(), password, orgSlug: "demo-org" }),
        });
      }

      json = await res.json();
      if (!res.ok) throw new Error(json.error || "Invalid credentials");

      const { token, orgId, role, studentId, name } = json.data;
      localStorage.setItem("attendiq_token", token);
      localStorage.setItem("attendiq_org_id", orgId);
      localStorage.setItem("attendiq_role", role);
      if (studentId) localStorage.setItem("attendiq_student_id", studentId);
      if (name) localStorage.setItem("attendiq_user_name", name);

      setSuccess(true);
      setTimeout(() => onLoginSuccess({ role, studentId, name }), 900);

    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const s = {
    page: {
      fontFamily: "'DM Sans', system-ui, sans-serif",
      background: "#f7f7f8", minHeight: "100vh",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem 1rem",
    },
    wrap: { width: "100%", maxWidth: 420 },
    logoWrap: { textAlign: "center", marginBottom: "2rem" },
    logoIcon: {
      width: 52, height: 52, borderRadius: 14,
      background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      fontSize: 24, marginBottom: "1rem",
    },
    logoTitle: {
      display: "block", fontFamily: "'Playfair Display', serif",
      fontSize: 22, fontWeight: 900, color: "#111", marginBottom: 4,
    },
    logoSub: { fontSize: 14, color: "#888" },
    card: {
      background: "#fff", borderRadius: 20,
      border: "1px solid #f0f0f0", padding: "2rem",
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
    },
    tabs: {
      display: "flex", background: "#f5f5f5", borderRadius: 10,
      padding: 4, marginBottom: "1.5rem", gap: 4,
    },
    tab: (active) => ({
      flex: 1, padding: "9px 0", border: "none", borderRadius: 8,
      fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
      transition: "all 0.18s",
      background: active ? "#fff" : "transparent",
      color: active ? "#6366f1" : "#888",
      boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
    }),
    label: {
      display: "block", fontSize: 11, fontWeight: 700,
      color: "#666", marginBottom: 6,
      letterSpacing: "0.06em", textTransform: "uppercase",
    },
    inputWrap: { position: "relative", marginBottom: "1rem" },
    inputIcon: {
      position: "absolute", left: 12, top: "50%",
      transform: "translateY(-50%)", fontSize: 15,
      color: "#bbb", pointerEvents: "none",
    },
    input: {
      width: "100%", padding: "11px 14px 11px 38px",
      borderRadius: 10, border: "1.5px solid #e8e8e8",
      fontSize: 14, fontFamily: "inherit", outline: "none",
      background: "#fff", color: "#111", boxSizing: "border-box",
      transition: "border-color 0.2s",
    },
    errorBanner: {
      display: "flex", alignItems: "center", gap: 8,
      background: "#fee2e2", color: "#991b1b",
      borderRadius: 10, padding: "10px 14px",
      fontSize: 13, fontWeight: 600, marginBottom: "1.25rem",
    },
    successBanner: {
      display: "flex", alignItems: "center", gap: 8,
      background: "#dcfce7", color: "#166534",
      borderRadius: 10, padding: "10px 14px",
      fontSize: 13, fontWeight: 600, marginTop: "1rem",
    },
    btn: {
      width: "100%", padding: "12px", marginTop: "0.5rem",
      background: success ? "#10b981" : "#6366f1",
      color: "#fff", border: "none", borderRadius: 12,
      fontSize: 15, fontWeight: 700, fontFamily: "inherit",
      cursor: loading ? "not-allowed" : "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      transition: "opacity 0.2s, background 0.2s",
      opacity: loading ? 0.65 : 1,
    },
    hint: {
      marginTop: "1.25rem", padding: "12px 14px",
      background: "#f8f7ff", borderRadius: 10,
      border: "1px solid #e8e7ff", fontSize: 12, color: "#6366f1",
    },
    footer: { textAlign: "center", marginTop: "1.5rem", fontSize: 12, color: "#bbb" },
  };

  return (
    <div style={s.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;600;700;800&display=swap');
        @keyframes iq-spin { to { transform: rotate(360deg); } }
        .iq-spin { display: inline-block; animation: iq-spin 0.7s linear infinite; }
        .iq-input:focus { border-color: #6366f1 !important; }
      `}</style>

      <div style={s.wrap}>
        <div style={s.logoWrap}>
          <div style={s.logoIcon}>📋</div>
          <span style={s.logoTitle}>AttendIQ</span>
          <p style={s.logoSub}>Sign in to continue</p>
        </div>

        <div style={s.card}>
          {/* Tabs */}
          <div style={s.tabs}>
            <button style={s.tab(tab === "admin")} onClick={() => { setTab("admin"); setError(null); }}>
              🏛 Admin / Organizer
            </button>
            <button style={s.tab(tab === "student")} onClick={() => { setTab("student"); setError(null); }}>
              🎓 Student
            </button>
          </div>

          {error && <div style={s.errorBanner}>⚠️ {error}</div>}

          <form onSubmit={handleLogin} noValidate>
            {tab === "admin" ? (
              <>
                <label style={s.label} htmlFor="iq-email">Email</label>
                <div style={s.inputWrap}>
                  <span style={s.inputIcon}>✉️</span>
                  <input className="iq-input" id="iq-email" type="email"
                    value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="admin@college.edu" autoComplete="email"
                    style={s.input} disabled={loading || success}
                  />
                </div>
              </>
            ) : (
              <>
                <label style={s.label} htmlFor="iq-roll">Roll Number</label>
                <div style={s.inputWrap}>
                  <span style={s.inputIcon}>🪪</span>
                  <input className="iq-input" id="iq-roll" type="text"
                    value={rollNo} onChange={e => setRollNo(e.target.value)}
                    placeholder="e.g. CS2021001" autoComplete="username"
                    style={s.input} disabled={loading || success}
                  />
                </div>
              </>
            )}

            <label style={s.label} htmlFor="iq-password">Password</label>
            <div style={{ ...s.inputWrap, marginBottom: "1.5rem" }}>
              <span style={s.inputIcon}>🔒</span>
              <input className="iq-input" id="iq-password"
                type={showPw ? "text" : "password"}
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" autoComplete="current-password"
                style={{ ...s.input, paddingRight: 40 }}
                disabled={loading || success}
              />
              <button type="button"
                onClick={() => setShowPw(v => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: 15, color: "#bbb" }}>
                {showPw ? "🙈" : "👁️"}
              </button>
            </div>

            <button type="submit" style={s.btn} disabled={loading || success}>
              <span>{success ? "Signed in!" : loading ? "Signing in…" : "Sign in"}</span>
              <span>{success ? "✓" : loading ? <span className="iq-spin">↻</span> : "→"}</span>
            </button>
          </form>

          {success && <div style={s.successBanner}>✅ Signed in! Loading your dashboard…</div>}

          {tab === "student" && !success && (
            <div style={s.hint}>
              💡 Your default password is your roll number. Change it after your first login.
            </div>
          )}
        </div>

        <p style={s.footer}>Powered by AttendIQ</p>
      </div>
    </div>
  );
}
