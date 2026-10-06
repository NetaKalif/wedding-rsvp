import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import Database from "./dbUtils";
import {
  User,
  Event,
  EventGuest,
  GIFT_TYPES,
  GiftType,
  SEATING_ITEM_KINDS,
  SEATING_SHAPES,
  SeatingItem,
  MessagingPlan,
  ScheduledRound,
  ScheduledRoundType,
  SCHEDULED_ROUND_LIMITS,
} from "./types";
import { Request, Response, RequestHandler } from "express-serve-static-core";
import multer from "multer";
import {
  handleButtonReply,
  handleTextResponse,
  sendWhatsAppMessage,
  uploadImage,
  getTemplateParams,
  getMissingInvitationFields,
  logMessage,
  batchLogMessageResults,
  sendNewUserRequestNotification,
  sendMessagingPermissionRequestNotification,
  handleStatusUpdates,
  MessageResult,
} from "./utils";
import { runPaced, startSendJob, finishSendJob, getSendJob, SendJob } from "./sendQueue";
import { getDateFormat, getWeddingDateStrings, daysBetween, addDays } from "./dateUtils";
import axios from "axios";
import { getAccessToken } from "./whatsappTokenManager";
import {
  authenticateMiddleware,
  requireAdmin,
  verifyGoogleToken,
  issueSessionToken,
} from "./auth";
import { sendApprovalDecisionEmail, sendDataExportWarningEmail, sendMessagingPermissionApprovedEmail, sendDeliveryFailureReportEmail } from "./email";
import { buildAllExports, zipExports } from "./dataExport";
import { log, logError } from "./logger";
import {
  buildGreetingTwiml,
  handleAnswerDigit,
  handleCallStatus,
  handleCountDigits,
  placeRsvpCalls,
  isValidTwilioRequest,
  isVoiceConfigured,
} from "./voiceRsvp";

const upload = multer({ storage: multer.memoryStorage() });
dotenv.config({ path: ".server.env" });

const app = express();
app.use(express.json() as any);
app.use(cors({ origin: process.env.CLIENT_URL }) as any);
app.use(express.urlencoded({ extended: true }) as any);

let db: Database;

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const MAX_GUESTS_PER_MESSAGE_BATCH = 250;
const ISRAEL_TIMEZONE = "Asia/Jerusalem";
const THANK_YOU_MESSAGE_TIME = "10:00";

// Track last execution time to prevent duplicate sends within the same minute
let lastExecutionMinute = "";

// ==================== Helper Functions ====================

const getIsraelTime = (): Date => {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: ISRAEL_TIMEZONE }));
};

const isTimeToSend = (timeToUse: string): boolean => {
  const israelTime = getIsraelTime();
  const currentHour = israelTime.getHours();
  const currentMinute = israelTime.getMinutes();
  const [targetHour, targetMinute] = timeToUse.split(":").map(Number);
  return currentHour === targetHour && currentMinute === targetMinute;
};

const limitGuests = <T>(guests: T[]): T[] =>
  guests.length <= MAX_GUESTS_PER_MESSAGE_BATCH
    ? guests
    : guests.slice(0, MAX_GUESTS_PER_MESSAGE_BATCH);

/** Guests with no cellphone can't receive WhatsApp messages — exclude from every send. */
const hasPhone = (eg: EventGuest): boolean => !!eg.phone;

const handleError = async (
  res: Response,
  error: any,
  message: string,
  userID?: string,
): Promise<Response> => {
  logError(userID, message, error);
  if (userID) {
    await logMessage(userID, `❌ ${message}: ${error.message}`);
  }
  return res.status(500).send(message);
};

const checkAdminAccess = (userID: string): boolean => {
  return userID === process.env.ADMIN_USER_ID;
};

/**
 * Resolves the data owner for a given userID.
 * If the user is linked to a primary account, returns the primary's userID.
 * Otherwise returns the user's own ID.
 *
 * Use this for all data operations (guests, wedding info, tasks, logs)
 * so that linked partners access the same data as their primary.
 */
const resolveDataOwner = async (userID: string): Promise<string> => {
  return db.getEffectiveUserID(userID);
};

// Short-lived signed tokens for image/file URLs that can't carry an
// Authorization header (used directly as <img src>/<a href>).
type MediaResource = "primaryImage" | "eventImage" | "vendorFile" | "dataExport";

interface MediaTokenPayload {
  userID: string;
  resource: MediaResource;
  resourceId?: number;
}

const verifyMediaToken = (
  token: string | undefined,
  resource: MediaResource,
  resourceId?: number,
): MediaTokenPayload | null => {
  if (!token) return null;
  try {
    const payload = jwt.verify(
      token,
      process.env.MEDIA_TOKEN_SECRET as string,
    ) as MediaTokenPayload;
    if (payload.resource !== resource) return null;
    if (resourceId !== undefined && payload.resourceId !== resourceId) return null;
    return payload;
  } catch {
    return null;
  }
};

// ==================== Public Routes (no auth required) ====================

app.get("/health", async (req: Request, res: Response) => {
  res.status(200).json({ "ok": ":)" });
});

app.get("/sms", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      log(undefined, "✅ Webhook verified");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  }
});

app.post("/sms", async (req: Request, res: Response) => {
  try {
    const data = req.body;
    const value = data?.entry?.[0]?.changes?.[0]?.value;

    // Delivery-status updates (sent/delivered/read/failed) for messages we
    // dispatched — failures are logged to the owner's activity log.
    if (Array.isArray(value?.statuses) && value.statuses.length > 0) {
      await handleStatusUpdates(value.statuses);
    }

    if (!value?.messages || !Array.isArray(value.messages)) {
      return res.sendStatus(200); // Acknowledge it to avoid retries
    }

    const message = value.messages[0];
    const sender = "+" + message.from;
    const candidates = await db.getAllRsvpCandidatesByPhone(sender);

    if (candidates.length === 0) {
      log(undefined, `Phone number not found in guest list or events: ${sender}`);
      return res.sendStatus(200);
    }

    // Pick the candidate with the most recent lastRsvpSentAt across weddings + events
    let latestTs: Date | null = null;
    let bestCandidate = candidates[0];

    for (const candidate of candidates) {
      const ts = candidate.lastRsvpSentAt;
      if (ts && (!latestTs || ts > latestTs)) {
        latestTs = ts;
        bestCandidate = candidate;
      }
    }

    // All candidates now have the same shape — wedding is just another event
    const { eventId, guestId, phone, userID: candidateUserID, guestName, numberOfGuests, askInvitedCount } = bestCandidate;
    let msg: string;
    if (message.type === "button") {
      msg = message.button?.payload || message.button?.text || "";
      await logMessage(candidateUserID, `🔘 SMS button reply for event ${eventId} from ${guestName} (${phone}): ${msg}`);
      await handleButtonReply(msg, {
        phone, userID: candidateUserID, eventId, guestId, guestName, numberOfGuests, askInvitedCount,
      }).catch((error) => {
        logError(candidateUserID, "Error processing SMS:", error);
        return res.status(500).send(error.message);
      });
    } else if (message.type === "text") {
      msg = message.text.body;
      await logMessage(candidateUserID, `📥 SMS text from ${guestName} (${phone}): ${msg}`);
      await handleTextResponse(msg, phone, candidateUserID, eventId, guestId, guestName).catch((error) => {
        logError(candidateUserID, "Error processing SMS:", error);
        return res.status(500).send(error.message);
      });
    }

    res.sendStatus(200);
  } catch (error) {
    logError(undefined, "Error processing SMS:", error);
    return res.status(500).send("Server error");
  }
});

app.post("/auth/google", async (req: Request, res: Response) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).send("credential is required");

    const identity = await verifyGoogleToken(credential);
    const isAdmin = checkAdminAccess(identity.userID);
    const { isNewUser, status: currentStatus } = await db.addUser(
      identity,
      isAdmin ? "approved" : "pending",
    );

    let effectiveStatus = currentStatus;
    let shouldNotifyAdmin = false;

    if (isAdmin && currentStatus !== "approved") {
      await db.updateUserStatus(identity.userID, "approved");
      effectiveStatus = "approved";
    } else if (!isAdmin && isNewUser) {
      // addUser already inserted this row as 'pending'
      shouldNotifyAdmin = true;
    } else if (!isAdmin && currentStatus === "declined") {
      // Re-request after a prior decline — treat like a fresh request.
      await db.updateUserStatus(identity.userID, "pending");
      effectiveStatus = "pending";
      shouldNotifyAdmin = true;
    }

    if (effectiveStatus !== "approved") {
      if (shouldNotifyAdmin) {
        sendNewUserRequestNotification(identity.name, identity.email).catch((error) =>
          logError(identity.userID, "Failed to send new-user-request WhatsApp notification:", error),
        );
      }
      await logMessage(identity.userID, `⏳ Pending approval: ${identity.name} (${identity.email})`);
      return res.status(200).json({ status: "pending" });
    }

    const token = issueSessionToken({ ...identity, isAdmin });

    await logMessage(identity.userID, `🔑 Signed in: ${identity.name} (${identity.email})`);

    // The plan lives on the effective data owner, so a linked partner sees the same plan
    const messagingPlan = await db.getMessagingPlan(await db.getEffectiveUserID(identity.userID));
    res.status(200).json({ token, user: { ...identity, messagingPlan }, isAdmin, status: "approved" });
  } catch (error) {
    return handleError(res, error, "Failed to sign in with Google");
  }
});

// Test-only trigger so integration tests can exercise the retention sweep
// deterministically instead of waiting on the real 60-second interval.
// Registered here (above the auth middleware) since it's a system-level test
// utility, not tied to any user's session.
if (process.env.NODE_ENV === "test") {
  app.post("/test/run-retention-check", async (req: Request, res: Response) => {
    try {
      await runAccountRetentionCheck();
      res.status(200).send("ok");
    } catch (error) {
      return handleError(res, error, "Failed to run retention check");
    }
  });

  // Test-only trigger for the new-user-request WhatsApp notification, since
  // the real path (/auth/google) requires a real Google credential.
  app.post("/test/trigger-new-user-notification", async (req: Request, res: Response) => {
    try {
      const { name, email } = req.body;
      await sendNewUserRequestNotification(name, email);
      res.status(200).send("ok");
    } catch (error) {
      return handleError(res, error, "Failed to send new-user-request notification");
    }
  });

  // Test-only trigger for the scheduled-message sweep, bypassing the exact
  // send-time checks so tests don't have to race the wall clock.
  app.post("/test/run-scheduled-messages", async (req: Request, res: Response) => {
    try {
      await sendScheduledMessages(true);
      res.status(200).send("ok");
    } catch (error) {
      return handleError(res, error, "Failed to run scheduled messages");
    }
  });

  // Test-only trigger for the "send and go" scheduled-rounds sweep. Bypasses
  // the scheduled_at check and (via bypassTime) the failure-report grace
  // window; eventId scopes the sweep so parallel tests don't claim each
  // other's rounds.
  app.post("/test/run-scheduled-rounds", async (req: Request, res: Response) => {
    try {
      const eventId = req.body?.eventId ? Number(req.body.eventId) : undefined;
      await processScheduledRounds({ bypassTime: true, eventId });
      res.status(200).send("ok");
    } catch (error) {
      return handleError(res, error, "Failed to run scheduled rounds");
    }
  });
}

// ==================== Voice RSVP webhooks (Twilio, no session — validated by signature) ====================
// Twilio drives an outbound IVR call: greet -> press 1 (confirm) / 0 (decline) ->
// if confirmed, ask for guest count. Guests are identified by eventId+guestId in
// the query string (set when the call is placed), so no session/phone lookup is
// needed. Requests are authenticated via the X-Twilio-Signature header instead.

const guardTwilio = (req: Request, res: Response): boolean => {
  const signature = req.headers["x-twilio-signature"] as string | undefined;
  if (!isValidTwilioRequest(req.originalUrl, signature, req.body || {})) {
    res.status(403).send("Invalid Twilio signature");
    return false;
  }
  return true;
};

const sendTwiml = (res: Response, twiml: string) => {
  res.type("text/xml").status(200).send(twiml);
};

app.post("/voice/greeting", async (req: Request, res: Response) => {
  try {
    if (!guardTwilio(req, res)) return;
    const eventId = parseInt(String(req.query.eventId));
    const guestId = parseInt(String(req.query.guestId));
    sendTwiml(res, await buildGreetingTwiml(eventId, guestId));
  } catch (error) {
    logError(undefined, "Voice greeting webhook failed:", error);
    res.type("text/xml").status(200).send("<Response><Hangup/></Response>");
  }
});

app.post("/voice/answer", async (req: Request, res: Response) => {
  try {
    if (!guardTwilio(req, res)) return;
    const eventId = parseInt(String(req.query.eventId));
    const guestId = parseInt(String(req.query.guestId));
    sendTwiml(res, await handleAnswerDigit(eventId, guestId, req.body?.Digits));
  } catch (error) {
    logError(undefined, "Voice answer webhook failed:", error);
    res.type("text/xml").status(200).send("<Response><Hangup/></Response>");
  }
});

