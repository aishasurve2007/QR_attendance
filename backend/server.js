const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const { z } = require("zod");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require('path');
require("dotenv").config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

// ─── DB ───────────────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30000 });
async function query(text, params) {
  const client = await pool.connect();
  try { return await client.query(text, params); } finally { client.release(); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ok(res, data, meta = {}) { res.json({ data, error: null, meta }); }
function err(res, status, message) { res.status(status).json({ data: null, error: message, meta: {} }); }

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return err(res, 401, "Unauthorized");
  try { req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET); next(); }
  catch { err(res, 401, "Invalid token"); }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return err(res, 401, "Unauthorized");
    if (!roles.includes(req.user.role)) return err(res, 403, "Forbidden: insufficient permissions");
    next();
  };
}

// ─── Schemas ──────────────────────────────────────────────────────────────────
const AttendeeSchema = z.object({
  name: z.string().min(1),
  identifier: z.string().min(1),
  group_label: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  metadata: z.record(z.any()).optional(),
  password: z.string().optional(),
});

const EventSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  event_time: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  organizer: z.string().nullable().optional(),
  capacity: z.number().int().positive().nullable().optional(),
});

const CheckinSchema = z.object({
  identifier: z.string().optional(),
  attendee_id: z.string().uuid().optional(),
  method: z.enum(["qr", "manual", "nfc", "bulk"]).default("manual"),
  notes: z.string().optional(),
});

// ─── Auth routes ──────────────────────────────────────────────────────────────

// Admin / Organizer login
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await query(
      "SELECT * FROM admin_users WHERE email = $1 AND is_active = TRUE", [email]
    );
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return err(res, 401, "Invalid credentials");
    }
    const token = jwt.sign(
      { userId: user.id, orgId: user.org_id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7h" }
    );
    ok(res, { token, orgId: user.org_id, role: user.role, email: user.email, name: user.email.split("@")[0] });
  } catch (e) { err(res, 500, e.message); }
});

// Student login
app.post("/auth/student-login", async (req, res) => {
  try {
    const { identifier, password, orgSlug } = req.body;
    if (!identifier || !password) return err(res, 400, "Roll number and password are required");
    let org;
    try { org = await resolveOrg(orgSlug || "demo-org"); }
    catch { return err(res, 404, "Organization not found"); }

    const { rows } = await query(
      "SELECT * FROM attendees WHERE org_id = $1 AND identifier = $2 AND deleted_at IS NULL",
      [org.id, identifier]
    );
    const student = rows[0];
    if (!student) return err(res, 401, "Invalid roll number or password");
    if (!student.password_hash) return err(res, 401, "No password set. Contact your administrator.");
    if (!bcrypt.compareSync(password, student.password_hash)) return err(res, 401, "Invalid roll number or password");

    const token = jwt.sign(
      { userId: student.id, orgId: org.id, role: "student", identifier: student.identifier, name: student.name },
      process.env.JWT_SECRET,
      { expiresIn: "7h" }
    );
    ok(res, { token, orgId: org.id, role: "student", studentId: student.id, name: student.name });
  } catch (e) { err(res, 500, e.message); }
});

// ─── Admin: Organizer Management ─────────────────────────────────────────────

// List all organizers
app.get("/admin/organizers", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const orgId = req.user.orgId;
    const { rows } = await query(
      `SELECT u.id, u.email, u.role, u.is_active, u.created_at,
              COUNT(e.id) AS event_count
       FROM admin_users u
       LEFT JOIN events e ON e.created_by = u.id
       WHERE u.org_id = $1 AND u.role = 'organizer'
       GROUP BY u.id
       ORDER BY u.created_at DESC`,
      [orgId]
    );
    ok(res, rows);
  } catch (e) { err(res, 500, e.message); }
});

// Get organizer detail + their events
app.get("/admin/organizers/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { rows: org } = await query(
      "SELECT id, email, role, is_active, created_at FROM admin_users WHERE id = $1",
      [req.params.id]
    );
    if (!org[0]) return err(res, 404, "Organizer not found");
    const { rows: events } = await query(
      `SELECT e.*, COUNT(a.id) AS attendance_count
       FROM events e
       LEFT JOIN attendance a ON a.event_id = e.id
       WHERE e.created_by = $1
       GROUP BY e.id
       ORDER BY e.event_date DESC`,
      [req.params.id]
    );
    ok(res, { ...org[0], events });
  } catch (e) { err(res, 500, e.message); }
});

// Create organizer (admin only)
app.post("/admin/organizers", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return err(res, 400, "Email and password required");
    const orgId = req.user.orgId;
    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await query(
      `INSERT INTO admin_users (email, password_hash, org_id, role, is_active)
       VALUES ($1, $2, $3, 'organizer', TRUE)
       RETURNING id, email, role, is_active, created_at`,
      [email, hash, orgId]
    );
    ok(res, rows[0]);
  } catch (e) { err(res, 400, e.message); }
});

