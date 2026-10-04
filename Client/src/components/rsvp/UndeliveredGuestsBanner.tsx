import React, { useEffect, useState } from "react";
import { SectionHelper, TextButton } from "@wix/design-system";
import { InfoCircleSmall } from "@wix/wix-ui-icons-common";
import { EventGuest } from "../../types";
import { httpRequests } from "../../httpClient";
import TargetedGuestListModal from "./TargetedGuestListModal";

/**
 * Compact warning banner shown while some guests have an undelivered
 * invitation (a stored send error — usually a wrong number).
 *
 * Freshness: delivery failures are stamped server-side by WhatsApp webhooks,
 * so the client's cached guest list doesn't know about them. The banner
 * fetches the guests itself on mount and again whenever refreshSignal
 * changes (the callers flip it when the send modal closes), so it appears
 * automatically without a manual refresh.
 *
 * Dismissal: the X remembers *which* guests were dismissed — the banner stays
 * hidden for those, but re-appears when a new failure shows up.
 */

interface UndeliveredGuestsBannerProps {
  eventId: number;
  /** Seed data until the fresh fetch lands (and reactive fallback). */
  eventGuests: EventGuest[];
  /** Re-fetches whenever this value changes (e.g. the send modal toggling). */
  refreshSignal?: unknown;
  /** Lets the caller sync its own guest state with the fresh fetch. */
  onGuestsRefreshed?: (guests: EventGuest[]) => void;
  /** Opens the send-messages modal (manual or scheduled — the caller knows). */
  onOpenSendModal: () => void;
}

const UndeliveredGuestsBanner: React.FC<UndeliveredGuestsBannerProps> = ({
  eventId,
  eventGuests,
  refreshSignal,
  onGuestsRefreshed,
  onOpenSendModal,
}) => {
  const [guests, setGuests] = useState<EventGuest[]>(eventGuests);
  useEffect(() => setGuests(eventGuests), [eventGuests]);

  useEffect(() => {
    if (!eventId) return; // never fetch /events/undefined/guests
    let cancelled = false;
    httpRequests
      .getEventGuests(eventId)
      .then((fresh) => {
        if (cancelled) return;
        setGuests(fresh);
        onGuestsRefreshed?.(fresh);
      })
      .catch((error) => console.error("Failed to refresh event guests:", error));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, refreshSignal]);

  // null = never dismissed; otherwise the failed guest ids seen at dismissal
  const [dismissedIds, setDismissedIds] = useState<Set<number> | null>(null);
  const [showGuestList, setShowGuestList] = useState(false);

  const failedGuests = guests.filter((eg) => eg.last_send_error);
  const hasNewFailures =
    dismissedIds === null || failedGuests.some((eg) => !dismissedIds.has(eg.guest_id));
  if (failedGuests.length === 0 || !hasNewFailures) return null;

  return (
    <div style={{ width: "100%", maxWidth: 900, margin: "16px auto 0", padding: "0 20px", boxSizing: "border-box" }}>
      <SectionHelper
        skin="warning"
        size="small"
        fullWidth
        actionText="לבדיקה ושליחה חוזרת"
        onAction={onOpenSendModal}
        showCloseButton
        onClose={() => setDismissedIds(new Set(failedGuests.map((eg) => eg.guest_id)))}
      >
        {failedGuests.length === 1
          ? "ההזמנה לא נמסרה לאורח אחד"
          : `ההזמנה לא נמסרה ל-${failedGuests.length} אורחים`}
        {" — כנראה בגלל מספר שגוי. תקנו את המספרים ושלחו מחדש רק אליהם. "}
        <TextButton
          size="small"
          aria-label="מי האורחים שההזמנה לא נמסרה אליהם?"
          onClick={() => setShowGuestList(true)}
        >
          <InfoCircleSmall />
        </TextButton>
      </SectionHelper>

      {showGuestList && (
        <TargetedGuestListModal
          target="failed"
          guests={failedGuests}
          onClose={() => setShowGuestList(false)}
        />
      )}
    </div>
  );
};

export default UndeliveredGuestsBanner;
