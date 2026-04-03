import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import Database from "./dbUtilsPostgresNeon";
import {
  FilterOptions,
  Guest,
  GuestIdentifier,
  User,
  WeddingDetails,
  TemplateName,
} from "./types";
import { Request, Response } from "express-serve-static-core";
import multer from "multer";
import {
  handleButtonReply,
  sendWhatsAppMessage,
  uploadImage,
  handleTextResponse,
  logMessage,
  batchLogMessageResults,
  MessageResult,
} from "./utils";
import { getDateFormat, getWeddingDateStrings } from "./dateUtils";
import axios from "axios";
import { getAccessToken } from "./whatsappTokenManager";

const upload = multer({ storage: multer.memoryStorage() });
dotenv.config();

const app = express();
app.use(express.json() as any);
app.use(cors() as any);
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

const limitGuestsByMaxGuestsNumber = (guests: Guest[]): Guest[] => {
  if (guests.length <= MAX_GUESTS_PER_MESSAGE_BATCH) {
    return guests;
  }
  return guests.slice(0, MAX_GUESTS_PER_MESSAGE_BATCH);
};

const filterAndLimitGuests = (
  guests: Guest[],
  options: {
    messageGroup?: number;
    rsvpStatus?: FilterOptions;
  },
): Guest[] => {
  let filtered = guests;

  if (options.messageGroup) {
    filtered = filtered.filter(
      (guest) => guest.messageGroup === options.messageGroup,
    );
  }

  if (options.rsvpStatus === "pending") {
    filtered = filtered.filter(
      (guest) => guest.RSVP === null || guest.RSVP === undefined,
    );
  } else if (options.rsvpStatus === "approved") {
    filtered = filtered.filter((guest) => guest.RSVP && guest.RSVP > 0);
  } else if (options.rsvpStatus === "declined") {
    filtered = filtered.filter((guest) => guest.RSVP === 0);
  }

  return limitGuestsByMaxGuestsNumber(filtered);
};

const handleError = async (
  res: Response,
  error: any,
  message: string,
  userID?: string,
): Promise<Response> => {
  console.error(message, error);
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

// ==================== Routes ====================

app.get("/sms", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token) {
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("✅ Webhook verified");
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
    const guestsList = await db.getAllGuests();
    const matchingGuests = guestsList.filter(
      (guest: Guest) => guest.phone === sender,
    );

    if (matchingGuests.length === 0) {
      console.log(`Phone number not found in guest list: ${sender}`);
      return res.sendStatus(200);
    }

    const guestSender =
      matchingGuests.length === 1
        ? matchingGuests[0]
        : matchingGuests.reduce((latest, guest) => {
            if (!latest.lastRsvpSentAt) return guest;
            if (!guest.lastRsvpSentAt) return latest;
            return new Date(guest.lastRsvpSentAt) >
              new Date(latest.lastRsvpSentAt)
              ? guest
              : latest;
          });
    let msg;
    if (message.type === "button") {
      msg = message.button?.payload || message.button?.text || "";
      await logMessage(
        guestSender.userID,
        `🔘 SMS button reply received from ${guestSender.name} (${guestSender.phone}): ${msg}`,
      );
      await handleButtonReply(msg, guestSender).catch((error) => {
        console.error("Error processing SMS:", error);
        return res.status(500).send(error.message);
      });
    } else if (message.type === "text") {
      msg = message.text.body;
      await logMessage(
        guestSender.userID,
        `📥 SMS text message received from ${guestSender.name} (${guestSender.phone}): ${msg}`,
      );
      await handleTextResponse(msg, guestSender).catch((error) => {
        console.error("Error processing SMS:", error);
        return res.status(500).send(error.message);
      });
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("Error processing SMS:", error);
    return res.status(500).send("Server error");
  }
});

app.post("/updateRsvp", async (req: Request, res: Response) => {
  try {
    const { userID, guest }: { userID: string; guest: Guest } = req.body;
    const dataOwner = await resolveDataOwner(userID);

    await db.updateRSVP(guest.name, guest.phone, guest.RSVP, dataOwner);
    await logMessage(
      dataOwner,
      `📠 RSVP updated for guest: ${guest.name} - RSVP: ${guest.RSVP}`,
    );
    const guestsList = await db.getGuests(dataOwner);
    res.status(200).send(guestsList);
  } catch (error) {
    console.error("Error updating RSVP:", error);
    return res.status(500).send("Failed to update RSVP");
  }
});

