import React, { useCallback, useState } from "react";
import {
  SidePanel,
  Box,
  RadioGroup,
  InputArea,
  Input,
  Text,
  Loader,
  Button,
  Checkbox,
  Popover,
} from "@wix/design-system";
import { ChevronDown, ChevronUp, Filter } from "lucide-react";
import { Event, EventGuest } from "../../types";
import { httpRequests } from "../../httpClient";
import { getUniqueEventGuestValues } from "./logic";
import WhatsAppPreview from "./WhatsAppPreview";
import "./css/WhatsAppMessage.css";

interface MessageGroupsModalProps {
  setIsMessageGroupsModalOpen: (value: boolean) => void;
  eventId: number;
  eventGuests: EventGuest[];
  event: Event;
}

export type MessageType =
  | "rsvp"
  | "rsvpReminder"
  | "freeText"
  | "weddingReminder"
  | "thankYou";

const MessageGroupsModal: React.FC<MessageGroupsModalProps> = ({
  setIsMessageGroupsModalOpen,
  eventId,
  eventGuests,
  event,
}) => {
  const getImageUrl = useCallback(
    () =>
      event.file_id
        ? httpRequests.getEventImageUrl(event.id)
        : httpRequests.getPrimaryImageUrl(),
    [event.id, event.file_id]
  );

  const [messageType, setMessageType] = useState<MessageType>("rsvp");
  const [customText, setCustomText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectSpecificGuests, setSelectSpecificGuests] = useState(false);
  const [selectedGuestIds, setSelectedGuestIds] = useState<Set<number>>(new Set());
  const [guestSearchQuery, setGuestSearchQuery] = useState("");
  const [guestFilters, setGuestFilters] = useState<{ whose: string[]; circle: string[] }>({
    whose: [],
    circle: [],
  });
  const [isGuestFilterOpen, setIsGuestFilterOpen] = useState(false);
  const [filterSectionsOpen, setFilterSectionsOpen] = useState<{ whose: boolean; circle: boolean }>({
    whose: false,
    circle: false,
  });
  const [messageResults, setMessageResults] = useState<
    | {
        success: number;
        fail: number;
        failGuestsList: { guestName: string; logMessage: string }[];
      }
    | undefined
  >(undefined);

  const isPrimaryEvent = event.is_primary;

  const toggleGuestSelection = (guestId: number) => {
    setSelectedGuestIds((prev) => {
      const next = new Set(prev);
      if (next.has(guestId)) {
        next.delete(guestId);
      } else {
        next.add(guestId);
      }
      return next;
    });
  };

  const toggleWhoseFilter = (whose: string) => {
    setGuestFilters((prev) => ({
      ...prev,
      whose: prev.whose.includes(whose) ? prev.whose.filter((item) => item !== whose) : [...prev.whose, whose],
    }));
  };

  const toggleCircleFilter = (circle: string) => {
    setGuestFilters((prev) => ({
      ...prev,
      circle: prev.circle.includes(circle) ? prev.circle.filter((item) => item !== circle) : [...prev.circle, circle],
    }));
  };

  const toggleFilterSection = (section: "whose" | "circle") => {
    setFilterSectionsOpen((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleSend = () => {
    if (messageType === "freeText" && (!customText || customText.trim() === "")) return;

    const guestIds =
      selectSpecificGuests && selectedGuestIds.size > 0
        ? Array.from(selectedGuestIds)
        : undefined;

    setIsSending(true);
    httpRequests
      .sendMessage({
        eventId,
        messageType,
        guestIds,
        customText: messageType === "freeText" ? customText : undefined,
      })
      .then((result) => {
        setMessageResults({
          success: result.success,
          fail: result.fail,
          failGuestsList: result.failGuestsList,
        });
      })
      .catch((err) => {
        console.error(err);
        alert("שליחת ההודעות נכשלה. אנא נסו שנית.");
      })
      .finally(() => setIsSending(false));
  };

  // Guests with no cellphone can't receive WhatsApp messages — exclude from picking/counting/sending.
  const sendableGuests = eventGuests.filter((g) => !!g.phone);

  const selectableGuests = (() => {
    if (messageType === "rsvpReminder") {
      return sendableGuests.filter((g) => g.rsvp_status == null);
    }
    if (messageType === "weddingReminder") {
      return sendableGuests.filter((g) => g.rsvp_status != null && g.rsvp_status > 0);
    }
    return sendableGuests;
  })();

  const targetGuestCount = selectableGuests.length;

  const whoseOptions = getUniqueEventGuestValues(selectableGuests, "whose");
  const circleOptions = getUniqueEventGuestValues(selectableGuests, "circle");
  const filteredGuests = selectableGuests.filter((g) => {
    const matchesSearch = (g.name ?? "").toLowerCase().includes(guestSearchQuery.toLowerCase());
    const matchesWhose = guestFilters.whose.length === 0 || (g.whose != null && guestFilters.whose.includes(g.whose));
    const matchesCircle =
      guestFilters.circle.length === 0 || (g.circle != null && guestFilters.circle.includes(g.circle));
    return matchesSearch && matchesWhose && matchesCircle;
  });

  const allFilteredSelected =
    filteredGuests.length > 0 && filteredGuests.every((g) => selectedGuestIds.has(g.guest_id));

  const toggleSelectAllFiltered = () => {
    setSelectedGuestIds((prev) => {
      const next = new Set(prev);
      filteredGuests.forEach((g) => {
        if (allFilteredSelected) next.delete(g.guest_id);
        else next.add(g.guest_id);
      });
      return next;
    });
  };

  const emptyGroupMessage = (() => {
    if (selectSpecificGuests || targetGuestCount > 0) return null;
    if (messageType === "rsvpReminder") return "אין אורחים שממתינים לתגובה";
    if (messageType === "weddingReminder") return "אין אורחים שאישרו הגעה";
    return "אין אורחים לשליחה";
  })();

  const isSendDisabled =
    isSending ||
    (messageType === "freeText" && (!customText || customText.trim() === "")) ||
    (selectSpecificGuests && selectedGuestIds.size === 0) ||
    (!selectSpecificGuests && targetGuestCount === 0);

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
        </Box>
      );
    }
    return null;
  };

  return (
    <SidePanel
      skin="floating"
      onCloseButtonClick={() => setIsMessageGroupsModalOpen(false)}
      height={selectSpecificGuests ? "80vh" : "auto"}
      maxHeight="85vh"
    >
      <SidePanel.Header title="שליחת הודעות" />
      <SidePanel.Content>
        {messageResults ? (
          renderResponseMessage()
        ) : (
          <Box direction="vertical" gap={3} height="100%" minHeight={0} overflow="hidden">
            <Box direction="vertical" gap={2} flexShrink={0}>
              <RadioGroup
              value={messageType}
              onChange={(value) => {
                setMessageType(value as MessageType);
                setSelectedGuestIds(new Set());
                setGuestSearchQuery("");
                setGuestFilters({ whose: [], circle: [] });
              }}
            >
              <RadioGroup.Radio value="rsvp">
                <Box direction="vertical" gap={1}>
                  <Text weight="bold">הזמנה לאישור הגעה</Text>
                  <Text size="small" secondary>
                    שליחת הזמנה ראשונית עם כפתורי אישור הגעה
                  </Text>
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

              {isPrimaryEvent && (
                <RadioGroup.Radio value="weddingReminder">
                  <Box direction="vertical" gap={1}>
                    <Text weight="bold">תזכורת לחתונה</Text>
                    <Text size="small" secondary>
                      שליחת תזכורת לאורחים שאישרו ב
                      {event.reminder_day === "wedding_day"
                        ? "יום החתונה"
                        : "יום לפני החתונה"}
                      {event.reminder_time ? ` בשעה ${event.reminder_time}` : ""}
                    </Text>
                  </Box>
                </RadioGroup.Radio>
              )}

              <RadioGroup.Radio value="freeText">
                <Box direction="vertical" gap={1}>
                  <Text weight="bold">הודעה מותאמת אישית</Text>
                  <Text size="small" secondary>
                    שליחת טקסט חופשי לאורחים
                  </Text>
                </Box>
              </RadioGroup.Radio>

              {isPrimaryEvent && (
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
          </Box>

            {messageType === "freeText" && (
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

            <Box direction="vertical" gap={2} flexShrink={0}>
              <Checkbox
                checked={selectSpecificGuests}
                onChange={() => {
                  setSelectSpecificGuests((v) => !v);
                  setSelectedGuestIds(new Set());
                }}
              >
                <Text>בחירת אורחים ספציפיים לשליחה</Text>
              </Checkbox>
            </Box>

              {selectSpecificGuests && (
                <Box direction="vertical" gap={2} flex="1 1 auto" minHeight={0} overflow="hidden">
                  <Text size="small" secondary style={{ display: "block" }}>
                    בחרו אורחים
                  </Text>
                    <Box direction="horizontal" gap="8px" verticalAlign="middle" flexShrink={0}>
                      <Box flex="1">
                        <Input
                          value={guestSearchQuery}
                          onChange={(e) => setGuestSearchQuery(e.target.value)}
                          placeholder="חיפוש לפי שם..."
                        />
                      </Box>
                      {(whoseOptions.length > 0 || circleOptions.length > 0) && (
                        <Popover
                          shown={isGuestFilterOpen}
                          placement="bottom-end"
                          onClickOutside={() => setIsGuestFilterOpen(false)}
                          appendTo="window"
                          width={300}
                          zIndex={6000}
                        >
                          <Popover.Element>
                            <Button
                              priority="secondary"
                              size="small"
                              onClick={() => setIsGuestFilterOpen((prev) => !prev)}
                            >
                              <Filter size={16} />
                              <span style={{ marginRight: "6px" }}>
                                סינון{guestFilters.whose.length + guestFilters.circle.length > 0
                                  ? ` (${guestFilters.whose.length + guestFilters.circle.length})`
                                  : ""}
                              </span>
                            </Button>
                          </Popover.Element>
                          <Popover.Content>
                            <Box
                              direction="vertical"
                              gap="8px"
                              padding="16px"
                              style={{ width: 300, maxWidth: 300, maxHeight: 360, overflowY: "auto" }}
                            >
                              {whoseOptions.length > 0 && (
                                <Box direction="vertical" gap="4px">
                                  <div
                                    onClick={() => toggleFilterSection("whose")}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      cursor: "pointer",
                                    }}
                                  >
                                    <Text size="small" weight="bold">
                                      מוזמן ע״י
                                    </Text>
                                    {filterSectionsOpen.whose ? (
                                      <ChevronUp size={16} />
                                    ) : (
                                      <ChevronDown size={16} />
                                    )}
                                  </div>
                                  {filterSectionsOpen.whose && (
                                    <Box direction="vertical" gap="2px">
                                      {whoseOptions.map((whose) => (
                                        <Checkbox
                                          key={whose}
                                          checked={guestFilters.whose.includes(whose)}
                                          size="small"
                                          onChange={() => toggleWhoseFilter(whose)}
                                        >
                                          {whose}
                                        </Checkbox>
                                      ))}
                                    </Box>
                                  )}
                                </Box>
                              )}
                              {circleOptions.length > 0 && (
                                <Box direction="vertical" gap="4px">
                                  <div
                                    onClick={() => toggleFilterSection("circle")}
                                    style={{
                                      display: "flex",
                                      justifyContent: "space-between",
                                      alignItems: "center",
                                      cursor: "pointer",
                                    }}
                                  >
                                    <Text size="small" weight="bold">
                                      מעגל
                                    </Text>
                                    {filterSectionsOpen.circle ? (
                                      <ChevronUp size={16} />
                                    ) : (
                                      <ChevronDown size={16} />
                                    )}
                                  </div>
                                  {filterSectionsOpen.circle && (
                                    <Box direction="vertical" gap="2px">
                                      {circleOptions.map((circle) => (
                                        <Checkbox
                                          key={circle}
                                          checked={guestFilters.circle.includes(circle)}
                                          size="small"
                                          onChange={() => toggleCircleFilter(circle)}
                                        >
                                          {circle}
                                        </Checkbox>
                                      ))}
                                    </Box>
                                  )}
                                </Box>
                              )}
                              <Button
                                priority="secondary"
                                size="tiny"
                                onClick={() => setGuestFilters({ whose: [], circle: [] })}
                              >
                                נקה מסננים
                              </Button>
                            </Box>
                          </Popover.Content>
                        </Popover>
                      )}
                    </Box>

                    {filteredGuests.length === 0 ? (
                      <Text secondary size="small">
                        {selectableGuests.length === 0 ? "אין אורחים זמינים" : "לא נמצאו תוצאות"}
                      </Text>
                    ) : (
                      <Box direction="vertical" gap={1} flex="1 1 auto" minHeight={0} overflow="hidden">
                        <Box flexShrink={0}>
                          <Checkbox checked={allFilteredSelected} onChange={toggleSelectAllFiltered}>
                            בחר הכל ({filteredGuests.length})
                          </Checkbox>
                        </Box>
                        <Box direction="vertical" gap={1} flex="1 1 auto" minHeight={0} overflowY="auto">
                          {filteredGuests.map((guest) => (
                            <Checkbox
                              key={guest.guest_id}
                              checked={selectedGuestIds.has(guest.guest_id)}
                              onChange={() => toggleGuestSelection(guest.guest_id)}
                            >
                              {guest.name} {guest.phone ? `(${guest.phone})` : ""}
                            </Checkbox>
                          ))}
                        </Box>
                      </Box>
                    )}
                  {selectedGuestIds.size > 0 && (
                    <Box flexShrink={0}>
                      <Text size="small" secondary>
                        נבחרו {selectedGuestIds.size} אורחים
                      </Text>
                    </Box>
                  )}
                </Box>
              )}

            <Box direction="vertical" gap={3} flexShrink={0}>
              {emptyGroupMessage && (
                <Text size="small" secondary skin="error">
                  ⚠️ {emptyGroupMessage}
                </Text>
              )}

              <Button
                onClick={handleSend}
                disabled={isSendDisabled}
                fullWidth
              >
                {isSending ? <Loader size="tiny" /> : "שליחת הודעות"}
              </Button>

              <WhatsAppPreview
                event={event}
                getImageUrl={getImageUrl}
                isCollapsible={true}
                showAllMessages={false}
                messageType={messageType}
                customText={customText}
              />
            </Box>
          </Box>
        )}
      </SidePanel.Content>
    </SidePanel>
  );
};

export default MessageGroupsModal;
