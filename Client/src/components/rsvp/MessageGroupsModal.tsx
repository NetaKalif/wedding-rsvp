import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SidePanel,
  Box,
  RadioGroup,
  InputArea,
  Text,
  Loader,
  Button,
  Checkbox,
  LinearProgressBar,
  TextButton,
  Modal,
  CustomModalLayout,
  SectionHelper,
} from "@wix/design-system";
import { InfoCircleSmall } from "@wix/wix-ui-icons-common";
import { Event, EventGuest } from "../../types";
import { httpRequests, DeliveryFailure } from "../../httpClient";
import { useAuth } from "../../hooks/useAuth";
import { getMissingInvitationContent } from "./logic";
import GuestPicker from "./GuestPicker";
import WhatsAppPreview from "./WhatsAppPreview";
import TargetedGuestListModal from "./TargetedGuestListModal";
import "./css/WhatsAppMessage.css";

interface MessageGroupsModalProps {
  setIsMessageGroupsModalOpen: (value: boolean) => void;
  eventId: number;
  eventGuests: EventGuest[];
  event: Event;
  /** Admin/QA: switches back to the scheduling modal for a "send and go" user. */
  onSwitchToScheduled?: () => void;
}

export type MessageType =
  | "rsvp"
  | "rsvpReminder"
  | "freeText"
  | "eventReminder"
  | "thankYou";

/** Who the RSVP invitation goes to — everyone, late-added guests, or failed deliveries. */
export type RsvpTarget = "all" | "unsent" | "failed";