// Deactivate organizer
app.patch("/admin/organizers/:id/deactivate", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { rows } = await query(
      "UPDATE admin_users SET is_active = FALSE WHERE id = $1 AND role = 'organizer' RETURNING id, email, is_active",
      [req.params.id]
    );
    if (!rows[0]) return err(res, 404, "Organizer not found");
    ok(res, rows[0]);
  } catch (e) { err(res, 500, e.message); }
});

// Reactivate organizer
app.patch("/admin/organizers/:id/activate", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { rows } = await query(
      "UPDATE admin_users SET is_active = TRUE WHERE id = $1 AND role = 'organizer' RETURNING id, email, is_active",
      [req.params.id]
    );
    if (!rows[0]) return err(res, 404, "Organizer not found");
    ok(res, rows[0]);
  } catch (e) { err(res, 500, e.message); }
});

// Reset organizer password
app.patch("/admin/organizers/:id/reset-password", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return err(res, 400, "New password required");
    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await query(
      "UPDATE admin_users SET password_hash = $1 WHERE id = $2 AND role = 'organizer' RETURNING id, email",
      [hash, req.params.id]
    );
    if (!rows[0]) return err(res, 404, "Organizer not found");
    ok(res, { ...rows[0], message: "Password reset successfully" });
  } catch (e) { err(res, 500, e.message); }
});

// ─── Student password utilities ───────────────────────────────────────────────
app.post("/auth/set-student-password", async (req, res) => {
  try {
    const { identifier, password, orgSlug } = req.body;
    if (!identifier || !password) return err(res, 400, "Identifier and password required");
    const org = await resolveOrg(orgSlug || "demo-org");
    const hash = bcrypt.hashSync(password, 10);
    const { rows } = await query(
      "UPDATE attendees SET password_hash = $1 WHERE org_id = $2 AND identifier = $3 AND deleted_at IS NULL RETURNING id, name, identifier",
      [hash, org.id, identifier]
    );
    if (!rows[0]) return err(res, 404, "Student not found");
    ok(res, rows[0]);
  } catch (e) { err(res, 500, e.message); }
});

app.post("/auth/bulk-set-passwords", async (req, res) => {
  try {
    const { orgSlug } = req.body;
    const org = await resolveOrg(orgSlug || "demo-org");
    const { rows: students } = await query(
      "SELECT id, identifier FROM attendees WHERE org_id = $1 AND password_hash IS NULL AND deleted_at IS NULL",
      [org.id]
    );
    let count = 0;
    for (const s of students) {
      const hash = bcrypt.hashSync(s.identifier, 10);
      await query("UPDATE attendees SET password_hash = $1 WHERE id = $2", [hash, s.id]);
      count++;
    }
    ok(res, { updated: count, message: `Set default password for ${count} students` });
  } catch (e) { err(res, 500, e.message); }
});

app.put("/admin/change-password", requireAuth, requireRole("organizer", "admin"), async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return err(res, 400, "Both fields required");

    const { rows } = await query(
      "SELECT * FROM admin_users WHERE id = $1", [req.user.userId]
    );
    if (!rows[0]) return err(res, 404, "User not found");
    if (!bcrypt.compareSync(currentPassword, rows[0].password_hash))
      return err(res, 401, "Current password is incorrect");

    const hash = bcrypt.hashSync(newPassword, 10);
    await query("UPDATE admin_users SET password_hash = $1 WHERE id = $2", [hash, req.user.userId]);
    ok(res, { message: "Password updated successfully" });
  } catch (e) { err(res, 500, e.message); }
});

// ─── API router ───────────────────────────────────────────────────────────────
const api = express.Router();

// ── Organizations ─────────────────────────────────────────────────────────────
api.get("/orgs/:orgId", async (req, res) => {
  try {
    const orgIdOrSlug = req.params.orgId;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgIdOrSlug);
    const { rows } = await query(
      isUUID ? "SELECT * FROM organizations WHERE id = $1" : "SELECT * FROM organizations WHERE slug = $1",
      [orgIdOrSlug]
    );
    if (!rows[0]) return err(res, 404, "Organization not found");
    ok(res, rows[0]);
  } catch (e) { err(res, 500, e.message); }
});

api.patch("/orgs/:orgId", async (req, res) => {
  try {
    const orgIdOrSlug = req.params.orgId;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgIdOrSlug);
    const { name, attendee_label, identifier_label, group_label } = req.body;
    const { rows } = await query(
      `UPDATE organizations SET
         name = COALESCE($2, name), attendee_label = COALESCE($3, attendee_label),
         identifier_label = COALESCE($4, identifier_label), group_label = COALESCE($5, group_label)
       WHERE ${isUUID ? "id" : "slug"} = $1 RETURNING *`,
      [orgIdOrSlug, name, attendee_label, identifier_label, group_label]
    );
    ok(res, rows[0]);
  } catch (e) { err(res, 500, e.message); }
});

