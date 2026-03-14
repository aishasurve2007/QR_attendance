
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const { z } = require("zod");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
require("dotenv").config();


const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());

// ─── DB Pool ──────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // ← needs this for Supabase
  max: 10,
  idleTimeoutMillis: 30000,
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

// ─── Response helpers ─────────────────────────────────────────────────────────
function ok(res, data, meta = {}) {
  res.json({ data, error: null, meta });
}
function err(res, status, message) {
  res.status(status).json({ data: null, error: message, meta: {} });
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return err(res, 401, "Unauthorized");
  try {
    req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    next();
  } catch {
    err(res, 401, "Invalid token");
  }
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────
const OrgSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  attendee_label: z.string().optional(),
  identifier_label: z.string().optional(),
  group_label: z.string().optional(),
});

const AttendeeSchema = z.object({
  name: z.string().min(1),
  identifier: z.string().min(1),
  group_label: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

const EventSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  event_time: z.string().optional(),
  location: z.string().optional(),
  organizer: z.string().optional(),
  capacity: z.number().int().positive().optional(),
});

const CheckinSchema = z.object({
  identifier: z.string().optional(),
  attendee_id: z.string().uuid().optional(),
  method: z.enum(["qr", "manual", "nfc", "bulk"]).default("manual"),
  notes: z.string().optional(),
});

// ─── Auth routes ──────────────────────────────────────────────────────────────
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const { rows } = await query("SELECT * FROM admin_users WHERE email = $1", [email]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return err(res, 401, "Invalid credentials");
    }
    const token = jwt.sign({ userId: user.id, orgId: user.org_id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    ok(res, { token, orgId: user.org_id });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ─── API router ───────────────────────────────────────────────────────────────
const api = express.Router();
// Uncomment below to require auth on all API routes:
// api.use(requireAuth);

// ── Organizations ─────────────────────────────────────────────────────────────
api.post("/orgs", async (req, res) => {
  try {
    const data = OrgSchema.parse(req.body);
    const { rows } = await query(
      `INSERT INTO organizations (name, slug, attendee_label, identifier_label, group_label)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [data.name, data.slug, data.attendee_label || "Student", data.identifier_label || "Roll No.", data.group_label || "Department"]
    );
    ok(res, rows[0]);
  } catch (e) {
    err(res, 400, e.message);
  }
});

api.get("/orgs/:orgId", async (req, res) => {
  try {
    const orgIdOrSlug = req.params.orgId;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgIdOrSlug);
    const { rows } = await query(
      isUUID
        ? "SELECT * FROM organizations WHERE id = $1"
        : "SELECT * FROM organizations WHERE slug = $1",
      [orgIdOrSlug]
    );
    if (!rows[0]) return err(res, 404, "Organization not found");
    ok(res, rows[0]);
  } catch (e) {
    err(res, 500, e.message);
  }
});

api.patch("/orgs/:orgId", async (req, res) => {
  try {
    const orgIdOrSlug = req.params.orgId;
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgIdOrSlug);
    const { name, attendee_label, identifier_label, group_label } = req.body;
    const { rows } = await query(
      `UPDATE organizations SET
         name = COALESCE($2, name),
         attendee_label = COALESCE($3, attendee_label),
         identifier_label = COALESCE($4, identifier_label),
         group_label = COALESCE($5, group_label)
       WHERE ${isUUID ? "id" : "slug"} = $1 RETURNING *`,
      [orgIdOrSlug, name, attendee_label, identifier_label, group_label]
    );
    ok(res, rows[0]);
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ── Attendees ─────────────────────────────────────────────────────────────────
api.get("/orgs/:orgId/attendees", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const org = await resolveOrg(req.params.orgId);
    const { rows } = await query(
      `SELECT * FROM attendees WHERE org_id = $1 AND deleted_at IS NULL ORDER BY name LIMIT $2 OFFSET $3`,
      [org.id, limit, offset]
    );
    const count = await query("SELECT COUNT(*) FROM attendees WHERE org_id = $1 AND deleted_at IS NULL", [org.id]);
    ok(res, rows, { total: parseInt(count.rows[0].count), page, limit });
  } catch (e) {
    err(res, 500, e.message);
  }
});

api.post("/orgs/:orgId/attendees", async (req, res) => {
  try {
    const data = AttendeeSchema.parse(req.body);
    const org = await resolveOrg(req.params.orgId);
    const { rows } = await query(
      `INSERT INTO attendees (org_id, name, identifier, group_label, email, phone, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [org.id, data.name, data.identifier, data.group_label, data.email, data.phone, JSON.stringify(data.metadata || {})]
    );
    ok(res, rows[0]);
  } catch (e) {
    err(res, 400, e.message);
  }
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
        const { rows } = await query(
          `INSERT INTO attendees (org_id, name, identifier, group_label, email, phone)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (org_id, identifier) DO UPDATE SET name = EXCLUDED.name RETURNING *`,
          [org.id, parsed.name, parsed.identifier, parsed.group_label, parsed.email, parsed.phone]
        );
        created.push(rows[0]);
      } catch {}
    }
    ok(res, created, { imported: created.length });
  } catch (e) {
    err(res, 400, e.message);
  }
});