app.post("/voice/count", async (req: Request, res: Response) => {
  try {
    if (!guardTwilio(req, res)) return;
    const eventId = parseInt(String(req.query.eventId));
    const guestId = parseInt(String(req.query.guestId));
    sendTwiml(res, await handleCountDigits(eventId, guestId, req.body?.Digits));
  } catch (error) {
    logError(undefined, "Voice count webhook failed:", error);
    res.type("text/xml").status(200).send("<Response><Hangup/></Response>");
  }
});

// Status callback (fires once per call when it ends): records whether the guest
// picked up (CallStatus completed + AnsweredBy human), got voicemail
// (machine_*), was busy/declined, or didn't answer.
app.post("/voice/status", async (req: Request, res: Response) => {
  try {
    if (!guardTwilio(req, res)) return;
    const eventId = parseInt(String(req.query.eventId));
    const guestId = parseInt(String(req.query.guestId));
    await handleCallStatus(eventId, guestId, req.body?.CallStatus, req.body?.AnsweredBy);
    res.status(204).send();
  } catch (error) {
    logError(undefined, "Voice status webhook failed:", error);
    res.status(204).send();
  }
});

// ==================== Auth Middleware (everything below requires a valid session) ====================

app.use(authenticateMiddleware);

app.get("/auth/me", async (req: Request, res: Response) => {
  try {
    const user = await db.getUserByID(req.auth.userID);
    if (!user) return res.status(404).send("User not found");
    // The plan lives on the effective data owner, so a linked partner sees the same plan
    const messagingPlan = await db.getMessagingPlan(await resolveDataOwner(req.auth.userID));
    // status lets the client kick a revoked user back to the pending page on session restore
    res.status(200).json({ user: { ...user, messagingPlan }, isAdmin: req.auth.isAdmin, status: user.status });
  } catch (error) {
    return handleError(res, error, "Failed to load current user");
  }
});

// ==== Tour Management ====
app.get("/tour/seen", async (req: Request, res: Response) => {
  try {
    const hasBeenSeen = await db.hasTourBeenSeen(req.auth.userID);
    res.status(200).json({ tourSeen: hasBeenSeen });
  } catch (error) {
    return handleError(res, error, "Failed to check tour status");
  }
});

app.post("/tour/mark-seen", async (req: Request, res: Response) => {
  try {
    await db.markTourAsSeen(req.auth.userID);
    res.status(200).json({ success: true });
  } catch (error) {
    return handleError(res, error, "Failed to mark tour as seen");
  }
});

app.post("/auth/impersonate", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { targetUserID } = req.body;
    if (!targetUserID) return res.status(400).send("targetUserID is required");

    const targetUser = await db.getUserByID(targetUserID);
    if (!targetUser) return res.status(404).send("User not found");

    const token = issueSessionToken({
      userID: targetUser.userID,
      email: targetUser.email,
      name: targetUser.name,
      isAdmin: true,
      actor: req.auth.actorUserID,
    });

    await logMessage(req.auth.actorUserID, `🎭 Admin switched into account: ${targetUser.name} (${targetUser.userID})`);

    const messagingPlan = await db.getMessagingPlan(await resolveDataOwner(targetUser.userID));
    res.status(200).json({ token, user: { ...targetUser, messagingPlan } });
  } catch (error) {
    return handleError(res, error, "Failed to switch user");
  }
});

app.post("/media/token", async (req: Request, res: Response) => {
  try {
    const { resource, resourceId }: { resource: MediaResource; resourceId?: number } = req.body;
    if (!resource) return res.status(400).send("resource is required");

    const payload: MediaTokenPayload = {
      userID: req.auth.userID,
      resource,
      ...(resourceId !== undefined ? { resourceId } : {}),
    };
    const token = jwt.sign(payload, process.env.MEDIA_TOKEN_SECRET as string, { expiresIn: 60 });
    res.status(200).json({ token });
  } catch (error) {
    return handleError(res, error, "Failed to mint media token");
  }
});

// ==================== Routes ====================

app.post("/updateRsvp", async (req: Request, res: Response) => {
  try {
    const { eventId, guestId, rsvpStatus } = req.body;
    const dataOwner = await resolveDataOwner(req.auth.userID);
    await db.updateEventGuestRsvp(Number(eventId), Number(guestId), rsvpStatus ?? null);
    const guests = await db.getEventGuests(Number(eventId));
    const guestName = guests.find((g) => g.guest_id === Number(guestId))?.name ?? `guest ${guestId}`;
    await logMessage(dataOwner, `📠 RSVP manually updated for ${guestName} in event ${eventId}: ${rsvpStatus}`);
    res.status(200).json(guests);
  } catch (error) {
    logError(req.auth?.userID, "Error updating RSVP:", error);
    return res.status(500).send("Failed to update RSVP");
  }
});

app.post("/guestsList", async (req: Request, res: Response) => {
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);

    const guestsList = await db.getGuests(dataOwner);
    res.status(200).json(guestsList);
  } catch (error) {
    logError(req.auth?.userID, "Error retrieving guest list:", error);
    return res.status(500).send("Error retrieving guest list");
  }
});

app.patch("/addGuests", async (req: Request, res: Response) => {
  const { guestsToAdd } = req.body;
  try {
    if (!Array.isArray(guestsToAdd)) {
      return res.status(400).send("Invalid input: expected an array of guests");
    }
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const added = await db.addGuests(dataOwner, guestsToAdd);
    await logMessage(dataOwner, `👥 Added ${added.length} guests`);
    res.status(200).json(added);
  } catch (error) {
    return handleError(res, error, "Failed to add guests", req.auth.userID);
  }
});

app.patch("/updateGuest", async (req: Request, res: Response) => {
  const { guestId, updates } = req.body;
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const updated = await db.updateGuest(dataOwner, Number(guestId), updates);
    if (!updated) return res.status(404).send("Guest not found");
    await logMessage(dataOwner, `✏️ Guest ${guestId} updated`);
    res.status(200).json(updated);
  } catch (error: any) {
    if (error.code === "23505") {
      return res.status(400).send("מספר הטלפון כבר קשור לאורח קיים ברשימה.");
    }
    return handleError(res, error, "Failed to update guest", req.auth.userID);
  }
});

// Hard-deletes the caller's account (FK cascades remove all owned data).
// Guards: an explicit confirm flag so no client code path can delete an
// account implicitly, and no deletion while impersonating — admins must use
// /admin/deleteUser, which attributes the action to them.
app.delete("/deleteUser", async (req: Request, res: Response) => {
  const userID = req.auth.userID;
  try {
    if (req.auth.actorUserID !== userID) {
      return res.status(403).send("Cannot delete an account while impersonating it");
    }
    if (req.query.confirm !== "true") {
      return res.status(400).send("Account deletion requires confirm=true");
    }
    const user = await db.getUserByID(userID);
    if (!user) return res.status(404).send("User not found");

    const dataOwner = await resolveDataOwner(userID);
    const primaryEvent = await db.getPrimaryEvent(dataOwner);
    await db.recordDeletedAccount({
      userID,
      email: user.email,
      name: user.name,
      weddingDate: primaryEvent?.date ?? null,
      role: dataOwner === userID ? "owner" : "partner",
    });
    await db.deleteUser(userID);
    await logMessage(undefined, `🗑️ User account deleted: ${user.name} (${userID})`);
    res.status(200).send("User deleted");
  } catch (error) {
    return handleError(res, error, "Failed to delete user", userID);
  }
});

app.delete("/deleteAllGuests", async (req: Request, res: Response) => {
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);

    await db.deleteAllGuests(dataOwner);
    const guestsList = await db.getGuests(dataOwner);
    await logMessage(dataOwner, "🧹 All guests deleted from account");
    res.status(200).send(guestsList);
  } catch (error) {
    return handleError(res, error, "Failed to reset database", req.auth.userID);
  }
});

app.delete("/deleteGuest", async (req: Request, res: Response) => {
  const { guestId } = req.body;
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);
    await db.deleteGuest(dataOwner, Number(guestId));
    await logMessage(dataOwner, `👋 Guest ${guestId} deleted`);
    const guests = await db.getGuests(dataOwner);
    res.status(200).json(guests);
  } catch (error) {
    return handleError(res, error, "Failed to delete guest", req.auth.userID);
  }
});

// Save / update primary event (wedding info)
app.post(
  "/saveWeddingInfo",
  upload.single("imageFile") as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const dataOwner = await resolveDataOwner(req.auth.userID);
      const info = JSON.parse(req.body.weddingInfo);
      const file = (req as any).file;

      let primary = await db.getPrimaryEvent(dataOwner);
      const isFirstSetup = !primary;

      // Map legacy field names → new Event field names
      const updates: Partial<Event> = {
        ceremony_name: info.ceremony_name || "חתונה",
        bride_name: info.bride_name,
        groom_name: info.groom_name,
        date: info.wedding_date || info.date,
        time: info.hour || info.time,
        location: info.location_name || info.location,
        additional_info: info.additional_information || info.additional_info,
        waze_link: info.waze_link,
        gift_link: info.gift_link,
        thank_you_message: info.thank_you_message,
        send_reminder: info.send_reminder ?? (info.reminder_time ? true : false),
        ask_invited_count: info.ask_invited_count ?? false,
        reminder_day: info.reminder_day,
        reminder_time: info.reminder_time,
        reminder_additional_text: info.reminder_additional_text,
        send_thank_you: info.send_thank_you ?? false,
        estimated_guests: info.estimated_guests,
        total_budget: info.total_budget,
      };

      if (file) {
        updates.file_id = await uploadImage(file);
      } else if (primary?.file_id) {
        updates.file_id = primary.file_id;
      } else if (info.fileID) {
        updates.file_id = info.fileID;
      }

      if (!primary) {
        primary = await db.createEvent(dataOwner, { is_primary: true, ceremony_name: "חתונה", ...updates });
      } else {
        primary = await db.updateEvent(primary.id, updates);
      }

      if (isFirstSetup) {
        await db.populateDefaultTasks(dataOwner);
        // Auto-add all guests to the primary event
        const guests = await db.getGuests(dataOwner);
        if (guests.length > 0) {
          await db.addEventGuests(primary.id, guests.map((g) => g.id));
        }
      }

      await logMessage(dataOwner, `💒 Wedding information saved`);
      res.status(200).json(primary);
    } catch (error) {
      return handleError(res, error, "Failed to save wedding information", req.auth.userID);
    }
  },
);

app.get("/getWeddingInfo", async (req: Request, res: Response) => {
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const primary = await db.getPrimaryEvent(dataOwner);
    if (!primary) return res.status(404).json(null);
    res.status(200).json(primary);
  } catch (error) {
    return res.status(500).send("Failed to retrieve wedding information");
  }
});

// Non-primary events inherit bride/groom names from the primary event when unset.
const withInheritedCoupleNames = async (event: Event): Promise<Event> => {
  if (event.is_primary && event.bride_name) return event;
  const primary = event.is_primary ? event : await db.getPrimaryEvent(event.user_id);
  return { ...event, bride_name: event.bride_name || primary?.bride_name, groom_name: event.groom_name || primary?.groom_name };
};

