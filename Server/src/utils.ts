import { Event, TemplateName } from "./types";
import axios from "axios";
import FormData from "form-data";
import { messagesMap } from "./messages";
import { getAccessToken } from "./whatsappTokenManager";
import Database from "./dbUtilsPostgresNeon";

// Constants
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_API_VERSION = "v19.0";
const WHATSAPP_MEDIA_API_VERSION = "v17.0";
const LANGUAGE_CODE = "he";

const HEBREW_MISTAKE_KEYWORD = "טעות";

const RESPONSE_BUTTONS = {
  APPROVED: "כן אני אגיע!",
  DECLINED: "לצערי לא",
  PENDING: "עדיין לא יודע/ת",
} as const;

const RSVP_STATUS = {
  APPROVED: "approved",
  DECLINED: "declined",
  PENDING: "pending",
} as const;

const MIN_RSVP_COUNT = 0;
const MAX_RSVP_COUNT = 10;

// ============================================================================
// Message Handlers — all incoming replies are routed by (eventId, guestId)
// ============================================================================

const isValidRsvpCount = (count: number): boolean =>
  !isNaN(count) && count >= MIN_RSVP_COUNT && count <= MAX_RSVP_COUNT;

const mapResponseToStatus = (
  response: (typeof RESPONSE_BUTTONS)[keyof typeof RESPONSE_BUTTONS]
): (typeof RSVP_STATUS)[keyof typeof RSVP_STATUS] => {
  if (response === RESPONSE_BUTTONS.APPROVED) return RSVP_STATUS.APPROVED;
  if (response === RESPONSE_BUTTONS.DECLINED) return RSVP_STATUS.DECLINED;
  return RSVP_STATUS.PENDING;
};

export const handleTextResponse = async (
  msg: string,
  phone: string,
  userID: string,
  eventId: number,
  guestId: number,
  guestName: string,
): Promise<void> => {
  const recipient = { phone, user_id: userID, name: guestName };

  if (msg === HEBREW_MISTAKE_KEYWORD) {
    const db = Database.getInstance();
    await db.updateEventGuestRsvp(eventId, guestId, null);
    await logMessage(userID, `🗑️ RSVP reset (mistake) for ${guestName} in event ${eventId}`);
    await sendWhatsAppMessage(recipient, { freeText: messagesMap.mistake });
    return;
  }

  const rsvpCount = parseInt(msg, 10);
  if (!isValidRsvpCount(rsvpCount)) {
    await sendWhatsAppMessage(recipient, { freeText: messagesMap.unknownResponse });
    return;
  }

  const db = Database.getInstance();
  await db.updateEventGuestRsvp(eventId, guestId, rsvpCount);
  await logMessage(userID, `📠 RSVP updated for ${guestName} (event ${eventId}): ${rsvpCount}`);
  const message = rsvpCount === 0 ? messagesMap.declined : messagesMap.approved;
  await sendWhatsAppMessage(recipient, { freeText: message });
};

export const handleButtonReply = async (
  msg: string,
  phone: string,
  userID: string,
  eventId: number,
  guestId: number,
  guestName: string,
): Promise<void> => {
  const senderStatus = mapResponseToStatus(
    msg as (typeof RESPONSE_BUTTONS)[keyof typeof RESPONSE_BUTTONS]
  );
  const db = Database.getInstance();
  const recipient = { phone, user_id: userID, name: guestName };

  if (senderStatus === RSVP_STATUS.DECLINED) {
    await db.updateEventGuestRsvp(eventId, guestId, 0);
    await logMessage(userID, `📠 RSVP declined by ${guestName} (event ${eventId})`);
    await sendWhatsAppMessage(recipient, { freeText: messagesMap.declined });
  } else if (senderStatus === RSVP_STATUS.APPROVED) {
    await logMessage(userID, `📠 RSVP approved by ${guestName} (event ${eventId}), awaiting count`);
    await sendWhatsAppMessage(recipient, { freeText: messagesMap.approveFollowUp });
  } else if (senderStatus === RSVP_STATUS.PENDING) {
    await sendWhatsAppMessage(recipient, { freeText: messagesMap.pending });
  }
};

// ============================================================================
// WhatsApp Message Building
// ============================================================================

interface TemplateParams {
  templateName: string;
  headerParams?: Array<{ type: string; image?: { id: string } }>;
  bodyParams: Array<{ type: string; parameter_name: string; text?: string }>;
}

const createTemplateData = (to: string, params: TemplateParams) => {
  const components = params.headerParams
    ? [{ type: "header", parameters: params.headerParams }]
    : [];
  components.push({ type: "body", parameters: params.bodyParams });
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: { name: params.templateName, language: { code: LANGUAGE_CODE }, components },
  };
};

const createDataForFreeText = (to: string, freeText: string) => ({
  messaging_product: "whatsapp",
  to,
  type: "text",
  text: { body: freeText },
});

type TemplateBodyParam = { type: string; parameter_name: string; text?: string };

const createTextParam = (parameterName: string, text: string): TemplateBodyParam => ({
  type: "text",
  parameter_name: parameterName,
  text,
});

const createImageHeader = (fileId: string) => [{ type: "image", image: { id: fileId } }];