api.get("/orgs/:orgId/attendees/:id", async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    const { rows } = await query(
      "SELECT * FROM attendees WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL",
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
  } catch (e) {
    err(res, 500, e.message);
  }
});

api.put("/orgs/:orgId/attendees/:id", async (req, res) => {
  try {
    const data = AttendeeSchema.partial().parse(req.body);
    const org = await resolveOrg(req.params.orgId);
    const { rows } = await query(
      `UPDATE attendees SET
         name = COALESCE($3, name), identifier = COALESCE($4, identifier),
         group_label = COALESCE($5, group_label), email = COALESCE($6, email)
       WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL RETURNING *`,
      [req.params.id, org.id, data.name, data.identifier, data.group_label, data.email]
    );
    ok(res, rows[0]);
  } catch (e) {
    err(res, 400, e.message);
  }
});

api.delete("/orgs/:orgId/attendees/:id", async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    await query(
      "UPDATE attendees SET deleted_at = NOW() WHERE id = $1 AND org_id = $2",
      [req.params.id, org.id]
    );
    ok(res, { deleted: true });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ── Events ────────────────────────────────────────────────────────────────────
api.get("/orgs/:orgId/events", async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    let whereClause = "WHERE org_id = $1";
    if (req.query.upcoming === "true") whereClause += " AND event_date >= CURRENT_DATE";
    if (req.query.past === "true") whereClause += " AND event_date < CURRENT_DATE";
    const { rows } = await query(
      `SELECT * FROM events ${whereClause} ORDER BY event_date DESC`,
      [org.id]
    );
    ok(res, rows);
  } catch (e) {
    err(res, 500, e.message);
  }
});