// Send messages for a specific event
app.post("/sendMessage", async (req: Request, res: Response) => {
  try {
    const { options } = req.body;
    const dataOwner = await resolveDataOwner(req.auth.userID);

    // Check messaging permission (admins are exempt — they're the ones granting it)
    const messagingStatus = await db.getMessagingPermissionStatus(dataOwner);
    if (!req.auth.isAdmin && messagingStatus !== "approved") {
      return res.status(403).json({
        error: "You don't have permission to send messages. Please request permission from the admin.",
        messagingStatus,
      });
    }

    const customText: string = options?.customText;
    const selectedGuestIds: number[] | undefined = options?.guestIds;
    const failedOnly: boolean = options?.failedOnly === true;
    // Guests added after the invitation already went out: no send was ever
    // attempted for them (last_message_type is NULL), so they need the
    // invitation now.
    const unsentOnly: boolean = options?.unsentOnly === true;
    if (failedOnly && unsentOnly) {
      return res.status(400).send("failedOnly and unsentOnly cannot be combined");
    }
    // Both targeted sends are always the invitation: a failed delivery means
    // a number to fix, a never-sent guest was added late — either way the
    // invitation is what they're missing, and they can still RSVP from it.
    const messageType: string = failedOnly || unsentOnly ? "rsvp" : options?.messageType || "rsvp";

    // "Send and go" couples don't send manually — the scheduler does. The
    // exceptions are the targeted invitation sends: resending to guests whose
    // delivery failed, and inviting guests added after the invitation round.
    const messagingPlan = await db.getMessagingPlan(dataOwner);
    if (!req.auth.isAdmin && messagingPlan === "scheduled" && !failedOnly && !unsentOnly) {
      return res.status(403).json({
        error: "Your messages are sent on a schedule. Manual sending is only available for failed-delivery resends and newly added guests.",
        messagingPlan,
      });
    }

    if (messageType === "freeText" && (!customText || !customText.trim())) {
      return res.status(400).send("Custom text message cannot be empty");
    }

    // Resolve which event to use
    let eventId: number | undefined = options?.eventId ? Number(options.eventId) : undefined;
    let event: Event | null;
    if (eventId) {
      event = await db.getEventById(eventId);
      if (!event || event.user_id !== dataOwner) return res.status(404).send("Event not found");
    } else {
      event = await db.getPrimaryEvent(dataOwner);
      if (!event) return res.status(400).send("No primary event found — please set up wedding info first");
      eventId = event.id;
    }

    event = await withInheritedCoupleNames(event);

    // An incomplete invitation (no photo, no date…) must never reach guests —
    // this also covers the targeted sends (failedOnly/unsentOnly), which are
    // always the invitation.
    if (messageType === "rsvp") {
      const missingFields = getMissingInvitationFields(event);
      if (missingFields.length > 0) {
        return res.status(400).json({
          error: `Invitation details are incomplete — missing: ${missingFields.join(", ")}`,
          missingFields,
        });
      }
    }

    // Get event guests with optional RSVP filter. Thank-yous only go to guests
    // who confirmed, matching the scheduled day-after send. A failed-only
    // resend ignores the filter — it targets exactly the guests with a stored
    // send error, whatever message type failed for them.
    const rsvpFilter =
      failedOnly || unsentOnly ? undefined
        : messageType === "rsvpReminder" ? "pending"
          : messageType === "eventReminder" || messageType === "thankYou" ? "approved"
            : undefined;
    let eventGuests = await db.getEventGuests(eventId, rsvpFilter).then((guests) => guests.filter(hasPhone));

    if (failedOnly) {
      eventGuests = eventGuests.filter((eg) => eg.last_send_error);
    }
    if (unsentOnly) {
      eventGuests = eventGuests.filter((eg) => !eg.last_message_type);
    }
    if (selectedGuestIds?.length) {
      eventGuests = eventGuests.filter((eg) => selectedGuestIds.includes(eg.guest_id));
    }

    if (eventGuests.length === 0) {
      return res.status(400).send("No guests match the selected criteria");
    }

    const limited = limitGuests(eventGuests);
    if (limited.length < eventGuests.length) {
      await logMessage(dataOwner, `⚠️ Guest list limited to ${MAX_GUESTS_PER_MESSAGE_BATCH} (WhatsApp limit)`);
    }

    const label = failedOnly ? "failed-messages resend" : unsentOnly ? "invitation for newly added guests" : messageType === "rsvp" ? "RSVP invitation" : messageType === "rsvpReminder" ? "RSVP reminder" : messageType === "eventReminder" ? "event reminder" : messageType === "thankYou" ? "thank-you" : "custom text";

    // Register the send job (polled via GET /sendProgress). A null job means a
    // dispatch is already running for this owner — reject rather than double-send.
    const job = startSendJob(dataOwner, label, limited.map((eg) => ({ phone: eg.phone, name: eg.name || eg.phone })));
    if (!job) {
      return res.status(409).send("A message send is already in progress");
    }

    await logMessage(dataOwner, `📨 Sending ${label} for "${event.ceremony_name}" to ${limited.length} guests`);

    let results;
    try {
      const tasks = buildMessageTasks(limited, messageType, customText, event, dataOwner);
      results = await sendMessagesAndLog(tasks, dataOwner, "🎯", label, [], job);
    } finally {
      // Always release the job — a stuck "active" job would block future sends.
      finishSendJob(job);
    }

    await db.setEventGuestsLastMessageType(eventId, limited.map((eg) => eg.guest_id), messageType);
    if (messageType === "rsvp" || messageType === "rsvpReminder") {
      await db.updateEventGuestLastRsvpSentAt(eventId, limited.map((eg) => eg.guest_id));
    }
    // Only invitation outcomes drive the failed-guests panel/email — a failed
    // invitation means a number to fix; later-round failures are mostly
    // transient (frequency caps, opt-outs) and only go to the activity log.
    if (messageType === "rsvp") {
      await db.recordGuestSendResults(eventId, results.results);
    }

    return res.status(200).send({ success: results.success, fail: results.fail, failGuestsList: results.failGuestsList });
  } catch (error) {
    logError(req.auth?.userID, "Error sending messages:", error);
    return res.status(500).send(error.message);
  }
});

// Progress of the current (or just-finished) bulk send for this data owner —
// polled by the client to drive the send-progress bar. deliveryFailures are
// webhook-reported failures (📵) attached while the job is live, including
// the post-dispatch grace window.
app.get("/sendProgress", async (req: Request, res: Response) => {
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const job = getSendJob(dataOwner);
    if (!job) return res.status(200).json({ active: false });

    res.status(200).json({
      active: true,
      label: job.label,
      total: job.total,
      completed: job.completed,
      failed: job.failed,
      dispatchDone: job.dispatchDone,
      deliveryFailures: job.deliveryFailures,
    });
  } catch (error) {
    return handleError(res, error, "Failed to retrieve send progress");
  }
});

// Message types the couple can try out on their own phone.
const TEST_MESSAGE_TYPES = ["rsvp", "rsvpReminder", "eventReminder", "thankYou", "freeText"];

/** Accepts the local formats guests are entered with (05x…, 5x…) and normalizes to +9725xxxxxxxx. */
const normalizeTestPhone = (phone: string): string | null => {
  const trimmed = phone.replace(/[\s-]/g, "");
  const formatted = trimmed.startsWith("0")
    ? `+972${trimmed.slice(1)}`
    : trimmed.startsWith("5") ? `+972${trimmed}` : trimmed;
  return /^\+9725\d{8}$/.test(formatted) ? formatted : null;
};

// Send a single test message to the couple's own phone, so they can see a
// message exactly as guests will receive it before any real send. Available on
// both messaging plans: a "send and go" couple can't send to guests manually,
// but a test send targets only the provided phone — never guests — so the
// scheduled-plan block doesn't apply, and no guest send-state is stamped.
app.post("/sendTestMessage", async (req: Request, res: Response) => {
  try {
    const { options } = req.body;
    const dataOwner = await resolveDataOwner(req.auth.userID);

    // Same permission gate as /sendMessage — a test still sends a real
    // (billable) WhatsApp message.
    const messagingStatus = await db.getMessagingPermissionStatus(dataOwner);
    if (!req.auth.isAdmin && messagingStatus !== "approved") {
      return res.status(403).json({
        error: "You don't have permission to send messages. Please request permission from the admin.",
        messagingStatus,
      });
    }

    const phone = normalizeTestPhone(typeof options?.phone === "string" ? options.phone : "");
    if (!phone) return res.status(400).send("A valid Israeli mobile number is required");

    const messageType: string = options?.messageType || "rsvp";
    if (!TEST_MESSAGE_TYPES.includes(messageType)) {
      return res.status(400).send(`Unknown message type: ${messageType}`);
    }

    const customText: string = options?.customText;
    if (messageType === "freeText" && (!customText || !customText.trim())) {
      return res.status(400).send("Custom text message cannot be empty");
    }

    // Resolve the event the same way /sendMessage does
    let event: Event | null;
    if (options?.eventId) {
      event = await db.getEventById(Number(options.eventId));
      if (!event || event.user_id !== dataOwner) return res.status(404).send("Event not found");
    } else {
      event = await db.getPrimaryEvent(dataOwner);
      if (!event) return res.status(400).send("No primary event found — please set up wedding info first");
    }
    event = await withInheritedCoupleNames(event);

    // The invitation template renders the photo/names/date/location — testing
    // it needs the same content the real send does.
    if (messageType === "rsvp") {
      const missingFields = getMissingInvitationFields(event);
      if (missingFields.length > 0) {
        return res.status(400).json({
          error: `Invitation details are incomplete — missing: ${missingFields.join(", ")}`,
          missingFields,
        });
      }
    }

    // A pseudo-guest carrying only what buildMessageTasks reads (phone, name,
    // user_id) — nothing is written to event_guests for a test send.
    const testRecipient = { phone, name: "הודעת ניסיון", user_id: dataOwner } as EventGuest;
    const [task] = buildMessageTasks([testRecipient], messageType, customText, event, dataOwner);
    const result = await task();

    await logMessage(
      dataOwner,
      result.success
        ? `🧪 Test message (${messageType}) sent to ${phone}`
        : `🧪 Test message (${messageType}) to ${phone} failed: ${result.error}`,
    );

    return res.status(200).send({ success: result.success, error: result.success ? undefined : result.error });
  } catch (error) {
    logError(req.auth?.userID, "Error sending test message:", error);
    return res.status(500).send(error.message);
  }
});

const sendMessagesAndLog = async (
  tasks: Array<() => Promise<MessageResult>>,
  userID: string,
  successEmoji: string,
  messageLabel: string,
  preMessageLogs: string[] = [],
  job?: SendJob,
): Promise<{
  success: number;
  fail: number;
  failGuestsList: Pick<MessageResult, "guestName" | "logMessage">[];
  results: MessageResult[];
}> => {
  // Paced dispatch — firing the whole batch at once gets 200 OKs from Meta
  // but silently drops delivery for part of the recipients (throttling).
  // Scheduler sends pass no job (nothing polls their progress).
  const results = await runPaced(tasks, {
    onResult: job
      ? (r) => {
        job.completed++;
        if (!(r as MessageResult).success) job.failed++;
      }
      : undefined,
  });

  const successCount = results.filter((r) => r.success).length;
  const fail = results.filter((r) => !r.success);
  const failCount = fail.length;
  const failGuestsList = fail.map((r) => ({
    logMessage: r.logMessage,
    guestName: r.guestName,
  }));

  const summaryMessage =
    failCount === 0
      ? `${successEmoji} ${messageLabel} sent successfully to ${successCount} guests`
      : `${successEmoji} ${messageLabel}: \n ✅ ${successCount} sent, ❌ ${failCount} failed`;

  await batchLogMessageResults([
    ...preMessageLogs.map((msg) => ({
      success: true,
      userID,
      guestName: "",
      logMessage: msg,
    })),
    ...results,
    { success: true, userID, guestName: "", logMessage: summaryMessage },
  ]);
  return { success: successCount, fail: failCount, failGuestsList, results };
};

// Returns thunks (not live promises) so sendMessagesAndLog can pace the
// dispatch instead of firing everything at once.
const buildMessageTasks = (
  eventGuests: EventGuest[],
  messageType: string,
  customText: string,
  event: Event,
  userID: string,
): Array<() => Promise<MessageResult>> => {
  const toRecipient = (eg: EventGuest) => ({ phone: eg.phone, user_id: eg.user_id || userID, name: eg.name || eg.phone, guest_id: eg.guest_id });

  if (messageType === "freeText") {
    return eventGuests.map((eg) => () => sendWhatsAppMessage(toRecipient(eg), { freeText: customText }));
  }
  if (messageType === "rsvpReminder") {
    return eventGuests.map((eg) => () => sendWhatsAppMessage(toRecipient(eg), { template: { name: "wedding_rsvp_reminder", event } }));
  }
  // Day wording and the optional waze/payment links are resolved from the
  // event itself in getTemplateParams.
  if (messageType === "eventReminder") {
    return eventGuests.map((eg) => () => sendWhatsAppMessage(toRecipient(eg), { template: { name: "event_reminder", event } }));
  }
  if (messageType === "thankYou") {
    const templateName = event.thank_you_message ? "custom_thank_you_message" : "thank_you_message";
    return eventGuests.map((eg) => () => sendWhatsAppMessage(toRecipient(eg), { template: { name: templateName, event } }));
  }
  // Default: RSVP invitation
  return eventGuests.map((eg) => () => sendWhatsAppMessage(toRecipient(eg), { template: { name: "wedding_rsvp_action", event } }));
};

app.get("/getImage", async (req: Request, res: Response) => {
  let mediaUserID: string | undefined;
  try {
    const mediaToken = req.query.mediaToken as string;
    const payload = verifyMediaToken(mediaToken, "primaryImage");
    if (!payload) return res.status(401).send("Invalid or expired media token");
    mediaUserID = payload.userID;

    const dataOwner = await resolveDataOwner(payload.userID);
    const primary = await db.getPrimaryEvent(dataOwner);
    if (!primary?.file_id) return res.status(404).send("No image");
    const ACCESS_TOKEN = await getAccessToken();

    const response = await axios.get(
      `https://graph.facebook.com/v19.0/${primary.file_id}`,
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        params: {
          access_token: ACCESS_TOKEN,
        },
      },
    );

    const imageUrl = response.data.url;

    const imageResponse = await axios.get(imageUrl, {
      responseType: "stream",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
      },
    });

    res.setHeader("Content-Type", imageResponse.headers["content-type"] as string);
    imageResponse.data.pipe(res);
  } catch (err) {
    logError(mediaUserID, err);
    return res.status(500).json({ error: "Failed to fetch image" });
  }
});

app.get("/logs", async (req: Request, res: Response) => {
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);

    const logs = await db.getClientLogs(dataOwner);
    res.status(200).json(logs);
  } catch (error) {
    logError(req.auth?.userID, "Error retrieving logs:", error);
    return res.status(500).send("Failed to retrieve logs");
  }
});

// ==================== Task Endpoints ====================

// Get all tasks for a user (grouped by timeline)
app.get("/tasks", async (req: Request, res: Response) => {
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);

    const tasks = await db.getTasks(dataOwner);
    res.status(200).json(tasks);
  } catch (error) {
    logError(req.auth?.userID, "Error retrieving tasks:", error);
    return res.status(500).send("Failed to retrieve tasks");
  }
});