// ── Attendees ─────────────────────────────────────────────────────────────────
// ── Attendees with Server-Side Search, Filter, and Pagination ────────────────
// ── Attendees with Optional Unpaginated Fetch for Dropdowns ────────────────
api.get("/orgs/:orgId/attendees", async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    const fetchAll = req.query.all === "true"; // 🆕 Flag to skip pagination boundaries
    
    // Extract search query and group/dept filter from query strings
    const searchStr = req.query.search ? req.query.search.trim() : "";
    const groupFilter = req.query.group_label ? req.query.group_label.trim() : "";
    
    let sqlParams = [org.id];
    let whereClause = "WHERE org_id = $1 AND deleted_at IS NULL";
    
    // Dynamically append search criteria
    if (searchStr) {
      sqlParams.push(`%${searchStr}%`);
      whereClause += ` AND (name ILIKE $${sqlParams.length} OR identifier ILIKE $${sqlParams.length} OR email ILIKE $${sqlParams.length})`;
    }
    
    // Dynamically append department/group filter
    if (groupFilter) {
      sqlParams.push(groupFilter);
      whereClause += ` AND group_label = $${sqlParams.length}`;
    }

    let dataQuery = `
      SELECT id, org_id, name, identifier, group_label, email, phone, metadata, created_at
      FROM attendees 
      ${whereClause} 
      ORDER BY name 
    `;

    // 🆕 If it's not fetching the full roster for a dropdown/portal panel, apply page limits
    let rows;
    if (!fetchAll) {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const offset = (page - 1) * limit;
      
      sqlParams.push(limit, offset);
      dataQuery += ` LIMIT $${sqlParams.length - 1} OFFSET $${sqlParams.length}`;
      
      const response = await query(dataQuery, sqlParams);
      rows = response.rows;
      
      // Get total matches for standard UI pagination calculations
      const countParams = sqlParams.slice(1, sqlParams.length - 2); 
      const countResult = await query(`SELECT COUNT(*) FROM attendees ${whereClause}`, [org.id, ...countParams]);
      const total = parseInt(countResult.rows[0].count);

      return ok(res, rows, { total, page, limit });
    }

    // Otherwise, execute unpaginated fetch for dashboard panels
    const response = await query(dataQuery, sqlParams);
    ok(res, response.rows);
  } catch (e) { 
    err(res, 500, e.message); 
  }
});
api.post("/orgs/:orgId/attendees", async (req, res) => {
  try {
    const data = AttendeeSchema.parse(req.body);
    const org = await resolveOrg(req.params.orgId);
    const passwordHash = data.password ? bcrypt.hashSync(data.password, 10) : bcrypt.hashSync(data.identifier, 10);
    const { rows } = await query(
      `INSERT INTO attendees (org_id, name, identifier, group_label, email, phone, metadata, password_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, org_id, name, identifier, group_label, email, phone, metadata, created_at`,
      [org.id, data.name, data.identifier, data.group_label, data.email, data.phone, JSON.stringify(data.metadata || {}), passwordHash]
    );
    ok(res, rows[0]);
  } catch (e) { err(res, 400, e.message); }
});

api.post("/orgs/:orgId/attendees/bulk", async (req, res) => {
  try {
    const { attendees } = req.body;
    if (!Array.isArray(attendees)) return err(res, 400, "attendees must be an array");
    const org = await resolveOrg(req.params.orgId);
    const created = [];
    for (const a of attendees) {
      try {
        const parsed = AttendeeSchema.parse({
          name: a.name, identifier: a.identifier || a.roll,
          group_label: a.group || a.group_label || a.dept,
          email: a.email, phone: a.phone
        });
        const defaultPw = bcrypt.hashSync(parsed.identifier, 10);
        const { rows } = await query(
          `INSERT INTO attendees (org_id, name, identifier, group_label, email, phone, password_hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (org_id, identifier) DO UPDATE SET name = EXCLUDED.name
           RETURNING id, name, identifier, group_label, email`,
          [org.id, parsed.name, parsed.identifier, parsed.group_label, parsed.email, parsed.phone, defaultPw]
        );
        created.push(rows[0]);
      } catch {}
    }
    ok(res, created, { imported: created.length });
  } catch (e) { err(res, 400, e.message); }
});

api.get("/orgs/:orgId/attendees/:id", async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    const { rows } = await query(
      "SELECT id, org_id, name, identifier, group_label, email, phone, metadata, created_at FROM attendees WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL",
      [req.params.id, org.id]
    );
    if (!rows[0]) return err(res, 404, "Attendee not found");
    const history = await query(
      `SELECT a.*, e.name AS event_name, e.event_date, e.location
       FROM attendance a JOIN events e ON e.id = a.event_id
       WHERE a.attendee_id = $1 ORDER BY a.checked_in_at DESC`,
      [req.params.id]
    );
    ok(res, { ...rows[0], attendance_history: history.rows });
  } catch (e) { err(res, 500, e.message); }
});