api.post("/orgs/:orgId/events", async (req, res) => {
  try {
    const data = EventSchema.parse(req.body);
    const org = await resolveOrg(req.params.orgId);
    const { rows } = await query(
      `INSERT INTO events (org_id, name, description, event_date, event_time, location, organizer, capacity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [org.id, data.name, data.description, data.event_date, data.event_time, data.location, data.organizer, data.capacity]
    );
    ok(res, rows[0]);
  } catch (e) {
    err(res, 400, e.message);
  }
});

api.get("/orgs/:orgId/events/:id", async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    const { rows } = await query(
      "SELECT * FROM events WHERE id = $1 AND org_id = $2",
      [req.params.id, org.id]
    );
    if (!rows[0]) return err(res, 404, "Event not found");
    const summary = await query(
      "SELECT COUNT(*) AS total FROM attendance WHERE event_id = $1",
      [req.params.id]
    );
    ok(res, { ...rows[0], attendance_count: parseInt(summary.rows[0].total) });
  } catch (e) {
    err(res, 500, e.message);
  }
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
  } catch (e) {
    err(res, 400, e.message);
  }
});

api.delete("/orgs/:orgId/events/:id", async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    await query("DELETE FROM events WHERE id = $1 AND org_id = $2", [req.params.id, org.id]);
    ok(res, { deleted: true });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ── Attendance / Check-in ─────────────────────────────────────────────────────
api.post("/orgs/:orgId/events/:id/checkin", async (req, res) => {
  try {
    const data = CheckinSchema.parse(req.body);
    const org = await resolveOrg(req.params.orgId);

    let attendeeId = data.attendee_id;
    if (!attendeeId && data.identifier) {
      const { rows } = await query(
        "SELECT id FROM attendees WHERE org_id = $1 AND identifier = $2 AND deleted_at IS NULL",
        [org.id, data.identifier]
      );
      if (!rows[0]) return err(res, 404, "Attendee not found");
      attendeeId = rows[0].id;
    }

    const { rows } = await query(
      `INSERT INTO attendance (event_id, attendee_id, method, checked_in_by, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id, attendee_id) DO NOTHING RETURNING *`,
      [req.params.id, attendeeId, data.method, req.user?.userId || "system", data.notes]
    );
    if (!rows[0]) return err(res, 409, "Already checked in");
    ok(res, rows[0]);
  } catch (e) {
    err(res, 400, e.message);
  }
});

api.post("/orgs/:orgId/events/:id/checkin/bulk", async (req, res) => {
  try {
    const { identifiers } = req.body;
    const org = await resolveOrg(req.params.orgId);
    const results = { success: [], failed: [] };
    for (const identifier of identifiers) {
      try {
        const { rows: att } = await query(
          "SELECT id FROM attendees WHERE org_id = $1 AND identifier = $2 AND deleted_at IS NULL",
          [org.id, identifier]
        );
        if (!att[0]) { results.failed.push({ identifier, reason: "Not found" }); continue; }
        await query(
          "INSERT INTO attendance (event_id, attendee_id, method) VALUES ($1, $2, 'bulk') ON CONFLICT DO NOTHING",
          [req.params.id, att[0].id]
        );
        results.success.push(identifier);
      } catch (e) {
        results.failed.push({ identifier, reason: e.message });
      }
    }
    ok(res, results);
  } catch (e) {
    err(res, 400, e.message);
  }
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
  } catch (e) {
    err(res, 500, e.message);
  }
});

api.delete("/orgs/:orgId/events/:id/attendance/:attId", async (req, res) => {
  try {
    await query("DELETE FROM attendance WHERE event_id = $1 AND attendee_id = $2", [req.params.id, req.params.attId]);
    ok(res, { deleted: true });
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ── Reports ───────────────────────────────────────────────────────────────────
api.get("/orgs/:orgId/reports/summary", async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    const [atts, evts, checkins] = await Promise.all([
      query("SELECT COUNT(*) FROM attendees WHERE org_id = $1 AND deleted_at IS NULL", [org.id]),
      query("SELECT COUNT(*) FROM events WHERE org_id = $1", [org.id]),
      query("SELECT COUNT(*) FROM attendance a JOIN events e ON e.id = a.event_id WHERE e.org_id = $1", [org.id]),
    ]);
    ok(res, {
      total_attendees: parseInt(atts.rows[0].count),
      total_events: parseInt(evts.rows[0].count),
      total_checkins: parseInt(checkins.rows[0].count),
    });
  } catch (e) {
    err(res, 500, e.message);
  }
});

api.get("/orgs/:orgId/reports/export", async (req, res) => {
  try {
    const org = await resolveOrg(req.params.orgId);
    const fmt = req.query.fmt || "json";
    let sql = `
      SELECT at.name, at.identifier, at.group_label, at.email,
             e.name AS event_name, a.checked_in_at, a.method
      FROM attendance a
      JOIN attendees at ON at.id = a.attendee_id
      JOIN events e ON e.id = a.event_id
      WHERE e.org_id = $1
    `;
    const params = [org.id];
    if (req.query.eventId) { sql += " AND e.id = $2"; params.push(req.query.eventId); }
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
  } catch (e) {
    err(res, 500, e.message);
  }
});

// ─── Helper ───────────────────────────────────────────────────────────────────
async function resolveOrg(orgIdOrSlug) {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgIdOrSlug);
  const { rows } = await query(
    isUUID
      ? "SELECT * FROM organizations WHERE id = $1"
      : "SELECT * FROM organizations WHERE slug = $1",
    [orgIdOrSlug]
  );
  if (!rows[0]) throw new Error("Organization not found");
  return rows[0];
}

app.use("/api/v1", api);

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`AttendIQ API running on :${PORT}`));