// Add a new task
app.post("/tasks", async (req: Request, res: Response) => {
  try {
    const { task } = req.body;
    if (!task?.title || !task?.timeline_group) {
      return res
        .status(400)
        .send("title and timeline_group are required");
    }
    const dataOwner = await resolveDataOwner(req.auth.userID);

    const newTask = await db.addTask(dataOwner, task);
    await logMessage(dataOwner, `📝 New task added: "${task.title}"`);
    res.status(201).json(newTask);
  } catch (error) {
    logError(req.auth?.userID, "Error adding task:", error);
    return res.status(500).send("Failed to add task");
  }
});

// Update task completion status
app.patch("/tasks/:taskId/complete", async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { isCompleted } = req.body;
    if (isCompleted === undefined) {
      return res.status(400).send("isCompleted is required");
    }
    const dataOwner = await resolveDataOwner(req.auth.userID);

    const updatedTask = await db.updateTaskCompletion(
      dataOwner,
      parseInt(taskId),
      isCompleted,
    );
    if (!updatedTask) {
      return res.status(404).send("Task not found");
    }
    res.status(200).json(updatedTask);
  } catch (error) {
    logError(req.auth?.userID, "Error updating task completion:", error);
    return res.status(500).send("Failed to update task");
  }
});

// Update task details
app.patch("/tasks/:taskId", async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { updates } = req.body;
    const dataOwner = await resolveDataOwner(req.auth.userID);

    const updatedTask = await db.updateTask(
      dataOwner,
      parseInt(taskId),
      updates,
    );
    if (!updatedTask) {
      return res.status(404).send("Task not found or no updates provided");
    }
    res.status(200).json(updatedTask);
  } catch (error) {
    logError(req.auth?.userID, "Error updating task:", error);
    return res.status(500).send("Failed to update task");
  }
});

// Delete (soft delete) a task
app.delete("/tasks/:taskId", async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const dataOwner = await resolveDataOwner(req.auth.userID);

    const deleted = await db.deleteTask(dataOwner, parseInt(taskId));
    if (!deleted) {
      return res.status(404).send("Task not found");
    }
    await logMessage(dataOwner, `🗑️ Task deleted`);
    res.status(200).send("Task deleted successfully");
  } catch (error) {
    logError(req.auth?.userID, "Error deleting task:", error);
    return res.status(500).send("Failed to delete task");
  }
});

// ==================== Messaging Permission Endpoints ====================

app.get("/user/messagingPermissionStatus", async (req: Request, res: Response) => {
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const status = await db.getMessagingPermissionStatus(dataOwner);
    const pendingRequest = await db.getMessagePermissionRequest(dataOwner);
    res.status(200).json({ status, hasPendingRequest: !!pendingRequest });
  } catch (error) {
    logError(req.auth?.userID, "Error getting messaging permission status:", error);
    return res.status(500).send("Failed to get messaging permission status");
  }
});

app.post("/user/requestMessagingPermission", async (req: Request, res: Response) => {
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const user = await db.getUserByID(dataOwner);
    if (!user) return res.status(404).send("User not found");

    await db.requestMessagingPermission(dataOwner);
    await logMessage(dataOwner, `🔔 Requested messaging permission`);

    sendMessagingPermissionRequestNotification(user.name, user.email).catch((error) =>
      logError(dataOwner, "Failed to send messaging permission request notification:", error),
    );

    res.status(200).json({ success: true });
  } catch (error) {
    logError(req.auth?.userID, "Error requesting messaging permission:", error);
    return res.status(500).send("Failed to request messaging permission");
  }
});

// ==================== Admin Endpoints ====================

app.post("/admin/getAllUsersDetailed", requireAdmin, async (req: Request, res: Response) => {
  try {
    const users = await db.getAllUsersDetailed();
    res.status(200).json(users);
  } catch (error) {
    return handleError(res, error, "Failed to retrieve users");
  }
});

app.post("/admin/deleteUser", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userID } = req.body;
    if (!userID) return res.status(400).send("userID is required");
    if (userID === req.auth.actorUserID) return res.status(400).send("Cannot delete your own account");

    const target = await db.getUserByID(userID);
    if (!target) return res.status(404).send("User not found");

    await deleteAccountAndPartner(userID, null);
    await logMessage(req.auth.actorUserID, `🗑️ Admin deleted account: ${target.name} (${userID})`);
    res.status(200).send("User deleted");
  } catch (error) {
    return handleError(res, error, "Failed to delete user");
  }
});

app.post("/admin/getPendingUsers", requireAdmin, async (req: Request, res: Response) => {
  try {
    const users = await db.getUsersByStatus("pending");
    res.status(200).json(users);
  } catch (error) {
    return handleError(res, error, "Failed to retrieve pending users");
  }
});

app.post("/admin/approveUser", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userID } = req.body;
    if (!userID) return res.status(400).send("userID is required");
    const target = await db.getUserByID(userID);
    if (!target) return res.status(404).send("User not found");

    await db.updateUserStatus(userID, "approved");
    sendApprovalDecisionEmail({ userID, name: target.name, email: target.email, approved: true }).catch((error) =>
      logError(userID, "Failed to send approval-decision email:", error),
    );
    res.status(200).send("User approved");
  } catch (error) {
    return handleError(res, error, "Failed to approve user");
  }
});

app.post("/admin/declineUser", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userID } = req.body;
    if (!userID) return res.status(400).send("userID is required");
    const target = await db.getUserByID(userID);
    if (!target) return res.status(404).send("User not found");

    await db.updateUserStatus(userID, "declined");
    sendApprovalDecisionEmail({ userID, name: target.name, email: target.email, approved: false }).catch((error) =>
      logError(userID, "Failed to send approval-decision email:", error),
    );
    res.status(200).send("User declined");
  } catch (error) {
    return handleError(res, error, "Failed to decline user");
  }
});

// Puts an approved user back in the approval queue (no data is deleted; they
// just can't enter the app until re-approved). No email is sent — the user
// simply sees the pending-approval page on their next visit.
app.post("/admin/revokeUserApproval", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userID } = req.body;
    if (!userID) return res.status(400).send("userID is required");
    if (userID === req.auth.userID) return res.status(400).send("Cannot revoke your own access");
    const target = await db.getUserByID(userID);
    if (!target) return res.status(404).send("User not found");

    await db.updateUserStatus(userID, "pending");
    await logMessage(req.auth.userID, `↩️ Revoked approval for ${target.name} — back to pending`);
    res.status(200).send("User approval revoked");
  } catch (error) {
    return handleError(res, error, "Failed to revoke user approval");
  }
});

app.post("/admin/getScheduledDeletions", requireAdmin, async (req: Request, res: Response) => {
  try {
    const deletions = await db.getScheduledDeletions(process.env.ADMIN_USER_ID || "");
    res.status(200).json(deletions);
  } catch (error) {
    return handleError(res, error, "Failed to retrieve scheduled deletions");
  }
});

app.post("/admin/cancelScheduledDeletion", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userID } = req.body;
    if (!userID) return res.status(400).send("userID is required");
    await db.cancelScheduledDeletion(userID);
    res.status(200).send("Scheduled deletion cancelled");
  } catch (error) {
    return handleError(res, error, "Failed to cancel scheduled deletion");
  }
});

app.post("/admin/setMessagingPermission", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userID, approved } = req.body;
    if (!userID || typeof approved !== "boolean") {
      return res.status(400).send("userID and approved (boolean) are required");
    }
    const target = await db.getUserByID(userID);
    if (!target) return res.status(404).send("User not found");

    await db.setMessagingPermission(userID, approved, req.auth.userID);

    if (approved) {
      sendMessagingPermissionApprovedEmail({
        userID,
        name: target.name,
        email: target.email,
      }).catch((error) =>
        logError(req.auth.userID, "Failed to send messaging permission approval email:", error),
      );
    }

    await logMessage(req.auth.userID, `${approved ? "✅ Approved" : "❌ Revoked"} messaging permission for ${target.name}`);
    res.status(200).send(approved ? "Messaging permission approved" : "Messaging permission denied");
  } catch (error) {
    return handleError(res, error, "Failed to update messaging permission");
  }
});

// Assigns a user's messaging plan: 'manual' (they send everything themselves)
// or 'scheduled' ("send and go" — they fill everything up front and the
// scheduler sends at the times they picked).
app.post("/admin/setMessagingPlan", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userID, plan } = req.body;
    if (!userID || (plan !== "manual" && plan !== "scheduled")) {
      return res.status(400).send("userID and plan ('manual' | 'scheduled') are required");
    }
    const target = await db.getUserByID(userID);
    if (!target) return res.status(404).send("User not found");

    await db.setMessagingPlan(userID, plan as MessagingPlan);
    await logMessage(req.auth.userID, `📋 Set messaging plan for ${target.name}: ${plan}`);
    res.status(200).send("Messaging plan updated");
  } catch (error) {
    return handleError(res, error, "Failed to update messaging plan");
  }
});

// QA tool: wipes an event's scheduled rounds (and optionally the per-guest
// send markers) so the "send and go" flow can be re-tested from scratch with
// fresh times. Rounds are deleted, not flipped back to pending — a pending
// round with a past time would re-fire on the next scheduler tick.
app.post("/admin/resetMessageSchedule", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { eventId, clearGuestState } = req.body;
    if (!eventId) return res.status(400).send("eventId is required");
    const event = await db.getEventById(Number(eventId));
    if (!event) return res.status(404).send("Event not found");

    const deleted = await db.deleteAllScheduledRounds(event.id!);
    if (clearGuestState === true) {
      await db.clearEventGuestSendState(event.id!);
    }
    await logMessage(req.auth.actorUserID, `🧪 QA reset of message schedule for "${event.ceremony_name}" (event ${event.id}) — ${deleted} rounds deleted${clearGuestState ? ", guest send-state cleared" : ""}`);
    res.status(200).json({ deletedRounds: deleted });
  } catch (error) {
    return handleError(res, error, "Failed to reset message schedule");
  }
});

// ==================== Partner/Collaboration Endpoints ====================

// Generate an invite code to share with partner
app.post("/partner/generate-invite", async (req: Request, res: Response) => {
  try {
    const userID = req.auth.userID;

    // Check if user already has a partner
    const partnerInfo = await db.getPartnerInfo(userID);
    if (partnerInfo.hasPartner) {
      return res.status(400).send("You already have a linked partner");
    }

    const inviteCode = await db.generateInviteCode(userID);
    await logMessage(userID, `🔗 Generated partner invite code`);
    res.status(200).json({ inviteCode });
  } catch (error) {
    return handleError(res, error, "Failed to generate invite code");
  }
});

// Accept an invite and link accounts
app.post("/partner/accept-invite", async (req: Request, res: Response) => {
  try {
    const userID = req.auth.userID;
    const { inviteCode }: { inviteCode: string } = req.body;
    if (!inviteCode) {
      return res.status(400).send("inviteCode is required");
    }

    const result = await db.acceptInvite(userID, inviteCode.toUpperCase());

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    await logMessage(
      result.primaryUserID!,
      `💑 Partner account linked successfully`,
    );
    await logMessage(
      userID,
      `💑 Linked to partner account (${result.primaryUserID})`,
    );

    res.status(200).json({ success: true });
  } catch (error) {
    return handleError(res, error, "Failed to accept invite");
  }
});

// Unlink partner accounts
app.post("/partner/unlink", async (req: Request, res: Response) => {
  try {
    const userID = req.auth.userID;

    const success = await db.unlinkPartner(userID);

    if (!success) {
      return res.status(400).send("No partner link found to remove");
    }

    await logMessage(userID, `👋 Partner account unlinked`);
    res.status(200).json({ success: true });
  } catch (error) {
    return handleError(res, error, "Failed to unlink partner");
  }
});

// Get partner information for the current user
app.get("/partner/info", async (req: Request, res: Response) => {
  try {
    const partnerInfo = await db.getPartnerInfo(req.auth.userID);
    res.status(200).json(partnerInfo);
  } catch (error) {
    return handleError(res, error, "Failed to get partner info");
  }
});

// ==================== Budget & Vendor Endpoints ====================

// Update total wedding budget
app.patch("/budget/total", async (req: Request, res: Response) => {
  try {
    const { total_budget } = req.body;
    if (total_budget === undefined) {
      return res.status(400).send("total_budget is required");
    }
    const dataOwner = await resolveDataOwner(req.auth.userID);

    const primary = await db.getPrimaryEvent(dataOwner);
    if (!primary) return res.status(404).send("Wedding info not found. Please set up your wedding first.");
    await db.updateEvent(primary.id, { total_budget });

    await logMessage(dataOwner, `💰 Total budget updated to ₪${total_budget}`);
    res.status(200).json({ total_budget });
  } catch (error) {
    logError(req.auth?.userID, "Error updating total budget:", error);
    return res.status(500).send("Failed to update total budget");
  }
});