api.put("/orgs/:orgId/attendees/:id", async (req, res) => {
  try {
    const data = AttendeeSchema.partial().parse(req.body);
    const org = await resolveOrg(req.params.orgId);
    const { rows } = await query(
      `UPDATE attendees SET
         name = COALESCE($3, name), identifier = COALESCE($4, identifier),
         group_label = COALESCE($5, group_label), email = COALESCE($6, email)
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL
       RETURNING id, name, identifier, group_label, email`,
      [req.params.id, org.id, data.name, data.identifier, data.group_label, data.email]
    );
    ok(res, rows[0]);
  } catch (e) { err(res, 400, e.message); }
});

api.delete("/orgs/:orgId/attendees/:id", async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    await query("UPDATE attendees SET deleted_at = NOW() WHERE id = $1 AND org_id = $2", [req.params.id, org.id]);
    ok(res, { deleted: true });
  } catch (e) { err(res, 500, e.message); }
});

// ── Events ─────────────────────────────────────────────────────────────────────
// GET all events (admin + students see all; organizer sees only their own)
// ── Events with Server-Side Filter and Substring Search ─────────────────────
api.get("/orgs/:orgId/events", requireAuth, async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    const searchStr = req.query.search ? req.query.search.trim() : "";
    const organizerFilter = req.query.organizer ? req.query.organizer.trim() : "";
    
    let params = [org.id];
 
    let sql = `
      SELECT e.*,
             u.email AS organizer_email,
             (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id) AS attendance_count
      FROM events e
      LEFT JOIN admin_users u ON u.id = e.created_by
      WHERE e.org_id = $1
    `;
 
    // Server-side structural access control: Organizers only see their own work
    if (req.user.role === "organizer") {
      sql += ` AND e.created_by = $2`;
      params.push(req.user.userId);
    }
 
    // Handle dynamic text matching on Event Name
    if (searchStr) {
      params.push(`%${searchStr}%`);
      sql += ` AND e.name ILIKE $${params.length}`;
    }

    // Handle structural matching on Organizer/Department Label
    if (organizerFilter) {
      params.push(organizerFilter);
      sql += ` AND e.organizer = $${params.length}`;
    }
 
    // Handle timeline scoping
    if (req.query.upcoming === "true") sql += " AND e.event_date >= CURRENT_DATE";
    if (req.query.past === "true")     sql += " AND e.event_date < CURRENT_DATE";
    
    // Handle explicit date ranges (ReportsView integration)
    if (req.query.startDate && req.query.endDate) {
      params.push(req.query.startDate, req.query.endDate);
      sql += ` AND e.event_date BETWEEN $${params.length - 1} AND $${params.length}`;
    }
 
    sql += " ORDER BY e.event_date DESC";
 
    const { rows } = await query(sql, params);
    ok(res, rows);
  } catch (e) { 
    err(res, 500, e.message); 
  }
});

api.post("/orgs/:orgId/events", requireAuth, async (req, res) => {
  try {
    const data = EventSchema.parse(req.body);
    const org = await resolveOrg(req.params.orgId);
    const createdBy = req.user.userId; // always read from JWT, never from body
    const { rows } = await query(
      `INSERT INTO events (org_id, name, description, event_date, event_time, location, organizer, capacity, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [org.id, data.name, data.description, data.event_date, data.event_time, data.location, data.organizer, data.capacity, createdBy]
    );
    ok(res, rows[0]);
  } catch (e) { err(res, 400, e.message); }
});

api.get("/orgs/:orgId/events/:id", async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    const { rows } = await query(
      `SELECT e.*, u.email AS organizer_email,
              (SELECT COUNT(*) FROM attendance a WHERE a.event_id = e.id) AS attendance_count
       FROM events e LEFT JOIN admin_users u ON u.id = e.created_by
       WHERE e.id = $1 AND e.org_id = $2`,
      [req.params.id, org.id]
    );
    if (!rows[0]) return err(res, 404, "Event not found");
    ok(res, rows[0]);
  } catch (e) { err(res, 500, e.message); }
});

api.put("/orgs/:orgId/events/:id", async (req, res) => {
  try {
    const data = EventSchema.partial().parse(req.body);
    const org = await resolveOrg(req.params.orgId);
    const { rows } = await query(
      `UPDATE events SET
         name = COALESCE($3, name), event_date = COALESCE($4, event_date),
         event_time = COALESCE($5, event_time), location = COALESCE($6, location),
         organizer = COALESCE($7, organizer)
       WHERE id = $1 AND org_id = $2 RETURNING *`,
      [req.params.id, org.id, data.name, data.event_date, data.event_time, data.location, data.organizer]
    );
    ok(res, rows[0]);
  } catch (e) { err(res, 400, e.message); }
});

api.delete("/orgs/:orgId/events/:id", async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    await query("DELETE FROM events WHERE id = $1 AND org_id = $2", [req.params.id, org.id]);
    ok(res, { deleted: true });
  } catch (e) { err(res, 500, e.message); }
});

// ── Attendance ────────────────────────────────────────────────────────────────
api.post("/orgs/:orgId/events/:id/checkin", async (req, res) => {
  try {
    const data = CheckinSchema.parse(req.body);
    const org = await resolveOrg(req.params.orgId);
    let attendeeId = data.attendee_id;
    if (!attendeeId && data.identifier) {
      const { rows } = await query(
        "SELECT id FROM attendees WHERE org_id = $1 AND (identifier = $2 OR id::text = $2) AND deleted_at IS NULL",
        [org.id, data.identifier]
      );
      if (!rows[0]) return err(res, 404, "Attendee not found");
      attendeeId = rows[0].id;
    }
    const { rows } = await query(
      `INSERT INTO attendance (event_id, attendee_id, method, checked_in_by, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id, attendee_id) DO NOTHING RETURNING *`,
      [req.params.id, attendeeId, data.method, req.body._checked_in_by || "system", data.notes]
    );
    if (!rows[0]) return err(res, 409, "Already checked in");
    ok(res, rows[0]);
  } catch (e) { err(res, 400, e.message); }
});

api.get("/orgs/:orgId/events/:id/attendance", async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT a.*, at.name, at.identifier, at.group_label, at.email
       FROM attendance a JOIN attendees at ON at.id = a.attendee_id
       WHERE a.event_id = $1 ORDER BY a.checked_in_at`,
      [req.params.id]
    );
    ok(res, rows);
  } catch (e) { err(res, 500, e.message); }
});

