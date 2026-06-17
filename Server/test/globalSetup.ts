import { execSync } from "child_process";
import { Pool } from "pg";

const CONTAINER_NAME = "wedding-rsvp-test-db";
export const PG_PORT = 5433;
export const PG_PASSWORD = "test";
export const PG_DB = "wedding_test";
export const PG_USER = "postgres";
export const DATABASE_URL = `postgres://${PG_USER}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}`;

async function waitForPostgres(retries = 30): Promise<void> {
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query("SELECT 1");
      await pool.end();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error("Postgres did not become ready after 15 seconds");
}

async function createTables(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "users" (
      "userID" TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      primary_user_id TEXT REFERENCES users("userID") ON DELETE SET NULL,
      invite_code TEXT UNIQUE,
      invite_code_expires_at TIMESTAMP WITH TIME ZONE
    );`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "clientLogs" (
      id SERIAL PRIMARY KEY,
      "userID" TEXT REFERENCES users("userID") ON DELETE CASCADE,
      message TEXT NOT NULL,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "tasks" (
      task_id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users("userID") ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      timeline_group VARCHAR(50) NOT NULL,
      is_completed BOOLEAN NOT NULL DEFAULT FALSE,
      priority INTEGER DEFAULT 2 CHECK (priority IN (1,2,3)),
      assignee VARCHAR(20) DEFAULT 'both' CHECK (assignee IN ('bride','groom','both')),
      sort_order INTEGER,
      info TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
    );`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "budget_categories" (
      category_id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users("userID") ON DELETE CASCADE,
      name VARCHAR(50) NOT NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, name)
    );`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "vendors" (
      vendor_id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users("userID") ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      job_title VARCHAR(100),
      category_id INTEGER NOT NULL REFERENCES budget_categories(category_id) ON DELETE CASCADE,
      agreed_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL,
      phone VARCHAR(50),
      email VARCHAR(255),
      notes TEXT,
      is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "payments" (
      payment_id SERIAL PRIMARY KEY,
      vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
      amount DECIMAL(12,2) NOT NULL,
      payment_date DATE NOT NULL,
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "vendor_files" (
      file_id SERIAL PRIMARY KEY,
      vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
      file_name VARCHAR(255) NOT NULL,
      file_type VARCHAR(100) NOT NULL,
      file_size INTEGER NOT NULL,
      file_data BYTEA NOT NULL,
      uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guests (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users("userID") ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      whose TEXT NOT NULL,
      circle TEXT NOT NULL,
      number_of_guests INTEGER NOT NULL DEFAULT 1,
      UNIQUE(user_id, phone)
    );`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users("userID") ON DELETE CASCADE,
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      ceremony_name TEXT NOT NULL,
      date TEXT,
      time TEXT,
      location TEXT,
      additional_info TEXT,
      file_id TEXT,
      bride_name TEXT,
      groom_name TEXT,
      waze_link TEXT,
      gift_link TEXT,
      thank_you_message TEXT,
      send_reminder BOOLEAN DEFAULT FALSE,
      reminder_day TEXT CHECK (reminder_day IN ('day_before','wedding_day')),
      reminder_time TIME,
      send_thank_you BOOLEAN DEFAULT FALSE,
      estimated_guests INTEGER DEFAULT 0,
      total_budget DECIMAL(12,2) DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    );`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_guests (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      rsvp_status INTEGER,
      last_rsvp_sent_at TIMESTAMP WITH TIME ZONE,
      UNIQUE(event_id, guest_id)
    );`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_token (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      access_token TEXT NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );`);
}

async function seedData(pool: Pool): Promise<void> {
  // TRUNCATE with RESTART IDENTITY resets auto-increment sequences so IDs
  // are always 1 on every test run, regardless of how many times tests ran.
  await pool.query(`TRUNCATE event_guests, events, guests, "clientLogs", users RESTART IDENTITY CASCADE;`);

  await pool.query(
    `INSERT INTO users ("userID", email, name) VALUES ($1, $2, $3)`,
    ["test-user-id", "test@test.com", "Test User"],
  );

  // guest phone must match what the webhook derives: "+" + message.from
  const { rows: [guest] } = await pool.query(
    `INSERT INTO guests (user_id, name, phone, whose, circle, number_of_guests)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    ["test-user-id", "Test Guest", "+972501234567", "bride", "family", 1],
  );

  const { rows: [event] } = await pool.query(
    `INSERT INTO events (user_id, is_primary, ceremony_name, date, bride_name, groom_name, location)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    ["test-user-id", true, "חתונה", "2027-01-01", "כלה", "חתן", "תל אביב"],
  );

  // Basic test guest → wedding only
  await pool.query(
    `INSERT INTO event_guests (event_id, guest_id, rsvp_status, last_rsvp_sent_at)
     VALUES ($1, $2, NULL, NOW())`,
    [event.id, guest.id],
  );

  // ── Multi-event guests ──────────────────────────────────────────────────────
  // Henna event (non-primary, id=2)
  const { rows: [hennaEvent] } = await pool.query(
    `INSERT INTO events (user_id, is_primary, ceremony_name, date, bride_name, groom_name, location)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    ["test-user-id", false, "חינה", "2026-12-31", "כלה", "חתן", "תל אביב"],
  );

  // Alice (id=2) — wedding + henna
  const { rows: [alice] } = await pool.query(
    `INSERT INTO guests (user_id, name, phone, whose, circle, number_of_guests)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    ["test-user-id", "Alice", "+972501111111", "bride", "family", 1],
  );

  // Bob (id=3) — wedding + henna
  const { rows: [bob] } = await pool.query(
    `INSERT INTO guests (user_id, name, phone, whose, circle, number_of_guests)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    ["test-user-id", "Bob", "+972502222222", "groom", "family", 1],
  );

  // Clare (id=4) — wedding only
  const { rows: [clare] } = await pool.query(
    `INSERT INTO guests (user_id, name, phone, whose, circle, number_of_guests)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    ["test-user-id", "Clare", "+972503333333", "bride", "friends", 1],
  );

  // event_guests: Alice + Bob + Clare → wedding; Alice + Bob → henna
  await pool.query(
    `INSERT INTO event_guests (event_id, guest_id) VALUES
     ($1,$2), ($1,$3), ($1,$4),
     ($5,$2), ($5,$3)`,
    [event.id, alice.id, bob.id, clare.id, hennaEvent.id],
  );

  console.log(`✅ Seeded: wedding id=${event.id}, henna id=${hennaEvent.id}`);
  console.log(`   Guests: basic=${guest.id}, alice=${alice.id}, bob=${bob.id}, clare=${clare.id}`);
}

function isContainerRunning(): boolean {
  try {
    const out = execSync(`docker inspect -f '{{.State.Running}}' ${CONTAINER_NAME}`, { stdio: "pipe" })
      .toString()
      .trim();
    return out === "true";
  } catch {
    return false;
  }
}

export default async function globalSetup() {
  if (isContainerRunning()) {
    console.log("\n✅ Test Postgres container already running — skipping docker start.");
  } else {
    console.log("\n🐳 Starting test Postgres container...");

    // Remove any stopped leftover from a previous run
    try {
      execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: "pipe" });
    } catch {
      // Container didn't exist — that's fine
    }

    execSync(
      `docker run -d --name ${CONTAINER_NAME} \
        -e POSTGRES_PASSWORD=${PG_PASSWORD} \
        -e POSTGRES_DB=${PG_DB} \
        -p ${PG_PORT}:5432 \
        postgres:16`,
      { stdio: "inherit" },
    );

    console.log("⏳ Waiting for Postgres to be ready...");
    await waitForPostgres();
    console.log("✅ Postgres is ready.");
  }

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });
  await createTables(pool);
  await seedData(pool);
  await pool.end();
}
