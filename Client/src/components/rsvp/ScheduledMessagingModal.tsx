import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  SidePanel,
  Box,
  Text,
  Loader,
  Button,
  Badge,
  Input,
  SectionHelper,
  TextButton,
} from "@wix/design-system";
import { Event, EventGuest, ScheduledRound, ScheduledRoundType } from "../../types";
import { httpRequests, ScheduledRoundInput } from "../../httpClient";
import { useAuth } from "../../hooks/useAuth";
import { getMissingInvitationContent } from "./logic";
import TargetedInvitationSends from "./TargetedInvitationSends";

/**
 * The "send and go" (messagingPlan="scheduled") replacement for the manual
 * send modal: the couple completes all message content once (wedding details,
 * reminder, thank-you — via the existing InfoModal), picks a date and time for
 * each round (invitation, 3 pending-reminders, 2 call rounds), and the server
 * sends everything on schedule. A round stays editable as long as it hasn't
 * been sent and its time hasn't passed. Guests whose invitation delivery
 * failed, and guests added after the invitation round, get targeted
 * invitation sends (shared with the manual modal).
 */

interface ScheduledMessagingModalProps {
  onClose: () => void;
  eventId: number;
  event: Event;
  eventGuests: EventGuest[];
  onGuestsUpdated?: (guests: EventGuest[]) => void;
  /** Opens the wedding-details modal so missing content can be completed. */
  onEditDetails?: () => void;
  /** Admin/QA: switches to the manual send modal for this scheduled-plan user. */
  onSwitchToManual?: () => void;
}

interface RoundDef {
  roundType: ScheduledRoundType;
  roundNumber: number;
  label: string;
}

export const ROUND_DEFS: RoundDef[] = [
  { roundType: "rsvp", roundNumber: 1, label: "הזמנה ואישור הגעה" },
  { roundType: "rsvpReminder", roundNumber: 1, label: "תזכורת לממתינים — סבב 1" },
  { roundType: "rsvpReminder", roundNumber: 2, label: "תזכורת לממתינים — סבב 2" },
  { roundType: "rsvpReminder", roundNumber: 3, label: "תזכורת לממתינים — סבב 3" },
  { roundType: "call", roundNumber: 1, label: "שיחות טלפון לממתינים — סבב 1" },
  { roundType: "call", roundNumber: 2, label: "שיחות טלפון לממתינים — סבב 2" },
];

const STATUS_LABELS: Record<ScheduledRound["status"], string> = {
  pending: "מתוזמן",
  processing: "בשליחה",
  sent: "נשלח",
  failed: "נכשל",
  skipped: "דולג",
};

const STATUS_SKINS: Record<ScheduledRound["status"], "standard" | "neutralSuccess" | "neutralDanger" | "warningLight" | "neutralStandard"> = {
  pending: "standard",
  processing: "warningLight",
  sent: "neutralSuccess",
  failed: "neutralDanger",
  skipped: "neutralStandard",
};

const roundKey = (roundType: ScheduledRoundType, roundNumber: number) => `${roundType}:${roundNumber}`;

/** ISO → value usable by <input type="datetime-local"> (local time, minute precision). */
const isoToLocalInput = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Content the couple must complete (in עריכת פרטים) before scheduling. */
export const getMissingContent = (event: Event): string[] => {
  // Everything the invitation renders (photo, names, date, location)…
  const missing = getMissingInvitationContent(event);
  // …plus what the reminder and thank-you rounds need.
  if (!event.time) missing.push("שעת האירוע");
  if (!event.reminder_day || !event.reminder_time) missing.push("הגדרות התזכורת ליום האירוע");
  if (!event.send_thank_you) missing.push("הודעת התודה (יש להפעיל אותה)");
  return missing;
};

