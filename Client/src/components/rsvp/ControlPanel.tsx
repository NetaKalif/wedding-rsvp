import "./css/ControlPanel.css";
import { Card, Button, Box, SectionHelper } from "@wix/design-system";
import { httpRequests } from "../../httpClient";
import { useAuth } from "../../hooks/useAuth";
import { useConfirm } from "../../hooks/useConfirm";
import {
  getNumberOfGuests,
  getNumberOfGuestsDeclined,
  getNumberOfGuestsRSVP,
  getRsvpCounts,
  handleExport,
} from "./logic";
import {
  UserPlus,
  Trash2,
  FileSpreadsheet,
  Check,
  Clock,
  X,
  MessageSquare,
  PhoneCall,
} from "lucide-react";
import { EventGuest, User } from "../../types";
import React from "react";
import { Edit } from "@wix/wix-ui-icons-common";

interface ControlPanelProps {
  setIsAddGuestModalOpen: (value: boolean) => void;
  setIsInfoModalOpen: (value: boolean) => void;
  setIsMessageGroupsModalOpen: (value: boolean) => void;
  setEventGuests: (value: any) => void;
  eventGuests: EventGuest[];
  userID: User["userID"];
  eventId?: number;
}
const ControlPanel: React.FC<ControlPanelProps> = ({
  setIsAddGuestModalOpen,
  setEventGuests,
  eventGuests,
  setIsInfoModalOpen,
  setIsMessageGroupsModalOpen,
  userID,
  eventId,
}) => {
  const { weddingInfo } = useAuth();
  const { confirm, ConfirmDialog } = useConfirm();
  const [noWeddingWarning, setNoWeddingWarning] = React.useState(false);
  const [isCalling, setIsCalling] = React.useState(false);
  const [callResult, setCallResult] = React.useState<string | null>(null);
  const rsvpCounts = getRsvpCounts(eventGuests);

  const handleCallPending = async () => {
    if (!eventId) return;
    const ok = await confirm({
      message: `להתקשר לכל ${rsvpCounts.pending} האורחים שטרם אישרו הגעה? כל אורח יקבל שיחה אוטומטית לאישור הגעה.`,
      confirmText: "התקשר",
    });
    if (!ok) return;
    setIsCalling(true);
    setCallResult(null);
    try {
      const res = await httpRequests.callPendingGuests(eventId);
      const parts = [`יצאו ${res.queued} שיחות`];
      if (res.skippedNoPhone) parts.push(`דילגנו על ${res.skippedNoPhone} ללא מספר טלפון`);
      if (res.failed) parts.push(`${res.failed} נכשלו`);
      setCallResult(parts.join(" · "));
    } catch (e: any) {
      setCallResult(
        e?.message?.includes("503") || e?.status === 503
          ? "שירות השיחות אינו מוגדר עדיין. יש להשלים את הגדרות ה-Twilio."
          : "אירעה שגיאה בהוצאת השיחות. נסו שוב.",
      );
    } finally {
      setIsCalling(false);
    }
  };

  return (
    <div className="control-panel">
      <Card>
        <Card.Header title="ספירת אורחים" />
        <Card.Content data-tour="rsvp-stats">
          <Box gap="16px" className="guest-summary">
            <Box direction="vertical" gap="4px">
              <span>סה״כ מוזמנים</span>
              <span className="pending">{getNumberOfGuests(eventGuests)}</span>
            </Box>

            <Box direction="vertical" gap="4px">
              <span>סה״כ אישרו</span>
              <span className="confirmed">
                {getNumberOfGuestsRSVP(eventGuests)}
              </span>
            </Box>

            <Box direction="vertical" gap="4px">
              <span>סה״כ סירבו</span>
              <span className="declined">
                {getNumberOfGuestsDeclined(eventGuests)}
              </span>
            </Box>
          </Box>
        </Card.Content>
      </Card>
      <Card>
        <Card.Header title="שיעורי תגובה נוכחיים"></Card.Header>
        <Card.Content>
          <div className="rsvp-summary">
            <Box
              direction="horizontal"
              verticalAlign="middle"
              className="confirmed"
              gap="8px"
            >
              <Check />
              <span>אישרו</span>
              <span>{rsvpCounts.confirmed}</span>
            </Box>

            <Box
              direction="horizontal"
              verticalAlign="middle"
              className="pending"
              gap="8px"
            >
              <Clock />
              <span>ממתינים</span>
              <span>{rsvpCounts.pending}</span>
            </Box>

            <Box
              direction="horizontal"
              verticalAlign="middle"
              className="declined"
              gap="8px"
            >
              <X />
              <span>סירבו</span>
              <span>{rsvpCounts.declined}</span>
            </Box>
          </div>
        </Card.Content>
      </Card>
      <Card>
        <Card.Header title="פעולות מהירות"></Card.Header>
        <Card.Content>
          <div className="quick-actions">
            <Button
              onClick={() => setIsAddGuestModalOpen(true)}
              priority="secondary"
              data-tour="add-guests-btn"
            >
              <UserPlus />
              <span style={{ marginRight: "8px" }}>הוספה</span>
            </Button>
            <Button
              onClick={() => setIsInfoModalOpen(true)}
              priority="secondary"
            >
              <Edit />
              <span style={{ marginRight: "8px" }}>עריכת פרטים</span>
            </Button>

            <Button
              onClick={() => handleExport(eventGuests)}
              priority="secondary"
              data-tour="export-btn"
            >
              <FileSpreadsheet />
              <span style={{ marginRight: "8px" }}>ייצוא</span>
            </Button>
            <Button
              onClick={async () => {
                const ok = await confirm({
                  message: "לאפס את רשימת האורחים? פעולה זו תמחק את כל האורחים.",
                  confirmText: "מחק הכל",
                });
                if (ok) {
                  const updatedGuestsList = await httpRequests.deleteAllGuests();
                  setEventGuests(updatedGuestsList);
                }
              }}
              priority="secondary"
            >
              <Trash2 />
              <span style={{ marginRight: "8px" }}>מחיקת הכל</span>
            </Button>
            <Button
              onClick={() => {
                if (weddingInfo) {
                  setNoWeddingWarning(false);
                  setIsMessageGroupsModalOpen(true);
                } else {
                  setNoWeddingWarning(true);
                }
              }}
              priority="secondary"
              disabled={eventGuests.length === 0}
              data-tour="send-messages-btn"
            >
              <MessageSquare />
              <span style={{ marginRight: "8px" }}>שליחת הודעות</span>
            </Button>
            <Button
              onClick={handleCallPending}
              priority="secondary"
              disabled={!eventId || rsvpCounts.pending === 0 || isCalling}
            >
              <PhoneCall />
              <span style={{ marginRight: "8px" }}>
                {isCalling ? "מתקשר..." : "שיחות לממתינים"}
              </span>
            </Button>
          </div>
        </Card.Content>
      </Card>
      {callResult && (
        <div className="section-helper-wrapper">
          <SectionHelper skin="standard"
            showCloseButton={true}
            onClose={() => setCallResult(null)}
          >
            {callResult}
          </SectionHelper>

        </div>
      )}
      {noWeddingWarning && (
        <SectionHelper skin="warning">
          לא נמצאו פרטי חתונה. אנא הוסיפו פרטי חתונה לפני שליחת הודעות.
        </SectionHelper>
      )}
      {ConfirmDialog}
    </div>
  );
};

export default ControlPanel;
