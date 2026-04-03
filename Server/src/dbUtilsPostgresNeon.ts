import {
  Guest,
  GuestIdentifier,
  User,
  WeddingDetails,
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

require("dotenv").config();

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
const guestsListColumnsNoUserID = `name, phone, whose, circle, "numberOfGuests", "RSVP", "messageGroup", "lastRsvpSentAt"`;

class Database {
  private static instance: Database | null = null;

  // Private constructor to prevent direct instantiation
  private constructor() {}

  // Static method to get the singleton instance
  static getInstance(): Database | null {
    return Database.instance;
  }

  // Static method to create and initialize the database instance
  static async connect(): Promise<Database> {
    if (!Database.instance) {
      const db = new Database();
      await db.initializeTables();
      Database.instance = db;
    }
    return Database.instance;
  }

  private async initializeTables(): Promise<void> {
    // Helper to safely create a table (checks if table exists first to avoid type conflicts)
    const safeCreateTable = async (
      tableName: string,
      createSQL: string,
    ): Promise<void> => {
      try {
        // First check if the table already exists
        const tableExists = await this.runQuery(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = $1
          );`,
          [tableName],
        );

        if (tableExists[0]?.exists) {
          // Table already exists, skip creation
          return;
        }

        await this.runQuery(createSQL, []);
      } catch (err: any) {
        // If table already exists or type conflict, just log and continue
        if (err.code === "42P07" || err.code === "23505") {
          console.log(`Table ${tableName} already exists, skipping...`);
          return;
        }
        throw err;
      }
    };

    // Create users table
    await safeCreateTable(
      "users",
      `
      CREATE TABLE IF NOT EXISTS "users" (
        "userID" TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        name TEXT NOT NULL,
        primary_user_id TEXT REFERENCES users("userID") ON DELETE SET NULL,
        invite_code TEXT UNIQUE,
        invite_code_expires_at TIMESTAMP WITH TIME ZONE
      );
    `,
    );

    // Create guestsList table
    await safeCreateTable(
      "guestsList",
      `
      CREATE TABLE IF NOT EXISTS "guestsList" (
        id SERIAL PRIMARY KEY,
        "userID" TEXT NOT NULL REFERENCES users("userID") ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        whose TEXT NOT NULL,
        circle TEXT NOT NULL,
        "numberOfGuests" INTEGER NOT NULL DEFAULT 1,
        "RSVP" INTEGER,
        "messageGroup" INTEGER,
        "lastRsvpSentAt" TIMESTAMP WITH TIME ZONE
      );
    `,
    );

    // Add lastRsvpSentAt column to guestsList if it doesn't exist (migration for existing DBs)
    try {
      await this.runQuery(
        `ALTER TABLE "guestsList" ADD COLUMN IF NOT EXISTS "lastRsvpSentAt" TIMESTAMP WITH TIME ZONE;`,
        [],
      );
    } catch (err: any) {
      if (err.code !== "42701") throw err; // 42701 = column already exists
    }

    // Create info table
    await safeCreateTable(
      "info",
      `
      CREATE TABLE IF NOT EXISTS "info" (
        "userID" TEXT PRIMARY KEY REFERENCES users("userID") ON DELETE CASCADE,
        bride_name TEXT NOT NULL,
        groom_name TEXT NOT NULL,
        wedding_date TEXT NOT NULL,
        hour TIME NOT NULL,
        location_name TEXT NOT NULL,
        additional_information TEXT,
        waze_link TEXT,
        gift_link TEXT,
        thank_you_message TEXT,
        "fileID" TEXT,
        reminder_day TEXT DEFAULT 'day_before' CHECK (reminder_day IN ('day_before', 'wedding_day')),
        reminder_time TIME DEFAULT '10:00:00',
        total_budget DECIMAL(12, 2) DEFAULT 0,
        estimated_guests INTEGER DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    );

    // Create ClientLogs table
    await safeCreateTable(
      "clientLogs",
      `
      CREATE TABLE IF NOT EXISTS "clientLogs" (
        id SERIAL PRIMARY KEY,
        "userID" TEXT REFERENCES users("userID") ON DELETE CASCADE,
        message TEXT NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    );

    // Create tasks table
    await safeCreateTable(
      "tasks",
      `
      CREATE TABLE IF NOT EXISTS "tasks" (
        task_id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users("userID") ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        timeline_group VARCHAR(50) NOT NULL,
        is_completed BOOLEAN NOT NULL DEFAULT FALSE,
        priority INTEGER DEFAULT 2 CHECK (priority IN (1, 2, 3)),
        assignee VARCHAR(20) DEFAULT 'both' CHECK (assignee IN ('bride', 'groom', 'both')),
        sort_order INTEGER,
        info TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL
      );
    `,
    );

    // Create budget_categories table
    await safeCreateTable(
      "budget_categories",
      `
      CREATE TABLE IF NOT EXISTS "budget_categories" (
        category_id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users("userID") ON DELETE CASCADE,
        name VARCHAR(50) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, name)
      );
    `,
    );

    // Create vendors table
    await safeCreateTable(
      "vendors",
      `
      CREATE TABLE IF NOT EXISTS "vendors" (
        vendor_id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users("userID") ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        job_title VARCHAR(100),
        category_id INTEGER NOT NULL REFERENCES budget_categories(category_id) ON DELETE CASCADE,
        agreed_cost DECIMAL(12, 2) NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL,
        phone VARCHAR(50),
        email VARCHAR(255),
        notes TEXT,
        is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    );

    // Create payments table
    await safeCreateTable(
      "payments",
      `
      CREATE TABLE IF NOT EXISTS "payments" (
        payment_id SERIAL PRIMARY KEY,
        vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
        amount DECIMAL(12, 2) NOT NULL,
        payment_date DATE NOT NULL,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    );

    // Create vendor_files table for storing agreement documents
    await safeCreateTable(
      "vendor_files",
      `
      CREATE TABLE IF NOT EXISTS "vendor_files" (
        file_id SERIAL PRIMARY KEY,
        vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        file_type VARCHAR(100) NOT NULL,
        file_size INTEGER NOT NULL,
        file_data BYTEA NOT NULL,
        uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `,
    );
  }

  // Add or update user (Google login)
  async addUser({ userID, email, name }: User): Promise<void> {
    // Check if user already exists
    const existingUser = await this.runQuery(
      `SELECT "userID" FROM users WHERE "userID" = $1`,
      [userID],
    );
    const isNewUser = existingUser.length === 0;

    const query = `
    INSERT INTO users ("userID", email, name) 
    VALUES ($1, $2, $3)
    ON CONFLICT ("userID") 
    DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name
    RETURNING "userID";
  `;
    const values = [userID, email, name];
    await this.runQuery(query, values);
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
        return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${
          offset + 4
        }, $${offset + 5}, $${offset + 6})`;
      })
      .join(", ");

    const query = `
      INSERT INTO tasks (user_id, title, timeline_group, sort_order, assignee, info)
      VALUES ${placeholders};
    `;

    await this.runQuery(query, values);
  }

  // Get all guests for a specific user
  async getGuests(userID: User["userID"]): Promise<Guest[]> {
    const query = `SELECT  ${guestsListColumnsNoUserID} FROM "guestsList" WHERE "userID" = $1;`;
    const results = await this.runQuery(query, [userID]);
    return results;
  }

  async getGuestsWithUserID(userID: User["userID"]): Promise<Guest[]> {
    const query = `SELECT "userID", ${guestsListColumnsNoUserID} FROM "guestsList" WHERE "userID" = $1;`;
    const results = await this.runQuery(query, [userID]);
    return results;
  }

  async getAllGuests(): Promise<Guest[]> {
    const query = `SELECT "userID", ${guestsListColumnsNoUserID} FROM "guestsList";`;
    const results = await this.runQuery(query, []);
    return results;
  }

  async addMultipleGuests(
    userID: User["userID"],
    guests: Guest[],
  ): Promise<any> {
    const values: any[] = [];
    const placeholders = guests
      .map((guest, index) => {
        const guestValues = [
          userID,
          guest.name,
          guest.phone,
          guest.whose,
          guest.circle,
          guest.numberOfGuests,
          guest.RSVP,
          guest.messageGroup,
          guest.lastRsvpSentAt || null,
        ];

        values.push(...guestValues);

        return `(${guestValues
          .map((_, i) => `$${index * 9 + i + 1}`)
          .join(", ")})`;
      })
      .join(", ");

    const query = `
    INSERT INTO "guestsList" ("userID", ${guestsListColumnsNoUserID})
    VALUES ${placeholders}
  `;
    return await this.runQuery(query, values);
  }

  // Update RSVP for a specific guest
  async updateRSVP(
    name: Guest["name"],
    phone: Guest["phone"],
    RSVP: number | undefined,
    userID?: string,
  ): Promise<any> {
    let updatedRSVP: number | null;
    if (RSVP == null) {
      updatedRSVP = null;
    } else {
      updatedRSVP = parseInt(RSVP.toString(), 10);
    }

    const query = userID
      ? `
      UPDATE "guestsList" 
      SET "RSVP" = $1 
      WHERE "userID" = $2
      AND phone = $3 
      AND name = $4
    `
      : `
      UPDATE "guestsList" 
      SET "RSVP" = $1 
      WHERE phone = $2 
      AND name = $3
    `;
    const values = userID
      ? [updatedRSVP, userID, phone, name]
      : [updatedRSVP, phone, name];

    return await this.runQuery(query, values);
  }

  async updateLastRsvpSentAt(userID: string, phones: string[]): Promise<void> {
    console.log("updateLastRsvpSentAt", userID, phones);
    if (phones.length === 0) return;
    const query = `
      UPDATE "guestsList"
      SET "lastRsvpSentAt" = CURRENT_TIMESTAMP
      WHERE "userID" = $1 AND phone = ANY($2);
    `;
    await this.runQuery(query, [userID, phones]);
  }

  // Delete a specific guest
  async deleteGuest(
    guest: GuestIdentifier,
    userID?: User["userID"],
  ): Promise<any> {
    return userID
      ? await this.runQuery(
          `DELETE FROM "guestsList" WHERE "userID" = $1 AND phone = $2 AND name = $3;`,
          [userID, guest.phone, guest.name],
        )
      : await this.runQuery(`DELETE FROM "guestsList" WHERE phone = $1;`, [
          guest.phone,
        ]);
  }

  // Delete all guests for a user
  async deleteAllGuests(userID: User["userID"]): Promise<any> {
    return await this.runQuery(
      `DELETE FROM "guestsList" WHERE "userID" = $1;`,
      [userID],
    );
  }
  async deleteUser(userID: User["userID"]): Promise<any> {
    return await this.runQuery(`DELETE FROM "users" WHERE "userID" = $1;`, [
      userID,
    ]);
  }

  // Add or update wedding information
  async saveWeddingInfo(
    userID: User["userID"],
    info: WeddingDetails,
  ): Promise<void> {
    const query = `
      INSERT INTO info (
        "userID", bride_name, groom_name, wedding_date, hour, 
        location_name, additional_information, waze_link, gift_link,
        thank_you_message, "fileID", reminder_day, reminder_time, total_budget, estimated_guests
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT ("userID") 
      DO UPDATE SET 
        bride_name = EXCLUDED.bride_name,
        groom_name = EXCLUDED.groom_name,
        wedding_date = EXCLUDED.wedding_date,
        hour = EXCLUDED.hour,
        location_name = EXCLUDED.location_name,
        additional_information = EXCLUDED.additional_information,
        waze_link = EXCLUDED.waze_link,
        gift_link = EXCLUDED.gift_link,
        thank_you_message = EXCLUDED.thank_you_message,
        "fileID" = EXCLUDED."fileID",
        reminder_day = EXCLUDED.reminder_day,
        reminder_time = EXCLUDED.reminder_time,
        total_budget = EXCLUDED.total_budget,
        estimated_guests = EXCLUDED.estimated_guests;
    `;

    const values = [
      userID,
      info.bride_name,
      info.groom_name,
      info.wedding_date,
      info.hour,
      info.location_name,
      info.additional_information,
      info.waze_link,
      info.gift_link,
      info.thank_you_message,
      info.fileID,
      info.reminder_day || "day_before",
      info.reminder_time || "10:00:00",
      info.total_budget || 0,
      info.estimated_guests || 0,
    ];

    await this.runQuery(query, values);
  }

  // Get wedding information for a user
  async getWeddingInfo(userID: User["userID"]): Promise<WeddingDetails | null> {
    const query = `
      SELECT 
        bride_name, groom_name, wedding_date, hour, 
        location_name, additional_information, waze_link, 
        gift_link, thank_you_message, "fileID",
        reminder_day, reminder_time, total_budget, estimated_guests
      FROM info 
      WHERE "userID" = $1;
    `;

    const results = await this.runQuery(query, [userID]);
    if (results.length === 0) return null;

    return {
      ...results[0],
      total_budget: results[0].total_budget
        ? parseFloat(results[0].total_budget)
        : 0,
      estimated_guests: results[0].estimated_guests
        ? parseInt(results[0].estimated_guests)
        : 0,
    };
  }

  // Get all weddings that need to send messages today
  async getWeddingsForMessaging(): Promise<
    { userID: string; info: WeddingDetails }[]
  > {
    const { today, tomorrow, yesterday } = getDateStrings();

    const query = `
      SELECT 
        "userID",
        bride_name, groom_name, wedding_date, hour, 
        location_name, additional_information, waze_link, 
        gift_link, thank_you_message, "fileID",
        reminder_day, reminder_time
      FROM info 
      WHERE wedding_date = $1 OR wedding_date = $2 OR wedding_date = $3;
    `;

    const results = await this.runQuery(query, [today, tomorrow, yesterday]);
    return results.map((row: any) => {
      const { userID, ...info } = row;
      return { userID, info };
    });
  }

  async updateGuestsGroups(
    userID: User["userID"],
    guests: Guest[],
  ): Promise<void> {
    const values: any[] = [];
    const placeholders = guests
      .map((guest, index) => {
        // Ensure messageGroup is a number or null
        const messageGroupValue = guest.messageGroup
          ? parseInt(guest.messageGroup.toString(), 10)
          : null;

        values.push(messageGroupValue, userID, guest.name, guest.phone);
        const offset = index * 4;
        return `($${offset + 1}::integer, $${offset + 2}, $${offset + 3}, $${
          offset + 4
        })`;
      })
      .join(", ");

    const query = `
      UPDATE "guestsList" AS g
      SET "messageGroup" = c.messageGroup
      FROM (VALUES ${placeholders}) AS c(messageGroup, userID, name, phone)
      WHERE g."userID" = c.userID
      AND g.name = c.name
      AND g.phone = c.phone;
    `;

    await this.runQuery(query, values);
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
    console.log("Adding client logs batch:", logs.length);
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
      WHERE "createdAt" < NOW() - INTERVAL '48 hours'
      RETURNING id;
    `;
    const results = await this.runQuery(query, []);
    return results.length;
  }

  // Get all users (for admin functionality)
  async getAllUsers(): Promise<User[]> {
    const query = `
      SELECT "userID", email, name
      FROM users
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

  // ==================== Budget Category Methods ====================

  // Get all budget categories for a user with actual spending calculated
  async getBudgetCategories(
    userID: string,
  ): Promise<BudgetCategoryWithSpending[]> {
    const query = `
      SELECT 
        bc.category_id,
        bc.user_id,
        bc.name,
        bc.created_at,
        COALESCE(SUM(p.amount), 0) as actual_spending,
        COALESCE(SUM(v.agreed_cost), 0) as agreed_cost
      FROM budget_categories bc
      LEFT JOIN vendors v ON bc.category_id = v.category_id AND v.status != 'יצרנו קשר'
      LEFT JOIN payments p ON v.vendor_id = p.vendor_id
      WHERE bc.user_id = $1
      GROUP BY bc.category_id
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
    const [categories, vendors, weddingInfo] = await Promise.all([
      this.getBudgetCategories(userID),
      this.getVendors(userID),
      this.getWeddingInfo(userID),
    ]);
    // Attach vendors to their categories
    const categoriesWithVendors: BudgetCategoryWithSpending[] = categories.map(
      (cat) => ({
        ...cat,
        vendors: vendors.filter((v) => v.category_id === cat.category_id),
      }),
    );

    // Get budget data from wedding info
    const totalBudget = weddingInfo?.total_budget || 0;
    const estimatedGuests = weddingInfo?.estimated_guests || 0;
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
      console.error("Query failed:", query, values, err);
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await pool.end();
  }
}

export default Database;
