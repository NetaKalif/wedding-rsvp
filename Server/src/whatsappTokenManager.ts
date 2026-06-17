import axios from "axios";
import dotenv from "dotenv";

const WHATSAPP_API_BASE = process.env.WHATSAPP_API_BASE_URL ?? "https://graph.facebook.com";
import Database from "./dbUtils";

dotenv.config();

let db: Database;
let cachedToken = null;

// Initialize database connection - only called once at startup
const initializeDB = async () => {
  if (!db) {
    db = await Database.connect();
    await createTokenTable();
  }
};

// Create token table if it doesn't exist - now with a single row design
const createTokenTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS whatsapp_token (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      access_token TEXT NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `;
  await db.runQuery(query, []);
};

const loadTokenFromDB = async () => {
  const query = `SELECT access_token FROM whatsapp_token WHERE id = 1;`;
  const result = await db.runQuery(query, []);
  return result[0]?.access_token || process.env.WHATSAPP_ACCESS_TOKEN || "";
};

export const getAccessToken = async () => {
  // Return cached token if available
  if (cachedToken) {
    return cachedToken;
  }

  // If no cached token, initialize DB if needed and load from database
  await initializeDB();
  if (cachedToken) {
    return cachedToken;
  }
  const token = await loadTokenFromDB();
  cachedToken = token; // Cache the token for future use
  return token;
};

export const refreshAccessToken = async () => {
  try {
    const currentToken = await getAccessToken();

    const response = await axios.post(
      `${WHATSAPP_API_BASE}/oauth/access_token`,
      null,
      {
        params: {
          grant_type: "fb_exchange_token",
          client_id: process.env.WHATSAPP_APP_ID,
          client_secret: process.env.WHATSAPP_APP_SECRET,
          fb_exchange_token: currentToken,
        },
      }
    );

    const newToken = response.data.access_token;

    // Ensure database is initialized
    await initializeDB();

    // Update or insert the new token (upsert) with explicit timestamp
    const query = `
      INSERT INTO whatsapp_token (id, access_token, updated_at)
      VALUES (1, $1, NOW())
      ON CONFLICT (id) 
      DO UPDATE SET 
        access_token = EXCLUDED.access_token,
        updated_at = NOW();
    `;

    await db.runQuery(query, [newToken]);
    // Update cache after successful database update
    cachedToken = newToken;

    const timestamp = new Date().toLocaleTimeString();
    console.log(
      `✅ Access token refreshed and stored at ${timestamp}:`,
      newToken.slice(0, 10) + "..."
    );
  } catch (error) {
    console.error(
      "❌ Failed to refresh access token:",
      error.response?.data || error.message
    );

    // Check if this is an expired token error
    if (error.response?.data?.error?.code === 190) {
      console.log(
        "🔄 Token has expired. Please update WHATSAPP_ACCESS_TOKEN with a new token from Facebook Developer Console."
      );
      console.log(
        "📖 Instructions: https://developers.facebook.com/docs/whatsapp/business-management-api/get-started"
      );
    }

    // Clear cached token on error to force database reload on next get
    cachedToken = null;
  }
};

// Initialize the database connection
initializeDB().catch(console.error);

// Refresh token every 50 minutes
setInterval(refreshAccessToken, 50 * 60 * 1000);

// Initial refresh
refreshAccessToken();