api.delete("/orgs/:orgId/events/:id/attendance/:attId", async (req, res) => {
  try {
    await query("DELETE FROM attendance WHERE event_id = $1 AND attendee_id = $2", [req.params.id, req.params.attId]);
    ok(res, { deleted: true });
  } catch (e) { err(res, 500, e.message); }
});

// ── Student own attendance ────────────────────────────────────────────────────
api.get("/orgs/:orgId/attendees/:id/my-attendance", async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT a.id, a.checked_in_at, a.method,
              e.id as event_id, e.name as event_name, e.event_date,
              e.event_time, e.location, e.organizer
       FROM attendance a
       JOIN events e ON e.id = a.event_id
       WHERE a.attendee_id = $1
       ORDER BY a.checked_in_at DESC`,
      [req.params.id]
    );
    ok(res, rows);
  } catch (e) { err(res, 500, e.message); }
});

api.put("/orgs/:orgId/attendees/:id/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
 
    if (!currentPassword || !newPassword)
      return err(res, 400, "Current and new password are required");
 
    // Make sure the logged-in student can only change their own password
    if (req.user.userId !== req.params.id)
      return err(res, 403, "Forbidden");
 
    const org = await resolveOrg(req.params.orgId);
 
    const { rows } = await query(
      "SELECT * FROM attendees WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL",
      [req.params.id, org.id]
    );
    if (!rows[0]) return err(res, 404, "Student not found");
 
    if (!bcrypt.compareSync(currentPassword, rows[0].password_hash))
      return err(res, 401, "Current password is incorrect");
 
    const newHash = bcrypt.hashSync(newPassword, 10);
    await query(
      "UPDATE attendees SET password_hash = $1 WHERE id = $2",
      [newHash, req.params.id]
    );
 
    ok(res, { message: "Password updated successfully" });
  } catch (e) { err(res, 500, e.message); }
});

// ── Reports ───────────────────────────────────────────────────────────────────
api.get("/orgs/:orgId/reports/summary", async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    const createdBy = req.query.created_by; // organizer scoping
    let eventFilter = "WHERE org_id = $1";
    const params = [org.id];
    if (createdBy) { eventFilter += " AND created_by = $2"; params.push(createdBy); }

    const [atts, evts, checkins] = await Promise.all([
      query("SELECT COUNT(*) FROM attendees WHERE org_id = $1 AND deleted_at IS NULL", [org.id]),
      query(`SELECT COUNT(*) FROM events ${eventFilter}`, params),
      query(
        `SELECT COUNT(*) FROM attendance a JOIN events e ON e.id = a.event_id
         WHERE e.org_id = $1 ${createdBy ? "AND e.created_by = $2" : ""}`,
        params
      ),
    ]);
    ok(res, {
      total_attendees: parseInt(atts.rows[0].count),
      total_events: parseInt(evts.rows[0].count),
      total_checkins: parseInt(checkins.rows[0].count),
    });
  } catch (e) { err(res, 500, e.message); }
});

api.get("/orgs/:orgId/reports/export", async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    const fmt = req.query.fmt || "json";
    const createdBy = req.query.created_by;

    let sql = `
      SELECT at.name, at.identifier, at.group_label, at.email,
             e.name AS event_name, a.checked_in_at, a.method
      FROM attendance a
      JOIN attendees at ON at.id = a.attendee_id
      JOIN events e ON e.id = a.event_id
      WHERE e.org_id = $1`;
    const params = [org.id];

    if (req.query.eventId) { sql += ` AND e.id = $${params.length + 1}`; params.push(req.query.eventId); }
    if (createdBy) { sql += ` AND e.created_by = $${params.length + 1}`; params.push(createdBy); }
    sql += " ORDER BY a.checked_in_at DESC";

    const { rows } = await query(sql, params);

    if (fmt === "csv") {
      const header = ["Name", "Identifier", "Group", "Email", "Event", "Checked In At", "Method"];
      const csvRows = rows.map(r =>
        [r.name, r.identifier, r.group_label, r.email, r.event_name, r.checked_in_at, r.method].join(",")
      );
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=attendance_report.csv");
      res.send([header.join(","), ...csvRows].join("\n"));
    } else {
      ok(res, rows);
    }
  } catch (e) { err(res, 500, e.message); }
});

// ─── Helper ───────────────────────────────────────────────────────────────────
async function resolveOrg(orgIdOrSlug) {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgIdOrSlug);
  const { rows } = await query(
    isUUID ? "SELECT * FROM organizations WHERE id = $1" : "SELECT * FROM organizations WHERE slug = $1",
    [orgIdOrSlug]
  );
  if (!rows[0]) throw new Error("Organization not found");
  return rows[0];
}
// ═══════════════════════════════════════════════════════════════════
// DAILY CLASS ATTENDANCE — Add these routes to your existing server.js
// Place them BEFORE the `app.use("/api/v1", api)` line at the bottom.
// ═══════════════════════════════════════════════════════════════════

// ── Schemas ───────────────────────────────────────────────────────
const ClassSchema = z.object({
  name:        z.string().min(1),
  code:        z.string().optional(),
  description: z.string().nullable().optional(),
  group_label: z.string().optional(),
});

const SessionSchema = z.object({
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  session_time: z.string().nullable().optional(),
  location:     z.string().nullable().optional(),
  notes:        z.string().nullable().optional(),
});

const ClassCheckinSchema = z.object({
  identifier:  z.string().optional(),
  attendee_id: z.string().uuid().optional(),
  method:      z.enum(["qr","manual","nfc","bulk"]).default("qr"),
  notes:       z.string().optional(),
});

// ════════════════════════════════════════════════════════════════════
// CLASSES — CRUD
// ════════════════════════════════════════════════════════════════════

// GET  /api/v1/orgs/:orgId/classes
// Returns all classes for this org.
// Organizers see only their own; admin sees all.
api.get("/orgs/:orgId/classes", requireAuth, async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    let sql = `
      SELECT c.*,
             u.email AS creator_email,
             (SELECT COUNT(*) FROM class_sessions cs WHERE cs.class_id = c.id) AS session_count
      FROM classes c
      LEFT JOIN admin_users u ON u.id = c.created_by
      WHERE c.org_id = $1 AND c.deleted_at IS NULL
    `;
    const params = [org.id];

    if (req.user.role === "organizer") {
      sql += ` AND c.created_by = $2`;
      params.push(req.user.userId);
    }

    if (req.query.group_label) {
      params.push(req.query.group_label);
      sql += ` AND c.group_label = $${params.length}`;
    }

    if (req.query.search) {
      params.push(`%${req.query.search.trim()}%`);
      sql += ` AND (c.name ILIKE $${params.length} OR c.code ILIKE $${params.length})`;
    }

    sql += " ORDER BY c.name ASC";
    const { rows } = await query(sql, params);
    ok(res, rows);
  } catch (e) { err(res, 500, e.message); }
});

// POST /api/v1/orgs/:orgId/classes
api.post("/orgs/:orgId/classes", requireAuth, async (req, res) => {
  try {
    const data = ClassSchema.parse(req.body);
    const org  = await resolveOrg(req.params.orgId);
    const { rows } = await query(
      `INSERT INTO classes (org_id, name, code, description, group_label, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [org.id, data.name, data.code, data.description, data.group_label, req.user.userId]
    );
    ok(res, rows[0]);
  } catch (e) { err(res, 400, e.message); }
});