const MessageGroupsModal: React.FC<MessageGroupsModalProps> = ({
  setIsMessageGroupsModalOpen,
  eventId,
  eventGuests,
  event,
  onSwitchToScheduled,
}) => {
  const { isAdmin } = useAuth();

  const [messagingPermission, setMessagingPermission] = useState<
    { status: string; hasPendingRequest: boolean } | null
  >(null);
  const [isLoadingPermission, setIsLoadingPermission] = useState(true);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [permissionRequestSent, setPermissionRequestSent] = useState(false);

  useEffect(() => {
    httpRequests
      .getMessagingPermissionStatus()
      .then(setMessagingPermission)
      .catch((error) => console.error("Failed to load messaging permission status:", error))
      .finally(() => setIsLoadingPermission(false));
  }, []);

  const handleRequestMessagingPermission = async () => {
    setIsRequestingPermission(true);
    try {
      await httpRequests.requestMessagingPermission();
      setMessagingPermission((prev) => (prev ? { ...prev, hasPendingRequest: true } : prev));
      setPermissionRequestSent(true);
    } catch (error) {
      console.error("Failed to request messaging permission:", error);
      alert("שליחת הבקשה נכשלה. אנא נסו שנית.");
    } finally {
      setIsRequestingPermission(false);
    }
  };

  const getImageUrl = useCallback(
    () =>
      event.file_id
        ? httpRequests.getEventImageUrl(event.id)
        : httpRequests.getPrimaryImageUrl(),
    [event.id, event.file_id]
  );

  // Local copy of the guests, refreshed from the server on open — the prop can
  // be stale (delivery-failure webhooks and scheduled rounds stamp guests
  // server-side), and the failed/new-guests invitation targets depend on it.
  const [guests, setGuests] = useState<EventGuest[]>(eventGuests);
  useEffect(() => setGuests(eventGuests), [eventGuests]);
  useEffect(() => {
    let cancelled = false;
    httpRequests
      .getEventGuests(eventId)
      .then((fresh) => {
        if (!cancelled) setGuests(fresh);
      })
      .catch((error) => console.error("Failed to refresh event guests:", error));
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  const [messageType, setMessageType] = useState<MessageType>("rsvp");
  // Invitation sub-target: everyone (the regular send), guests added after the
  // invitation went out (unsentOnly), or guests whose delivery failed (failedOnly).
  const [rsvpTarget, setRsvpTarget] = useState<RsvpTarget>("all");
  // (i) popup listing the guests behind a targeted sub-option
  const [infoTarget, setInfoTarget] = useState<Exclude<RsvpTarget, "all"> | null>(null);
  const [customText, setCustomText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [showSendConfirmation, setShowSendConfirmation] = useState(false);
  const [selectSpecificGuests, setSelectSpecificGuests] = useState(false);
  const sendButtonRef = useRef<HTMLDivElement>(null);

  // Opening the picker pushes the send button below the fold of the
  // scrollable panel content, so scroll it (and the picker above it) into view.
  useEffect(() => {
    if (selectSpecificGuests) {
      sendButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectSpecificGuests]);
  const [selectedGuestIds, setSelectedGuestIds] = useState<Set<number>>(new Set());
  const [messageResults, setMessageResults] = useState<
    | {
        success: number;
        fail: number;
        failGuestsList: { guestName: string; logMessage: string }[];
      }
    | undefined
  >(undefined);
  const [sendProgress, setSendProgress] = useState<{ completed: number; total: number } | null>(null);
  const [deliveryFailures, setDeliveryFailures] = useState<DeliveryFailure[]>([]);
  // True between the send response arriving and the server's grace window
  // closing — the period when webhook delivery failures (📵) can still arrive.
  const [isListeningForFailures, setIsListeningForFailures] = useState(false);

  const [copiedFailuresList, setCopiedFailuresList] = useState(false);
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Only treat {active: false} as "over" once the send response arrived —
  // before that it just means the job isn't registered yet.
  const sendResponseReceivedRef = useRef(false);

  const stopProgressPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setIsListeningForFailures(false);
  }, []);

  const startProgressPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
      try {
        const progress = await httpRequests.getSendProgress();
        if (progress.active) {
          if (progress.total) {
            setSendProgress({ completed: progress.completed ?? 0, total: progress.total });
          }
          setDeliveryFailures(progress.deliveryFailures ?? []);
        } else if (sendResponseReceivedRef.current) {
          // Dispatch finished and the grace window expired — nothing more will arrive
          stopProgressPolling();
        }
      } catch {
        // Transient polling errors are fine — the next tick retries
      }
    }, 1000);
  }, [stopProgressPolling]);

  // Don't leak the interval if the modal unmounts mid-send (the server keeps
  // sending regardless; results land in the activity log).
  useEffect(() => stopProgressPolling, [stopProgressPolling]);

  useEffect(
    () => () => {
      if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
    },
    [],
  );

  const handleCopyFailuresList = async () => {
    const text = deliveryFailures
      .map((failure) => `${failure.guestName} (${failure.phone}): ${failure.description}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopiedFailuresList(true);
      if (copyFeedbackTimerRef.current) clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = setTimeout(() => setCopiedFailuresList(false), 2000);
    } catch (error) {
      console.error("Failed to copy delivery failures list:", error);
    }
  };

  const isPrimaryEvent = event.is_primary;

  const failedGuests = useMemo(() => guests.filter((eg) => eg.last_send_error), [guests]);
  // Never had any send attempt — added after the invitation went out
  const unsentGuests = useMemo(
    () => guests.filter((eg) => eg.phone && !eg.last_message_type && !eg.last_send_error),
    [guests],
  );
  // Before the first send every guest is "unsent" — the regular send covers
  // them, so the new-guests target only means something after a send happened.
  const hasAnySend = guests.some((eg) => eg.last_message_type);
  // An empty category is hidden, not disabled — no dead radio buttons.
  const showUnsentOption = hasAnySend && unsentGuests.length > 0;
  const showFailedOption = failedGuests.length > 0;
  const isTargetedSend = messageType === "rsvp" && rsvpTarget !== "all";
  const targetedGuests = rsvpTarget === "failed" ? failedGuests : unsentGuests;

  // A refresh can empty the selected target's guest list (e.g. right after
  // sending to them) — fall back to the regular send rather than a dead end.
  useEffect(() => {
    if (isTargetedSend && targetedGuests.length === 0) setRsvpTarget("all");
  }, [isTargetedSend, targetedGuests.length]);

  const handleSend = () => {
    if (messageType === "freeText" && (!customText || customText.trim() === "")) return;

    setShowSendConfirmation(false);
    const guestIds =
      selectSpecificGuests && selectedGuestIds.size > 0
        ? Array.from(selectedGuestIds)
        : undefined;

    setIsSending(true);
    setSendProgress(null);
    setDeliveryFailures([]);
    sendResponseReceivedRef.current = false;
    startProgressPolling();
    httpRequests
      .sendMessage(
        // Targeted sends are always the invitation — the server resolves the
        // exact guest set from the failedOnly/unsentOnly flag.
        isTargetedSend
          ? { eventId, ...(rsvpTarget === "failed" ? { failedOnly: true } : { unsentOnly: true }) }
          : {
              eventId,
              messageType,
              guestIds,
              customText: messageType === "freeText" ? customText : undefined,
            },
      )
      .then((result) => {
        sendResponseReceivedRef.current = true;
        setIsListeningForFailures(true);
        setMessageResults({
          success: result.success,
          fail: result.fail,
          failGuestsList: result.failGuestsList,
        });
        // Refresh so the failed/new-guests targets reflect this send
        httpRequests.getEventGuests(eventId).then(setGuests).catch(() => {});
      })
      .catch((err) => {
        console.error(err);
        stopProgressPolling();
        alert("שליחת ההודעות נכשלה. אנא נסו שנית.");
      })
      .finally(() => setIsSending(false));
  };

  // Guests with no cellphone can't receive WhatsApp messages — exclude from picking/counting/sending.
  const sendableGuests = guests.filter((g) => !!g.phone);

  const selectableGuests = (() => {
    if (messageType === "rsvpReminder") {
      return sendableGuests.filter((g) => g.rsvp_status == null);
    }
    if (messageType === "eventReminder" || messageType === "thankYou") {
      return sendableGuests.filter((g) => g.rsvp_status != null && g.rsvp_status > 0);
    }
    return sendableGuests;
  })();

  const targetGuestCount = selectableGuests.length;

  // How many messages the send button will actually fire — mirrors the
  // guestIds logic in handleSend.
  const messagesToSendCount = isTargetedSend
    ? targetedGuests.length
    : selectSpecificGuests && selectedGuestIds.size > 0
      ? selectedGuestIds.size
      : targetGuestCount;

  const emptyGroupMessage = (() => {
    if (isTargetedSend || selectSpecificGuests || targetGuestCount > 0) return null;
    if (messageType === "rsvpReminder") return "אין אורחים שממתינים לתגובה";
    if (messageType === "eventReminder" || messageType === "thankYou") return "אין אורחים שאישרו הגעה";
    return "אין אורחים לשליחה";
  })();

  // The invitation can't go out with missing content (chiefly the invitation
  // photo) — the server rejects such sends too; this surfaces it up front.
  const missingInvitationContent = getMissingInvitationContent(event);
  const invitationBlocked = messageType === "rsvp" && missingInvitationContent.length > 0;

  const isSendDisabled =
    isSending ||
    invitationBlocked ||
    (isTargetedSend && targetedGuests.length === 0) ||
    (messageType === "freeText" && (!customText || customText.trim() === "")) ||
    (!isTargetedSend && selectSpecificGuests && selectedGuestIds.size === 0) ||
    (!isTargetedSend && !selectSpecificGuests && targetGuestCount === 0);

  const canSendMessages = isAdmin || messagingPermission?.status === "approved";

  const renderPermissionRequest = () => (
    <Box direction="vertical" gap={3} padding="8px 0">
      {permissionRequestSent ? (
        <>
          <Text weight="bold">✅ הבקשה הועברה בהצלחה</Text>
          <Text secondary>
            הבקשה נשלחה למנהל. עדכון יישלח למייל ברגע שהבקשה תאושר.
          </Text>
          <Button priority="secondary" fullWidth onClick={() => setIsMessageGroupsModalOpen(false)}>
            סגירה
          </Button>
        </>
      ) : messagingPermission?.hasPendingRequest ? (
        <>
          <Text weight="bold">בקשתך ממתינה לאישור</Text>
          <Text secondary>
            בקשתך לשליחת הודעות נשלחה למנהל וממתינה לאישור. תקבלו מייל ברגע שהבקשה תאושר.
          </Text>
        </>
      ) : (
        <>
          <Text weight="bold">נדרשת הרשאה לשליחת הודעות</Text>
          <Text secondary>
            שליחת הודעות לאורחים כרוכה בעלות, ולכן נדרש אישור מנהל. לחצו על הכפתור כדי לשלוח בקשה — תקבלו מייל ברגע שהבקשה תאושר.
          </Text>
          <Button
            onClick={handleRequestMessagingPermission}
            disabled={isRequestingPermission}
            fullWidth
          >
            {isRequestingPermission ? <Loader size="tiny" /> : "בקשת הרשאה"}
          </Button>
        </>
      )}
    </Box>
  );

  // Shown while the send request is in flight — the counter comes from
  // polling GET /sendProgress once a second.
  const renderSendingProgress = () => {
    const total = sendProgress?.total ?? 0;
    const completed = sendProgress?.completed ?? 0;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
      <Box direction="vertical" gap={3} padding="12px 0" align="center">
        <Text weight="bold">📨 שולח הודעות לאורחים...</Text>
        <LinearProgressBar value={percentage} showProgressIndication />
        <Text secondary>
          {total > 0 ? `${completed} / ${total} הודעות נשלחו` : "מתחיל לשלוח..."}
        </Text>
        <Text size="small" secondary>
          אפשר לסגור את החלון — השליחה תמשיך ברקע והתוצאות יופיעו ביומן הפעילות
        </Text>
      </Box>
    );
  };

  const renderResponseMessage = () => {
    if (messageResults) {
      return (
        <Box direction="vertical" gap={2}>
          <Text>✅: {messageResults.success} הודעות נשלחו בהצלחה</Text>
          <Text>❌: {messageResults.fail} הודעות נכשלו</Text>
          {messageResults.failGuestsList.length > 0 && (
            <>
              <Text>אורחים שנכשלו:</Text>
              {messageResults.failGuestsList.map((guest) => (
                <Text key={guest.guestName}>
                  {guest.guestName}: {guest.logMessage}
                </Text>
              ))}
            </>
          )}
          {deliveryFailures.length > 0 && (
            <>
              <Text weight="bold">📵 נשלחו אך לא נמסרו:</Text>
              <Text size="small" secondary>
                מומלץ לבדוק אם המספרים של האורחים האלה שגויים. אם כן — תקנו אותם
                ברשימת האורחים ושלחו להם את ההודעה שוב.
              </Text>
              {deliveryFailures.map((failure) => (
                <Text key={failure.phone} size="small">
                  {failure.guestName}: {failure.description}
                </Text>
              ))}
              <TextButton size="small" onClick={handleCopyFailuresList}>
                {copiedFailuresList ? "✓ הרשימה הועתקה" : "📋 העתקת הרשימה"}
              </TextButton>
            </>
          )}
          {isListeningForFailures && (
            <Box gap={1} verticalAlign="middle">
              <Loader size="tiny" />
              <Text size="small" secondary>
                בודק עדכוני מסירה מוואטסאפ...
              </Text>
            </Box>
          )}
        </Box>
      );
    }
    return null;
  };

  return (
    <SidePanel
      skin="floating"
      onCloseButtonClick={() => setIsMessageGroupsModalOpen(false)}
      height="auto"
      maxHeight="85vh"
    >
      <SidePanel.Header title="שליחת הודעות" />
      <SidePanel.Content>
        {isLoadingPermission ? (
          <Box align="center" padding="24px 0">
            <Loader size="small" />
          </Box>
        ) : !canSendMessages ? (
          renderPermissionRequest()
        ) : isSending ? (
          renderSendingProgress()
        ) : messageResults ? (
          renderResponseMessage()
        ) : (
          <Box direction="vertical" gap={3}>
            {isAdmin && onSwitchToScheduled && (
              <Box flexShrink={0}>
                <TextButton size="small" onClick={onSwitchToScheduled}>
                  תצוגת אדמין: מעבר לתזמון (שלח וגמרנו)
                </TextButton>
              </Box>
            )}
            <Box direction="vertical" gap={2} flexShrink={0}>
              <div data-tour="message-types">
              <RadioGroup
              value={messageType}
              onChange={(value) => {
                setMessageType(value as MessageType);
                setRsvpTarget("all");
                setSelectedGuestIds(new Set());
              }}
            >
              <RadioGroup.Radio value="rsvp">
                <Box direction="vertical" gap={1}>
                  <Text weight="bold">הזמנה לאישור הגעה</Text>
                  <Text size="small" secondary>
                    שליחת הזמנה ראשונית עם כפתורי אישור הגעה
                  </Text>
                  {messageType === "rsvp" && (showUnsentOption || showFailedOption) && (
                    <Box direction="vertical" gap={1} paddingTop="6px">
                      <RadioGroup
                        value={rsvpTarget}
                        onChange={(value) => {
                          setRsvpTarget(value as RsvpTarget);
                          // The specific-guest picker only applies to the regular send
                          setSelectSpecificGuests(false);
                          setSelectedGuestIds(new Set());
                        }}
                      >
                        <RadioGroup.Radio value="all">
                          <Text size="small">שליחה לכל האורחים</Text>
                        </RadioGroup.Radio>
                        {showUnsentOption && (
                          <RadioGroup.Radio value="unsent">
                            <Box direction="horizontal" verticalAlign="middle" gap="4px">
                              <Text size="small">
                                אורחים חדשים שטרם קיבלו הזמנה ({unsentGuests.length})
                              </Text>
                              <TextButton
                                size="small"
                                aria-label="מי האורחים החדשים?"
                                onClick={(e: React.MouseEvent) => {
                                  // Peeking at the list must not switch the target
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setInfoTarget("unsent");
                                }}
                              >
                                <InfoCircleSmall />
                              </TextButton>
                            </Box>
                          </RadioGroup.Radio>
                        )}
                        {showFailedOption && (
                          <RadioGroup.Radio value="failed">
                            <Box direction="horizontal" verticalAlign="middle" gap="4px">
                              <Text size="small">
                                אורחים שההזמנה לא נמסרה אליהם ({failedGuests.length})
                              </Text>
                              <TextButton
                                size="small"
                                aria-label="מי האורחים שההזמנה לא נמסרה אליהם?"
                                onClick={(e: React.MouseEvent) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setInfoTarget("failed");
                                }}
                              >
                                <InfoCircleSmall />
                              </TextButton>
                            </Box>
                          </RadioGroup.Radio>
                        )}
                      </RadioGroup>
                    </Box>
                  )}
                </Box>
              </RadioGroup.Radio>

              <RadioGroup.Radio value="rsvpReminder">
                <Box direction="vertical" gap={1}>
                  <Text weight="bold">שליחה חוזרת לממתינים</Text>
                  <Text size="small" secondary>
                    שליחת תזכורת רק לאורחים שעדיין לא הגיבו
                  </Text>
                </Box>
              </RadioGroup.Radio>

              {isAdmin && (
                <RadioGroup.Radio value="eventReminder">
                  <Box direction="vertical" gap={1}>
                    <Text weight="bold">
                      {isPrimaryEvent ? "תזכורת לחתונה" : "תזכורת לאירוע"}
                    </Text>
                    <Text size="small" secondary>
                      {isPrimaryEvent ? (
                        <>
                          שליחת תזכורת לאורחים שאישרו ב
                          {event.reminder_day === "wedding_day"
                            ? "יום החתונה"
                            : "יום לפני החתונה"}
                          {event.reminder_time ? ` בשעה ${event.reminder_time}` : ""}
                        </>
                      ) : (
                        "שליחת תזכורת לאורחים שאישרו ביום האירוע"
                      )}
                    </Text>
                  </Box>
                </RadioGroup.Radio>
              )}

              {isAdmin && (
                <RadioGroup.Radio value="freeText">
                  <Box direction="vertical" gap={1}>
                    <Text weight="bold">הודעה מותאמת אישית</Text>
                    <Text size="small" secondary>
                      שליחת טקסט חופשי לאורחים
                    </Text>
                  </Box>
                </RadioGroup.Radio>
              )}

              {isAdmin && isPrimaryEvent && (
                <RadioGroup.Radio value="thankYou">
                  <Box direction="vertical" gap={1}>
                    <Text weight="bold">הודעת תודה</Text>
                    <Text size="small" secondary>
                      שליחת הודעת תודה לאורחים שהגיעו
                    </Text>
                  </Box>
                </RadioGroup.Radio>
              )}
            </RadioGroup>
              </div>
          </Box>

            {isAdmin && messageType === "freeText" && (
              <Box direction="vertical" gap={2} flexShrink={0}>
                <Text weight="bold">הודעה מותאמת אישית:</Text>
                <InputArea
                  placeholder="הכניסו את ההודעה שלכם כאן..."
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  rows={5}
                />
                {(!customText || customText.trim() === "") && (
                  <Text size="small" secondary skin="error">
                    ⚠️ אנא הכניסו הודעה לפני השליחה
                  </Text>
                )}
              </Box>
            )}

            {/* Targeted sends already name their exact guest set — no picker */}
            {!isTargetedSend && (
              <Box direction="vertical" gap={2} flexShrink={0}>
                <div data-tour="select-specific-guests">
                  <Checkbox
                    checked={selectSpecificGuests}
                    onChange={() => {
                      setSelectSpecificGuests((v) => !v);
                      setSelectedGuestIds(new Set());
                    }}
                  >
                    <Text>בחירת אורחים ספציפיים לשליחה</Text>
                  </Checkbox>
                </div>
              </Box>
            )}

              {!isTargetedSend && selectSpecificGuests && (
                <GuestPicker
                  key={messageType}
                  guests={selectableGuests}
                  selectedGuestIds={selectedGuestIds}
                  onSelectionChange={setSelectedGuestIds}
                />
              )}

            <Box direction="vertical" gap={3} flexShrink={0}>
              {invitationBlocked && (
                <SectionHelper skin="warning" title="לפני ששולחים — חסרים פרטים">
                  <Box direction="vertical" gap="6px">
                    <Text size="small">
                      כדי לשלוח את ההזמנה יש להשלים בעריכת הפרטים:
                    </Text>
                    {missingInvitationContent.map((item) => (
                      <Text size="small" key={item}>
                        • {item}
                      </Text>
                    ))}
                  </Box>
                </SectionHelper>
              )}
              {emptyGroupMessage && (
                <Text size="small" secondary skin="error">
                  ⚠️ {emptyGroupMessage}
                </Text>
              )}

              <div ref={sendButtonRef}>
                <Button
                  onClick={() => setShowSendConfirmation(true)}
                  disabled={isSendDisabled}
                  fullWidth
                >
                  שליחת הודעות
                </Button>
              </div>

              <Modal
                isOpen={showSendConfirmation}
                onRequestClose={() => setShowSendConfirmation(false)}
              >
                <CustomModalLayout
                  title="אישור שליחה"
                  primaryButtonText="שליחה"
                  primaryButtonOnClick={handleSend}
                  secondaryButtonText="ביטול"
                  secondaryButtonOnClick={() => setShowSendConfirmation(false)}
                  width="400px"
                  className="modal"
                  content={
                    <div dir="rtl">
                      <Text>
                        {messagesToSendCount === 1
                          ? "הודעה אחת עומדת להישלח. האם להמשיך?"
                          : `${messagesToSendCount} הודעות עומדות להישלח. האם להמשיך?`}
                      </Text>
                    </div>
                  }
                />
              </Modal>

              {infoTarget !== null && (
                <TargetedGuestListModal
                  target={infoTarget}
                  guests={infoTarget === "failed" ? failedGuests : unsentGuests}
                  onClose={() => setInfoTarget(null)}
                />
              )}

              <div data-tour="whatsapp-preview">
                <WhatsAppPreview
                  event={event}
                  getImageUrl={getImageUrl}
                  isCollapsible={true}
                  showAllMessages={false}
                  messageType={messageType}
                  customText={customText}
                />
              </div>
            </Box>
          </Box>
        )}
      </SidePanel.Content>
    </SidePanel>
  );
};

export default MessageGroupsModal;