const ScheduledMessagingModal: React.FC<ScheduledMessagingModalProps> = ({
  onClose,
  eventId,
  event,
  eventGuests,
  onGuestsUpdated,
  onEditDetails,
  onSwitchToManual,
}) => {
  const { isAdmin } = useAuth();
  const [rounds, setRounds] = useState<ScheduledRound[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const missingContent = useMemo(() => getMissingContent(event), [event]);
  // The "late-added guests" section only makes sense after the invitation
  // round went out — before that, the scheduled round will cover everyone.
  const invitationRoundDone = rounds.some((r) => r.round_type === "rsvp" && r.status === "sent");

  const loadRounds = useCallback(async () => {
    try {
      setRounds(await httpRequests.getMessageSchedule(eventId));
    } catch (error) {
      console.error("Failed to load message schedule:", error);
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadRounds();
  }, [loadRounds]);

  const savedRound = (def: RoundDef) =>
    rounds.find((r) => r.round_type === def.roundType && r.round_number === def.roundNumber);

  /** Editable while not yet sent/claimed and the saved time hasn't passed. */
  const isEditable = (def: RoundDef) => {
    const saved = savedRound(def);
    if (!saved) return true;
    if (saved.status !== "pending") return false;
    return new Date(saved.scheduled_at).getTime() > Date.now();
  };

  const inputValue = (def: RoundDef): string => {
    const key = roundKey(def.roundType, def.roundNumber);
    if (key in edited) return edited[key];
    const saved = savedRound(def);
    return saved ? isoToLocalInput(saved.scheduled_at) : "";
  };

  const handleSave = async () => {
    setSaveError(null);
    setSaveSuccess(false);

    const changes: ScheduledRoundInput[] = [];
    for (const def of ROUND_DEFS) {
      const key = roundKey(def.roundType, def.roundNumber);
      if (!(key in edited)) continue;
      const value = edited[key];
      const saved = savedRound(def);
      if (!value) {
        // Cleared — remove the round if it existed
        if (saved) changes.push({ roundType: def.roundType, roundNumber: def.roundNumber, scheduledAt: null });
        continue;
      }
      const when = new Date(value);
      if (isNaN(when.getTime()) || when.getTime() <= Date.now()) {
        setSaveError(`המועד של "${def.label}" חייב להיות בעתיד`);
        return;
      }
      changes.push({ roundType: def.roundType, roundNumber: def.roundNumber, scheduledAt: when.toISOString() });
    }

    if (changes.length === 0) return;

    setIsSaving(true);
    try {
      const updated = await httpRequests.saveMessageSchedule(eventId, changes);
      setRounds(updated);
      setEdited({});
      setSaveSuccess(true);
    } catch (error) {
      console.error("Failed to save message schedule:", error);
      setSaveError(error instanceof Error ? error.message : "שמירת התזמון נכשלה. אנא נסו שנית.");
    } finally {
      setIsSaving(false);
    }
  };

  // QA tool (admins only, typically while impersonating): wipes the saved
  // rounds and per-guest send markers so the flow can be re-run with new times.
  const handleQaReset = async () => {
    if (!window.confirm("איפוס QA: כל סבבי התזמון של האירוע יימחקו וסימוני השליחה של האורחים ינוקו, כדי שאפשר יהיה להזין מועדים מחדש. להמשיך?")) return;
    setIsResetting(true);
    setSaveError(null);
    try {
      await httpRequests.resetMessageSchedule(eventId, true);
      setEdited({});
      setSaveSuccess(false);
      setRounds(await httpRequests.getMessageSchedule(eventId));
      const refreshed = await httpRequests.getEventGuests(eventId);
      onGuestsUpdated?.(refreshed);
    } catch (error) {
      console.error("Failed to reset message schedule:", error);
      setSaveError("איפוס התזמון נכשל. אנא נסו שנית.");
    } finally {
      setIsResetting(false);
    }
  };

  const hasChanges = Object.keys(edited).length > 0;

  return (
    <SidePanel onCloseButtonClick={onClose} skin="floating" width="480px" height="100%">
      <SidePanel.Header title="תזמון הודעות — שלח וגמרנו">
        <Text size="small" secondary>
          ממלאים הכל פעם אחת, בוחרים מועד לכל סבב — והמערכת שולחת בשבילכם.
        </Text>
      </SidePanel.Header>
      <SidePanel.Content>
        {isLoading ? (
          <Box align="center" padding="24px">
            <Loader size="small" />
          </Box>
        ) : (
          <Box direction="vertical" gap="18px">
            {isAdmin && onSwitchToManual && (
              <Box>
                <TextButton size="small" onClick={onSwitchToManual}>
                  תצוגת אדמין: מעבר לשליחה ידנית
                </TextButton>
              </Box>
            )}

            {missingContent.length > 0 && (
              <SectionHelper skin="warning" title="לפני שמתזמנים — חסרים פרטים">
                <Box direction="vertical" gap="6px">
                  <Text size="small">
                    כדי שכל ההודעות (הזמנה, תזכורת והודעת תודה) יישלחו אוטומטית, יש להשלים:
                  </Text>
                  {missingContent.map((item) => (
                    <Text size="small" key={item}>
                      • {item}
                    </Text>
                  ))}
                  {onEditDetails && (
                    <Box paddingTop="6px">
                      <Button size="small" onClick={onEditDetails}>
                        השלמת פרטים
                      </Button>
                    </Box>
                  )}
                </Box>
              </SectionHelper>
            )}

            <Box direction="vertical" gap="12px">
              <Text weight="bold">מועדי השליחה</Text>
              {ROUND_DEFS.map((def) => {
                const saved = savedRound(def);
                const editable = isEditable(def) && missingContent.length === 0;
                return (
                  <Box key={roundKey(def.roundType, def.roundNumber)} direction="vertical" gap="4px">
                    <Box direction="horizontal" verticalAlign="middle" gap="8px">
                      <Text size="small">{def.label}</Text>
                      {saved && (
                        <Badge uppercase={false} skin={STATUS_SKINS[saved.status]} size="tiny">
                          {STATUS_LABELS[saved.status]}
                        </Badge>
                      )}
                    </Box>
                    <Input
                      type="datetime-local"
                      size="small"
                      value={inputValue(def)}
                      disabled={!editable}
                      onChange={(e) =>
                        setEdited((prev) => ({
                          ...prev,
                          [roundKey(def.roundType, def.roundNumber)]: e.target.value,
                        }))
                      }
                      ariaLabel={def.label}
                    />
                  </Box>
                );
              })}

              {saveError && (
                <SectionHelper skin="danger">{saveError}</SectionHelper>
              )}
              {saveSuccess && !hasChanges && (
                <SectionHelper skin="success">התזמון נשמר. אפשר לערוך כל סבב כל עוד מועדו לא עבר.</SectionHelper>
              )}

              <Button
                onClick={handleSave}
                disabled={!hasChanges || isSaving || missingContent.length > 0}
              >
                {isSaving ? <Loader size="tiny" /> : "שמירת התזמון"}
              </Button>

              {isAdmin && (
                <Button
                  size="small"
                  skin="destructive"
                  priority="secondary"
                  onClick={handleQaReset}
                  disabled={isResetting}
                >
                  {isResetting ? <Loader size="tiny" /> : "איפוס תזמון (QA)"}
                </Button>
              )}
            </Box>

            <TargetedInvitationSends
              eventId={eventId}
              eventGuests={eventGuests}
              onGuestsUpdated={onGuestsUpdated}
              showUnsent={invitationRoundDone}
              showFailedEmptyState
            />
          </Box>
        )}
      </SidePanel.Content>
    </SidePanel>
  );
};

export default ScheduledMessagingModal;