// GET  /api/v1/orgs/:orgId/classes/:id
api.get("/orgs/:orgId/classes/:id", requireAuth, async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    const { rows } = await query(
      `SELECT c.*, u.email AS creator_email FROM classes c
       LEFT JOIN admin_users u ON u.id = c.created_by
       WHERE c.id = $1 AND c.org_id = $2 AND c.deleted_at IS NULL`,
      [req.params.id, org.id]
    );
    if (!rows[0]) return err(res, 404, "Class not found");
    ok(res, rows[0]);
  } catch (e) { err(res, 500, e.message); }
});

// PUT  /api/v1/orgs/:orgId/classes/:id
api.put("/orgs/:orgId/classes/:id", requireAuth, async (req, res) => {
  try {
    const data = ClassSchema.partial().parse(req.body);
    const org  = await resolveOrg(req.params.orgId);
    const { rows } = await query(
      `UPDATE classes SET
         name        = COALESCE($3, name),
         code        = COALESCE($4, code),
         description = COALESCE($5, description),
         group_label = COALESCE($6, group_label)
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL RETURNING *`,
      [req.params.id, org.id, data.name, data.code, data.description, data.group_label]
    );
    if (!rows[0]) return err(res, 404, "Class not found");
    ok(res, rows[0]);
  } catch (e) { err(res, 400, e.message); }
});

