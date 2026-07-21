import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import Database from "./dbUtils";
import { User, Event, EventGuest, TemplateName } from "./types";
import { Request, Response, RequestHandler } from "express-serve-static-core";
import multer from "multer";
import {
  handleButtonReply,
  handleTextResponse,
  sendWhatsAppMessage,
  uploadImage,
  getTemplateParams,
  logMessage,
  batchLogMessageResults,
  MessageResult,
} from "./utils";
import { getDateFormat, getWeddingDateStrings } from "./dateUtils";
import axios from "axios";
import { getAccessToken } from "./whatsappTokenManager";
import {
  authenticateMiddleware,
  requireAdmin,
  verifyGoogleToken,
  issueSessionToken,
} from "./auth";
import { sendApprovalRequestEmail } from "./email";
import { log, logError } from "./logger";

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

const getTemplateName = (
  messageType: string,
  hasGiftLink: boolean,
  isWeddingDay: boolean,
): TemplateName => {
  if (messageType === "weddingReminder") {
    if (isWeddingDay) {
      return hasGiftLink
        ? "wedding_day_reminder"
        : "wedding_reminders_no_gift_same_day";
    }
    return hasGiftLink
      ? "day_before_wedding_reminder"
      : "wedding_reminders_no_gift";
  }
  return messageType as TemplateName;
};

const limitGuests = <T>(guests: T[]): T[] =>
  guests.length <= MAX_GUESTS_PER_MESSAGE_BATCH
    ? guests
    : guests.slice(0, MAX_GUESTS_PER_MESSAGE_BATCH);

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
type MediaResource = "primaryImage" | "eventImage" | "vendorFile";

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
    const { eventId, guestId, phone, userID: candidateUserID, guestName } = bestCandidate;
    let msg: string;
    if (message.type === "button") {
      msg = message.button?.payload || message.button?.text || "";
      await logMessage(candidateUserID, `🔘 SMS button reply for event ${eventId} from ${guestName} (${phone}): ${msg}`);
      await handleButtonReply(msg, phone, candidateUserID, eventId, guestId, guestName).catch((error) => {
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
        sendApprovalRequestEmail({ userID: identity.userID, name: identity.name, email: identity.email }).catch(
          (error) => logError(identity.userID, "Failed to send approval-request email:", error),
        );
      }
      await logMessage(identity.userID, `⏳ Pending approval: ${identity.name} (${identity.email})`);
      return res.status(200).json({ status: "pending" });
    }

    const token = issueSessionToken({ ...identity, isAdmin });

    await logMessage(identity.userID, `🔑 Signed in: ${identity.name} (${identity.email})`);

    res.status(200).json({ token, user: identity, isAdmin, status: "approved" });
  } catch (error) {
    return handleError(res, error, "Failed to sign in with Google");
  }
});

// ==================== Auth Middleware (everything below requires a valid session) ====================

app.use(authenticateMiddleware);

