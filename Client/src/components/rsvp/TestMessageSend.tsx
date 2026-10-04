import React, { useMemo, useState } from "react";
import {
  Box,
  Text,
  Input,
  Button,
  Loader,
  RadioGroup,
  SectionHelper,
} from "@wix/design-system";
import { Event } from "../../types";
import { httpRequests } from "../../httpClient";
import { validatePhoneNumber, getMissingInvitationContent } from "./logic";

/**
 * "Send a test to myself" — the couple enters their own phone number, picks
 * which message to preview, and gets that single message on WhatsApp before
 * anything goes to guests. Shared by the manual send modal and the
 * "send and go" scheduling modal (the server allows the test on both plans).
 */

export type TestableMessageType = "rsvp" | "rsvpReminder" | "eventReminder" | "thankYou";

interface TestMessageSendProps {
  eventId: number;
  /** Pass an event whose couple names are already inherited from the primary event. */
  event: Event;
}

const TestMessageSend: React.FC<TestMessageSendProps> = ({ eventId, event }) => {
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);

  // The invitation test renders the same template as the real send — it needs
  // the same content (photo, names, date, location).
  const invitationBlocked = useMemo(
    () => getMissingInvitationContent(event).length > 0,
    [event],
  );

  const typeOptions: { value: TestableMessageType; label: string; disabled?: boolean }[] = [
    { value: "rsvp", label: "הזמנה לאישור הגעה", disabled: invitationBlocked },
    { value: "rsvpReminder", label: "תזכורת לממתינים" },
    { value: "eventReminder", label: "תזכורת ליום האירוע" },
    ...(event.is_primary ? [{ value: "thankYou" as const, label: "הודעת תודה" }] : []),
  ];

  const [messageType, setMessageType] = useState<TestableMessageType>(
    invitationBlocked ? "rsvpReminder" : "rsvp",
  );

  const handleSendTest = async () => {
    // validatePhoneNumber doesn't strip separators — people type 052-1234567
    const formattedPhone = validatePhoneNumber(phone.replace(/[\s-]/g, ""));
    if (!formattedPhone) {
      setPhoneError(true);
      setResult(null);
      return;
    }
    setPhoneError(false);
    setIsSending(true);
    setResult(null);
    try {
      const response = await httpRequests.sendTestMessage({
        eventId,
        messageType,
        phone: formattedPhone,
      });
      setResult(response);
    } catch (error) {
      console.error("Failed to send test message:", error);
      setResult({ success: false });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Box direction="vertical" gap={2} dataHook="test-message-send">
      <Text weight="bold">🧪 הודעת ניסיון לעצמכם</Text>
      <Text size="small" secondary>
        לפני ששולחים לאורחים — שלחו לעצמכם הודעת ניסיון כדי לראות בדיוק איך היא
        תיראה. הזינו את המספר שלכם ובחרו איזו הודעה לקבל.
      </Text>

      <RadioGroup
        value={messageType}
        onChange={(value) => {
          setMessageType(value as TestableMessageType);
          setResult(null);
        }}
      >
        {typeOptions.map((option) => (
          <RadioGroup.Radio key={option.value} value={option.value} disabled={option.disabled}>
            <Text size="small">
              {option.label}
              {option.disabled ? " (חסרים פרטים בהזמנה)" : ""}
            </Text>
          </RadioGroup.Radio>
        ))}
      </RadioGroup>

      <Input
        size="small"
        placeholder="מספר הטלפון שלכם, למשל 050-1234567"
        value={phone}
        onChange={(e) => {
          setPhone(e.target.value);
          setPhoneError(false);
        }}
        status={phoneError ? "error" : undefined}
        ariaLabel="מספר טלפון להודעת ניסיון"
      />
      {phoneError && (
        <Text size="small" skin="error">
          ⚠️ מספר הטלפון אינו תקין — הזינו מספר נייד ישראלי
        </Text>
      )}

      <Button
        size="small"
        priority="secondary"
        onClick={handleSendTest}
        disabled={isSending || !phone.trim()}
      >
        {isSending ? <Loader size="tiny" /> : "שליחת הודעת ניסיון"}
      </Button>

      {result &&
        (result.success ? (
          <Text size="small" skin="success">
            ✅ הודעת הניסיון נשלחה! בדקו את הוואטסאפ שלכם
          </Text>
        ) : (
          <Text size="small" skin="error">
            ❌ שליחת הודעת הניסיון נכשלה{result.error ? `: ${result.error}` : ". אנא נסו שנית."}
          </Text>
        ))}

      <SectionHelper skin="warning" title="שימו לב — לא ללחוץ על הכפתורים בהודעה">
        <Text size="small">
          הכפתורים בהודעת הניסיון מקושרים למספר שהזנתם: אם המספר לא שייך לאורח
          באף אירוע — לחיצה עליהם לא תעשה כלום ולא תתקבל תגובה. אם המספר כן שייך
          לאורח ברשימה — לחיצה תעדכן בפועל את אישור ההגעה שלו, כאילו הוא ענה
          להזמנה אמיתית.
        </Text>
      </SectionHelper>
    </Box>
  );
};

export default TestMessageSend;
