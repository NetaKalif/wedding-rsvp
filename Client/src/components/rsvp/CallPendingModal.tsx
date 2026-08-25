import React, { useEffect, useState } from "react";
import { SidePanel, Box, Text, Loader, Button, Checkbox } from "@wix/design-system";
import { EventGuest } from "../../types";
import { httpRequests, CallPendingResult } from "../../httpClient";
import { getCallOutcomeCounts } from "./logic";
import GuestPicker from "./GuestPicker";

const OUTCOME_POLL_INTERVAL_MS = 5000;

interface CallPendingModalProps {
  onClose: () => void;
  eventId: number;
  eventGuests: EventGuest[];
  onGuestsUpdated?: (guests: EventGuest[]) => void;
}

/**
 * Places automated RSVP phone calls to guests who haven't responded yet —
 * either all of them, or a specific subset picked like in the send-messages modal.
 */
const CallPendingModal: React.FC<CallPendingModalProps> = ({
  onClose,
  eventId,
  eventGuests,
  onGuestsUpdated,
}) => {
  const [selectSpecificGuests, setSelectSpecificGuests] = useState(false);
  const [selectedGuestIds, setSelectedGuestIds] = useState<Set<number>>(new Set());
  const [isCalling, setIsCalling] = useState(false);
  const [callResult, setCallResult] = useState<CallPendingResult | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [freshGuests, setFreshGuests] = useState<EventGuest[] | null>(null);

  // The eventGuests prop can be stale (dashboard state) — call outcomes are
  // written asynchronously by Twilio's status callback as each call ends. Fetch
  // fresh guests on open, and once a call round was placed keep polling so the
  // outcomes appear live without a manual page refresh.
  const hasCallResult = !!callResult;
  useEffect(() => {
    let cancelled = false;
    const fetchGuests = () =>
      httpRequests
        .getEventGuests(eventId)
        .then((guests) => {
          if (cancelled) return;
          setFreshGuests(guests);
          onGuestsUpdated?.(guests);
        })
        .catch(() => { });
    fetchGuests();
    if (!hasCallResult) return () => { cancelled = true; };
    const interval = setInterval(fetchGuests, OUTCOME_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, hasCallResult]);

  const guests = freshGuests ?? eventGuests;
  const pendingGuests = guests.filter((g) => g.rsvp_status == null);
  // Guests with no phone can't receive a call — exclude from picking/counting.
  const callableGuests = pendingGuests.filter((g) => !!g.phone);

  // Outcomes of the last call round, over ALL guests (a guest who confirmed via
  // the call is no longer pending but still counts as "answered").
  const outcomes = getCallOutcomeCounts(guests);
  const anyOutcomes =
    outcomes.answered + outcomes.voicemail + outcomes.busy + outcomes.noAnswer + outcomes.failed + outcomes.inProgress > 0;

  const targetCount = selectSpecificGuests ? selectedGuestIds.size : callableGuests.length;

  const handleCall = () => {
    const guestIds =
      selectSpecificGuests && selectedGuestIds.size > 0
        ? Array.from(selectedGuestIds)
        : undefined;

    setIsCalling(true);
    setCallError(null);
    httpRequests
      .callPendingGuests(eventId, guestIds)
      .then(setCallResult)
      .catch((e: any) => {
        setCallError(
          e?.message?.includes("503") || e?.status === 503
            ? "שירות השיחות אינו מוגדר עדיין. יש להשלים את הגדרות ה-Twilio."
            : "אירעה שגיאה בהוצאת השיחות. נסו שוב.",
        );
      })
      .finally(() => setIsCalling(false));
  };

  const outcomeSummary = anyOutcomes && (
    <Box direction="vertical" gap={1} dataHook="call-outcome-summary">
      <Text size="small" weight="bold">
        תוצאות סבב השיחות האחרון:
      </Text>
      {outcomes.answered > 0 && <Text size="small">✅ ענו לשיחה: {outcomes.answered}</Text>}
      {outcomes.voicemail > 0 && <Text size="small">📼 תא קולי: {outcomes.voicemail}</Text>}
      {outcomes.busy > 0 && <Text size="small">🚫 דחו את השיחה / תפוס: {outcomes.busy}</Text>}
      {outcomes.noAnswer > 0 && <Text size="small">🔕 לא ענו: {outcomes.noAnswer}</Text>}
      {outcomes.failed > 0 && <Text size="small">❌ שיחות שנכשלו: {outcomes.failed}</Text>}
      {outcomes.inProgress > 0 && <Text size="small">⏳ ממתינים לתוצאה: {outcomes.inProgress}</Text>}
      <Text size="small" secondary>
        התוצאות מתעדכנות אוטומטית בסיום כל שיחה.
      </Text>
    </Box>
  );

  const renderResult = (result: CallPendingResult) => (
    <Box direction="vertical" gap={2}>
      <Text>📞 יצאו {result.queued} שיחות</Text>
      {result.skippedNoPhone > 0 && (
        <Text>דילגנו על {result.skippedNoPhone} אורחים ללא מספר טלפון</Text>
      )}
      {result.failed > 0 && <Text>❌ {result.failed} שיחות נכשלו</Text>}
      {outcomeSummary}
      <Button priority="secondary" fullWidth onClick={onClose}>
        סגירה
      </Button>
    </Box>
  );

  return (
    <SidePanel
      skin="floating"
      onCloseButtonClick={onClose}
      height="auto"
      maxHeight="85vh"
    >
      <SidePanel.Header title="שיחות לממתינים" />
      <SidePanel.Content>
        {callResult ? (
          renderResult(callResult)
        ) : (
          <Box direction="vertical" gap={3}>
            <Text secondary>
              כל אורח יקבל שיחה אוטומטית לאישור הגעה. ניתן להתקשר לכל{" "}
              {callableGuests.length} האורחים שטרם הגיבו, או לבחור אורחים ספציפיים.
            </Text>

            {outcomeSummary}

            <Box flexShrink={0}>
              <Checkbox
                checked={selectSpecificGuests}
                onChange={() => {
                  setSelectSpecificGuests((v) => !v);
                  setSelectedGuestIds(new Set());
                }}
              >
                <Text>בחירת אורחים ספציפיים להתקשרות</Text>
              </Checkbox>
            </Box>

            {selectSpecificGuests && (
              <GuestPicker
                guests={callableGuests}
                selectedGuestIds={selectedGuestIds}
                onSelectionChange={setSelectedGuestIds}
              />
            )}

            {callError && (
              <Text size="small" secondary skin="error">
                ⚠️ {callError}
              </Text>
            )}

            <Button
              onClick={handleCall}
              disabled={isCalling || targetCount === 0}
              fullWidth
            >
              {isCalling ? (
                <Loader size="tiny" />
              ) : (
                `התקשר ל-${targetCount} אורחים`
              )}
            </Button>
          </Box>
        )}
      </SidePanel.Content>
    </SidePanel>
  );
};

export default CallPendingModal;
