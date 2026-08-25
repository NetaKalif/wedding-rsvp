import React, { useEffect, useState } from "react";
import { Card, Image, Button, Box } from "@wix/design-system";
import { Event } from "../../types";
import "./css/WhatsAppMessage.css";
import { MessageType } from "./MessageGroupsModal";

interface WhatsAppPreviewProps {
  event: Event;
  getImageUrl?: () => Promise<string>;
  isCollapsible?: boolean;
  isPreviewOpen?: boolean;
  setIsPreviewOpen?: (value: boolean) => void;
  showAllMessages?: boolean;
  messageType?: MessageType;
  customText?: string;
}

const WhatsAppPreview: React.FC<WhatsAppPreviewProps> = ({
  event,
  getImageUrl,
  showAllMessages = true,
  messageType = "rsvp",
  customText = "",
}) => {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const effectiveCeremonyType = event.ceremony_name || "חתונה";

  // Media tokens are short-lived, so only mint one once the preview (and its
  // image) is actually about to be shown, not when an ancestor modal opens.
  useEffect(() => {
    if (!isPreviewOpen || !getImageUrl) return;
    let cancelled = false;
    getImageUrl().then((resolvedUrl) => {
      if (!cancelled) setImageUrl(resolvedUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [isPreviewOpen, getImageUrl]);

  const rsvpTemplate = `משפחה וחברים יקרים,
הנכם מוזמנים ל${effectiveCeremonyType} של ${event.bride_name || "{{bride_name}}"} ו${
    event.groom_name || "{{groom_name}}"
  }!
האירוע יתקיים בתאריך ${
    event.date
      ? new Date(event.date).toLocaleDateString("he-IL")
      : "{{date}}"
  } ב${event.location || "{{location}}"}.

${event.additional_info || ""}`;

  const reminderTemplate = `היי, ראינו שעדיין לא עניתם אם תגיעו לחתונה של ${
    event.bride_name || "{{bride_name}}"
  } ו${event.groom_name || "{{groom_name}}"}. ❤️
נודה לתשובתכם על מנת לסדר את האירוע בצורה הטובה ביותר!`;

  // Mirrors the server's unified event_reminder template (see getTemplateParams):
  // the optional waze/payment links are joined into a single additional_data line.
  const buildReminderAdditionalData = () => {
    const parts: string[] = [];
    if (event.waze_link?.trim()) parts.push(`לניווט: ${event.waze_link.trim()}`);
    if (event.gift_link?.trim())
      parts.push(`לנוחיותכם, ניתן להעניק מתנות באשראי בקישור: ${event.gift_link.trim()}`);
    return parts.join(" | ");
  };

  const buildEventReminderTemplate = (dayWord: string) => `משפחה וחברים יקרים,
מתרגשים לראותכם ${dayWord} ב${effectiveCeremonyType} של ${
    event.bride_name || "{{bride_name}}"
  } ו${event.groom_name || "{{groom_name}}"} בשעה ${
    event.time ? event.time.slice(0, 5) : "{{time}}"
  }

${buildReminderAdditionalData()}

נתראה ! 🎊 🪩`;

  const thankYouTemplate = `אורחים יקרים,
${event.thank_you_message || "תודה שהגעתם לחגוג איתנו ולשמוח בשמחתנו!"}
אוהבים,
${event.bride_name || "{{bride_name}}"} ו${
    event.groom_name || "{{groom_name}}"
  }`;

  const renderMessage = (title: string, content: string, showImage: boolean = false) => (
    <div className="whatsapp-chat" dir="rtl">
      <div className="message-title">{title}</div>
      <div className="whatsapp-message sent">
        {showImage &&
          (imageUrl ? <Image src={imageUrl} /> : <Image loading="eager" />)}
        {content}
        <span className="message-time">12:00</span>
      </div>
    </div>
  );

  const getMessageContent = (type: MessageType) => {
    if (type === "freeText") {
      return renderMessage(
        "הודעת טקסט חופשי",
        customText || "הכניסו את ההודעה שלכם..."
      );
    } else if (type === "rsvpReminder") {
      return renderMessage("הודעת תזכורת", reminderTemplate);
    } else if (type === "eventReminder") {
      // Same day-word rule as the server: only day_before reminders say "מחר"
      const isDayBefore = event.reminder_day === "day_before";
      const title = !event.is_primary
        ? "תזכורת לאירוע"
        : isDayBefore
        ? "תזכורת ליום לפני החתונה"
        : "תזכורת ליום החתונה";
      return renderMessage(title, buildEventReminderTemplate(isDayBefore ? "מחר" : "היום"));
    } else if (type === "thankYou") {
      return renderMessage("הודעת תודה", thankYouTemplate);
    } else if (type === "rsvp") {
      return renderMessage("הודעת אישור הגעה ראשונית", rsvpTemplate, true);
    }
  };

  const content = (
    <>
      <Box direction="vertical" gap={4}>
        {!showAllMessages ? (
          getMessageContent(messageType)
        ) : (
          <>
            {getMessageContent("rsvp")}
            {getMessageContent("eventReminder")}
            {getMessageContent("thankYou")}
          </>
        )}
      </Box>
    </>
  );

  return (
    <Card>
      <Card.Header
        suffix={
          <Button
            size="small"
            onClick={() => setIsPreviewOpen(!isPreviewOpen)}
          >
            {isPreviewOpen ? "הסתר תצוגה מקדימה" : "הצג תצוגה מקדימה"}
          </Button>
        }
      />
      {isPreviewOpen && <Card.Content>{content}</Card.Content>}
    </Card>
  );
};

export default WhatsAppPreview;
