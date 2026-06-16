import React, { useState } from "react";
import { Card, Image, Button, Box } from "@wix/design-system";
import { Event } from "../../types";
import "./css/WhatsAppMessage.css";
import { MessageType } from "./MessageGroupsModal";

interface WhatsAppPreviewProps {
  event: Event;
  imageUrl: string;
  isCollapsible?: boolean;
  isPreviewOpen?: boolean;
  setIsPreviewOpen?: (value: boolean) => void;
  showAllMessages?: boolean;
  messageType?: MessageType;
  customText?: string;
}

const WhatsAppPreview: React.FC<WhatsAppPreviewProps> = ({
  event,
  imageUrl,
  showAllMessages = true,
  messageType = "rsvp",
  customText = "",
}) => {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const effectiveCeremonyType = event.ceremony_name || "חתונה";

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

  const dayBeforeWeddingTemplate = `היי, מחכים לראותכם מחר בחתונה של ${
    event.bride_name || "{{bride_name}}"
  } ו${event.groom_name || "{{groom_name}}"} בשעה ${
    event.time ? event.time.slice(0, 5) : "{{time}}"
  }!

לניווט: ${event.waze_link || "{{waze_link}}"}

${
  event.gift_link && event.gift_link.trim() !== ""
    ? `לנוחיותכם, ניתן להעניק מתנות באשראי בקישור:
${event.gift_link}`
    : ""
} `;

  const weddingDayTemplate = `היי, מחכים לראותכם היום בחתונה של ${
    event.bride_name || "{{bride_name}}"
  } ו${event.groom_name || "{{groom_name}}"} בשעה ${
    event.time ? event.time.slice(0, 5) : "{{time}}"
  }!
לניווט: ${event.waze_link || "{{waze_link}}"}

${
  event.gift_link && event.gift_link.trim() !== ""
    ? `לנוחיותכם, ניתן להעניק מתנות באשראי בקישור:
${event.gift_link}`
    : ""
} `;

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
    } else if (type === "weddingReminder") {
      const isWeddingDay = event.reminder_day === "wedding_day";
      return renderMessage(
        isWeddingDay ? "תזכורת ליום החתונה" : "תזכורת ליום לפני החתונה",
        isWeddingDay ? weddingDayTemplate : dayBeforeWeddingTemplate
      );
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
            {getMessageContent("weddingReminder")}
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