app.get("/auth/me", async (req: Request, res: Response) => {
  try {
    const user = await db.getUserByID(req.auth.userID);
    if (!user) return res.status(404).send("User not found");
    res.status(200).json({ user, isAdmin: req.auth.isAdmin });
  } catch (error) {
    return handleError(res, error, "Failed to load current user");
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

    res.status(200).json({ token, user: targetUser });
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
    await logMessage(dataOwner, `📠 RSVP manually updated for guest ${guestId} in event ${eventId}: ${rsvpStatus}`);
    const guests = await db.getEventGuests(Number(eventId));
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

app.delete("/deleteUser", async (req: Request, res: Response) => {
  const userID = req.auth.userID;
  try {
    await db.deleteAllGuests(userID);
    await db.deleteUser(userID);
    await db.deleteAllTasks(userID);
    await logMessage(undefined, "🗑️ User account deleted");
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
        reminder_day: info.reminder_day,
        reminder_time: info.reminder_time,
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

// Send messages for a specific event
app.post("/sendMessage", async (req: Request, res: Response) => {
  try {
    const { options } = req.body;
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const messageType: string = options?.messageType || "rsvp";
    const customText: string = options?.customText;
    const selectedGuestIds: number[] | undefined = options?.guestIds;

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

    // For non-primary events, fill bride/groom from the primary event
    if (!event.is_primary || !event.bride_name) {
      const primary = event.is_primary ? event : await db.getPrimaryEvent(dataOwner);
      event = { ...event, bride_name: event.bride_name || primary?.bride_name, groom_name: event.groom_name || primary?.groom_name };
    }

    // Get event guests with optional RSVP filter
    const rsvpFilter = messageType === "rsvpReminder" ? "pending" : messageType === "weddingReminder" ? "approved" : undefined;
    let eventGuests = await db.getEventGuests(eventId, rsvpFilter);

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

    const label = messageType === "rsvp" ? "RSVP invitation" : messageType === "rsvpReminder" ? "RSVP reminder" : messageType === "weddingReminder" ? "wedding reminder" : messageType === "thankYou" ? "thank-you" : "custom text";
    await logMessage(dataOwner, `📨 Sending ${label} for "${event.ceremony_name}" to ${limited.length} guests`);

    const promises = buildMessagePromises(limited, messageType, customText, event, dataOwner);
    const results = await sendMessagesAndLog(promises, dataOwner, "🎯", label);

    if (messageType === "rsvp" || messageType === "rsvpReminder") {
      await db.updateEventGuestLastRsvpSentAt(eventId, limited.map((eg) => eg.guest_id));
    }

    return res.status(200).send(results);
  } catch (error) {
    logError(req.auth?.userID, "Error sending messages:", error);
    return res.status(500).send(error.message);
  }
});

const sendMessagesAndLog = async (
  promises: Promise<MessageResult>[],
  userID: string,
  successEmoji: string,
  messageLabel: string,
  preMessageLogs: string[] = [],
): Promise<{
  success: number;
  fail: number;
  failGuestsList: Pick<MessageResult, "guestName" | "logMessage">[];
}> => {
  const results = await Promise.all(promises);

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
  return { success: successCount, fail: failCount, failGuestsList };
};

const buildMessagePromises = (
  eventGuests: EventGuest[],
  messageType: string,
  customText: string,
  event: Event,
  userID: string,
): Promise<MessageResult>[] => {
  const toRecipient = (eg: EventGuest) => ({ phone: eg.phone, user_id: eg.user_id || userID, name: eg.name || eg.phone });

  if (messageType === "freeText") {
    return eventGuests.map((eg) => sendWhatsAppMessage(toRecipient(eg), { freeText: customText }));
  }
  if (messageType === "rsvpReminder") {
    return eventGuests.map((eg) => sendWhatsAppMessage(toRecipient(eg), { template: { name: "wedding_rsvp_reminder", event } }));
  }
  if (messageType === "weddingReminder") {
    const hasGiftLink = !!(event.gift_link?.trim());
    const isWeddingDay = event.reminder_day === "wedding_day";
    const templateName = getTemplateName(messageType, hasGiftLink, isWeddingDay);
    return eventGuests.map((eg) => sendWhatsAppMessage(toRecipient(eg), { template: { name: templateName, event } }));
  }
  if (messageType === "thankYou") {
    const templateName = event.thank_you_message ? "custom_thank_you_message" : "thank_you_message";
    return eventGuests.map((eg) => sendWhatsAppMessage(toRecipient(eg), { template: { name: templateName, event } }));
  }
  // Default: RSVP invitation
  return eventGuests.map((eg) => sendWhatsAppMessage(toRecipient(eg), { template: { name: "wedding_rsvp_action", event } }));
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

// ==================== Admin Endpoints ====================

app.post("/getUsers", requireAdmin, async (req: Request, res: Response) => {
  try {
    const users = await db.getAllUsers();
    res.status(200).json(users);
  } catch (error) {
    return handleError(res, error, "Failed to retrieve users");
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
    await db.updateUserStatus(userID, "approved");
    res.status(200).send("User approved");
  } catch (error) {
    return handleError(res, error, "Failed to approve user");
  }
});

app.post("/admin/declineUser", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userID } = req.body;
    if (!userID) return res.status(400).send("userID is required");
    await db.updateUserStatus(userID, "declined");
    res.status(200).send("User declined");
  } catch (error) {
    return handleError(res, error, "Failed to decline user");
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

// ==================== Event Routes ====================

app.post(
  "/events",
  upload.single("image") as RequestHandler,
  async (req: Request, res: Response) => {
    try {
      const { ceremony_name, date, time, location, additional_info } = req.body;
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
        file_id: null,
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

app.patch("/events/:eventId", async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;
    const updates = req.body;
    const dataOwner = await resolveDataOwner(req.auth.userID);
    const event = await db.getEventById(parseInt(eventId));
    if (!event || event.user_id !== dataOwner) return res.status(404).send("Event not found");
    const updated = await db.updateEvent(parseInt(eventId), updates);
    await logMessage(dataOwner, `✏️ Event updated: "${event.ceremony_name}"`);
    return res.status(200).json(updated);
  } catch (error) {
    logError(req.auth?.userID, "Error updating event:", error);
    return res.status(500).send("Failed to update event");
  }
});

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

// ==================== Scheduled Message Functions ====================

const sendScheduledMessages = async () => {
  try {
    const israelTime = getIsraelTime();
    const currentMinute = `${israelTime.getHours()}:${israelTime.getMinutes()}`;
    if (lastExecutionMinute === currentMinute) return;
    lastExecutionMinute = currentMinute;

    const today = getDateFormat(new Date());
    const events = await db.getEventsForScheduledMessages();
    if (events.length === 0) return;
    log(undefined, `📝 Processing ${events.length} events for scheduled messages`);

    for (const event of events) {
      const userID = event.user_id;
      const { weddingDateStr, dayBeforeWeddingStr, dayAfterWeddingStr } = getWeddingDateStrings(event.date);
      const reminderTime = event.reminder_time || "09:00";

      // Wedding day reminder (day_before or wedding_day)
      if (event.send_reminder) {
        const isWeddingDay = event.reminder_day === "wedding_day";
        const triggerDate = isWeddingDay ? weddingDateStr : dayBeforeWeddingStr;
        if (today === triggerDate && isTimeToSend(reminderTime)) {
          const eventGuests = limitGuests(await db.getEventGuests(event.id, "approved"));
          if (eventGuests.length > 0) {
            await logMessage(userID, `🔄 Sending ${isWeddingDay ? "wedding day" : "day before"} reminder for "${event.ceremony_name}" to ${eventGuests.length} guests`);
            const hasGiftLink = !!(event.gift_link?.trim());
            const templateName = getTemplateName("weddingReminder", hasGiftLink, isWeddingDay);
            const promises = eventGuests.map((eg) =>
              sendWhatsAppMessage({ phone: eg.phone, user_id: eg.user_id || userID, name: eg.name || eg.phone }, { template: { name: templateName, event } })
            );
            await sendMessagesAndLog(promises, userID, "💍", `${isWeddingDay ? "wedding day" : "day before"} reminder`);
          }
        }
      }

      // Thank-you messages the day after
      if (event.send_thank_you && today === dayAfterWeddingStr && isTimeToSend(THANK_YOU_MESSAGE_TIME)) {
        const eventGuests = limitGuests(await db.getEventGuests(event.id, "approved"));
        if (eventGuests.length > 0) {
          await logMessage(userID, `🔄 Sending thank-you for "${event.ceremony_name}" to ${eventGuests.length} guests`);
          const templateName = event.thank_you_message?.trim() ? "custom_thank_you_message" : "thank_you_message";
          const promises = eventGuests.map((eg) =>
            sendWhatsAppMessage({ phone: eg.phone, user_id: eg.user_id || userID, name: eg.name || eg.phone }, { template: { name: templateName, event } })
          );
          await sendMessagesAndLog(promises, userID, "🙏", "thank-you messages");
        }
      }
    }
  } catch (error) {
    logError(undefined, "Error sending scheduled messages:", error);
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

setInterval(() => {
  sendScheduledMessages();
  const now = new Date();
  if (now.getHours() === 0 && now.getMinutes() === 0) {
    cleanupOldLogs();
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
    });
  } catch (error) {
    logError(undefined, "Database connection failed:", error);
    process.exit(1);
  }
}

startServer();