app.post("/guestsList", async (req: Request, res: Response) => {
  try {
    const { userID }: { userID: User["userID"] } = req.body;
    const dataOwner = await resolveDataOwner(userID);

    const guestsList = await db.getGuests(dataOwner);
    res.status(200).json(guestsList);
  } catch (error) {
    console.error("Error retrieving guest list:", error);
    return res.status(500).send("Error retrieving guest list");
  }
});

app.patch("/addGuests", async (req: Request, res: Response) => {
  const {
    guestsToAdd,
    userID,
  }: { guestsToAdd: Guest[]; userID: User["userID"] } = req.body;
  try {
    if (!Array.isArray(guestsToAdd)) {
      return res.status(400).send("Invalid input: expected an array of guests");
    }

    const dataOwner = await resolveDataOwner(userID);

    await db.addMultipleGuests(dataOwner, guestsToAdd);
    const guestsList = await db.getGuests(dataOwner);
    await logMessage(
      dataOwner,
      `👥 Added ${guestsToAdd.length} guests. Total guests: ${guestsList.length}`,
    );
    res.status(200).send(guestsList);
  } catch (error) {
    return handleError(res, error, "Failed to add guests", userID);
  }
});

app.patch("/addUser", async (req: Request, res: Response) => {
  try {
    console.log("Adding user");
    const { newUser }: { newUser: User } = req.body;
    await db.addUser(newUser);
    const guestsList = await db.getGuests(newUser.userID);
    await logMessage(
      newUser.userID,
      `🆕 User account created: ${newUser.name} (${newUser.email}). User ID: ${newUser.userID}`,
    );
    res.status(200).send(guestsList);
  } catch (error) {
    return handleError(res, error, "Failed to add user");
  }
});

app.delete("/deleteUser", async (req: Request, res: Response) => {
  const { userID }: { userID: User["userID"] } = req.body;
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
  const { userID }: { userID: User["userID"] } = req.body;
  try {
    const dataOwner = await resolveDataOwner(userID);

    await db.deleteAllGuests(dataOwner);
    const guestsList = await db.getGuests(dataOwner);
    await logMessage(dataOwner, "🧹 All guests deleted from account");
    res.status(200).send(guestsList);
  } catch (error) {
    return handleError(res, error, "Failed to reset database", userID);
  }
});

app.delete("/deleteGuest", async (req: Request, res: Response) => {
  const {
    userID,
    guest,
  }: {
    userID: User["userID"];
    guest: GuestIdentifier;
  } = req.body;
  try {
    const dataOwner = await resolveDataOwner(userID);

    await db.deleteGuest(guest, dataOwner);
    await logMessage(dataOwner, `👋 Guest deleted: ${guest.name}`);
    const guestsList = await db.getGuests(dataOwner);
    res.status(200).send(guestsList);
  } catch (error) {
    return handleError(res, error, "Failed to delete guest", userID);
  }
});

app.post(
  "/saveWeddingInfo",
  upload.single("imageFile"),
  async (req: Request, res: Response) => {
    const userID = req.body.userID;
    try {
      const dataOwner = await resolveDataOwner(userID);
      const weddingInfo = JSON.parse(req.body.weddingInfo);
      const file = (req as any).file;

      // Check if this is a first-time wedding setup (no existing info)
      const existingInfo = await db.getWeddingInfo(dataOwner);
      const isFirstTimeSetup = !existingInfo;

      // If a new file is uploaded, process it and update fileID
      if (file) {
        const fileID = await uploadImage(file);
        weddingInfo.fileID = fileID;
      } else {
        // If no new file is uploaded, preserve the existing fileID
        if (existingInfo?.fileID) {
          weddingInfo.fileID = existingInfo.fileID;
        }
      }

      await db.saveWeddingInfo(dataOwner, weddingInfo);

      // If this is a first-time wedding setup, populate default tasks
      if (isFirstTimeSetup) {
        await db.populateDefaultTasks(dataOwner);
      }

      await logMessage(
        dataOwner,
        `💒 Wedding information saved: ${JSON.stringify(weddingInfo)}`,
      );

      res.status(200).send("Wedding information saved successfully");
    } catch (error) {
      return handleError(
        res,
        error,
        "Failed to save wedding information",
        userID,
      );
    }
  },
);