const createBrideGroomParams = (event: Event): TemplateBodyParam[] => [
  createTextParam("bride_name", event.bride_name || ""),
  createTextParam("groom_name", event.groom_name || ""),
];

const createReminderParams = (event: Event, includeGift: boolean): TemplateBodyParam[] => {
  const params = [
    ...createBrideGroomParams(event),
    createTextParam("time", (event.time || "").slice(0, 5)),
    createTextParam("waze_link", event.waze_link || ""),
  ];
  if (includeGift) params.push(createTextParam("card_gift_link", event.gift_link || ""));
  return params;
};

export const getTemplateParams = (templateName: TemplateName, event: Event): TemplateParams => {
  switch (templateName) {
    case "wedding_rsvp_action":
      return {
        templateName: "wedding_rsvp_action",
        headerParams: event.file_id ? createImageHeader(event.file_id) : undefined,
        bodyParams: [
          createTextParam("ceremony_type", event.ceremony_name || "חתונה"),
          ...createBrideGroomParams(event),
          createTextParam("date", event.date ? new Date(event.date).toLocaleDateString("he-IL") : ""),
          createTextParam("location", event.location || ""),
          createTextParam("additonal_details", event.additional_info || " "),
        ],
      };
    case "wedding_day_reminder":
      return { templateName: "wedding_rsvp_same_day", bodyParams: createReminderParams(event, true) };
    case "day_before_wedding_reminder":
      return { templateName: "day_before_wedding_reminder", bodyParams: createReminderParams(event, true) };
    case "wedding_reminders_no_gift":
      return { templateName: "wedding_reminders_no_gift", bodyParams: createReminderParams(event, false) };
    case "wedding_reminders_no_gift_same_day":
      return { templateName: "wedding_reminders_no_gift_same_day", bodyParams: createReminderParams(event, false) };
    case "wedding_rsvp_reminder":
      return { templateName: "wedding_rsvp_reminder", bodyParams: [createTextParam("ceremony_name", event.ceremony_name || "חתונה"), ...createBrideGroomParams(event)] };
    case "custom_thank_you_message":
      return {
        templateName: "custom_thank_you_message",
        bodyParams: [
          createTextParam("custom_massage", event.thank_you_message || ""),
          createTextParam("names", `${event.bride_name || ""} ו${event.groom_name || ""}`),
        ],
      };
    case "thank_you_message":
      return { templateName: "thank_you_message", bodyParams: createBrideGroomParams(event) };
    default:
      throw new Error(`Template name ${templateName} not found`);
  }
};

// ============================================================================
// WhatsApp API Communication
// ============================================================================

interface SendMessageOptions {
  freeText?: string;
  template?: { name: TemplateName; event?: Event };
}

export interface MessageResult {
  success: boolean;
  userID: string;
  guestName: string;
  logMessage: string;
}

const getWhatsAppApiUrl = (endpoint: string) =>
  `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${PHONE_NUMBER_ID}/${endpoint}`;

const createAuthHeaders = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  "Content-Type": "application/json",
});

type MessageRecipient = { phone: string; user_id: string; name: string };

export const sendWhatsAppMessage = async (
  recipient: MessageRecipient,
  options: SendMessageOptions,
): Promise<MessageResult> => {
  try {
    const accessToken = await getAccessToken();
    const headers = createAuthHeaders(accessToken);
    const whatsappData = options.template
      ? createTemplateData(recipient.phone, getTemplateParams(options.template.name, options.template.event))
      : createDataForFreeText(recipient.phone, options.freeText);
    await axios.post(getWhatsAppApiUrl("messages"), whatsappData, { headers });
    return {
      success: true,
      userID: recipient.user_id,
      guestName: recipient.name,
      logMessage: `✅ Message sent successfully to ${recipient.name}`,
    };
  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || error.message;
    return {
      success: false,
      userID: recipient.user_id,
      guestName: recipient.name,
      logMessage: `❌ Failed to send message to ${recipient.name}: ${errorMessage}`,
    };
  }
};

// ============================================================================
// Media Upload
// ============================================================================

interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

export const uploadImage = async (file: UploadedFile): Promise<string> => {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", file.buffer, { filename: file.originalname, contentType: file.mimetype });
  const accessToken = await getAccessToken();
  const response = await axios.post(
    `https://graph.facebook.com/${WHATSAPP_MEDIA_API_VERSION}/${PHONE_NUMBER_ID}/media`,
    form,
    { headers: { Authorization: `Bearer ${accessToken}`, ...form.getHeaders() } },
  );
  return response.data.id;
};

// ============================================================================
// Logging
// ============================================================================

export const logMessage = async (userID: string, message: string): Promise<void> => {
  console.log(message);
  const db = Database.getInstance();
  if (db && userID) await db.addClientLog(userID, message);
};

export const batchLogMessageResults = async (results: MessageResult[]): Promise<void> => {
  const db = Database.getInstance();
  if (!db || results.length === 0) return;
  results.forEach((r) => console.log(r.logMessage));
  const logs = results.filter((r) => r.userID).map((r) => ({ userID: r.userID, message: r.logMessage }));
  if (logs.length > 0) {
    try {
      await db.addClientLogsBatch(logs);
    } catch (error) {
      console.error("Failed to batch log message results:", error);
    }
  }
};
