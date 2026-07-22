import {
  Guest,
  User,
  Event,
  EventGuest,
  RsvpFilter,
  ClientLog,
  Task,
  DefaultTask,
  BudgetCategory,
  Vendor,
  VendorStatus,
  Payment,
  VendorWithPayments,
  BudgetCategoryWithSpending,
  BudgetOverview,
  VendorFile,
} from "./types";
import defaultTasks from "./defaultTasks.json";
import { getDateStrings } from "./dateUtils";
import { Pool } from "pg";
import { loadUserNames, setUserName, removeUserName, log, logError } from "./logger";

require("dotenv").config({ path: ".server.env" });

const dbUrl = process.env.DATABASE_URL || "";
const needsSSL =
  dbUrl.includes("aivencloud.com") ||
  dbUrl.includes("neon.tech") ||
  dbUrl.includes("sslmode=require") ||
  process.env.NODE_ENV === "production";

const pool = new Pool({
  connectionString: dbUrl.replace(/[?&]sslmode=require/g, ""),
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
});
const guestColumns = `id, user_id, name, phone, whose, circle, number_of_guests`;
const USER_NAME_CACHE_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

class Database {
  private static instance: Database | null = null;
  private static connectPromise: Promise<Database> | null = null;

  // Private constructor to prevent direct instantiation
  private constructor() { }

  // Static method to get the singleton instance
  static getInstance(): Database | null {
    return Database.instance;
  }

  // Static method to create and initialize the database instance.
  // Uses a shared promise so concurrent callers share one initialization
  // instead of racing to CREATE TABLE simultaneously on a fresh database.
  static async connect(): Promise<Database> {
    if (Database.instance) return Database.instance;
    if (!Database.connectPromise) {
      Database.connectPromise = (async () => {
        const db = new Database();
        await db.initializeTables();
        await db.refreshUserNameCache();
        // Belt-and-suspenders: addUser/deleteUser keep the cache in sync as
        // they happen, but this catches any drift (e.g. a name edited
        // directly in the DB) so the cache is never stale for more than a day.
        setInterval(() => db.refreshUserNameCache(), USER_NAME_CACHE_REFRESH_INTERVAL_MS).unref();
        Database.instance = db;
        return db;
      })();
    }
    return Database.connectPromise;
  }

  private async refreshUserNameCache(): Promise<void> {
    const users = await this.runQuery(`SELECT "userID", name FROM users;`, []);
    loadUserNames(users);
  }