// Update estimated guests for budget planning
app.patch("/budget/estimated-guests", async (req: Request, res: Response) => {
  try {
    const { estimated_guests } = req.body;
    if (estimated_guests === undefined) {
      return res.status(400).send("estimated_guests is required");
    }
    const dataOwner = await resolveDataOwner(req.auth.userID);

    const primary = await db.getPrimaryEvent(dataOwner);
    if (!primary) return res.status(404).send("Wedding info not found. Please set up your wedding first.");
    await db.updateEvent(primary.id, { estimated_guests });

    await logMessage(
      dataOwner,
      `👥 Estimated guests updated to ${estimated_guests}`,
    );
    res.status(200).json({ estimated_guests });
  } catch (error) {
    logError(req.auth?.userID, "Error updating estimated guests:", error);
    return res.status(500).send("Failed to update estimated guests");
  }
});

// Get budget overview with all categories and vendors
app.get("/budget/overview", async (req: Request, res: Response) => {
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const overview = await db.getBudgetOverview(dataOwner);
    res.status(200).json(overview);
  } catch (error) {
    logError(req.auth?.userID, "Error retrieving budget overview:", error);
    return res.status(500).send("Failed to retrieve budget overview");
  }
});

// Get all budget categories
app.get("/budget/categories", async (req: Request, res: Response) => {
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const categories = await db.getBudgetCategories(dataOwner);
    res.status(200).json(categories);
  } catch (error) {
    logError(req.auth?.userID, "Error retrieving budget categories:", error);
    return res.status(500).send("Failed to retrieve budget categories");
  }
});

// Add a budget category
app.post("/budget/categories", async (req: Request, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).send("Category name is required");
    }
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const category = await db.addBudgetCategory(dataOwner, name);
    await logMessage(dataOwner, `📊 Budget category added: "${name}"`);
    res.status(201).json(category);
  } catch (error: any) {
    if (error.code === "23505") {
      return res.status(400).send("Category already exists");
    }
    logError(req.auth?.userID, "Error adding budget category:", error);
    return res.status(500).send("Failed to add budget category");
  }
});

// Delete a budget category
app.delete(
  "/budget/categories/:categoryId",
  async (req: Request, res: Response) => {
    try {
      const { categoryId } = req.params;
      const dataOwner = await resolveDataOwner(req.auth.userID);
      const deleted = await db.deleteBudgetCategory(
        dataOwner,
        parseInt(categoryId),
      );
      if (!deleted) {
        return res.status(404).send("Category not found");
      }
      await logMessage(dataOwner, `🗑️ Budget category deleted`);
      res.status(200).send("Category deleted successfully");
    } catch (error) {
      logError(req.auth?.userID, "Error deleting budget category:", error);
      return res.status(500).send("Failed to delete budget category");
    }
  },
);

// Get all vendors for the current user
app.get("/budget/vendors", async (req: Request, res: Response) => {
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const vendors = await db.getVendors(dataOwner);
    res.status(200).json(vendors);
  } catch (error) {
    logError(req.auth?.userID, "Error retrieving vendors:", error);
    return res.status(500).send("Failed to retrieve vendors");
  }
});

//upload files to vendors
const uploadFilesToVendors = async (
  userID: string,
  vendorId: number,
  files: {
    originalname: string;
    mimetype: string;
    size: number;
    buffer: Buffer;
  }[],
  fileNames: string | string[],
) => {
  const dataOwner = await resolveDataOwner(userID);
  const fileNamesArray = fileNames
    ? typeof fileNames === "string"
      ? [fileNames]
      : fileNames
    : [];
  if (files && files.length > 0) {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = fileNamesArray[i] || file.originalname;
      await db.addVendorFile(dataOwner, vendorId, {
        name: fileName,
        type: file.mimetype,
        size: file.size,
        data: file.buffer,
      });
      await logMessage(dataOwner, `📎 File uploaded: ${fileName}`);
    }
  }
};

type VendorFile = {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};
// Add a vendor
app.post(
  "/budget/vendors",
  upload.array("files", 10) as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const { vendor: vendorJson, fileNames } = req.body;
      const vendor =
        typeof vendorJson === "string" ? JSON.parse(vendorJson) : vendorJson;
      const files = (req as any).files as VendorFile[] | undefined;

      if (!vendor?.name || !vendor?.category_id) {
        return res
          .status(400)
          .send("Vendor name and category are required");
      }

      const userID = req.auth.userID;
      const dataOwner = await resolveDataOwner(userID);
      const newVendor = await db.addVendor(dataOwner, vendor);
      await logMessage(dataOwner, `🏢 Vendor added: "${vendor.name}"`);

      // Upload files if any
      uploadFilesToVendors(userID, newVendor.vendor_id, files, fileNames);

      res.status(201).json(newVendor);
    } catch (error) {
      logError(req.auth?.userID, "Error adding vendor:", error);
      return res.status(500).send("Failed to add vendor");
    }
  },
);

// Update a vendor
app.patch(
  "/budget/vendors/:vendorId",
  upload.array("files", 10) as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const { vendorId } = req.params;
      const { updates: updatesJson, fileNames } = req.body;
      const updates =
        typeof updatesJson === "string" ? JSON.parse(updatesJson) : updatesJson;
      const files = (req as any).files as VendorFile[] | undefined;

      const userID = req.auth.userID;
      const dataOwner = await resolveDataOwner(userID);
      const vendor = await db.updateVendor(
        dataOwner,
        parseInt(vendorId),
        updates,
      );

      if (!vendor) {
        return res.status(404).send("Vendor not found");
      }

      uploadFilesToVendors(userID, parseInt(vendorId), files, fileNames);

      res.status(200).json(vendor);
    } catch (error) {
      logError(req.auth?.userID, "Error updating vendor:", error);
      return res.status(500).send("Failed to update vendor");
    }
  },
);

// Delete a vendor
app.delete("/budget/vendors/:vendorId", async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const deleted = await db.deleteVendor(dataOwner, parseInt(vendorId));
    if (!deleted) {
      return res.status(404).send("Vendor not found");
    }
    await logMessage(dataOwner, `🗑️ Vendor deleted`);
    res.status(200).send("Vendor deleted successfully");
  } catch (error) {
    logError(req.auth?.userID, "Error deleting vendor:", error);
    return res.status(500).send("Failed to delete vendor");
  }
});

// Toggle vendor favorite
app.patch(
  "/budget/vendors/:vendorId/favorite",
  async (req: Request, res: Response) => {
    try {
      const { vendorId } = req.params;
      const dataOwner = await resolveDataOwner(req.auth.userID);
      const vendor = await db.toggleVendorFavorite(
        dataOwner,
        parseInt(vendorId),
      );
      if (!vendor) {
        return res.status(404).send("Vendor not found");
      }
      res.status(200).json(vendor);
    } catch (error) {
      logError(req.auth?.userID, "Error toggling vendor favorite:", error);
      return res.status(500).send("Failed to toggle vendor favorite");
    }
  },
);

// Add a payment to a vendor
app.post("/budget/payments", async (req: Request, res: Response) => {
  try {
    const { vendor_id, amount, payment_date, notes } = req.body;
    if (!vendor_id || !amount || !payment_date) {
      return res
        .status(400)
        .send("vendor_id, amount, and payment_date are required");
    }
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const payment = await db.addPayment(dataOwner, vendor_id, {
      amount,
      payment_date,
      notes,
    });
    await logMessage(dataOwner, `💰 Payment of ₪${amount} recorded`);
    res.status(201).json(payment);
  } catch (error) {
    logError(req.auth?.userID, "Error adding payment:", error);
    return res.status(500).send("Failed to add payment");
  }
});

// Delete a payment
app.delete(
  "/budget/payments/:paymentId",
  async (req: Request, res: Response) => {
    try {
      const { paymentId } = req.params;
      const dataOwner = await resolveDataOwner(req.auth.userID);
      const deleted = await db.deletePayment(dataOwner, parseInt(paymentId));
      if (!deleted) {
        return res.status(404).send("Payment not found");
      }
      await logMessage(dataOwner, `🗑️ Payment deleted`);
      res.status(200).send("Payment deleted successfully");
    } catch (error) {
      logError(req.auth?.userID, "Error deleting payment:", error);
      return res.status(500).send("Failed to delete payment");
    }
  },
);

// Upload a file for a vendor
app.post(
  "/budget/vendors/:vendorId/files",
  upload.single("file") as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const { vendorId } = req.params;
      const fileName = req.body.fileName; // Use separate field for proper Hebrew support
      const file = (req as any).file;

      if (!file) {
        return res.status(400).send("file is required");
      }

      const finalFileName = fileName || file.originalname;

      const dataOwner = await resolveDataOwner(req.auth.userID);
      const vendorFile = await db.addVendorFile(dataOwner, parseInt(vendorId), {
        name: finalFileName,
        type: file.mimetype,
        size: file.size,
        data: file.buffer,
      });

      await logMessage(dataOwner, `📎 File uploaded: ${finalFileName}`);
      res.status(201).json(vendorFile);
    } catch (error: any) {
      logError(req.auth?.userID, "Error uploading file:", error);
      return res.status(500).send(error.message || "Failed to upload file");
    }
  },
);

// Download a vendor file
app.get(
  "/budget/files/:fileId/download",
  async (req: Request, res: Response) => {
    let mediaUserID: string | undefined;
    try {
      const { fileId } = req.params;
      const mediaToken = req.query.mediaToken as string;
      const payload = verifyMediaToken(mediaToken, "vendorFile", parseInt(fileId));
      if (!payload) return res.status(401).send("Invalid or expired media token");
      mediaUserID = payload.userID;

      const dataOwner = await resolveDataOwner(payload.userID);
      const fileData = await db.getVendorFileData(dataOwner, parseInt(fileId));

      if (!fileData) {
        return res.status(404).send("File not found");
      }

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(fileData.file_name)}"`,
      );
      res.setHeader("Content-Type", fileData.file_type);
      res.send(fileData.file_data);
    } catch (error) {
      logError(mediaUserID, "Error downloading file:", error);
      return res.status(500).send("Failed to download file");
    }
  },
);

// Download a zip of the user's own data (RSVP status, tasks, budget) — on demand,
// same three files as the 60-day pre-deletion warning email.
app.get(
  "/export/my-data/download",
  async (req: Request, res: Response) => {
    let mediaUserID: string | undefined;
    try {
      const mediaToken = req.query.mediaToken as string;
      const payload = verifyMediaToken(mediaToken, "dataExport");
      if (!payload) return res.status(401).send("Invalid or expired media token");
      mediaUserID = payload.userID;

      const dataOwner = await resolveDataOwner(payload.userID);
      const exports = await buildAllExports(db, dataOwner);
      const zipBuffer = await zipExports(exports);

      res.setHeader("Content-Disposition", 'attachment; filename="wedding-data.zip"');
      res.setHeader("Content-Type", "application/zip");
      res.send(zipBuffer);
    } catch (error) {
      logError(mediaUserID, "Error building data export:", error);
      return res.status(500).send("Failed to build data export");
    }
  },
);

// Delete a vendor file
app.delete("/budget/files/:fileId", async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const deleted = await db.deleteVendorFile(dataOwner, parseInt(fileId));

    if (!deleted) {
      return res.status(404).send("File not found");
    }

    await logMessage(dataOwner, `🗑️ Vendor file deleted`);
    res.status(200).send("File deleted successfully");
  } catch (error) {
    logError(req.auth?.userID, "Error deleting file:", error);
    return res.status(500).send("Failed to delete file");
  }
});

// ==================== Gift Endpoints ====================

// Get all gifts for the current user
app.get("/gifts", async (req: Request, res: Response) => {
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const gifts = await db.getGifts(dataOwner);
    res.status(200).json(gifts);
  } catch (error) {
    logError(req.auth?.userID, "Error retrieving gifts:", error);
    return res.status(500).send("Failed to retrieve gifts");
  }
});

// Shared field validation for POST/PATCH /gifts. Returns an error message, or
// the normalized values (a free-text description is required for the "other"
// type and discarded for every named type).
const validateGiftFields = (
  body: any,
): { error: string } | { giftType: GiftType; amount: number; otherDescription: string | null } => {
  const { gift_type, amount, other_description } = body;
  if (!gift_type || amount === undefined) {
    return { error: "gift_type and amount are required" };
  }
  if (!GIFT_TYPES.includes(gift_type as GiftType)) {
    return { error: `gift_type must be one of: ${GIFT_TYPES.join(", ")}` };
  }
  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return { error: "amount must be a positive number" };
  }
  const otherDescription =
    typeof other_description === "string" ? other_description.trim() : "";
  if (gift_type === "other" && !otherDescription) {
    return { error: "other_description is required when gift_type is 'other'" };
  }
  return {
    giftType: gift_type,
    amount: numericAmount,
    otherDescription: gift_type === "other" ? otherDescription : null,
  };
};

