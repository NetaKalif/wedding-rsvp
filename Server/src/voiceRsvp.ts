// ============================================================================
// Voice RSVP — automated phone calls that confirm attendance via keypad (DTMF).
//
// Flow (all prompts are Hebrew TTS via Twilio <Say language="he-IL">):
//   1. /voice/greeting  — greet + "press 1 to confirm, 0 to decline"
//   2. /voice/answer    — reads the pressed digit:
//        0 -> declined      (rsvp_status = 0)
//        1 -> ask how many guests -> /voice/count
//   3. /voice/count     — reads the number -> rsvp_status = N (attending count)
//
// Guests are matched by eventId+guestId carried in the webhook URLs (set when
// the call is placed), so no phone lookup is needed on the callback. Results are
// written with the same db.updateEventGuestRsvp used by the WhatsApp flow:
// null = pending, 0 = declined, N = attending count.
// ============================================================================

import twilio from "twilio";
import Database from "./dbUtils";
import { log, logError } from "./logger";
import { logMessage } from "./utils";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
// Your verified business number, E.164 (e.g. +9725XXXXXXXX). Shown as caller ID.
const CALLER_ID = process.env.TWILIO_CALLER_ID;
// Public https base URL Twilio uses to reach these webhooks (ngrok in dev,
// the deployed server URL in prod). No trailing slash.
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
// Hebrew neural voices: he-IL-Wavenet-C (female, default) / he-IL-Wavenet-D (male).
const VOICE = process.env.TWILIO_VOICE || "Google.he-IL-Wavenet-C";
// Signature validation is on whenever we have an auth token; set to "false" to
// disable (e.g. local testing without a public URL Twilio can sign against).
const VALIDATE_SIGNATURE = process.env.TWILIO_VALIDATE_SIGNATURE !== "false";

const MIN_ATTENDING = 1;
const MAX_ATTENDING = 10;

const VoiceResponse = twilio.twiml.VoiceResponse;
type VoiceResponseType = InstanceType<typeof VoiceResponse>;

let cachedClient: ReturnType<typeof twilio> | null = null;

/** True when we have everything needed to place outbound calls. */
export const isVoiceConfigured = (): boolean =>
  Boolean(ACCOUNT_SID && AUTH_TOKEN && CALLER_ID && PUBLIC_BASE_URL);

const getClient = () => {
  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    throw new Error("Twilio credentials are not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).");
  }
  if (!cachedClient) cachedClient = twilio(ACCOUNT_SID, AUTH_TOKEN);
  return cachedClient;
};

// Cast to any: Twilio's SayAttributes voice/language are strict string-literal
// unions that don't yet list every Google Hebrew Wavenet voice, but they're
// accepted at runtime.
const sayOpts: any = { voice: VOICE, language: "he-IL" };
const enc = (s: string | number) => encodeURIComponent(String(s));
const webhook = (path: string, eventId: number, guestId: number) =>
  `${PUBLIC_BASE_URL}${path}?eventId=${enc(eventId)}&guestId=${enc(guestId)}`;

// ============================================================================
// Twilio request signature validation
// ============================================================================

/**
 * Verifies the X-Twilio-Signature header so only Twilio can drive these public
 * webhooks. The signed URL must exactly match what Twilio called, so we rebuild
 * it from PUBLIC_BASE_URL + the original path/query rather than trusting proxy
 * headers.
 */
export const isValidTwilioRequest = (
  originalUrl: string,
  signature: string | undefined,
  params: Record<string, unknown>,
): boolean => {
  if (!VALIDATE_SIGNATURE) return true;
  if (!AUTH_TOKEN || !signature) return false;
  const fullUrl = `${PUBLIC_BASE_URL}${originalUrl}`;
  return twilio.validateRequest(AUTH_TOKEN, signature, fullUrl, params as Record<string, string>);
};

// ============================================================================
// TwiML builders
// ============================================================================

/** Resolves the couple's names, inheriting from the primary event when unset. */
const getCoupleNames = async (
  eventId: number,
): Promise<{ groom: string; bride: string; userID: string | null }> => {
  const db = Database.getInstance();
  const event = await db.getEventById(eventId);
  if (!event) return { groom: "", bride: "", userID: null };
  let groom = event.groom_name ?? "";
  let bride = event.bride_name ?? "";
  if ((!groom || !bride) && event.user_id) {
    const events = await db.getEvents(event.user_id);
    const primary = events.find((e) => e.is_primary);
    if (primary) {
      groom = groom || primary.groom_name || "";
      bride = bride || primary.bride_name || "";
    }
  }
  return { groom, bride, userID: event.user_id ?? null };
};

const coupleClause = (groom: string, bride: string): string => {
  if (groom && bride) return `${groom} ו${bride}`;
  return groom || bride || "בני הזוג";
};