// DELETE /api/v1/orgs/:orgId/classes/:id  (soft delete)
api.delete("/orgs/:orgId/classes/:id", requireAuth, async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    await query(
      "UPDATE classes SET deleted_at = NOW() WHERE id = $1 AND org_id = $2",
      [req.params.id, org.id]
    );
    ok(res, { deleted: true });
  } catch (e) { err(res, 500, e.message); }
});

// ════════════════════════════════════════════════════════════════════
// CLASS SESSIONS — one session = one class on one specific date
// ════════════════════════════════════════════════════════════════════

// GET  /api/v1/orgs/:orgId/classes/:classId/sessions
// Returns all sessions for a class, newest first.
// Each session row also includes how many students checked in.
api.get("/orgs/:orgId/classes/:classId/sessions", requireAuth, async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    const { rows } = await query(
      `SELECT cs.*,
              (SELECT COUNT(*) FROM class_attendance ca WHERE ca.session_id = cs.id) AS checkin_count
       FROM class_sessions cs
       WHERE cs.class_id = $1 AND cs.org_id = $2
       ORDER BY cs.session_date DESC, cs.session_time DESC`,
      [req.params.classId, org.id]
    );
    ok(res, rows);
  } catch (e) { err(res, 500, e.message); }
});

// POST /api/v1/orgs/:orgId/classes/:classId/sessions
// Create a new session (e.g. "Today's class")
api.post("/orgs/:orgId/classes/:classId/sessions", requireAuth, async (req, res) => {
  try {
    const data = SessionSchema.parse(req.body);
    const org  = await resolveOrg(req.params.orgId);
    const { rows } = await query(
      `INSERT INTO class_sessions (class_id, org_id, session_date, session_time, location, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.classId, org.id, data.session_date, data.session_time, data.location, data.notes, req.user.userId]
    );
    ok(res, rows[0]);
  } catch (e) { err(res, 400, e.message); }
});

// DELETE /api/v1/orgs/:orgId/classes/:classId/sessions/:sessionId
api.delete("/orgs/:orgId/classes/:classId/sessions/:sessionId", requireAuth, async (req, res) => {
  try {
    await query("DELETE FROM class_sessions WHERE id = $1", [req.params.sessionId]);
    ok(res, { deleted: true });
  } catch (e) { err(res, 500, e.message); }
});

// ════════════════════════════════════════════════════════════════════
// CLASS CHECK-IN (QR scan or manual)
// POST /api/v1/orgs/:orgId/classes/:classId/sessions/:sessionId/checkin
//
// KEY DIFFERENCE from events:
//   - The same student CAN check in to multiple sessions of the same class
//     (different dates). Each session has its own attendance record.
//   - But they CANNOT check in twice to the SAME session (unique constraint).
// ════════════════════════════════════════════════════════════════════

api.post(
  "/orgs/:orgId/classes/:classId/sessions/:sessionId/checkin",
  async (req, res) => {
    try {
      const data = ClassCheckinSchema.parse(req.body);
      const org  = await resolveOrg(req.params.orgId);

      // Resolve attendee by identifier or UUID
      let attendeeId = data.attendee_id;
      if (!attendeeId && data.identifier) {
        const { rows } = await query(
          `SELECT id FROM attendees
           WHERE org_id = $1 AND (identifier = $2 OR id::text = $2) AND deleted_at IS NULL`,
          [org.id, data.identifier]
        );
        if (!rows[0]) return err(res, 404, "Attendee not found");
        attendeeId = rows[0].id;
      }

      const { rows } = await query(
        `INSERT INTO class_attendance (session_id, attendee_id, method, checked_in_by, notes)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (session_id, attendee_id) DO NOTHING
         RETURNING *`,
        [req.params.sessionId, attendeeId, data.method, "system", data.notes]
      );

      if (!rows[0]) return err(res, 409, "Student already checked in to this session");
      ok(res, rows[0]);
    } catch (e) { err(res, 400, e.message); }
  }
);

// GET  /api/v1/orgs/:orgId/classes/:classId/sessions/:sessionId/attendance
// Who checked in to a specific session?
api.get(
  "/orgs/:orgId/classes/:classId/sessions/:sessionId/attendance",
  requireAuth,
  async (req, res) => {
    try {
      const { rows } = await query(
        `SELECT ca.*, at.name, at.identifier, at.group_label, at.email
         FROM class_attendance ca
         JOIN attendees at ON at.id = ca.attendee_id
         WHERE ca.session_id = $1
         ORDER BY ca.checked_in_at`,
        [req.params.sessionId]
      );
      ok(res, rows);
    } catch (e) { err(res, 500, e.message); }
  }
);

// DELETE /api/v1/orgs/:orgId/classes/.../attendance/:attendeeId
// Remove a check-in from a session
api.delete(
  "/orgs/:orgId/classes/:classId/sessions/:sessionId/attendance/:attendeeId",
  requireAuth,
  async (req, res) => {
    try {
      await query(
        "DELETE FROM class_attendance WHERE session_id = $1 AND attendee_id = $2",
        [req.params.sessionId, req.params.attendeeId]
      );
      ok(res, { deleted: true });
    } catch (e) { err(res, 500, e.message); }
  }
);

// ════════════════════════════════════════════════════════════════════
// STUDENT — View own class attendance across ALL sessions
// GET /api/v1/orgs/:orgId/attendees/:id/my-class-attendance
// Returns every session this student checked in to, grouped-friendly
// ════════════════════════════════════════════════════════════════════

api.get("/orgs/:orgId/attendees/:id/my-class-attendance", async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         ca.id,
         ca.checked_in_at,
         ca.method,
         cs.id         AS session_id,
         cs.session_date,
         cs.session_time,
         cs.location   AS session_location,
         c.id          AS class_id,
         c.name        AS class_name,
         c.code        AS class_code,
         c.group_label AS class_group
       FROM class_attendance ca
       JOIN class_sessions cs ON cs.id = ca.session_id
       JOIN classes c         ON c.id  = cs.class_id
       WHERE ca.attendee_id = $1
       ORDER BY cs.session_date DESC, ca.checked_in_at DESC`,
      [req.params.id]
    );
    ok(res, rows);
  } catch (e) { err(res, 500, e.message); }
});