app.get("/getWeddingInfo/:userID", async (req: Request, res: Response) => {
  try {
    const userID = req.params.userID;
    const dataOwner = await resolveDataOwner(userID);

    const weddingInfo = await db.getWeddingInfo(dataOwner);
    res.status(200).json(weddingInfo);
  } catch (error) {
    console.error("Error retrieving wedding information:", error);
    return res.status(500).send("Failed to retrieve wedding information");
  }
});

app.patch("/updateGuestsGroups", async (req: Request, res: Response) => {
  const { guests, userID }: { guests: Guest[]; userID: User["userID"] } =
    req.body;
  try {
    const dataOwner = await resolveDataOwner(userID);

    await db.updateGuestsGroups(dataOwner, guests);
    await logMessage(dataOwner, `🔗 Guest groups updated`);
    const updatedGuestsList = await db.getGuests(dataOwner);
    res.status(200).json(updatedGuestsList);
  } catch (error) {
    return handleError(res, error, "Failed to update guest groups", userID);
  }
});

app.post("/sendMessage", async (req: Request, res: Response) => {
  try {
    const { userID, options } = req.body;
    const dataOwner = await resolveDataOwner(userID);
    const messageType = options?.messageType || "rsvp";
    const customText = options?.customText;

    // Validate free text message
    if (
      messageType === "freeText" &&
      (!customText || customText.trim() === "")
    ) {
      await logMessage(dataOwner, `❌ Custom text message cannot be empty`);
      return res.status(400).send("Custom text message cannot be empty");
    }

    const allGuests = await db.getGuestsWithUserID(dataOwner);
    const guests = filterAndLimitGuests(allGuests, {
      messageGroup: options?.messageGroup
        ? Number(options.messageGroup)
        : undefined,
      rsvpStatus:
        messageType === "rsvpReminder"
          ? "pending"
          : messageType === "weddingReminder"
            ? "approved"
            : undefined,
    });

    if (guests.length === 0) {
      await logMessage(dataOwner, `❌ No guests match the selected criteria`);
      return res.status(400).send("No guests match the selected criteria");
    }

    // Check if we had to limit the guests
    if (guests.length === MAX_GUESTS_PER_MESSAGE_BATCH) {
      await logMessage(
        dataOwner,
        `⚠️ Guest list limited to ${MAX_GUESTS_PER_MESSAGE_BATCH} guests (WhatsApp limit)`,
      );
    }

    const messageTypeLabel =
      messageType === "rsvp"
        ? "RSVP invitation"
        : messageType === "rsvpReminder"
          ? "rsvpReminder"
          : messageType === "weddingReminder"
            ? "wedding reminder"
            : "custom text";

    const groupSuffix = options?.messageGroup
      ? ` in group ${options.messageGroup}`
      : "";

    await logMessage(
      dataOwner,
      `📨 Sending ${messageTypeLabel} messages to ${guests.length} guests${groupSuffix}`,
    );

    const weddingInfo = await db.getWeddingInfo(dataOwner);
    const messagePromises = buildMessagePromises(
      guests,
      messageType,
      customText,
      weddingInfo,
    );

    const messageResults = await sendMessagesAndLog(
      messagePromises,
      dataOwner,
      "🎯",
      `${messageTypeLabel} messages${groupSuffix}`,
    );

    if (messageType === "rsvp" || messageType === "rsvpReminder") {
      const phones = guests.map((g) => g.phone);
      await db.updateLastRsvpSentAt(dataOwner, phones);
    }

    return res.status(200).send(messageResults);
  } catch (error) {
    console.error("Error sending messages:", error);
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
  guests: Guest[],
  messageType: string,
  customText: string,
  weddingInfo: WeddingDetails,
): Promise<MessageResult>[] => {
  if (messageType === "freeText") {
    return guests.map((guest) =>
      sendWhatsAppMessage(guest, { freeText: customText }),
    );
  }

  if (messageType === "rsvpReminder") {
    return guests.map((guest) =>
      sendWhatsAppMessage(guest, {
        template: {
          name: "wedding_rsvp_reminder",
          info: weddingInfo,
        },
      }),
    );
  }

  if (messageType === "weddingReminder") {
    const hasGiftLink =
      weddingInfo.gift_link && weddingInfo.gift_link.trim() !== "";
    const isWeddingDay = weddingInfo.reminder_day === "wedding_day";
    const templateName = getTemplateName(
      messageType,
      hasGiftLink,
      isWeddingDay,
    );

    return guests.map((guest) =>
      sendWhatsAppMessage(guest, {
        template: {
          name: templateName,
          info: weddingInfo,
        },
      }),
    );
  }

  // Default: RSVP invitation
  return guests.map((guest) =>
    sendWhatsAppMessage(guest, {
      template: {
        name: "wedding_rsvp_action",
        info: weddingInfo,
      },
    }),
  );
};

app.get("/getImage/:userID", async (req: Request, res: Response) => {
  try {
    const userID = req.params.userID;
    const dataOwner = await resolveDataOwner(userID);

    const weddingInfo = await db.getWeddingInfo(dataOwner);
    const ACCESS_TOKEN = await getAccessToken();

    const response = await axios.get(
      `https://graph.facebook.com/v19.0/${weddingInfo.fileID}`,
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

    res.setHeader("Content-Type", imageResponse.headers["content-type"]);
    imageResponse.data.pipe(res);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch image" });
  }
});

app.get("/logs/:userID", async (req: Request, res: Response) => {
  try {
    const { userID } = req.params;
    if (!userID) {
      return res.status(400).send("UserID is required");
    }
    const dataOwner = await resolveDataOwner(userID);

    const logs = await db.getClientLogs(dataOwner);
    res.status(200).json(logs);
  } catch (error) {
    console.error("Error retrieving logs:", error);
    return res.status(500).send("Failed to retrieve logs");
  }
});

// ==================== Task Endpoints ====================

// Get all tasks for a user (grouped by timeline)
app.get("/tasks/:userID", async (req: Request, res: Response) => {
  try {
    const { userID } = req.params;
    if (!userID) {
      return res.status(400).send("UserID is required");
    }
    const dataOwner = await resolveDataOwner(userID);

    const tasks = await db.getTasks(dataOwner);
    res.status(200).json(tasks);
  } catch (error) {
    console.error("Error retrieving tasks:", error);
    return res.status(500).send("Failed to retrieve tasks");
  }
});

// Add a new task
app.post("/tasks", async (req: Request, res: Response) => {
  try {
    const { userID, task } = req.body;
    if (!userID || !task?.title || !task?.timeline_group) {
      return res
        .status(400)
        .send("UserID, title, and timeline_group are required");
    }
    const dataOwner = await resolveDataOwner(userID);

    const newTask = await db.addTask(dataOwner, task);
    await logMessage(dataOwner, `📝 New task added: "${task.title}"`);
    res.status(201).json(newTask);
  } catch (error) {
    console.error("Error adding task:", error);
    return res.status(500).send("Failed to add task");
  }
});

// Update task completion status
app.patch("/tasks/:taskId/complete", async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { userID, isCompleted } = req.body;
    if (!userID || isCompleted === undefined) {
      return res.status(400).send("UserID and isCompleted are required");
    }
    const dataOwner = await resolveDataOwner(userID);

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
    console.error("Error updating task completion:", error);
    return res.status(500).send("Failed to update task");
  }
});

// Update task details
app.patch("/tasks/:taskId", async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { userID, updates } = req.body;
    if (!userID) {
      return res.status(400).send("UserID is required");
    }
    const dataOwner = await resolveDataOwner(userID);

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
    console.error("Error updating task:", error);
    return res.status(500).send("Failed to update task");
  }
});

