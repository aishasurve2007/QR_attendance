// seed.js — run with: node seed.js
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Create demo org
    const { rows: [org] } = await client.query(`
      INSERT INTO organizations (name, slug, attendee_label, identifier_label, group_label)
      VALUES ('AttendIQ College', 'demo-org', 'Student', 'Roll No.', 'Department')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING *
    `);
    console.log("✓ Organization:", org.name, `(${org.id})`);

    // Create 10 attendees
    const attendees = [
      { name: "Aisha Rahman",  identifier: "CS2021001", group_label: "Computer Science",        email: "aisha@college.edu" },
      { name: "Marcus Chen",   identifier: "EE2021042", group_label: "Electrical Engineering",   email: "marcus@college.edu" },
      { name: "Priya Nair",    identifier: "ME2022015", group_label: "Mechanical Engineering",   email: "priya@college.edu" },
      { name: "James Okafor",  identifier: "CS2022008", group_label: "Computer Science",         email: "james@college.edu" },
      { name: "Sofia Mendez",  identifier: "BIO2021031",group_label: "Biotechnology",            email: "sofia@college.edu" },
      { name: "Yuki Tanaka",   identifier: "CS2023017", group_label: "Computer Science",         email: "yuki@college.edu" },
      { name: "Carlos Rivera", identifier: "ME2021009", group_label: "Mechanical Engineering",   email: "carlos@college.edu" },
      { name: "Fatima Al-Said",identifier: "BIO2022044",group_label: "Biotechnology",            email: "fatima@college.edu" },
      { name: "Liam O'Brien",  identifier: "EE2023005", group_label: "Electrical Engineering",   email: "liam@college.edu" },
      { name: "Nadia Petrov",  identifier: "CS2021055", group_label: "Computer Science",         email: "nadia@college.edu" },
    ];

    const attIds = [];
    for (const a of attendees) {
      const { rows: [row] } = await client.query(`
        INSERT INTO attendees (org_id, name, identifier, group_label, email)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (org_id, identifier) DO UPDATE SET name = EXCLUDED.name RETURNING id
      `, [org.id, a.name, a.identifier, a.group_label, a.email]);
      attIds.push(row.id);
    }
    console.log(`✓ ${attIds.length} attendees seeded`);

    // Create 3 events
    const events = [
      { name: "Tech Summit 2025",      event_date: "2025-03-15", event_time: "10:00", location: "Main Auditorium",  organizer: "CS Dept" },
      { name: "Cultural Fest Opening", event_date: "2025-03-18", event_time: "18:00", location: "Open Air Theatre", organizer: "Student Council" },
      { name: "Research Symposium",    event_date: "2025-03-20", event_time: "09:00", location: "Conference Hall B",organizer: "Research Cell" },
    ];

    const evtIds = [];
    for (const e of events) {
      const { rows: [row] } = await client.query(`
        INSERT INTO events (org_id, name, event_date, event_time, location, organizer)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id
      `, [org.id, e.name, e.event_date, e.event_time, e.location, e.organizer]);
      evtIds.push(row.id);
    }
    console.log(`✓ ${evtIds.length} events seeded`);

    // Sample attendance
    const checkIns = [
      [evtIds[0], attIds[0]], [evtIds[0], attIds[1]], [evtIds[0], attIds[5]],
      [evtIds[1], attIds[0]], [evtIds[1], attIds[2]], [evtIds[1], attIds[6]],
      [evtIds[2], attIds[3]], [evtIds[2], attIds[7]], [evtIds[2], attIds[8]],
    ];

    for (const [evtId, attId] of checkIns) {
      await client.query(`
        INSERT INTO attendance (event_id, attendee_id, method)
        VALUES ($1, $2, 'manual') ON CONFLICT DO NOTHING
      `, [evtId, attId]);
    }
    console.log(`✓ ${checkIns.length} attendance records seeded`);

    await client.query("COMMIT");
    console.log("\n🎉 Seed complete! Demo org slug: demo-org");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", e.message);
  } finally {
    client.release();
    pool.end();
  }
}

seed();
