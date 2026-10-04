import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, Button, Modal, CustomModalLayout, Divider, LinearProgressBar } from "@wix/design-system";
import { EventGuest } from "../../types";
import { httpRequests } from "../../httpClient";

/**
 * The two targeted invitation sends, shared by the manual send modal and the
 * "send and go" scheduling modal:
 * - guests whose invitation delivery failed (bad numbers — fix, then resend)
 * - guests added after the invitation already went out (never got any message)
 * Both actions send the RSVP invitation to exactly those guests.
 */

interface TargetedInvitationSendsProps {
  eventId: number;
  eventGuests: EventGuest[];
  onGuestsUpdated?: (guests: EventGuest[]) => void;
  /** Show the late-added-guests section — the caller decides when "added late" is meaningful. */
  showUnsent: boolean;
  /** Render the failed section with an explanatory note even when no guest failed. */
  showFailedEmptyState?: boolean;
}

const TargetedInvitationSends: React.FC<TargetedInvitationSendsProps> = ({
  eventId,
  eventGuests,
  onGuestsUpdated,
  showUnsent,
  showFailedEmptyState = false,
}) => {
  // Internal copy so the lists refresh after a send even when the parent
  // doesn't track guest updates (the manual modal doesn't).
  const [guests, setGuests] = useState<EventGuest[]>(eventGuests);
  useEffect(() => setGuests(eventGuests), [eventGuests]);

  // The prop can be stale — scheduled rounds send server-side while the page
  // sits open, stamping guests the client never heard about. Fetch fresh on
  // open so the failed/late lists reflect what was actually sent.
  useEffect(() => {
    let cancelled = false;
    httpRequests
      .getEventGuests(eventId)
      .then((fresh) => {
        if (cancelled) return;
        setGuests(fresh);
        onGuestsUpdated?.(fresh);
      })
      .catch((error) => console.error("Failed to refresh event guests:", error));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  const [confirmTarget, setConfirmTarget] = useState<"failed" | "unsent" | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // Fed by polling GET /sendProgress while the send is in flight — same
  // progress bar the regular send shows.
  const [sendProgress, setSendProgress] = useState<{ completed: number; total: number } | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopProgressPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startProgressPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
      try {
        const progress = await httpRequests.getSendProgress();
        if (progress.active && progress.total) {
          setSendProgress({ completed: progress.completed ?? 0, total: progress.total });
        }
      } catch {
        // Transient polling errors are fine — the next tick retries
      }
    }, 1000);
  }, []);

  // Don't leak the interval if the panel unmounts mid-send
  useEffect(() => stopProgressPolling, [stopProgressPolling]);

  const failedGuests = useMemo(() => guests.filter((eg) => eg.last_send_error), [guests]);
  // Never had any send attempt — added after the invitation went out
  const unsentGuests = useMemo(
    () => guests.filter((eg) => eg.phone && !eg.last_message_type && !eg.last_send_error),
    [guests],
  );

  const handleTargetedSend = async (target: "failed" | "unsent") => {
    setConfirmTarget(null);
    setIsSending(true);
    setResult(null);
    setSendProgress(null);
    startProgressPolling();
    try {
      const sendResult = await httpRequests.sendMessage(
        target === "failed" ? { eventId, failedOnly: true } : { eventId, unsentOnly: true },
      );
      setResult(`✅ ההזמנה נשלחה: ${sendResult.success} הצליחו, ${sendResult.fail} נכשלו`);
      const refreshed = await httpRequests.getEventGuests(eventId);
      setGuests(refreshed);
      onGuestsUpdated?.(refreshed);
    } catch (error) {
      console.error("Targeted invitation send failed:", error);
      setResult("❌ השליחה נכשלה. אנא נסו שנית.");
    } finally {
      stopProgressPolling();
      setIsSending(false);
    }
  };

  // Same look as the regular send's progress view
  const renderSendingProgress = () => {
    const total = sendProgress?.total ?? 0;
    const completed = sendProgress?.completed ?? 0;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    return (
      <Box direction="vertical" gap="8px" padding="8px 0" align="center">
        <Text size="small" weight="bold">📨 שולח הודעות לאורחים...</Text>
        <LinearProgressBar value={percentage} showProgressIndication />
        <Text size="small" secondary>
          {total > 0 ? `${completed} / ${total} הודעות נשלחו` : "מתחיל לשלוח..."}
        </Text>
      </Box>
    );
  };

  const showFailedSection = failedGuests.length > 0 || showFailedEmptyState;
  const showUnsentSection = showUnsent && unsentGuests.length > 0;
  if (!showFailedSection && !showUnsentSection && !result) return null;

  return (
    <Box direction="vertical" gap="18px">
      {showFailedSection && (
        <>
          <Divider />
          <Box direction="vertical" gap="8px">
            <Text weight="bold">אורחים שההזמנה לא נמסרה אליהם</Text>
            {failedGuests.length === 0 ? (
              <Text size="small" secondary>
                אין כרגע אורחים שההזמנה אליהם נכשלה. אם ההזמנה לא תימסר למישהו, הוא יופיע כאן
                וגם תישלח אליכם הודעת מייל עם המספרים שכדאי לבדוק.
              </Text>
            ) : (
              <>
                <Text size="small" secondary>
                  ההזמנה לא נמסרה לאורחים הבאים — כנראה בגלל מספר שגוי. בדקו ותקנו את
                  המספרים, ואז שלחו את ההזמנה מחדש רק אליהם:
                </Text>
                {failedGuests.map((eg) => (
                  <Box key={eg.guest_id} direction="vertical" gap="2px">
                    <Text size="small" weight="bold">
                      {eg.name} {eg.phone ? `(${eg.phone})` : ""}
                    </Text>
                    <Text size="tiny" secondary>
                      {eg.last_send_error}
                    </Text>
                  </Box>
                ))}
                <Button size="small" onClick={() => setConfirmTarget("failed")} disabled={isSending}>
                  {`שליחת ההזמנה מחדש ל-${failedGuests.length} אורחים`}
                </Button>
              </>
            )}
          </Box>
        </>
      )}

      {showUnsentSection && (
        <>
          <Divider />
          <Box direction="vertical" gap="8px">
            <Text weight="bold">אורחים שנוספו אחרי שליחת ההזמנה</Text>
            <Text size="small" secondary>
              האורחים הבאים נוספו אחרי שההזמנה כבר נשלחה, ולכן טרם קיבלו אותה:
            </Text>
            {unsentGuests.map((eg) => (
              <Text size="small" weight="bold" key={eg.guest_id}>
                {eg.name} {eg.phone ? `(${eg.phone})` : ""}
              </Text>
            ))}
            <Button size="small" onClick={() => setConfirmTarget("unsent")} disabled={isSending}>
              {`שליחת ההזמנה ל-${unsentGuests.length} אורחים חדשים`}
            </Button>
          </Box>
        </>
      )}

      {isSending && renderSendingProgress()}

      {result && <Text size="small">{result}</Text>}

      <Modal isOpen={confirmTarget !== null}>
        <CustomModalLayout
          title="אישור שליחה"
          primaryButtonText="שליחה"
          secondaryButtonText="ביטול"
          primaryButtonOnClick={() => confirmTarget && handleTargetedSend(confirmTarget)}
          secondaryButtonOnClick={() => setConfirmTarget(null)}
          onCloseButtonClick={() => setConfirmTarget(null)}
          content={
            <Text>
              {confirmTarget === "failed"
                ? `ההזמנה תישלח מחדש ל-${failedGuests.length} האורחים שההזמנה לא נמסרה אליהם. להמשיך?`
                : `ההזמנה תישלח ל-${unsentGuests.length} האורחים שנוספו אחרי השליחה. להמשיך?`}
            </Text>
          }
        />
      </Modal>
    </Box>
  );
};

export default TargetedInvitationSends;
