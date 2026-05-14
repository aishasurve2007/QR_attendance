import { useState, useEffect } from "react";

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = "http://localhost:3001";

// ── Helpers ───────────────────────────────────────────────────────────────────
function getToken() {
  return typeof localStorage !== "undefined"
    ? localStorage.getItem("attendiq_token")
    : null;
}

// ── LoginPage Component ───────────────────────────────────────────────────────
export default function LoginPage({ onLoginSuccess }) {
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [showPw, setShowPw]       = useState(false);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [success, setSuccess]     = useState(false);

  // Auto-redirect if already logged in
  useEffect(() => {
    if (getToken() && onLoginSuccess) {
      onLoginSuccess();
    }
  }, []);

  async function handleLogin(e) {
    e && e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Please enter your email and password.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(`${BASE_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Invalid credentials");
      }

      const { token, orgId } = json.data;

      // Store — same keys used by apiFetch in the main app
      localStorage.setItem("attendiq_token", token);
      localStorage.setItem("attendiq_org_id", orgId);

      setSuccess(true);

      // Call parent callback after short delay
      setTimeout(() => {
        if (onLoginSuccess) onLoginSuccess(orgId);
      }, 1000);

    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  // ── Styles (inline, no extra CSS file needed) ─────────────────────────────
  const s = {
    page: {
      fontFamily: "'DM Sans', 'Inter', system-ui, sans-serif",
      background: "#f7f7f8",
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "2rem 1rem",
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
    field: { marginBottom: "1rem" },
    label: {
      display: "block", fontSize: 11, fontWeight: 700,
      color: "#666", marginBottom: 6,
      letterSpacing: "0.06em", textTransform: "uppercase",
    },
    inputWrap: { position: "relative" },
    inputIcon: {
      position: "absolute", left: 12, top: "50%",
      transform: "translateY(-50%)", fontSize: 15, color: "#bbb",
      pointerEvents: "none",
    },
    input: {
      width: "100%", padding: "11px 14px 11px 38px",
      borderRadius: 10, border: "1.5px solid #e8e8e8",
      fontSize: 14, fontFamily: "inherit", outline: "none",
      transition: "border-color 0.2s", background: "#fff",
      color: "#111", boxSizing: "border-box",
    },
    inputFocusBorder: "1.5px solid #6366f1",
    pwToggle: {
      position: "absolute", right: 10, top: "50%",
      transform: "translateY(-50%)", background: "none",
      border: "none", cursor: "pointer", padding: 4,
      color: "#bbb", fontSize: 15, lineHeight: 1,
    },
    btn: {
      width: "100%", padding: "12px",
      marginTop: "0.5rem",
      background: success ? "#10b981" : "#6366f1",
      color: "#fff", border: "none", borderRadius: 12,
      fontSize: 15, fontWeight: 700, fontFamily: "inherit",
      cursor: loading ? "not-allowed" : "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      transition: "opacity 0.2s, background 0.2s",
      opacity: loading ? 0.65 : 1,
    },
    footer: {
      textAlign: "center", marginTop: "1.5rem",
      fontSize: 12, color: "#bbb",
    },
  };

  return (
    <div style={s.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Sans:wght@400;600;700;800&display=swap');
        @keyframes iq-spin { to { transform: rotate(360deg); } }
        .iq-spin { display: inline-block; animation: iq-spin 0.7s linear infinite; }
        .iq-input:focus { border-color: #6366f1 !important; }
        .iq-pw-toggle:hover { color: #6366f1 !important; }
      `}</style>

      <div style={s.wrap}>
        {/* Logo */}
        <div style={s.logoWrap}>
          <div style={s.logoIcon}>📋</div>
          <span style={s.logoTitle}>AttendIQ</span>
          <p style={s.logoSub}>Sign in to your admin account</p>
        </div>

        {/* Card */}
        <div style={s.card}>

          {/* Error */}
          {error && (
            <div style={s.errorBanner} role="alert">
              ⚠️ {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin} noValidate>

            {/* Email */}
            <div style={s.field}>
              <label style={s.label} htmlFor="iq-email">Email</label>
              <div style={s.inputWrap}>
                <span style={s.inputIcon} aria-hidden="true">✉️</span>
                <input
                  className="iq-input"
                  id="iq-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="admin@college.edu"
                  autoComplete="email"
                  style={s.input}
                  disabled={loading || success}
                />
              </div>
            </div>

            {/* Password */}
            <div style={{ ...s.field, marginBottom: "1.5rem" }}>
              <label style={s.label} htmlFor="iq-password">Password</label>
              <div style={s.inputWrap}>
                <span style={s.inputIcon} aria-hidden="true">🔒</span>
                <input
                  className="iq-input"
                  id="iq-password"
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  style={{ ...s.input, paddingRight: 40 }}
                  disabled={loading || success}
                />
                <button
                  type="button"
                  className="iq-pw-toggle"
                  style={s.pwToggle}
                  onClick={() => setShowPw(v => !v)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? "🙈" : "👁️"}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              style={s.btn}
              disabled={loading || success}
            >
              <span>
                {success ? "Signed in!" : loading ? "Signing in…" : "Sign in"}
              </span>
              <span>
                {success ? "✓" : loading
                  ? <span className="iq-spin">↻</span>
                  : "→"}
              </span>
            </button>
          </form>

          {/* Success */}
          {success && (
            <div style={s.successBanner} role="status">
              ✅ Signed in! Redirecting to dashboard…
            </div>
          )}

        </div>

        <p style={s.footer}>Powered by AttendIQ</p>
      </div>
    </div>
  );
}