// Delete (soft delete) a task
app.delete("/tasks/:taskId", async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { userID } = req.body;
    if (!userID) {
      return res.status(400).send("UserID is required");
    }
    const dataOwner = await resolveDataOwner(userID);

    const deleted = await db.deleteTask(dataOwner, parseInt(taskId));
    if (!deleted) {
      return res.status(404).send("Task not found");
    }
    await logMessage(dataOwner, `🗑️ Task deleted`);
    res.status(200).send("Task deleted successfully");
  } catch (error) {
    console.error("Error deleting task:", error);
    return res.status(500).send("Failed to delete task");
  }
});

// ==================== Admin Endpoints ====================

app.post("/checkAdmin", async (req: Request, res: Response) => {
  try {
    const { userID }: { userID: string } = req.body;
    const isAdmin = checkAdminAccess(userID);
    res.status(200).json({ isAdmin });
  } catch (error) {
    return handleError(res, error, "Failed to check admin status");
  }
});

app.post("/getUsers", async (req: Request, res: Response) => {
  try {
    const { userID }: { userID: string } = req.body;

    if (!checkAdminAccess(userID)) {
      return res.status(403).send("Access denied. Admin privileges required.");
    }

    const users = await db.getAllUsers();
    res.status(200).json(users);
  } catch (error) {
    return handleError(res, error, "Failed to retrieve users");
  }
});