// Add a gift from a guest
app.post("/gifts", async (req: Request, res: Response) => {
  try {
    const { guest_id } = req.body;
    if (!guest_id) {
      return res.status(400).send("guest_id, gift_type and amount are required");
    }
    const fields = validateGiftFields(req.body);
    if ("error" in fields) {
      return res.status(400).send(fields.error);
    }
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const gift = await db.addGift(
      dataOwner,
      guest_id,
      fields.giftType,
      fields.amount,
      fields.otherDescription,
    );
    await logMessage(dataOwner, `🎁 Gift added: ₪${fields.amount} (${fields.giftType})`);
    res.status(201).json(gift);
  } catch (error: any) {
    if (error.message === "Guest not found or access denied") {
      return res.status(404).send("Guest not found");
    }
    logError(req.auth?.userID, "Error adding gift:", error);
    return res.status(500).send("Failed to add gift");
  }
});

// Update a gift's type and amount
app.patch("/gifts/:giftId", async (req: Request, res: Response) => {
  try {
    const { giftId } = req.params;
    const fields = validateGiftFields(req.body);
    if ("error" in fields) {
      return res.status(400).send(fields.error);
    }
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const gift = await db.updateGift(dataOwner, parseInt(giftId), {
      gift_type: fields.giftType,
      other_description: fields.otherDescription,
      amount: fields.amount,
    });
    if (!gift) {
      return res.status(404).send("Gift not found");
    }
    await logMessage(dataOwner, `🎁 Gift updated: ₪${fields.amount} (${fields.giftType})`);
    res.status(200).json(gift);
  } catch (error) {
    logError(req.auth?.userID, "Error updating gift:", error);
    return res.status(500).send("Failed to update gift");
  }
});

// Delete a gift
app.delete("/gifts/:giftId", async (req: Request, res: Response) => {
  try {
    const { giftId } = req.params;
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const deleted = await db.deleteGift(dataOwner, parseInt(giftId));
    if (!deleted) {
      return res.status(404).send("Gift not found");
    }
    await logMessage(dataOwner, `🗑️ Gift deleted`);
    res.status(200).send("Gift deleted successfully");
  } catch (error) {
    logError(req.auth?.userID, "Error deleting gift:", error);
    return res.status(500).send("Failed to delete gift");
  }
});

// ==================== Event Routes ====================

app.post(
  "/events",
  upload.single("image") as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const { ceremony_name, date, time, location, additional_info, waze_link, gift_link, send_reminder, ask_invited_count, reminder_day, reminder_time, reminder_additional_text } = req.body;
      if (!ceremony_name) {
        return res.status(400).send("ceremony_name is required");
      }
      const dataOwner = await resolveDataOwner(req.auth.userID);

      const event = await db.createEvent(dataOwner, {
        is_primary: false,
        ceremony_name,
        date: date || null,
        time: time || null,
        location: location || null,
        additional_info: additional_info || null,
        waze_link: waze_link || null,
        gift_link: gift_link || null,
        file_id: null,
        // Multipart bodies deliver booleans as "true"/"false" strings
        send_reminder: send_reminder === true || send_reminder === "true",
        ask_invited_count: ask_invited_count === true || ask_invited_count === "true",
        reminder_day: reminder_day || null,
        reminder_time: reminder_time || null,
        reminder_additional_text: reminder_additional_text || null,
      });

      if (req.file) {
        const fileId = await uploadImage(req.file);
        await db.updateEventFileId(event.id, fileId);
        event.file_id = fileId;
      }

      await logMessage(dataOwner, `🎉 Event created: "${ceremony_name}"`);
      return res.status(201).json(event);
    } catch (error) {
      logError(req.auth?.userID, "Error creating event:", error);
      return res.status(500).send("Failed to create event");
    }
  },
);

app.get("/events", async (req: Request, res: Response) => {
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const events = await db.getEvents(dataOwner);
    return res.status(200).json(events);
  } catch (error) {
    logError(req.auth?.userID, "Error fetching events:", error);
    return res.status(500).send("Failed to fetch events");
  }
});

app.patch(
  "/events/:eventId",
  upload.single("image") as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const { eventId } = req.params;
      const updates = { ...req.body };
      // Multipart bodies deliver booleans as "true"/"false" strings, and an
      // empty reminder_time is not a valid TIME value
      if (typeof updates.send_reminder === "string") updates.send_reminder = updates.send_reminder === "true";
      if (typeof updates.ask_invited_count === "string") updates.ask_invited_count = updates.ask_invited_count === "true";
      if (updates.reminder_time === "") updates.reminder_time = null;
      if (updates.reminder_day === "") updates.reminder_day = null;
      const dataOwner = await resolveDataOwner(req.auth.userID);
      const event = await db.getEventById(parseInt(eventId));
      if (!event || event.user_id !== dataOwner) return res.status(404).send("Event not found");
      if (req.file) updates.file_id = await uploadImage(req.file);
      const updated = await db.updateEvent(parseInt(eventId), updates);
      await logMessage(dataOwner, `✏️ Event updated: "${event.ceremony_name}"`);
      return res.status(200).json(updated);
    } catch (error) {
      logError(req.auth?.userID, "Error updating event:", error);
      return res.status(500).send("Failed to update event");
    }
  },
);

app.delete("/events/:eventId", async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const event = await db.getEventById(parseInt(eventId));
    if (!event || event.user_id !== dataOwner) {
      return res.status(404).send("Event not found");
    }
    await db.deleteEvent(parseInt(eventId));
    await logMessage(dataOwner, `🗑️ Event deleted: "${event.ceremony_name}"`);
    return res.status(200).send("Event deleted");
  } catch (error) {
    logError(req.auth?.userID, "Error deleting event:", error);
    return res.status(500).send("Failed to delete event");
  }
});

app.post("/events/:eventId/guests", async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const { guestIds } = req.body;
    if (!guestIds) return res.status(400).send("guestIds is required");
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const event = await db.getEventById(parseInt(eventId));
    if (!event || event.user_id !== dataOwner) {
      return res.status(404).send("Event not found");
    }
    await db.addEventGuests(parseInt(eventId), guestIds);
    const guests = await db.getEventGuests(parseInt(eventId));
    return res.status(200).json(guests);
  } catch (error) {
    logError(req.auth?.userID, "Error adding event guests:", error);
    return res.status(500).send("Failed to add event guests");
  }
});

app.delete("/events/:eventId/guests", async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const { guestIds } = req.body;
    if (!guestIds) return res.status(400).send("guestIds is required");
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const event = await db.getEventById(parseInt(eventId));
    if (!event || event.user_id !== dataOwner) {
      return res.status(404).send("Event not found");
    }
    await db.removeEventGuests(parseInt(eventId), guestIds);
    const guests = await db.getEventGuests(parseInt(eventId));
    return res.status(200).json(guests);
  } catch (error) {
    logError(req.auth?.userID, "Error removing event guests:", error);
    return res.status(500).send("Failed to remove event guests");
  }
});

app.get("/events/:eventId/guests", async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const event = await db.getEventById(parseInt(eventId));
    if (!event || event.user_id !== dataOwner) {
      return res.status(404).send("Event not found");
    }
    const guests = await db.getEventGuests(parseInt(eventId));
    return res.status(200).json(guests);
  } catch (error) {
    logError(req.auth?.userID, "Error fetching event guests:", error);
    return res.status(500).send("Failed to fetch event guests");
  }
});

// Place automated RSVP phone calls to guests who haven't responded yet — all of
// them, or only the (still pending) guests listed in the optional guestIds body.
app.post("/events/:eventId/voice/call-pending", async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const { guestIds } = req.body ?? {};
    if (
      guestIds !== undefined &&
      (!Array.isArray(guestIds) || guestIds.length === 0 || guestIds.some((id) => typeof id !== "number"))
    ) {
      return res.status(400).send("guestIds must be a non-empty array of numbers");
    }
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const event = await db.getEventById(parseInt(eventId));
    if (!event || event.user_id !== dataOwner) {
      return res.status(404).send("Event not found");
    }
    // "Send and go" couples don't place calls manually — the scheduler runs
    // their call rounds at the times they picked (same gate as /sendMessage).
    const messagingPlan = await db.getMessagingPlan(dataOwner);
    if (!req.auth.isAdmin && messagingPlan === "scheduled") {
      return res.status(403).json({
        error: "Your call rounds run automatically on the schedule you set.",
        messagingPlan,
      });
    }
    if (!isVoiceConfigured()) {
      return res.status(503).send(
        "Voice calling is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_CALLER_ID and PUBLIC_BASE_URL.",
      );
    }
    const result = await placeRsvpCalls(parseInt(eventId), guestIds);
    await logMessage(
      req.auth.userID,
      `📞 Voice RSVP calls placed for event ${eventId}${guestIds ? ` (${guestIds.length} selected guests)` : ""}: queued ${result.queued}, failed ${result.failed}, skipped ${result.skippedNoPhone}`,
    );
    return res.status(200).json(result);
  } catch (error) {
    return handleError(res, error, "Failed to place voice RSVP calls", req.auth.userID);
  }
});

// ==== Scheduled message rounds ("send and go" plan) ====

app.get("/events/:eventId/messageSchedule", async (req: Request, res: Response) => {
  try {
    const event = await getOwnedEvent(req.auth.userID, parseInt(req.params.eventId));
    if (!event) return res.status(404).send("Event not found");
    const rounds = await db.getScheduledRounds(event.id!);
    res.status(200).json({ rounds });
  } catch (error) {
    return handleError(res, error, "Failed to load message schedule", req.auth.userID);
  }
});

// Upserts round times: body { rounds: [{ roundType, roundNumber, scheduledAt }] }.
// A round with scheduledAt=null is removed (skipped). Rounds already claimed or
// sent by the scheduler are immutable; new times must be in the future.
app.post("/events/:eventId/messageSchedule", async (req: Request, res: Response) => {
  try {
    const event = await getOwnedEvent(req.auth.userID, parseInt(req.params.eventId));
    if (!event) return res.status(404).send("Event not found");

    const rounds = req.body?.rounds;
    if (!Array.isArray(rounds) || rounds.length === 0) {
      return res.status(400).send("rounds must be a non-empty array");
    }

    // Validate everything before writing anything, so a bad entry doesn't
    // leave a half-saved schedule.
    for (const r of rounds) {
      const limit = SCHEDULED_ROUND_LIMITS[r?.roundType as ScheduledRoundType];
      if (!limit) return res.status(400).send(`Invalid roundType: ${r?.roundType}`);
      const num = Number(r.roundNumber ?? 1);
      if (!Number.isInteger(num) || num < 1 || num > limit) {
        return res.status(400).send(`Invalid roundNumber for ${r.roundType}: ${r.roundNumber}`);
      }
      if (r.scheduledAt !== null) {
        const when = new Date(r.scheduledAt);
        if (isNaN(when.getTime())) return res.status(400).send(`Invalid scheduledAt for ${r.roundType} ${num}`);
        if (when.getTime() <= Date.now()) {
          return res.status(400).send(`Scheduled time for ${r.roundType} ${num} must be in the future`);
        }
      }
    }

    // Scheduling the invitation round requires complete invitation content —
    // same gate as a manual invitation send.
    if (rounds.some((r) => r.roundType === "rsvp" && r.scheduledAt !== null)) {
      const missingFields = getMissingInvitationFields(await withInheritedCoupleNames(event));
      if (missingFields.length > 0) {
        return res.status(400).json({
          error: `Invitation details are incomplete — missing: ${missingFields.join(", ")}`,
          missingFields,
        });
      }
    }

    const rejected: string[] = [];
    for (const r of rounds) {
      const num = Number(r.roundNumber ?? 1);
      if (r.scheduledAt === null) {
        await db.deleteScheduledRound(event.id!, r.roundType, num);
        continue;
      }
      const saved = await db.upsertScheduledRound(event.id!, r.roundType, num, new Date(r.scheduledAt));
      if (!saved) rejected.push(`${r.roundType} ${num}`);
    }

    if (rejected.length > 0) {
      return res.status(409).json({
        error: `These rounds were already sent and can no longer be changed: ${rejected.join(", ")}`,
        rounds: await db.getScheduledRounds(event.id!),
      });
    }

    const dataOwner = await resolveDataOwner(req.auth.userID);
    await logMessage(dataOwner, `🗓️ Message schedule updated for "${event.ceremony_name}"`);
    res.status(200).json({ rounds: await db.getScheduledRounds(event.id!) });
  } catch (error) {
    return handleError(res, error, "Failed to save message schedule", req.auth.userID);
  }
});