/** Step 1: greeting + confirm/decline prompt. */
export const buildGreetingTwiml = async (eventId: number, guestId: number): Promise<string> => {
  const { groom, bride } = await getCoupleNames(eventId);
  const vr: VoiceResponseType = new VoiceResponse();
  const gather = vr.gather({
    input: ["dtmf"],
    numDigits: 1,
    timeout: 8,
    action: webhook("/voice/answer", eventId, guestId),
    method: "POST",
  });
  gather.say(
    sayOpts,
    `היי, זאת שיחה לאישור ההגעה לחתונה של ${coupleClause(groom, bride)}. ` +
      `נשמח לדעת האם תגיעו לאירוע. כדי לאשר הגעה הקישו 1, כדי לומר שלא מגיעים הקישו 0.`,
  );
  // No key pressed within the timeout: say goodbye and hang up.
  vr.say(sayOpts, "לא התקבלה תשובה. נשמח לנסות שוב מאוחר יותר. להתראות!");
  vr.hangup();
  return vr.toString();
};

/** Step 2: handle the confirm/decline digit. */
export const handleAnswerDigit = async (
  eventId: number,
  guestId: number,
  digits: string | undefined,
): Promise<string> => {
  const db = Database.getInstance();
  const vr: VoiceResponseType = new VoiceResponse();

  if (digits === "0") {
    await db.updateEventGuestRsvp(eventId, guestId, 0);
    await logMessage(null, `📞 Voice RSVP declined (event ${eventId}, guest ${guestId})`);
    vr.say(sayOpts, "קיבלנו, תודה. נשמח לראותכם בשמחה הבאה!");
    vr.hangup();
    return vr.toString();
  }

  if (digits === "1") {
    const gather = vr.gather({
      input: ["dtmf"],
      finishOnKey: "#",
      numDigits: 2,
      timeout: 8,
      action: webhook("/voice/count", eventId, guestId),
      method: "POST",
    });
    gather.say(sayOpts, "מעולה! נשמח לדעת כמה אורחים תגיעו. נא להקליד מספר בלבד ולסיים בסולמית.");
    // No number entered: default to 1 confirmed guest so the RSVP isn't lost.
    vr.redirect(webhook("/voice/count", eventId, guestId));
    return vr.toString();
  }

  // Any other key: re-read the greeting once.
  vr.say(sayOpts, "לא הבנו את הבחירה.");
  vr.redirect(webhook("/voice/greeting", eventId, guestId));
  return vr.toString();
};

/** Step 3: handle the guest-count digits. */
export const handleCountDigits = async (
  eventId: number,
  guestId: number,
  digits: string | undefined,
): Promise<string> => {
  const db = Database.getInstance();
  const vr: VoiceResponseType = new VoiceResponse();
  const count = parseInt((digits || "").trim(), 10);

  if (isNaN(count) || count < MIN_ATTENDING || count > MAX_ATTENDING) {
    const gather = vr.gather({
      input: ["dtmf"],
      finishOnKey: "#",
      numDigits: 2,
      timeout: 8,
      action: webhook("/voice/count", eventId, guestId),
      method: "POST",
    });
    gather.say(
      sayOpts,
      `נא להקליד מספר בין ${MIN_ATTENDING} ל-${MAX_ATTENDING} ולסיים בסולמית.`,
    );
    vr.hangup();
    return vr.toString();
  }

  await db.updateEventGuestRsvp(eventId, guestId, count);
  await logMessage(null, `📞 Voice RSVP confirmed (event ${eventId}, guest ${guestId}): ${count}`);
  vr.say(sayOpts, `תודה רבה! רשמנו ${count} אורחים. נתראה בשמחה!`);
  vr.hangup();
  return vr.toString();
};

// ============================================================================
// Outbound calling
// ============================================================================

export interface PlaceCallsResult {
  queued: number;
  failed: number;
  skippedNoPhone: number;
  errors: Array<{ guestId: number; error: string }>;
}

/**
 * Calls every guest who hasn't RSVP'd yet for the event. Returns a summary and
 * stamps last_rsvp_sent_at on the guests we successfully queued.
 */
export const placeRsvpCalls = async (eventId: number): Promise<PlaceCallsResult> => {
  if (!isVoiceConfigured()) {
    throw new Error(
      "Voice calling is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_CALLER_ID and PUBLIC_BASE_URL.",
    );
  }
  const db = Database.getInstance();
  const client = getClient();
  const pending = await db.getEventGuests(eventId, "pending");

  const result: PlaceCallsResult = { queued: 0, failed: 0, skippedNoPhone: 0, errors: [] };
  const queuedGuestIds: number[] = [];

  for (const g of pending) {
    const guestId = g.guest_id;
    if (!g.phone) {
      result.skippedNoPhone++;
      continue;
    }
    try {
      await client.calls.create({
        to: g.phone,
        from: CALLER_ID as string,
        url: webhook("/voice/greeting", eventId, guestId),
        method: "POST",
        // Hang up on voicemail so we don't leave a confusing recording / burn minutes.
        machineDetection: "Enable",
      });
      result.queued++;
      queuedGuestIds.push(guestId);
    } catch (err: any) {
      result.failed++;
      result.errors.push({ guestId, error: err?.message || String(err) });
      logError(undefined, `Voice call failed for guest ${guestId} (event ${eventId}):`, err);
    }
  }

  await db.updateEventGuestLastRsvpSentAt(eventId, queuedGuestIds);
  log(undefined, `📞 Voice RSVP calls for event ${eventId}: ${JSON.stringify({ ...result, errors: undefined })}`);
  return result;
};