// ════════════════════════════════════════════════════════════════════
// ADMIN/ORGANIZER — Full attendance sheet for a class (all sessions + all students)
// GET /api/v1/orgs/:orgId/classes/:classId/full-attendance
// Returns a pivot-friendly list: each row = student, with dates they attended
// ════════════════════════════════════════════════════════════════════

api.get("/orgs/:orgId/classes/:classId/full-attendance", requireAuth, async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);

    // All sessions for this class
    const { rows: sessions } = await query(
      `SELECT id, session_date, session_time, location
       FROM class_sessions WHERE class_id = $1 ORDER BY session_date`,
      [req.params.classId]
    );

    // All check-ins for this class
    const { rows: checkins } = await query(
      `SELECT ca.attendee_id, ca.session_id, ca.checked_in_at, ca.method,
              at.name, at.identifier, at.group_label, at.email
       FROM class_attendance ca
       JOIN attendees at ON at.id = ca.attendee_id
       JOIN class_sessions cs ON cs.id = ca.session_id
       WHERE cs.class_id = $1
       ORDER BY at.name`,
      [req.params.classId]
    );

    // Build a map: attendee_id -> { info, sessions_attended: Set }
    const studentMap = {};
    for (const row of checkins) {
      if (!studentMap[row.attendee_id]) {
        studentMap[row.attendee_id] = {
          attendee_id: row.attendee_id,
          name: row.name,
          identifier: row.identifier,
          group_label: row.group_label,
          email: row.email,
          sessions_attended: [],
        };
      }
      studentMap[row.attendee_id].sessions_attended.push({
        session_id: row.session_id,
        checked_in_at: row.checked_in_at,
        method: row.method,
      });
    }

    ok(res, {
      sessions,
      students: Object.values(studentMap),
    });
  } catch (e) { err(res, 500, e.message); }
});

// ════════════════════════════════════════════════════════════════════
// REPORTS — Export class attendance as CSV
// GET /api/v1/orgs/:orgId/classes/:classId/export?fmt=csv
// ════════════════════════════════════════════════════════════════════

api.get("/orgs/:orgId/classes/:classId/export", requireAuth, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         at.name, at.identifier, at.group_label, at.email,
         c.name AS class_name, c.code AS class_code,
         cs.session_date, cs.location,
         ca.checked_in_at, ca.method
       FROM class_attendance ca
       JOIN class_sessions cs ON cs.id = ca.session_id
       JOIN classes c         ON c.id  = cs.class_id
       JOIN attendees at      ON at.id = ca.attendee_id
       WHERE cs.class_id = $1
       ORDER BY cs.session_date ASC, at.name`,
      [req.params.classId]
    );

    const fmt = req.query.fmt || "json";
    if (fmt === "csv") {
      const header = ["Name","Identifier","Group","Email","Class","Code","Session Date","Location","Checked In At","Method"];
      const csvRows = rows.map(r => [
        r.name, r.identifier, r.group_label, r.email,
        r.class_name, r.class_code, r.session_date, r.location,
        r.checked_in_at, r.method
      ].join(","));
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename=class_attendance.csv`);
      res.send([header.join(","), ...csvRows].join("\n"));
    } else {
      ok(res, rows);
    }
  } catch (e) { err(res, 500, e.message); }
});

app.use("/api/v1", api);
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`AttendIQ API running on :${PORT}`));