// ==================== Partner/Collaboration Endpoints ====================

// Generate an invite code to share with partner
app.post("/partner/generate-invite", async (req: Request, res: Response) => {
  try {
    const { userID }: { userID: string } = req.body;
    if (!userID) {
      return res.status(400).send("UserID is required");
    }

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
    const { userID, inviteCode }: { userID: string; inviteCode: string } =
      req.body;
    if (!userID || !inviteCode) {
      return res.status(400).send("UserID and inviteCode are required");
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
    const { userID }: { userID: string } = req.body;
    if (!userID) {
      return res.status(400).send("UserID is required");
    }

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

// Get partner information for a user
app.get("/partner/info/:userID", async (req: Request, res: Response) => {
  try {
    const { userID } = req.params;
    if (!userID) {
      return res.status(400).send("UserID is required");
    }

    const partnerInfo = await db.getPartnerInfo(userID);
    res.status(200).json(partnerInfo);
  } catch (error) {
    return handleError(res, error, "Failed to get partner info");
  }
});

// ==================== Budget & Vendor Endpoints ====================

// Update total wedding budget
app.patch("/budget/total", async (req: Request, res: Response) => {
  try {
    const { userID, total_budget } = req.body;
    if (!userID || total_budget === undefined) {
      return res.status(400).send("UserID and total_budget are required");
    }
    const dataOwner = await resolveDataOwner(userID);

    // Get current wedding info and update with new budget
    const currentInfo = await db.getWeddingInfo(dataOwner);
    if (!currentInfo) {
      return res
        .status(404)
        .send("Wedding info not found. Please set up your wedding first.");
    }

    await db.saveWeddingInfo(dataOwner, {
      ...currentInfo,
      total_budget: total_budget,
    });

    await logMessage(dataOwner, `💰 Total budget updated to ₪${total_budget}`);
    res.status(200).json({ total_budget });
  } catch (error) {
    console.error("Error updating total budget:", error);
    return res.status(500).send("Failed to update total budget");
  }
});

// Update estimated guests for budget planning
app.patch("/budget/estimated-guests", async (req: Request, res: Response) => {
  try {
    const { userID, estimated_guests } = req.body;
    if (!userID || estimated_guests === undefined) {
      return res.status(400).send("UserID and estimated_guests are required");
    }
    const dataOwner = await resolveDataOwner(userID);

    const currentInfo = await db.getWeddingInfo(dataOwner);
    if (!currentInfo) {
      return res
        .status(404)
        .send("Wedding info not found. Please set up your wedding first.");
    }

    await db.saveWeddingInfo(dataOwner, {
      ...currentInfo,
      estimated_guests: estimated_guests,
    });

    await logMessage(
      dataOwner,
      `👥 Estimated guests updated to ${estimated_guests}`,
    );
    res.status(200).json({ estimated_guests });
  } catch (error) {
    console.error("Error updating estimated guests:", error);
    return res.status(500).send("Failed to update estimated guests");
  }
});

// Get budget overview with all categories and vendors
app.get("/budget/overview/:userID", async (req: Request, res: Response) => {
  try {
    const { userID } = req.params;
    if (!userID) {
      return res.status(400).send("UserID is required");
    }
    const dataOwner = await resolveDataOwner(userID);
    const overview = await db.getBudgetOverview(dataOwner);
    res.status(200).json(overview);
  } catch (error) {
    console.error("Error retrieving budget overview:", error);
    return res.status(500).send("Failed to retrieve budget overview");
  }
});

// Get all budget categories
app.get("/budget/categories/:userID", async (req: Request, res: Response) => {
  try {
    const { userID } = req.params;
    if (!userID) {
      return res.status(400).send("UserID is required");
    }
    const dataOwner = await resolveDataOwner(userID);
    const categories = await db.getBudgetCategories(dataOwner);
    res.status(200).json(categories);
  } catch (error) {
    console.error("Error retrieving budget categories:", error);
    return res.status(500).send("Failed to retrieve budget categories");
  }
});

// Add a budget category
app.post("/budget/categories", async (req: Request, res: Response) => {
  try {
    const { userID, name } = req.body;
    if (!userID || !name) {
      return res.status(400).send("UserID and category name are required");
    }
    const dataOwner = await resolveDataOwner(userID);
    const category = await db.addBudgetCategory(dataOwner, name);
    await logMessage(dataOwner, `📊 Budget category added: "${name}"`);
    res.status(201).json(category);
  } catch (error: any) {
    if (error.code === "23505") {
      return res.status(400).send("Category already exists");
    }
    console.error("Error adding budget category:", error);
    return res.status(500).send("Failed to add budget category");
  }
});

// Delete a budget category
app.delete(
  "/budget/categories/:categoryId",
  async (req: Request, res: Response) => {
    try {
      const { categoryId } = req.params;
      const { userID } = req.body;
      if (!userID) {
        return res.status(400).send("UserID is required");
      }
      const dataOwner = await resolveDataOwner(userID);
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
      console.error("Error deleting budget category:", error);
      return res.status(500).send("Failed to delete budget category");
    }
  },
);

// Get all vendors for a user
app.get("/budget/vendors/:userID", async (req: Request, res: Response) => {
  try {
    const { userID } = req.params;
    if (!userID) {
      return res.status(400).send("UserID is required");
    }
    const dataOwner = await resolveDataOwner(userID);
    const vendors = await db.getVendors(dataOwner);
    res.status(200).json(vendors);
  } catch (error) {
    console.error("Error retrieving vendors:", error);
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
  upload.array("files", 10),
  async (req: Request, res: Response) => {
    try {
      const { userID, vendor: vendorJson, fileNames } = req.body;
      const vendor =
        typeof vendorJson === "string" ? JSON.parse(vendorJson) : vendorJson;
      const files = (req as any).files as VendorFile[] | undefined;

      if (!userID || !vendor?.name || !vendor?.category_id) {
        return res
          .status(400)
          .send("UserID, vendor name, and category are required");
      }

      const dataOwner = await resolveDataOwner(userID);
      const newVendor = await db.addVendor(dataOwner, vendor);
      await logMessage(dataOwner, `🏢 Vendor added: "${vendor.name}"`);

      // Upload files if any
      uploadFilesToVendors(userID, newVendor.vendor_id, files, fileNames);

      res.status(201).json(newVendor);
    } catch (error) {
      console.error("Error adding vendor:", error);
      return res.status(500).send("Failed to add vendor");
    }
  },
);

// Update a vendor
app.patch(
  "/budget/vendors/:vendorId",
  upload.array("files", 10),
  async (req: Request, res: Response) => {
    try {
      const { vendorId } = req.params;
      const { userID, updates: updatesJson, fileNames } = req.body;
      const updates =
        typeof updatesJson === "string" ? JSON.parse(updatesJson) : updatesJson;
      const files = (req as any).files as VendorFile[] | undefined;

      if (!userID) {
        return res.status(400).send("UserID is required");
      }

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
      console.error("Error updating vendor:", error);
      return res.status(500).send("Failed to update vendor");
    }
  },
);

// Delete a vendor
app.delete("/budget/vendors/:vendorId", async (req: Request, res: Response) => {
  try {
    const { vendorId } = req.params;
    const { userID } = req.body;
    if (!userID) {
      return res.status(400).send("UserID is required");
    }
    const dataOwner = await resolveDataOwner(userID);
    const deleted = await db.deleteVendor(dataOwner, parseInt(vendorId));
    if (!deleted) {
      return res.status(404).send("Vendor not found");
    }
    await logMessage(dataOwner, `🗑️ Vendor deleted`);
    res.status(200).send("Vendor deleted successfully");
  } catch (error) {
    console.error("Error deleting vendor:", error);
    return res.status(500).send("Failed to delete vendor");
  }
});

// Toggle vendor favorite
app.patch(
  "/budget/vendors/:vendorId/favorite",
  async (req: Request, res: Response) => {
    try {
      const { vendorId } = req.params;
      const { userID } = req.body;
      if (!userID) {
        return res.status(400).send("UserID is required");
      }
      const dataOwner = await resolveDataOwner(userID);
      const vendor = await db.toggleVendorFavorite(
        dataOwner,
        parseInt(vendorId),
      );
      if (!vendor) {
        return res.status(404).send("Vendor not found");
      }
      res.status(200).json(vendor);
    } catch (error) {
      console.error("Error toggling vendor favorite:", error);
      return res.status(500).send("Failed to toggle vendor favorite");
    }
  },
);

// Add a payment to a vendor
app.post("/budget/payments", async (req: Request, res: Response) => {
  try {
    const { userID, vendor_id, amount, payment_date, notes } = req.body;
    if (!userID || !vendor_id || !amount || !payment_date) {
      return res
        .status(400)
        .send("UserID, vendor_id, amount, and payment_date are required");
    }
    const dataOwner = await resolveDataOwner(userID);
    const payment = await db.addPayment(dataOwner, vendor_id, {
      amount,
      payment_date,
      notes,
    });
    await logMessage(dataOwner, `💰 Payment of ₪${amount} recorded`);
    res.status(201).json(payment);
  } catch (error) {
    console.error("Error adding payment:", error);
    return res.status(500).send("Failed to add payment");
  }
});

// Delete a payment
app.delete(
  "/budget/payments/:paymentId",
  async (req: Request, res: Response) => {
    try {
      const { paymentId } = req.params;
      const { userID } = req.body;
      if (!userID) {
        return res.status(400).send("UserID is required");
      }
      const dataOwner = await resolveDataOwner(userID);
      const deleted = await db.deletePayment(dataOwner, parseInt(paymentId));
      if (!deleted) {
        return res.status(404).send("Payment not found");
      }
      await logMessage(dataOwner, `🗑️ Payment deleted`);
      res.status(200).send("Payment deleted successfully");
    } catch (error) {
      console.error("Error deleting payment:", error);
      return res.status(500).send("Failed to delete payment");
    }
  },
);

// Upload a file for a vendor
app.post(
  "/budget/vendors/:vendorId/files",
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const { vendorId } = req.params;
      const userID = req.body.userID;
      const fileName = req.body.fileName; // Use separate field for proper Hebrew support
      const file = (req as any).file;

      if (!userID || !file) {
        return res.status(400).send("UserID and file are required");
      }

      const finalFileName = fileName || file.originalname;

      const dataOwner = await resolveDataOwner(userID);
      const vendorFile = await db.addVendorFile(dataOwner, parseInt(vendorId), {
        name: finalFileName,
        type: file.mimetype,
        size: file.size,
        data: file.buffer,
      });

      await logMessage(dataOwner, `📎 File uploaded: ${finalFileName}`);
      res.status(201).json(vendorFile);
    } catch (error: any) {
      console.error("Error uploading file:", error);
      return res.status(500).send(error.message || "Failed to upload file");
    }
  },
);

// Download a vendor file
app.get(
  "/budget/files/:fileId/download",
  async (req: Request, res: Response) => {
    try {
      const { fileId } = req.params;
      const userID = req.query.userID as string;

      if (!userID) {
        return res.status(400).send("UserID is required");
      }

      const dataOwner = await resolveDataOwner(userID);
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
      console.error("Error downloading file:", error);
      return res.status(500).send("Failed to download file");
    }
  },
);

// Delete a vendor file
app.delete("/budget/files/:fileId", async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const { userID } = req.body;

    if (!userID) {
      return res.status(400).send("UserID is required");
    }

    const dataOwner = await resolveDataOwner(userID);
    const deleted = await db.deleteVendorFile(dataOwner, parseInt(fileId));

    if (!deleted) {
      return res.status(404).send("File not found");
    }

    await logMessage(dataOwner, `🗑️ Vendor file deleted`);
    res.status(200).send("File deleted successfully");
  } catch (error) {
    console.error("Error deleting file:", error);
    return res.status(500).send("Failed to delete file");
  }
});

// ==================== Scheduled Message Functions ====================

const sendWeddingReminders = async (
  userID: string,
  guests: Guest[],
  weddingInfo: WeddingDetails,
  isWeddingDay: boolean,
  messageGroup?: number,
): Promise<void> => {
  const guestsToSend = filterAndLimitGuests(guests, {
    messageGroup,
    rsvpStatus: "approved",
  });

  const dayType = isWeddingDay ? "wedding day" : "day before wedding";

  if (guestsToSend.length === 0) {
    await logMessage(userID, `⚠️ No guests to send ${dayType} messages to`);
    return;
  }

  const preMessageLogs: string[] = [];

  if (guestsToSend.length === MAX_GUESTS_PER_MESSAGE_BATCH) {
    preMessageLogs.push(
      `⚠️ Limited to ${MAX_GUESTS_PER_MESSAGE_BATCH} guests (WhatsApp limit)`,
    );
  }

  preMessageLogs.push(
    `💐 Sending ${dayType} messages to ${guestsToSend.length} guests`,
  );

  const hasGiftLink = weddingInfo.gift_link?.trim() !== "";
  const templateName = getTemplateName(
    "weddingReminder",
    hasGiftLink,
    isWeddingDay,
  );

  const promises = guestsToSend.map((guest) =>
    sendWhatsAppMessage(guest, {
      template: { name: templateName, info: weddingInfo },
    }),
  );

  await sendMessagesAndLog(
    promises,
    userID,
    "💍",
    `${dayType} messages`,
    preMessageLogs,
  );
};

const sendThankYouMessages = async (
  userID: string,
  guests: Guest[],
  weddingInfo: WeddingDetails,
): Promise<void> => {
  const guestsToSend = filterAndLimitGuests(guests, {
    rsvpStatus: "approved",
  });

  if (guestsToSend.length === 0) {
    await logMessage(userID, `⚠️ No guests to send thank you messages to`);
    return;
  }

  const preMessageLogs: string[] = [];

  if (guestsToSend.length === MAX_GUESTS_PER_MESSAGE_BATCH) {
    preMessageLogs.push(
      `⚠️ Limited to ${MAX_GUESTS_PER_MESSAGE_BATCH} guests (WhatsApp limit)`,
    );
  }

  preMessageLogs.push(
    `🎁 Sending thank you messages to ${guestsToSend.length} guests`,
  );

  const templateName =
    weddingInfo.thank_you_message?.trim() !== ""
      ? "custom_thank_you_message"
      : "thank_you_message";

  const promises = guestsToSend.map((guest) =>
    sendWhatsAppMessage(guest, {
      template: { name: templateName, info: weddingInfo },
    }),
  );

  await sendMessagesAndLog(
    promises,
    userID,
    "🙏",
    "thank you messages",
    preMessageLogs,
  );
};

const sendScheduledMessages = async () => {
  try {
    // Prevent duplicate executions within the same minute
    const israelTime = getIsraelTime();
    const currentMinute = `${israelTime.getHours()}:${israelTime.getMinutes()}`;

    if (lastExecutionMinute === currentMinute) {
      console.log("⏭️ Already executed in this minute, skipping...");
      return;
    }

    lastExecutionMinute = currentMinute;

    const weddings = await db.getWeddingsForMessaging();
    if (weddings.length === 0) {
      return;
    }
    console.log(`📝 Found ${weddings.length} weddings to process`);

    for (const { userID, info } of weddings) {
      const guests = await db.getGuestsWithUserID(userID);

      const today = getDateFormat(new Date());

      const { weddingDateStr, dayBeforeWeddingStr, dayAfterWeddingStr } =
        getWeddingDateStrings(info.wedding_date);
      const reminderDay = info.reminder_day || "day_before";
      const reminderTime = info.reminder_time || "09:00";

      // Send day before wedding reminder
      if (
        reminderDay === "day_before" &&
        today === dayBeforeWeddingStr &&
        isTimeToSend(reminderTime)
      ) {
        await logMessage(
          userID,
          `🔄 Processing day before wedding reminder for: ${info.bride_name} & ${info.groom_name} at ${reminderTime}`,
        );
        await sendWeddingReminders(userID, guests, info, false);
      }

      // Send wedding day reminder
      if (
        reminderDay === "wedding_day" &&
        today === weddingDateStr &&
        isTimeToSend(reminderTime)
      ) {
        await logMessage(
          userID,
          `🔄 Processing wedding day reminder for: ${info.bride_name} & ${info.groom_name} at ${reminderTime}`,
        );
        await sendWeddingReminders(userID, guests, info, true);
      }

      // Send thank you messages the day after the wedding
      if (
        today === dayAfterWeddingStr &&
        isTimeToSend(THANK_YOU_MESSAGE_TIME)
      ) {
        await logMessage(
          userID,
          `🔄 Processing thank you messages for: ${info.bride_name} & ${info.groom_name}`,
        );
        await sendThankYouMessages(userID, guests, info);
      }
    }
  } catch (error) {
    console.error("Error sending scheduled messages:", error);
  }
};

const cleanupOldLogs = async () => {
  try {
    console.log("🧹 Starting log cleanup...");
    const deletedCount = await db.cleanupOldLogs();
    console.log(`🗑️ Deleted ${deletedCount} old log entries`);
  } catch (error) {
    console.error("Error cleaning up logs:", error);
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
    console.log("Connected to database");

    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
      sendScheduledMessages();
    });
  } catch (error) {
    console.error("Database connection failed:", error);
    process.exit(1);
  }
}

startServer();