app.get("/events/:eventId/image", async (req: Request, res: Response) => {
  let mediaUserID: string | undefined;
  try {
    const { eventId } = req.params;
    const mediaToken = req.query.mediaToken as string;
    const payload = verifyMediaToken(mediaToken, "eventImage", parseInt(eventId));
    if (!payload) return res.status(401).send("Invalid or expired media token");
    mediaUserID = payload.userID;

    const event = await db.getEventById(parseInt(eventId));
    if (!event?.file_id) return res.status(404).send("No image");

    const ACCESS_TOKEN = await getAccessToken();
    const response = await axios.get(
      `https://graph.facebook.com/v19.0/${event.file_id}`,
      { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
    );
    const imageUrl = response.data.url;
    const imageResponse = await axios.get(imageUrl, {
      responseType: "stream",
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    res.setHeader("Content-Type", imageResponse.headers["content-type"] as string);
    imageResponse.data.pipe(res);
  } catch (err) {
    logError(mediaUserID, err);
    return res.status(500).json({ error: "Failed to fetch event image" });
  }
});

// ==================== Seating Endpoints ====================
// Floor plan + guest-to-table assignments, per event. Geometry is integer cm;
// width/height are the bounding box (circles: both = diameter). Occupancy is
// never stored — it's derived client-side from assignments ⋈ live rsvp_status.

const isPositiveInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isNonNegativeInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

// Fields the client may set on a seating item (kind is create-only; event_id/id never).
const SEATING_ITEM_MUTABLE_FIELDS = [
  "shape", "label", "table_number", "capacity",
  "x_cm", "y_cm", "width_cm", "height_cm", "rotation_deg", "color",
] as const;

const isValidHexColor = (v: unknown): boolean =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** Returns an error message, or null if the fields are valid. `partial` skips required-field checks. */
function validateSeatingItemFields(item: any, partial: boolean): string | null {
  if (!partial && !SEATING_ITEM_KINDS.includes(item.kind)) return "kind must be 'table' or 'object'";
  if (item.shape !== undefined || !partial) {
    if (!SEATING_SHAPES.includes(item.shape)) return "shape must be 'circle' or 'rect'";
  }
  for (const f of ["x_cm", "y_cm"]) {
    if (item[f] !== undefined || !partial) {
      if (!isNonNegativeInt(item[f])) return `${f} must be a non-negative integer`;
    }
  }
  for (const f of ["width_cm", "height_cm"]) {
    if (item[f] !== undefined || !partial) {
      if (!isPositiveInt(item[f])) return `${f} must be a positive integer`;
    }
  }
  if (item.rotation_deg !== undefined && !Number.isInteger(item.rotation_deg)) {
    return "rotation_deg must be an integer";
  }
  if (item.table_number !== undefined && item.table_number !== null && !isPositiveInt(item.table_number)) {
    return "table_number must be a positive integer";
  }
  if (item.capacity !== undefined && item.capacity !== null && !isPositiveInt(item.capacity)) {
    return "capacity must be a positive integer";
  }
  if (item.color !== undefined && item.color !== null && !isValidHexColor(item.color)) {
    return "color must be a hex color like #a1b2c3";
  }
  // Circles store diameter in both bounding-box columns.
  if (item.width_cm !== undefined && item.height_cm !== undefined &&
    item.shape === "circle" && item.width_cm !== item.height_cm) {
    return "circle items must have width_cm equal to height_cm (the diameter)";
  }
  if (!partial && item.kind === "table" && !isPositiveInt(item.capacity)) {
    return "tables require a positive integer capacity";
  }
  return null;
}

/** Standard ownership guard: the event exists and belongs to the caller's data owner. */
async function getOwnedEvent(userID: string, eventId: number): Promise<Event | null> {
  // A malformed URL param (e.g. /events/undefined/...) parses to NaN — treat it
  // as not-found instead of letting the query blow up with a pg type error.
  if (!Number.isInteger(eventId)) return null;
  const dataOwner = await resolveDataOwner(userID);
  const event = await db.getEventById(eventId);
  if (!event || event.user_id !== dataOwner) return null;
  return event;
}

// One-shot page load: layout (or null), items, and assignments joined with live guest/RSVP data
app.get("/events/:eventId/seating", async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const event = await getOwnedEvent(req.auth.userID, eventId);
    if (!event) return res.status(404).send("Event not found");
    const [layout, items, assignments] = await Promise.all([
      db.getSeatingLayout(eventId),
      db.getSeatingItems(eventId),
      db.getSeatingAssignments(eventId),
    ]);
    return res.status(200).json({ layout, items, assignments });
  } catch (error) {
    return handleError(res, error, "Failed to get seating data", req.auth.userID);
  }
});

app.patch("/events/:eventId/seating/layout", async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const { room_width_cm, room_height_cm } = req.body;
    if (!isPositiveInt(room_width_cm) || !isPositiveInt(room_height_cm)) {
      return res.status(400).send("room_width_cm and room_height_cm must be positive integers");
    }
    const event = await getOwnedEvent(req.auth.userID, eventId);
    if (!event) return res.status(404).send("Event not found");
    const layout = await db.upsertSeatingLayout(eventId, room_width_cm, room_height_cm);
    return res.status(200).json(layout);
  } catch (error) {
    return handleError(res, error, "Failed to save seating layout", req.auth.userID);
  }
});

// Create on drop — returns the row so the client swaps its temp id for the real id
app.post("/events/:eventId/seating/items", async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const validationError = validateSeatingItemFields(req.body, false);
    if (validationError) return res.status(400).send(validationError);
    const event = await getOwnedEvent(req.auth.userID, eventId);
    if (!event) return res.status(404).send("Event not found");
    const b = req.body;
    const item = await db.createSeatingItem(eventId, {
      kind: b.kind,
      shape: b.shape,
      label: b.label ?? null,
      table_number: b.kind === "table" ? b.table_number ?? null : null,
      capacity: b.kind === "table" ? b.capacity : null,
      x_cm: b.x_cm,
      y_cm: b.y_cm,
      width_cm: b.width_cm,
      height_cm: b.height_cm,
      rotation_deg: b.rotation_deg ?? 0,
      color: b.color ?? null,
    });
    return res.status(201).json(item);
  } catch (error) {
    return handleError(res, error, "Failed to create seating item", req.auth.userID);
  }
});

// Batch geometry/props update — the debounced-autosave target
app.patch("/events/:eventId/seating/items", async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).send("updates must be a non-empty array");
    }
    const sanitized: Array<{ id: number } & Partial<SeatingItem>> = [];
    for (const u of updates) {
      if (!isPositiveInt(u?.id)) return res.status(400).send("each update must have a numeric id");
      const validationError = validateSeatingItemFields(u, true);
      if (validationError) return res.status(400).send(validationError);
      const fields: any = { id: u.id };
      for (const f of SEATING_ITEM_MUTABLE_FIELDS) {
        if (u[f] !== undefined) fields[f] = u[f];
      }
      sanitized.push(fields);
    }
    const event = await getOwnedEvent(req.auth.userID, eventId);
    if (!event) return res.status(404).send("Event not found");
    const items = await db.updateSeatingItems(eventId, sanitized);
    return res.status(200).json(items);
  } catch (error) {
    return handleError(res, error, "Failed to update seating items", req.auth.userID);
  }
});

// Clean canvas: removes every table and object (assignments cascade); the room layout stays
app.delete("/events/:eventId/seating/items", async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const event = await getOwnedEvent(req.auth.userID, eventId);
    if (!event) return res.status(404).send("Event not found");
    const deleted = await db.deleteAllSeatingItems(eventId);
    return res.status(200).json({ success: true, deleted });
  } catch (error) {
    return handleError(res, error, "Failed to clear seating items", req.auth.userID);
  }
});

app.delete("/events/:eventId/seating/items/:itemId", async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const itemId = parseInt(req.params.itemId);
    const event = await getOwnedEvent(req.auth.userID, eventId);
    if (!event) return res.status(404).send("Event not found");
    const deleted = await db.deleteSeatingItem(eventId, itemId);
    if (!deleted) return res.status(404).send("Seating item not found");
    return res.status(200).json({ success: true });
  } catch (error) {
    return handleError(res, error, "Failed to delete seating item", req.auth.userID);
  }
});

// Assign a guest party to a table; upsert semantics — an already-seated guest is moved
app.post("/events/:eventId/seating/items/:itemId/guests", async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const itemId = parseInt(req.params.itemId);
    const { eventGuestId } = req.body;
    if (!isPositiveInt(eventGuestId)) {
      return res.status(400).send("eventGuestId must be a positive integer");
    }
    const event = await getOwnedEvent(req.auth.userID, eventId);
    if (!event) return res.status(404).send("Event not found");
    const item = await db.getSeatingItemById(itemId);
    if (!item || item.event_id !== eventId) return res.status(404).send("Seating item not found");
    if (item.kind !== "table") return res.status(400).send("Guests can only be assigned to tables");
    const eventGuest = await db.getEventGuestById(eventGuestId);
    if (!eventGuest || eventGuest.event_id !== eventId) {
      return res.status(404).send("Guest not found in this event");
    }
    const assignment = await db.assignGuestToItem(itemId, eventGuestId);
    return res.status(200).json(assignment);
  } catch (error) {
    return handleError(res, error, "Failed to assign guest to table", req.auth.userID);
  }
});

app.delete("/events/:eventId/seating/guests/:eventGuestId", async (req: Request, res: Response) => {
  try {
    const eventId = parseInt(req.params.eventId);
    const eventGuestId = parseInt(req.params.eventGuestId);
    const event = await getOwnedEvent(req.auth.userID, eventId);
    if (!event) return res.status(404).send("Event not found");
    const removed = await db.unassignGuest(eventId, eventGuestId);
    if (!removed) return res.status(404).send("Assignment not found");
    return res.status(200).json({ success: true });
  } catch (error) {
    return handleError(res, error, "Failed to unassign guest", req.auth.userID);
  }
});

// Custom table presets — user-owned (shared with linked partner), not event-scoped
app.get("/table-presets", async (req: Request, res: Response) => {
  try {
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const presets = await db.getCustomTablePresets(dataOwner);
    return res.status(200).json(presets);
  } catch (error) {
    return handleError(res, error, "Failed to get table presets", req.auth.userID);
  }
});

/** Validates a full preset shape (POST body, or an existing preset merged with PATCH updates). */
function validatePresetFields(p: any): string | null {
  if (!SEATING_ITEM_KINDS.includes(p.kind)) return "kind must be 'table' or 'object'";
  if (!p.name || typeof p.name !== "string" || !p.name.trim()) return "name is required";
  if (!SEATING_SHAPES.includes(p.shape)) return "shape must be 'circle' or 'rect'";
  if (!isPositiveInt(p.width_cm) || !isPositiveInt(p.height_cm)) {
    return "width_cm and height_cm must be positive integers";
  }
  if (p.shape === "circle" && p.width_cm !== p.height_cm) {
    return "circle presets must have width_cm equal to height_cm (the diameter)";
  }
  if (p.kind === "table" && !isPositiveInt(p.capacity)) {
    return "table presets require a positive integer capacity";
  }
  return null;
}

app.post("/table-presets", async (req: Request, res: Response) => {
  try {
    const { name, shape, width_cm, height_cm, capacity } = req.body;
    const kind = req.body.kind ?? "table";
    const validationError = validatePresetFields({ kind, name, shape, width_cm, height_cm, capacity });
    if (validationError) return res.status(400).send(validationError);
    const dataOwner = await resolveDataOwner(req.auth.userID);
    try {
      const preset = await db.createCustomTablePreset(dataOwner, {
        kind, name: name.trim(), shape, width_cm, height_cm,
        capacity: kind === "table" ? capacity : null,
      });
      return res.status(201).json(preset);
    } catch (error: any) {
      if (error?.code === "23505") { // unique_violation on (user_id, name)
        return res.status(400).send("A preset with this name already exists");
      }
      throw error;
    }
  } catch (error) {
    return handleError(res, error, "Failed to create table preset", req.auth.userID);
  }
});

app.patch("/table-presets/:presetId", async (req: Request, res: Response) => {
  try {
    const presetId = parseInt(req.params.presetId);
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const existing = await db.getCustomTablePresetById(dataOwner, presetId);
    if (!existing) return res.status(404).send("Preset not found");
    const updates: any = {};
    for (const f of ["kind", "name", "shape", "width_cm", "height_cm", "capacity"]) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    const merged = { ...existing, ...updates };
    const validationError = validatePresetFields(merged);
    if (validationError) return res.status(400).send(validationError);
    if (updates.name) updates.name = updates.name.trim();
    if (merged.kind === "object") updates.capacity = null;
    try {
      const preset = await db.updateCustomTablePreset(dataOwner, presetId, updates);
      return res.status(200).json(preset);
    } catch (error: any) {
      if (error?.code === "23505") {
        return res.status(400).send("A preset with this name already exists");
      }
      throw error;
    }
  } catch (error) {
    return handleError(res, error, "Failed to update table preset", req.auth.userID);
  }
});

app.delete("/table-presets/:presetId", async (req: Request, res: Response) => {
  try {
    const presetId = parseInt(req.params.presetId);
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const deleted = await db.deleteCustomTablePreset(dataOwner, presetId);
    if (!deleted) return res.status(404).send("Preset not found");
    return res.status(200).json({ success: true });
  } catch (error) {
    return handleError(res, error, "Failed to delete table preset", req.auth.userID);
  }
});

// ==================== Scheduled Message Functions ====================