  private async initializeTables(): Promise<void> {
    // ── Core structural tables (never dropped) ──────────────────────────────
    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS "users" (
        "userID" TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        primary_user_id TEXT REFERENCES users("userID") ON DELETE SET NULL,
        invite_code TEXT UNIQUE,
        invite_code_expires_at TIMESTAMP WITH TIME ZONE
      );`, []);

    // Existing rows are grandfathered as 'approved' via the column DEFAULT;
    // new sign-ups explicitly insert 'pending' (see addUser below).
    await this.runQuery(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'
        CHECK (status IN ('pending', 'approved', 'declined'));`, []);

    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS "clientLogs" (
        id SERIAL PRIMARY KEY,
        "userID" TEXT REFERENCES users("userID") ON DELETE CASCADE,
        message TEXT NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );`, []);

    await this.runQuery(`
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
      );`, []);

    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS "budget_categories" (
        category_id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users("userID") ON DELETE CASCADE,
        name VARCHAR(50) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, name)
      );`, []);

    await this.runQuery(`
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
      );`, []);

    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS "payments" (
        payment_id SERIAL PRIMARY KEY,
        vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
        amount DECIMAL(12,2) NOT NULL,
        payment_date DATE NOT NULL,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );`, []);

    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS "vendor_files" (
        file_id SERIAL PRIMARY KEY,
        vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        file_type VARCHAR(100) NOT NULL,
        file_size INTEGER NOT NULL,
        file_data BYTEA NOT NULL,
        uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );`, []);

    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS guests (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users("userID") ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone TEXT,
        whose TEXT NOT NULL,
        circle TEXT NOT NULL,
        number_of_guests INTEGER NOT NULL DEFAULT 1,
        UNIQUE(user_id, phone)
      );`, []);

    // Guests without a cellphone (couple still wants them in the guest count,
    // but they can't receive WhatsApp invites) — phone must be nullable.
    // Postgres treats multiple NULLs as non-duplicates under UNIQUE(user_id, phone),
    // so no constraint change is needed alongside this.
    await this.runQuery(`ALTER TABLE guests ALTER COLUMN phone DROP NOT NULL;`, []);

    // events — wedding (is_primary=true) and any other ceremony
    await this.runQuery(`
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
      );`, []);

    // event_guests — per-event RSVP, links to guests
    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS event_guests (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
        rsvp_status INTEGER,
        last_rsvp_sent_at TIMESTAMP WITH TIME ZONE,
        UNIQUE(event_id, guest_id)
      );`, []);

    // 60-day post-wedding data retention: warning email + hard-delete tracking
    // on the primary event, and a standalone audit trail that outlives the
    // deleted user row.
    await this.runQuery(`
      ALTER TABLE events ADD COLUMN IF NOT EXISTS deletion_warning_sent_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;`, []);
    await this.runQuery(`
      ALTER TABLE events ADD COLUMN IF NOT EXISTS deletion_cancelled_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;`, []);

    await this.runQuery(`
      CREATE TABLE IF NOT EXISTS deleted_accounts (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        email TEXT,
        name TEXT,
        wedding_date TEXT,
        role TEXT NOT NULL CHECK (role IN ('owner','partner')),
        deleted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );`, []);
  }

  // Add or update user (Google login). Returns whether the row was newly
  // created and the user's current approval status (untouched on repeat logins).
  async addUser(
    { userID, email, name }: User,
    initialStatus: "pending" | "approved",
  ): Promise<{ isNewUser: boolean; status: string }> {
    const existingUser = await this.runQuery(
      `SELECT status FROM users WHERE "userID" = $1`,
      [userID],
    );
    const isNewUser = existingUser.length === 0;

    const query = `
    INSERT INTO users ("userID", email, name, status)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT ("userID")
    DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
    RETURNING status;
  `;
    const values = [userID, email, name, initialStatus];
    const result = await this.runQuery(query, values);
    setUserName(userID, name);
    return { isNewUser, status: result[0].status };
  }

  async updateUserStatus(
    userID: string,
    status: "pending" | "approved" | "declined",
  ): Promise<void> {
    await this.runQuery(`UPDATE users SET status = $1 WHERE "userID" = $2`, [
      status,
      userID,
    ]);
  }

  async getUsersByStatus(status: string): Promise<User[]> {
    const query = `
      SELECT "userID", email, name, status
      FROM users
      WHERE status = $1
      ORDER BY name;
    `;
    return this.runQuery(query, [status]);
  }

  // Populate default tasks for a new user
  async populateDefaultTasks(userID: string): Promise<void> {
    const tasks = defaultTasks as DefaultTask[];

    if (tasks.length === 0) return;

    const values: any[] = [];
    const placeholders = tasks
      .map((task, index) => {
        values.push(
          userID,
          task.title,
          task.timeline_group,
          index,
          task.assignee || "both",
          task.info,
        );
        const offset = index * 6;
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4
          }, $${offset + 5}, $${offset + 6})`;
      })
      .join(", ");

    const query = `
      INSERT INTO tasks (user_id, title, timeline_group, sort_order, assignee, info)
      VALUES ${placeholders};
    `;

    await this.runQuery(query, values);
  }

  // ==================== Guest Methods ====================

  async getGuests(userID: string): Promise<Guest[]> {
    return this.runQuery(
      `SELECT ${guestColumns} FROM guests WHERE user_id = $1 ORDER BY name ASC;`,
      [userID],
    );
  }

  async addGuests(userID: string, guests: Pick<Guest, "name" | "phone" | "whose" | "circle" | "number_of_guests">[]): Promise<Guest[]> {
    if (guests.length === 0) return [];
    const values: any[] = [];
    const placeholders = guests.map((g, i) => {
      values.push(userID, g.name, g.phone || null, g.whose, g.circle, g.number_of_guests);
      const o = i * 6;
      return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6})`;
    }).join(", ");
    return this.runQuery(
      `INSERT INTO guests (user_id,name,phone,whose,circle,number_of_guests) VALUES ${placeholders}
       ON CONFLICT (user_id,phone) DO UPDATE SET name=EXCLUDED.name,whose=EXCLUDED.whose,circle=EXCLUDED.circle,number_of_guests=EXCLUDED.number_of_guests
       RETURNING ${guestColumns};`,
      values,
    );
  }

  async updateGuest(
    userID: string,
    guestId: number,
    updates: Pick<Guest, "name" | "phone" | "whose" | "circle" | "number_of_guests">,
  ): Promise<Guest | undefined> {
    const rows = await this.runQuery(
      `UPDATE guests SET name=$1, phone=$2, whose=$3, circle=$4, number_of_guests=$5
       WHERE id=$6 AND user_id=$7
       RETURNING ${guestColumns};`,
      [updates.name, updates.phone || null, updates.whose, updates.circle, updates.number_of_guests, guestId, userID],
    );
    return rows[0];
  }

  async deleteGuest(userID: string, guestId: number): Promise<void> {
    await this.runQuery(`DELETE FROM guests WHERE id=$1 AND user_id=$2;`, [guestId, userID]);
  }

  async deleteAllGuests(userID: string): Promise<void> {
    await this.runQuery(`DELETE FROM guests WHERE user_id=$1;`, [userID]);
  }

  async deleteUser(userID: User["userID"]): Promise<any> {
    const result = await this.runQuery(`DELETE FROM "users" WHERE "userID" = $1;`, [userID]);
    removeUserName(userID);
    return result;
  }

  // ==================== Event Methods ====================

  async getPrimaryEvent(userID: string): Promise<Event | null> {
    const rows = await this.runQuery(
      `SELECT * FROM events WHERE user_id=$1 AND is_primary=TRUE LIMIT 1;`,
      [userID],
    );
    return rows[0] ?? null;
  }

  async getEvents(userID: string): Promise<Event[]> {
    return this.runQuery(
      `SELECT * FROM events WHERE user_id=$1 ORDER BY is_primary DESC, created_at ASC;`,
      [userID],
    );
  }

  async getEventById(eventId: number): Promise<Event | null> {
    const rows = await this.runQuery(`SELECT * FROM events WHERE id=$1;`, [eventId]);
    return rows[0] ?? null;
  }

  async createEvent(userID: string, event: Omit<Event, "id" | "user_id" | "created_at">): Promise<Event> {
    const e = event;
    const rows = await this.runQuery(
      `INSERT INTO events
         (user_id,is_primary,ceremony_name,date,time,location,additional_info,file_id,
          bride_name,groom_name,waze_link,gift_link,thank_you_message,
          send_reminder,reminder_day,reminder_time,send_thank_you,estimated_guests,total_budget)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *;`,
      [userID, e.is_primary ?? false, e.ceremony_name,
        e.date ?? null, e.time ?? null, e.location ?? null, e.additional_info ?? null, e.file_id ?? null,
        e.bride_name ?? null, e.groom_name ?? null, e.waze_link ?? null, e.gift_link ?? null, e.thank_you_message ?? null,
        e.send_reminder ?? false, e.reminder_day ?? null, e.reminder_time ?? null, e.send_thank_you ?? false,
        e.estimated_guests ?? 0, e.total_budget ?? 0],
    );
    return rows[0];
  }

  async updateEvent(eventId: number, updates: Partial<Omit<Event, "id" | "user_id" | "created_at">>): Promise<Event | null> {
    const fields = Object.keys(updates);
    if (fields.length === 0) return this.getEventById(eventId);
    // Postponing/moving the wedding date restarts the 60-day deletion countdown.
    const clearsDeletionWarning = fields.includes("date");
    const setClauses = fields.map((f, i) => `${f}=$${i + 2}`)
      .concat(clearsDeletionWarning ? ["deletion_warning_sent_at=NULL"] : [])
      .join(", ");
    const values = [eventId, ...fields.map(f => (updates as any)[f])];
    const rows = await this.runQuery(
      `UPDATE events SET ${setClauses} WHERE id=$1 RETURNING *;`,
      values,
    );
    return rows[0] ?? null;
  }

  async updateEventFileId(eventId: number, fileId: string): Promise<void> {
    await this.runQuery(`UPDATE events SET file_id=$1 WHERE id=$2;`, [fileId, eventId]);
  }

  async deleteEvent(eventId: number): Promise<void> {
    await this.runQuery(`DELETE FROM events WHERE id=$1;`, [eventId]);
  }

  /** Returns events where a scheduled message (reminder or thank-you) might need sending today. */
  async getEventsForScheduledMessages(): Promise<Event[]> {
    const { today, tomorrow, yesterday } = getDateStrings();
    return this.runQuery(
      `SELECT * FROM events WHERE (send_reminder=TRUE OR send_thank_you=TRUE)
       AND (date=$1 OR date=$2 OR date=$3);`,
      [today, tomorrow, yesterday],
    );
  }

  // ==================== EventGuest Methods ====================

  async addEventGuests(eventId: number, guestIds: number[]): Promise<void> {
    if (guestIds.length === 0) return;
    const values: any[] = [];
    const placeholders = guestIds.map((id, i) => {
      values.push(eventId, id);
      return `($${i * 2 + 1},$${i * 2 + 2})`;
    }).join(", ");
    await this.runQuery(
      `INSERT INTO event_guests (event_id,guest_id) VALUES ${placeholders} ON CONFLICT (event_id,guest_id) DO NOTHING;`,
      values,
    );
  }

  async removeEventGuests(eventId: number, guestIds: number[]): Promise<void> {
    if (guestIds.length === 0) return;
    await this.runQuery(
      `DELETE FROM event_guests WHERE event_id=$1 AND guest_id=ANY($2);`,
      [eventId, guestIds],
    );
  }

  async getEventGuests(eventId: number, filter?: RsvpFilter): Promise<EventGuest[]> {
    let where = `eg.event_id=$1`;
    if (filter === "pending") where += ` AND eg.rsvp_status IS NULL`;
    if (filter === "approved") where += ` AND eg.rsvp_status > 0`;
    if (filter === "declined") where += ` AND eg.rsvp_status = 0`;
    return this.runQuery(
      `SELECT eg.id,eg.event_id,eg.guest_id,eg.rsvp_status,eg.last_rsvp_sent_at,
              g.name,g.phone,g.whose,g.circle,g.number_of_guests,g.user_id
       FROM event_guests eg
       JOIN guests g ON g.id=eg.guest_id
       WHERE ${where}
       ORDER BY g.name ASC;`,
      [eventId],
    );
  }

  async updateEventGuestRsvp(eventId: number, guestId: number, rsvpStatus: number | null): Promise<void> {
    await this.runQuery(
      `UPDATE event_guests SET rsvp_status=$1 WHERE event_id=$2 AND guest_id=$3;`,
      [rsvpStatus, eventId, guestId],
    );
  }

  async updateEventGuestLastRsvpSentAt(eventId: number, guestIds: number[]): Promise<void> {
    if (guestIds.length === 0) return;
    await this.runQuery(
      `UPDATE event_guests SET last_rsvp_sent_at=CURRENT_TIMESTAMP WHERE event_id=$1 AND guest_id=ANY($2);`,
      [eventId, guestIds],
    );
  }

  /** Used by the webhook to route an incoming reply to the right wedding/event. */
  async getAllRsvpCandidatesByPhone(phone: string): Promise<Array<{
    type: "wedding" | "event";
    eventId: number;
    guestId: number;
    phone: string;
    userID: string;
    guestName: string;
    lastRsvpSentAt: Date | null;
  }>> {
    const rows = await this.runQuery(
      `SELECT eg.event_id, eg.guest_id, eg.last_rsvp_sent_at,
              g.user_id, g.name as guest_name,
              e.is_primary
       FROM event_guests eg
       JOIN guests g ON g.id = eg.guest_id
       JOIN events e ON e.id = eg.event_id
       WHERE g.phone = $1;`,
      [phone],
    );
    return rows.map((row: any) => ({
      type: row.is_primary ? "wedding" as const : "event" as const,
      eventId: row.event_id,
      guestId: row.guest_id,
      phone,
      userID: row.user_id,
      guestName: row.guest_name,
      lastRsvpSentAt: row.last_rsvp_sent_at ? new Date(row.last_rsvp_sent_at) : null,
    }));
  }

  // Add a log entry
  async addClientLog(userID: string | null, message: string): Promise<void> {
    const query = `
      INSERT INTO "clientLogs" ("userID", message)
      VALUES ($1, $2);
    `;
    await this.runQuery(query, [userID, message]);
  }

  // Add multiple log entries in a single batch insert
  async addClientLogsBatch(
    logs: Array<{ userID: string | null; message: string }>,
  ): Promise<void> {
    log(undefined, "Adding client logs batch:", logs.length);
    if (logs.length === 0) return;

    const values: any[] = [];
    const placeholders = logs
      .map((log, index) => {
        values.push(log.userID, log.message);
        const offset = index * 2;
        return `($${offset + 1}, $${offset + 2})`;
      })
      .join(", ");

    const query = `
      INSERT INTO "clientLogs" ("userID", message)
      VALUES ${placeholders};
    `;
    await this.runQuery(query, values);
  }

  // Get all logs for a specific user ordered by creation date (newest first)
  async getClientLogs(userID: string): Promise<ClientLog[]> {
    const query = `
      SELECT id, "userID", message, "createdAt"
      FROM "clientLogs"
      WHERE "userID" = $1
      ORDER BY "createdAt" DESC;
    `;
    const results = await this.runQuery(query, [userID]);
    return results;
  }

  // Get system logs (where userID is null)
  async getSystemLogs(): Promise<ClientLog[]> {
    const query = `
      SELECT id, "userID", message, "createdAt"
      FROM "clientLogs"
      WHERE "userID" IS NULL
      ORDER BY "createdAt" DESC;
    `;
    const results = await this.runQuery(query, []);
    return results;
  }

  // Delete logs older than 48 hours for all users
  async cleanupOldLogs(): Promise<number> {
    const query = `
      DELETE FROM "clientLogs"
      WHERE "createdAt" < NOW() - INTERVAL '30 days'
      RETURNING id;
    `;
    const results = await this.runQuery(query, []);
    return results.length;
  }

  // Get all approved users (for admin functionality, e.g. switch-user)
  async getAllUsers(): Promise<User[]> {
    const query = `
      SELECT "userID", email, name, status
      FROM users
      WHERE status = 'approved'
      ORDER BY name;
    `;
    const results = await this.runQuery(query, []);
    return results;
  }

  // ==================== Task Methods ====================

  // Get all tasks for a user (excluding soft-deleted)
  async getTasks(userID: string): Promise<Task[]> {
    const query = `
      SELECT task_id, user_id, title, timeline_group, is_completed, 
             priority, assignee, sort_order, created_at
      FROM tasks
      WHERE user_id = $1 AND deleted_at IS NULL
      ORDER BY 
        CASE timeline_group 
          WHEN 'Just Engaged' THEN 1
          WHEN '12 Months Before' THEN 2
          WHEN '9 Months Before' THEN 3
          WHEN '6 Months Before' THEN 4
          WHEN '3 Months Before' THEN 5
          WHEN '1 Month Before' THEN 6
          WHEN '1 Week Before' THEN 7
          WHEN 'Wedding Day Bride' THEN 8
          WHEN 'Wedding Day Groom' THEN 9
          WHEN 'Wedding Day' THEN 10
          ELSE 11
        END,
        sort_order ASC,
        created_at ASC;
    `;
    const results = await this.runQuery(query, [userID]);
    return results;
  }

  // Add a new custom task
  async addTask(
    userID: string,
    task: Pick<Task, "title" | "timeline_group" | "priority" | "assignee">,
  ): Promise<Task> {
    // Get the max sort_order for this timeline group
    const maxSortQuery = `
      SELECT COALESCE(MAX(sort_order), 0) + 1 as next_sort
      FROM tasks
      WHERE user_id = $1 AND timeline_group = $2 AND deleted_at IS NULL;
    `;
    const sortResult = await this.runQuery(maxSortQuery, [
      userID,
      task.timeline_group,
    ]);
    const nextSort = sortResult[0]?.next_sort || 1;

    const query = `
      INSERT INTO tasks (user_id, title, timeline_group, priority, assignee, sort_order)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING task_id, user_id, title, timeline_group, is_completed, 
                priority, assignee, sort_order, created_at;
    `;
    const values = [
      userID,
      task.title,
      task.timeline_group,
      task.priority || 2,
      task.assignee || "both",
      nextSort,
    ];
    const result = await this.runQuery(query, values);
    return result[0];
  }

  // Update task completion status
  async updateTaskCompletion(
    userID: string,
    taskId: number,
    isCompleted: boolean,
  ): Promise<Task | null> {
    const query = `
      UPDATE tasks
      SET is_completed = $1
      WHERE task_id = $2 AND user_id = $3 AND deleted_at IS NULL
      RETURNING task_id, user_id, title, timeline_group, is_completed, 
                priority, assignee, sort_order, created_at;
    `;
    const result = await this.runQuery(query, [isCompleted, taskId, userID]);
    return result.length > 0 ? result[0] : null;
  }

  // Update task details
  async updateTask(
    userID: string,
    taskId: number,
    updates: Partial<
      Pick<Task, "title" | "timeline_group" | "priority" | "assignee">
    >,
  ): Promise<Task | null> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      values.push(updates.title);
    }
    if (updates.timeline_group !== undefined) {
      setClauses.push(`timeline_group = $${paramIndex++}`);
      values.push(updates.timeline_group);
    }
    if (updates.priority !== undefined) {
      setClauses.push(`priority = $${paramIndex++}`);
      values.push(updates.priority);
    }
    if (updates.assignee !== undefined) {
      setClauses.push(`assignee = $${paramIndex++}`);
      values.push(updates.assignee);
    }

    if (setClauses.length === 0) return null;

    values.push(taskId, userID);
    const query = `
      UPDATE tasks
      SET ${setClauses.join(", ")}
      WHERE task_id = $${paramIndex++} AND user_id = $${paramIndex} AND deleted_at IS NULL
      RETURNING task_id, user_id, title, timeline_group, is_completed, 
                priority, assignee, sort_order, created_at;
    `;
    const result = await this.runQuery(query, values);
    return result.length > 0 ? result[0] : null;
  }

  // Soft delete a task
  async deleteTask(userID: string, taskId: number): Promise<boolean> {
    const query = `
      UPDATE tasks
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE task_id = $1 AND user_id = $2 AND deleted_at IS NULL
      RETURNING task_id;
    `;
    const result = await this.runQuery(query, [taskId, userID]);
    return result.length > 0;
  }

  // Delete all tasks for a user
  async deleteAllTasks(userID: string): Promise<boolean> {
    const query = `
      DELETE FROM tasks
      WHERE user_id = $1
    `;
    const result = await this.runQuery(query, [userID]);
    return result.length > 0;
  }

  // ==================== Partner Methods ====================

  // Generate a unique invite code for a user
  async generateInviteCode(userID: string): Promise<string> {
    // Check if user is a linked account (can't generate invites if you're a partner)
    const userCheck = await this.runQuery(
      `SELECT primary_user_id FROM users WHERE "userID" = $1`,
      [userID],
    );
    if (userCheck[0]?.primary_user_id) {
      throw new Error(
        "Linked accounts cannot generate invite codes. Only the primary account owner can invite partners.",
      );
    }

    // Generate a random 8-character code
    const inviteCode = Math.random()
      .toString(36)
      .substring(2, 10)
      .toUpperCase();
    // Set expiration to 7 days from now
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const query = `
      UPDATE users 
      SET invite_code = $1, invite_code_expires_at = $2
      WHERE "userID" = $3
      RETURNING invite_code;
    `;
    await this.runQuery(query, [inviteCode, expiresAt, userID]);
    return inviteCode;
  }

  // Accept an invite and link accounts
  async acceptInvite(
    partnerUserID: string,
    inviteCode: string,
  ): Promise<{ success: boolean; primaryUserID?: string; error?: string }> {
    // Find the user with this invite code
    const findQuery = `
      SELECT "userID", invite_code_expires_at, primary_user_id 
      FROM users 
      WHERE invite_code = $1;
    `;
    const results = await this.runQuery(findQuery, [inviteCode]);

    if (results.length === 0) {
      return { success: false, error: "Invalid invite code" };
    }

    const primaryUser = results[0];

    // Check if code is expired
    if (
      primaryUser.invite_code_expires_at &&
      new Date(primaryUser.invite_code_expires_at) < new Date()
    ) {
      return { success: false, error: "Invite code has expired" };
    }

    // Check if trying to link to self
    if (primaryUser.userID === partnerUserID) {
      return { success: false, error: "Cannot link to your own account" };
    }

    // Check if the "primary" user is themselves a linked account (partner to someone else)
    if (primaryUser.primary_user_id) {
      return {
        success: false,
        error:
          "This account is linked to another account and cannot have partners",
      };
    }

    // Check if partner is already linked to someone
    const partnerCheck = await this.runQuery(
      `SELECT primary_user_id FROM users WHERE "userID" = $1`,
      [partnerUserID],
    );
    if (partnerCheck[0]?.primary_user_id) {
      return {
        success: false,
        error: "You are already linked to another account",
      };
    }

    // Check if primary already has a partner (someone linked to them)
    const primaryPartnerCheck = await this.runQuery(
      `SELECT "userID" FROM users WHERE primary_user_id = $1`,
      [primaryUser.userID],
    );
    if (primaryPartnerCheck.length > 0) {
      return { success: false, error: "This account already has a partner" };
    }

    // Link the accounts
    const linkQuery = `
      UPDATE users 
      SET primary_user_id = $1
      WHERE "userID" = $2;
    `;
    await this.runQuery(linkQuery, [primaryUser.userID, partnerUserID]);

    // Clear the invite code after successful use
    await this.runQuery(
      `UPDATE users SET invite_code = NULL, invite_code_expires_at = NULL WHERE "userID" = $1`,
      [primaryUser.userID],
    );

    return { success: true, primaryUserID: primaryUser.userID };
  }

  // Unlink partner accounts
  async unlinkPartner(userID: string): Promise<boolean> {
    // First check if this user IS a linked partner (has primary_user_id set pointing to someone)
    const isPartner = await this.runQuery(
      `SELECT primary_user_id FROM users WHERE "userID" = $1`,
      [userID],
    );

    if (isPartner[0]?.primary_user_id) {
      // This user is the partner, unlink themselves
      await this.runQuery(
        `UPDATE users SET primary_user_id = NULL WHERE "userID" = $1`,
        [userID],
      );
      return true;
    }

    // Check if this user HAS a partner (someone linked to them)
    const hasPartner = await this.runQuery(
      `SELECT "userID" FROM users WHERE primary_user_id = $1`,
      [userID],
    );

    if (hasPartner.length > 0) {
      // Unlink the partner from this user
      await this.runQuery(
        `UPDATE users SET primary_user_id = NULL WHERE primary_user_id = $1`,
        [userID],
      );
      return true;
    }

    return false;
  }

  // Get partner info for a user
  async getPartnerInfo(userID: string): Promise<{
    hasPartner: boolean;
    isLinkedAccount: boolean;
    partner?: User;
    primaryUser?: User;
    inviteCode?: string;
    inviteExpires?: Date;
  }> {
    // Check if this user has primary_user_id set (meaning they are linked to a primary account)
    const userQuery = `
      SELECT u."userID", u.name, u.email, u.primary_user_id, u.invite_code, u.invite_code_expires_at,
             p."userID" as primary_id, p.name as primary_name, p.email as primary_email
      FROM users u
      LEFT JOIN users p ON u.primary_user_id = p."userID"
      WHERE u."userID" = $1;
    `;
    const userResult = await this.runQuery(userQuery, [userID]);

    if (userResult.length === 0) {
      return { hasPartner: false, isLinkedAccount: false };
    }

    const user = userResult[0];

    // If this user is linked to a primary account
    if (user.primary_user_id) {
      return {
        hasPartner: true,
        isLinkedAccount: true,
        primaryUser: {
          userID: user.primary_id,
          name: user.primary_name,
          email: user.primary_email,
        },
      };
    }

    // Check if someone is linked to this user (this user is the primary)
    const partnerQuery = `
      SELECT "userID", name, email FROM users WHERE primary_user_id = $1;
    `;
    const partnerResult = await this.runQuery(partnerQuery, [userID]);

    if (partnerResult.length > 0) {
      return {
        hasPartner: true,
        isLinkedAccount: false,
        partner: partnerResult[0],
      };
    }

    // No partner, return invite code if exists
    return {
      hasPartner: false,
      isLinkedAccount: false,
      inviteCode: user.invite_code,
      inviteExpires: user.invite_code_expires_at,
    };
  }

  // Get the effective userID for data operations (returns primary account ID)
  async getEffectiveUserID(userID: string): Promise<string> {
    const query = `
      SELECT primary_user_id FROM users WHERE "userID" = $1;
    `;
    const result = await this.runQuery(query, [userID]);

    if (result.length > 0 && result[0].primary_user_id) {
      return result[0].primary_user_id;
    }
    return userID;
  }

  // Look up a user by their userID (used by admin impersonation)
  async getUserByID(userID: string): Promise<User | null> {
    const query = `SELECT "userID", email, name FROM users WHERE "userID" = $1`;
    const result = await this.runQuery(query, [userID]);
    return result.length > 0 ? (result[0] as User) : null;
  }

  // ==================== Account Retention (60-day post-wedding deletion) ====================

  /**
   * Primary events that drive their own account's deletion countdown: only
   * accounts that are not themselves a linked partner (partner_user_id IS NULL)
   * get their own timeline, so a partner's stale pre-link primary event can
   * never spawn a second, independent countdown. Cancelled and admin-excluded
   * accounts are filtered out here too.
   */
  async getPrimaryEventsForRetentionCheck(adminUserID: string): Promise<Event[]> {
    return this.runQuery(
      `SELECT e.* FROM events e
       JOIN users u ON u."userID" = e.user_id
       WHERE e.is_primary = TRUE
         AND e.date IS NOT NULL
         AND e.deletion_cancelled_at IS NULL
         AND u.primary_user_id IS NULL
         AND u."userID" != $1;`,
      [adminUserID],
    );
  }

  async markDeletionWarningSent(eventId: number): Promise<void> {
    await this.runQuery(
      `UPDATE events SET deletion_warning_sent_at = CURRENT_TIMESTAMP WHERE id = $1;`,
      [eventId],
    );
  }

  async cancelScheduledDeletion(userID: string): Promise<void> {
    await this.runQuery(
      `UPDATE events SET deletion_cancelled_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND is_primary = TRUE;`,
      [userID],
    );
  }

  /** Admin view of every account's retention state, cancelled or not. */
  async getScheduledDeletions(adminUserID: string): Promise<{
    userID: string;
    name: string;
    email: string;
    weddingDate: string;
    warningSentAt: Date | null;
    cancelledAt: Date | null;
  }[]> {
    const rows = await this.runQuery(
      `SELECT u."userID" as "userID", u.name, u.email, e.date as "weddingDate",
              e.deletion_warning_sent_at as "warningSentAt", e.deletion_cancelled_at as "cancelledAt"
       FROM events e
       JOIN users u ON u."userID" = e.user_id
       WHERE e.is_primary = TRUE
         AND e.date IS NOT NULL
         AND u.primary_user_id IS NULL
         AND u."userID" != $1
       ORDER BY e.date ASC;`,
      [adminUserID],
    );
    return rows;
  }

  async recordDeletedAccount(entry: {
    userID: string;
    email?: string | null;
    name?: string | null;
    weddingDate?: string | null;
    role: "owner" | "partner";
  }): Promise<void> {
    await this.runQuery(
      `INSERT INTO deleted_accounts (user_id, email, name, wedding_date, role)
       VALUES ($1, $2, $3, $4, $5);`,
      [entry.userID, entry.email ?? null, entry.name ?? null, entry.weddingDate ?? null, entry.role],
    );
  }

  // ==================== Budget Category Methods ====================

  // Get all budget categories for a user with actual spending calculated
  async getBudgetCategories(
    userID: string,
  ): Promise<BudgetCategoryWithSpending[]> {
    const query = `
      WITH vendor_costs AS (
        SELECT category_id, SUM(agreed_cost) AS agreed_cost
        FROM vendors
        WHERE status != 'יצרנו קשר'
        GROUP BY category_id
      ),
      vendor_payments AS (
        SELECT v.category_id, SUM(p.amount) AS actual_spending
        FROM vendors v
        JOIN payments p ON v.vendor_id = p.vendor_id
        GROUP BY v.category_id
      )
      SELECT
        bc.category_id,
        bc.user_id,
        bc.name,
        bc.created_at,
        COALESCE(vc.agreed_cost, 0) AS agreed_cost,
        COALESCE(vp.actual_spending, 0) AS actual_spending
      FROM budget_categories bc
      LEFT JOIN vendor_costs vc ON bc.category_id = vc.category_id
      LEFT JOIN vendor_payments vp ON bc.category_id = vp.category_id
      WHERE bc.user_id = $1
      ORDER BY bc.created_at ASC;
    `;
    const results = await this.runQuery(query, [userID]);

    return results.map((row: any) => ({
      ...row,
      actual_spending: parseFloat(row.actual_spending),
      agreed_cost: parseFloat(row.agreed_cost),
      vendors: [],
    }));
  }

  // Add a new budget category
  async addBudgetCategory(
    userID: string,
    name: string,
  ): Promise<BudgetCategory> {
    const query = `
      INSERT INTO budget_categories (user_id, name)
      VALUES ($1, $2)
      RETURNING category_id, user_id, name, created_at;
    `;
    const result = await this.runQuery(query, [userID, name]);
    return result[0];
  }

  // Delete a budget category
  async deleteBudgetCategory(
    userID: string,
    categoryId: number,
  ): Promise<boolean> {
    const query = `
      DELETE FROM budget_categories
      WHERE category_id = $1 AND user_id = $2
      RETURNING category_id;
    `;
    const result = await this.runQuery(query, [categoryId, userID]);
    return result.length > 0;
  }

  // ==================== Vendor Methods ====================

  // Get all vendors for a user with payments
  async getVendors(userID: string): Promise<VendorWithPayments[]> {
    const vendorsQuery = `
      SELECT v.*, bc.name as category_name
      FROM vendors v
      JOIN budget_categories bc ON v.category_id = bc.category_id
      WHERE v.user_id = $1
      ORDER BY v.is_favorite DESC, v.created_at DESC;
    `;
    const vendors = await this.runQuery(vendorsQuery, [userID]);

    // Get all payments for these vendors
    const vendorIds = vendors.map((v: any) => v.vendor_id);
    if (vendorIds.length === 0) return [];

    const paymentsQuery = `
      SELECT *
      FROM payments
      WHERE vendor_id = ANY($1)
      ORDER BY payment_date DESC;
    `;

    // Get all files for these vendors
    const filesQuery = `
      SELECT file_id, vendor_id, file_name, file_type, file_size, uploaded_at
      FROM vendor_files
      WHERE vendor_id = ANY($1)
      ORDER BY uploaded_at DESC;
    `;
    // Run payments and files queries in parallel
    const [payments, files] = await Promise.all([
      this.runQuery(paymentsQuery, [vendorIds]),
      this.runQuery(filesQuery, [vendorIds]),
    ]);

    // Group payments by vendor
    const paymentsByVendor: { [key: number]: Payment[] } = {};
    payments.forEach((p: Payment) => {
      if (!paymentsByVendor[p.vendor_id]) {
        paymentsByVendor[p.vendor_id] = [];
      }
      paymentsByVendor[p.vendor_id].push({
        ...p,
        amount: parseFloat(p.amount as any),
      });
    });
    // Group files by vendor
    const filesByVendor: { [key: number]: VendorFile[] } = {};
    files.forEach((f: VendorFile) => {
      if (!filesByVendor[f.vendor_id]) {
        filesByVendor[f.vendor_id] = [];
      }
      filesByVendor[f.vendor_id].push(f);
    });

    return vendors.map((v: any) => {
      const vendorPayments = paymentsByVendor[v.vendor_id] || [];
      const vendorFiles = filesByVendor[v.vendor_id] || [];
      const totalPaid = vendorPayments.reduce((sum, p) => sum + p.amount, 0);
      const agreedCost = parseFloat(v.agreed_cost);
      return {
        ...v,
        agreed_cost: agreedCost,
        payments: vendorPayments,
        files: vendorFiles,
        total_paid: totalPaid,
        remaining_balance: agreedCost - totalPaid,
      };
    });
  }

  // Get vendors by category
  async getVendorsByCategory(
    userID: string,
    categoryId: number,
  ): Promise<VendorWithPayments[]> {
    const allVendors = await this.getVendors(userID);
    return allVendors.filter((v) => v.category_id === categoryId);
  }

  // Add a new vendor
  async addVendor(
    userID: string,
    vendor: Omit<
      Vendor,
      "vendor_id" | "user_id" | "created_at" | "category_name"
    >,
  ): Promise<Vendor> {
    const query = `
      INSERT INTO vendors (user_id, name, job_title, category_id, agreed_cost, status, phone, email, notes, is_favorite)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING vendor_id, user_id, name, job_title, category_id, agreed_cost, status, phone, email, notes, is_favorite, created_at;
    `;

    const values = [
      userID,
      vendor.name,
      vendor.job_title || null,
      vendor.category_id,
      vendor.agreed_cost,
      vendor.status || "יצרנו קשר",
      vendor.phone || null,
      vendor.email || null,
      vendor.notes || null,
      vendor.is_favorite || false,
    ];
    const result = await this.runQuery(query, values);
    return result[0];
  }

  // Update a vendor
  async updateVendor(
    userID: string,
    vendorId: number,
    updates: Partial<Omit<Vendor, "vendor_id" | "user_id" | "created_at">>,
  ): Promise<Vendor | null> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex++}`);
      values.push(updates.name);
    }
    if (updates.job_title !== undefined) {
      setClauses.push(`job_title = $${paramIndex++}`);
      values.push(updates.job_title);
    }
    if (updates.category_id !== undefined) {
      setClauses.push(`category_id = $${paramIndex++}`);
      values.push(updates.category_id);
    }
    if (updates.agreed_cost !== undefined) {
      setClauses.push(`agreed_cost = $${paramIndex++}`);
      values.push(updates.agreed_cost);
    }
    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex++}`);
      values.push(updates.status);
    }
    if (updates.phone !== undefined) {
      setClauses.push(`phone = $${paramIndex++}`);
      values.push(updates.phone);
    }
    if (updates.email !== undefined) {
      setClauses.push(`email = $${paramIndex++}`);
      values.push(updates.email);
    }
    if (updates.notes !== undefined) {
      setClauses.push(`notes = $${paramIndex++}`);
      values.push(updates.notes);
    }
    if (updates.is_favorite !== undefined) {
      setClauses.push(`is_favorite = $${paramIndex++}`);
      values.push(updates.is_favorite);
    }

    if (setClauses.length === 0) return null;

    values.push(vendorId, userID);
    const query = `
      UPDATE vendors
      SET ${setClauses.join(", ")}
      WHERE vendor_id = $${paramIndex++} AND user_id = $${paramIndex}
      RETURNING vendor_id, user_id, name, job_title, category_id, agreed_cost, status, phone, email, notes, is_favorite, created_at;
    `;
    const result = await this.runQuery(query, values);
    return result.length > 0 ? result[0] : null;
  }

  // Delete a vendor
  async deleteVendor(userID: string, vendorId: number): Promise<boolean> {
    const query = `
      DELETE FROM vendors
      WHERE vendor_id = $1 AND user_id = $2
      RETURNING vendor_id;
    `;
    const result = await this.runQuery(query, [vendorId, userID]);
    return result.length > 0;
  }

  // Toggle vendor favorite status
  async toggleVendorFavorite(
    userID: string,
    vendorId: number,
  ): Promise<Vendor | null> {
    const query = `
      UPDATE vendors
      SET is_favorite = NOT is_favorite
      WHERE vendor_id = $1 AND user_id = $2
      RETURNING vendor_id, user_id, name, job_title, category_id, agreed_cost, status, phone, email, notes, is_favorite, created_at;
    `;
    const result = await this.runQuery(query, [vendorId, userID]);
    return result.length > 0 ? result[0] : null;
  }

  // ==================== Payment Methods ====================

  // Add a payment to a vendor
  async addPayment(
    userID: string,
    vendorId: number,
    payment: { amount: number; payment_date: string; notes?: string },
  ): Promise<Payment> {
    // Verify vendor belongs to user
    const vendorCheck = await this.runQuery(
      `SELECT vendor_id FROM vendors WHERE vendor_id = $1 AND user_id = $2`,
      [vendorId, userID],
    );
    if (vendorCheck.length === 0) {
      throw new Error("Vendor not found or access denied");
    }

    const query = `
      INSERT INTO payments (vendor_id, amount, payment_date, notes)
      VALUES ($1, $2, $3, $4)
      RETURNING payment_id, vendor_id, amount, payment_date, notes, created_at;
    `;
    const result = await this.runQuery(query, [
      vendorId,
      payment.amount,
      payment.payment_date,
      payment.notes || null,
    ]);

    // Update vendor status based on payments
    await this.updateVendorStatusBasedOnPayments(userID, vendorId);

    return result[0];
  }

  // Update vendor status based on payments
  private async updateVendorStatusBasedOnPayments(
    userID: string,
    vendorId: number,
  ): Promise<void> {
    const query = `
      SELECT v.agreed_cost, COALESCE(SUM(p.amount), 0) as total_paid
      FROM vendors v
      LEFT JOIN payments p ON v.vendor_id = p.vendor_id
      WHERE v.vendor_id = $1 AND v.user_id = $2
      GROUP BY v.vendor_id;
    `;
    const result = await this.runQuery(query, [vendorId, userID]);

    if (result.length > 0) {
      const { agreed_cost, total_paid } = result[0];
      const agreedCostNum = parseFloat(agreed_cost);
      const totalPaidNum = parseFloat(total_paid);

      let newStatus: VendorStatus = "הוזמן";
      if (totalPaidNum >= agreedCostNum) {
        newStatus = "שולם";
      } else if (totalPaidNum > 0) {
        newStatus = "שולם חלקית";
      }

      await this.runQuery(
        `UPDATE vendors SET status = $1 WHERE vendor_id = $2 AND user_id = $3`,
        [newStatus, vendorId, userID],
      );
    }
  }

  // Delete a payment
  async deletePayment(userID: string, paymentId: number): Promise<boolean> {
    // Get vendor_id for status update
    const paymentQuery = await this.runQuery(
      `SELECT p.vendor_id FROM payments p 
       JOIN vendors v ON p.vendor_id = v.vendor_id 
       WHERE p.payment_id = $1 AND v.user_id = $2`,
      [paymentId, userID],
    );

    if (paymentQuery.length === 0) return false;

    const vendorId = paymentQuery[0].vendor_id;

    const query = `
      DELETE FROM payments
      WHERE payment_id = $1 AND vendor_id IN (SELECT vendor_id FROM vendors WHERE user_id = $2)
      RETURNING payment_id;
    `;
    const result = await this.runQuery(query, [paymentId, userID]);

    if (result.length > 0) {
      await this.updateVendorStatusBasedOnPayments(userID, vendorId);
      return true;
    }
    return false;
  }

  // Get full budget overview with all data
  async getBudgetOverview(userID: string): Promise<BudgetOverview> {
    const [categories, vendors, primaryEvent] = await Promise.all([
      this.getBudgetCategories(userID),
      this.getVendors(userID),
      this.getPrimaryEvent(userID),
    ]);
    // Attach vendors to their categories
    const categoriesWithVendors: BudgetCategoryWithSpending[] = categories.map(
      (cat) => ({
        ...cat,
        vendors: vendors.filter((v) => v.category_id === cat.category_id),
      }),
    );

    const totalBudget = primaryEvent?.total_budget || 0;
    const estimatedGuests = primaryEvent?.estimated_guests || 0;
    const totalExpenses = vendors.reduce((sum, v) => sum + v.total_paid, 0);
    const plannedExpenses = vendors
      .filter((v) => v.status !== "יצרנו קשר")
      .reduce((sum, v) => sum + v.agreed_cost, 0);
    const remainingBudget = totalBudget - plannedExpenses;
    const usagePercentage =
      totalBudget > 0 ? (plannedExpenses / totalBudget) * 100 : 0;

    // Calculate price per guest based on estimated guests for budget planning
    const pricePerGuest =
      estimatedGuests > 0 ? plannedExpenses / estimatedGuests : 0;

    return {
      total_budget: totalBudget,
      total_expenses: totalExpenses,
      remaining_budget: remainingBudget,
      usage_percentage: usagePercentage,
      estimated_guests: estimatedGuests,
      price_per_guest: pricePerGuest,
      categories: categoriesWithVendors,
      planned_expenses: plannedExpenses,
    };
  }

  // ==================== Vendor File Methods ====================

  // Get all files for a vendor (without file data for listing)
  async getVendorFiles(vendorId: number): Promise<VendorFile[]> {
    const query = `
      SELECT file_id, vendor_id, file_name, file_type, file_size, uploaded_at
      FROM vendor_files
      WHERE vendor_id = $1
      ORDER BY uploaded_at DESC;
    `;
    const results = await this.runQuery(query, [vendorId]);
    return results;
  }

  // Get every uploaded file (with its binary data) across all of a user's vendors — used by the data export.
  async getAllVendorFilesForExport(userID: string): Promise<VendorFile[]> {
    const query = `
      SELECT vf.file_id, vf.vendor_id, vf.file_name, vf.file_type, vf.file_size, vf.file_data, vf.uploaded_at
      FROM vendor_files vf
      JOIN vendors v ON vf.vendor_id = v.vendor_id
      WHERE v.user_id = $1
      ORDER BY vf.uploaded_at DESC;
    `;
    return this.runQuery(query, [userID]);
  }

  // Add a file to a vendor
  async addVendorFile(
    userID: string,
    vendorId: number,
    file: { name: string; type: string; size: number; data: Buffer },
  ): Promise<VendorFile> {
    // Verify vendor belongs to user
    const vendorCheck = await this.runQuery(
      `SELECT vendor_id FROM vendors WHERE vendor_id = $1 AND user_id = $2`,
      [vendorId, userID],
    );
    if (vendorCheck.length === 0) {
      throw new Error("Vendor not found or access denied");
    }

    const query = `
      INSERT INTO vendor_files (vendor_id, file_name, file_type, file_size, file_data)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING file_id, vendor_id, file_name, file_type, file_size, uploaded_at;
    `;
    const result = await this.runQuery(query, [
      vendorId,
      file.name,
      file.type,
      file.size,
      file.data,
    ]);
    return result[0];
  }

  // Get file data for download
  async getVendorFileData(
    userID: string,
    fileId: number,
  ): Promise<{
    file_name: string;
    file_type: string;
    file_data: Buffer;
  } | null> {
    const query = `
      SELECT vf.file_name, vf.file_type, vf.file_data
      FROM vendor_files vf
      JOIN vendors v ON vf.vendor_id = v.vendor_id
      WHERE vf.file_id = $1 AND v.user_id = $2;
    `;
    const result = await this.runQuery(query, [fileId, userID]);
    return result.length > 0 ? result[0] : null;
  }

  // Delete a vendor file
  async deleteVendorFile(userID: string, fileId: number): Promise<boolean> {
    const query = `
      DELETE FROM vendor_files
      WHERE file_id = $1 
      AND vendor_id IN (SELECT vendor_id FROM vendors WHERE user_id = $2)
      RETURNING file_id;
    `;
    const result = await this.runQuery(query, [fileId, userID]);
    return result.length > 0;
  }


  async runQuery(query: string, values: any[]): Promise<any> {
    try {
      const result = await pool.query(query, values);
      return result.rows;
    } catch (err) {
      logError(undefined, "Query failed:", query, values, err);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await pool.end();
  }
}

export default Database;