// bypassTimeGuards is test-only (see /test/run-scheduled-messages): it skips the
// once-per-minute guard and the exact-send-time checks so tests can trigger the
// scheduler deterministically without waiting for a wall-clock match.
const sendScheduledMessages = async (bypassTimeGuards = false) => {
  try {
    if (!bypassTimeGuards) {
      const israelTime = getIsraelTime();
      const currentMinute = `${israelTime.getHours()}:${israelTime.getMinutes()}`;
      if (lastExecutionMinute === currentMinute) return;
      lastExecutionMinute = currentMinute;
    }

    const today = getDateFormat(new Date());
    // Owners without messaging permission are filtered out here (admin exempt)
    const events = await db.getEventsForScheduledMessages(process.env.ADMIN_USER_ID || "");
    if (events.length === 0) return;
    log(undefined, `📝 Processing ${events.length} events for scheduled messages`);

    for (const event of events) {
      const userID = event.user_id;
      const { weddingDateStr, dayBeforeWeddingStr, dayAfterWeddingStr } = getWeddingDateStrings(event.date);
      const reminderTime = event.reminder_time || "09:00";

      // Event reminder (day_before or wedding_day) — applies to any event, not just the wedding
      if (event.send_reminder) {
        const isEventDay = event.reminder_day === "wedding_day";
        const triggerDate = isEventDay ? weddingDateStr : dayBeforeWeddingStr;
        if (today === triggerDate && (bypassTimeGuards || isTimeToSend(reminderTime))) {
          const eventGuests = limitGuests((await db.getEventGuests(event.id, "approved")).filter(hasPhone));
          if (eventGuests.length > 0) {
            await logMessage(userID, `🔄 Sending ${isEventDay ? "event day" : "day before"} reminder for "${event.ceremony_name}" to ${eventGuests.length} guests`);
            const tasks = eventGuests.map((eg) => () =>
              sendWhatsAppMessage({ phone: eg.phone, user_id: eg.user_id || userID, name: eg.name || eg.phone, guest_id: eg.guest_id }, { template: { name: "event_reminder", event } })
            );
            await sendMessagesAndLog(tasks, userID, "💍", `${isEventDay ? "event day" : "day before"} reminder`);
            // Stamped so a later delivery-failed webhook knows this wasn't the
            // invitation (only invitation failures feed the failed panel).
            await db.setEventGuestsLastMessageType(event.id!, eventGuests.map((eg) => eg.guest_id), "eventReminder");
          }
        }
      }

      // Thank-you messages the day after (wedding-only)
      if (event.is_primary && event.send_thank_you && today === dayAfterWeddingStr && (bypassTimeGuards || isTimeToSend(THANK_YOU_MESSAGE_TIME))) {
        const eventGuests = limitGuests((await db.getEventGuests(event.id, "approved")).filter(hasPhone));
        if (eventGuests.length > 0) {
          await logMessage(userID, `🔄 Sending thank-you for "${event.ceremony_name}" to ${eventGuests.length} guests`);
          const templateName = event.thank_you_message?.trim() ? "custom_thank_you_message" : "thank_you_message";
          const tasks = eventGuests.map((eg) => () =>
            sendWhatsAppMessage({ phone: eg.phone, user_id: eg.user_id || userID, name: eg.name || eg.phone, guest_id: eg.guest_id }, { template: { name: templateName, event } })
          );
          await sendMessagesAndLog(tasks, userID, "🙏", "thank-you messages");
          await db.setEventGuestsLastMessageType(event.id!, eventGuests.map((eg) => eg.guest_id), "thankYou");
        }
      }
    }
  } catch (error) {
    logError(undefined, "Error sending scheduled messages:", error);
  }
};

// ==================== Scheduled Rounds ("send and go" plan) ====================

const SCHEDULED_ROUND_LABELS: Record<ScheduledRoundType, string> = {
  rsvp: "scheduled RSVP invitation",
  rsvpReminder: "scheduled RSVP reminder",
  call: "scheduled RSVP call round",
};

// Grace window between a scheduled invitation send and its failed-numbers
// report email, so async delivery-failed webhooks have time to arrive.
const FAILURE_REPORT_DELAY_MS = Number(process.env.SCHEDULED_FAILURE_REPORT_DELAY_MS ?? 3 * 60 * 1000);

/**
 * Executes due scheduled rounds for "send and go" couples: the RSVP
 * invitation, up to 3 pending-guest reminders, and up to 2 voice-call rounds,
 * each at the date/time the couple picked. Rounds are claimed atomically
 * (pending → processing) so overlapping ticks can't double-send.
 * bypassTime/eventId are test-only (see /test/run-scheduled-rounds).
 */
const processScheduledRounds = async (opts: { bypassTime?: boolean; eventId?: number } = {}) => {
  try {
    const rounds = await db.claimDueScheduledRounds(opts.bypassTime ?? false, opts.eventId);
    for (const round of rounds) {
      const label = `${SCHEDULED_ROUND_LABELS[round.round_type]} ${round.round_number}`;
      try {
        const event = await db.getEventById(round.event_id);
        if (!event) {
          await db.updateScheduledRoundStatus(round.id!, "skipped");
          continue;
        }
        const ownerID = event.user_id;

        // Same gate as /sendMessage, plus the plan itself: if the admin moved
        // the couple back to manual, their leftover rounds must not fire.
        const isAdminOwner = ownerID === process.env.ADMIN_USER_ID;
        const permission = await db.getMessagingPermissionStatus(ownerID);
        const plan = await db.getMessagingPlan(ownerID);
        if (!isAdminOwner && (permission !== "approved" || plan !== "scheduled")) {
          await db.updateScheduledRoundStatus(round.id!, "skipped");
          await logMessage(ownerID, `⏭️ Skipped ${label} for "${event.ceremony_name}" — messaging permission or scheduled plan not active`);
          continue;
        }

        if (round.round_type === "call") {
          if (!isVoiceConfigured()) {
            await db.updateScheduledRoundStatus(round.id!, "skipped");
            await logMessage(ownerID, `⏭️ Skipped ${label} for "${event.ceremony_name}" — voice calling is not configured`);
            continue;
          }
          const result = await placeRsvpCalls(round.event_id);
          await db.updateScheduledRoundStatus(round.id!, "sent");
          await logMessage(ownerID, `📞 ${label} for "${event.ceremony_name}": queued ${result.queued}, failed ${result.failed}, skipped ${result.skippedNoPhone}`);
          continue;
        }

        const eventForSend = await withInheritedCoupleNames(event);

        // Same invitation-completeness gate as /sendMessage — a round scheduled
        // before the details were completed must not send a half-empty invitation.
        if (round.round_type === "rsvp") {
          const missingFields = getMissingInvitationFields(eventForSend);
          if (missingFields.length > 0) {
            await db.updateScheduledRoundStatus(round.id!, "skipped");
            await logMessage(ownerID, `⏭️ Skipped ${label} for "${event.ceremony_name}" — invitation details incomplete (missing: ${missingFields.join(", ")})`);
            continue;
          }
        }

        const rsvpFilter = round.round_type === "rsvpReminder" ? "pending" as const : undefined;
        const eventGuests = limitGuests((await db.getEventGuests(round.event_id, rsvpFilter)).filter(hasPhone));
        if (eventGuests.length === 0) {
          await db.updateScheduledRoundStatus(round.id!, "sent");
          await logMessage(ownerID, `🗓️ ${label} for "${event.ceremony_name}" — no guests to send to`);
          continue;
        }

        await logMessage(ownerID, `🗓️ Sending ${label} for "${event.ceremony_name}" to ${eventGuests.length} guests`);
        const tasks = buildMessageTasks(eventGuests, round.round_type, "", eventForSend, ownerID);
        const outcome = await sendMessagesAndLog(tasks, ownerID, "🗓️", label);
        // Only the invitation round feeds the failed-guests panel/email —
        // reminder-round failures are mostly transient and stay in the log.
        if (round.round_type === "rsvp") {
          await db.recordGuestSendResults(round.event_id, outcome.results);
        }
        await db.setEventGuestsLastMessageType(round.event_id, eventGuests.map((eg) => eg.guest_id), round.round_type);
        await db.updateEventGuestLastRsvpSentAt(round.event_id, eventGuests.map((eg) => eg.guest_id));
        await db.updateScheduledRoundStatus(round.id!, "sent");
      } catch (error) {
        logError(undefined, `Error executing ${label} (round ${round.id}):`, error);
        await db.updateScheduledRoundStatus(round.id!, "failed").catch(() => { });
      }
    }

    await sendPendingFailureReports(opts.bypassTime ?? false, opts.eventId);
  } catch (error) {
    logError(undefined, "Error processing scheduled rounds:", error);
  }
};

/**
 * Emails the couple about guests whose invitation wasn't delivered, so they
 * can fix the numbers and resend to just those guests. Keyed off the guests
 * themselves (not scheduled rounds): failures from scheduled rounds, manual
 * sends, targeted resends, and late-arriving webhooks all get reported, each
 * failure exactly once, after a grace window that lets async webhook
 * failures accumulate into a single email.
 */
const sendPendingFailureReports = async (bypassDelay = false, eventId?: number) => {
  const dueEvents = await db.getEventsWithUnreportedSendFailures(bypassDelay ? 0 : FAILURE_REPORT_DELAY_MS, eventId);
  for (const due of dueEvents) {
    try {
      // Mark first: a report that fails to send shouldn't retry forever on
      // every tick (the failures also live in the activity log and the app).
      await db.markEventSendFailuresReported(due.event_id);

      const failures = (await db.getEventGuests(due.event_id)).filter((eg) => eg.last_send_error);
      if (failures.length === 0) continue;

      const owner = await db.getUserByID(due.user_id);
      if (!owner) continue;

      await sendDeliveryFailureReportEmail({
        userID: owner.userID,
        name: owner.name,
        email: owner.email,
        eventName: due.ceremony_name,
        failures: failures.map((eg) => ({
          guestName: eg.name || String(eg.guest_id),
          phone: eg.phone || "",
          error: eg.last_send_error!,
        })),
      });
      await logMessage(due.user_id, `📧 Emailed delivery-failure report for "${due.ceremony_name}" — ${failures.length} guests need a number check`);
    } catch (error) {
      logError(due.user_id, "Failed to send delivery-failure report:", error);
    }
  }
};

const cleanupOldLogs = async () => {
  try {
    log(undefined, "🧹 Starting log cleanup...");
    const deletedCount = await db.cleanupOldLogs();
    log(undefined, `🗑️ Deleted ${deletedCount} old log entries`);
  } catch (error) {
    logError(undefined, "Error cleaning up logs:", error);
  }
};

// 60 days after the wedding, an account (and its linked partner, if any) is
// permanently deleted; 3 days before that a warning email with a full data
// export goes out. Deletion never runs for an account until its warning has
// been *confirmed sent* — a failed send is retried the next day instead.
const WARNING_DAYS_BEFORE_DELETION = 57;
const DELETION_DAYS = 60;

const deleteAccountAndPartner = async (ownerID: string, weddingDate: string | null) => {
  const owner = await db.getUserByID(ownerID);
  if (!owner) return; // already deleted by a previous, interrupted run
  const { partner } = await db.getPartnerInfo(ownerID);

  await db.recordDeletedAccount({ userID: ownerID, email: owner.email, name: owner.name, weddingDate, role: "owner" });
  if (partner) {
    await db.recordDeletedAccount({ userID: partner.userID, email: partner.email, name: partner.name, weddingDate, role: "partner" });
  }

  // Delete the partner first (nothing references its row); only delete the
  // owner — which cascades every owned table — once that's succeeded, so a
  // crash mid-sequence leaves state a later run can safely retry.
  if (partner) await db.deleteUser(partner.userID);
  await db.deleteUser(ownerID);
  await logMessage(undefined, `🗑️ Auto-deleted account ${ownerID} 60 days after wedding`);
};

const runAccountRetentionCheck = async () => {
  try {
    const events = await db.getPrimaryEventsForRetentionCheck(process.env.ADMIN_USER_ID || "");
    for (const event of events) {
      const daysSince = daysBetween(getIsraelTime(), event.date!);
      if (daysSince < WARNING_DAYS_BEFORE_DELETION) continue;

      if (!event.deletion_warning_sent_at) {
        try {
          const owner = await db.getUserByID(event.user_id);
          if (!owner) continue;
          const exports = await buildAllExports(db, event.user_id);
          await sendDataExportWarningEmail({
            userID: event.user_id,
            name: owner.name,
            email: owner.email,
            weddingDate: event.date!,
            deletionDate: addDays(event.date!, DELETION_DAYS),
            attachments: exports,
          });
          await db.markDeletionWarningSent(event.id!);
          await logMessage(event.user_id, "📧 Sent 60-day data deletion warning email");
        } catch (err) {
          logError(event.user_id, `Failed to send deletion warning for ${event.user_id}:`, err);
          continue; // retried tomorrow; deletion below is gated on this succeeding
        }
      }

      if (daysSince >= DELETION_DAYS && event.deletion_warning_sent_at) {
        await deleteAccountAndPartner(event.user_id, event.date!);
      }
    }
  } catch (error) {
    logError(undefined, "Error running account retention check:", error);
  }
};

setInterval(() => {
  sendScheduledMessages();
  processScheduledRounds();
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    cleanupOldLogs();
    runAccountRetentionCheck();
  }
}, 60000);

const PORT = process.env.PORT || 8080;
async function startServer() {
  try {
    db = await Database.connect();
    log(undefined, "Connected to database");

    app.listen(PORT, () => {
      log(undefined, `Server listening on port ${PORT}`);
      sendScheduledMessages();
      processScheduledRounds();
      runAccountRetentionCheck();
    });
  } catch (error) {
    logError(undefined, "Database connection failed:", error);
    process.exit(1);
  }
}

startServer();
