import React, { useState } from "react";
import { Box, Button, Card, Checkbox, Input, Modal, SidePanel, Text } from "@wix/design-system";
import { Event, EventGuest, Guest } from "../../types";
import { httpRequests } from "../../httpClient";
import { useAppData } from "../../hooks/useAppData";
import { useConfirm } from "../../hooks/useConfirm";
import { ArrowRight, Check, Clock, Download, Edit2, MessageSquare, Trash2, UserPlus, X } from "lucide-react";
import GuestList from "./GuestList";
import MessageGroupsModal from "./MessageGroupsModal";
import EventEditModal from "./EventEditModal";
import { getNumberOfGuests, getNumberOfGuestsDeclined, getNumberOfGuestsRSVP, getRsvpCounts, handleExport } from "./logic";
import "./css/ControlPanel.css";

interface EventDetailProps {
  event: Event;
  userID: string;
  guestsList: Guest[];
  primaryEvent: Event | null;
  onBack: () => void;
  onEventDeleted: () => void;
  onEventUpdated?: (updated: Event) => void;
}

const EventDetail: React.FC<EventDetailProps> = ({
  event: initialEvent,
  userID,
  guestsList,
  primaryEvent,
  onBack,
  onEventDeleted,
  onEventUpdated,
}) => {
  const { eventGuestsByEventId, updateEventGuests } = useAppData();
  const { confirm, ConfirmDialog } = useConfirm();
  const [event, setEvent] = useState<Event>(initialEvent);
  const [eventGuests, setEventGuests] = useState<EventGuest[]>(
    () => eventGuestsByEventId[initialEvent.id] ?? []
  );
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAddFromListOpen, setIsAddFromListOpen] = useState(false);
  const [selectedGuestIds, setSelectedGuestIds] = useState<Set<number>>(new Set());
  const [guestSearchQuery, setGuestSearchQuery] = useState("");

  const syncGuests = async () => {
    const guests = await httpRequests.getEventGuests(userID, event.id);
    setEventGuests(guests);
    updateEventGuests(event.id, guests);
  };

  // Remove from event only (not from global guests table)
  const handleDeleteFromEvent = async (guest: EventGuest) => {
    const ok = await confirm({ message: `להסיר את ${guest.name} מהאירוע?`, confirmText: "הסר" });
    if (!ok) return;
    const updated = eventGuests.filter((g) => g.guest_id !== guest.guest_id);
    setEventGuests(updated);
    updateEventGuests(event.id, updated);
    try {
      await httpRequests.removeEventGuests(userID, event.id, [guest.guest_id]);
    } catch (error) {
      console.error("Error removing from event:", error);
      await syncGuests(); // rollback
    }
  };

  const handleRemoveAll = async () => {
    if (!eventGuests.length) return;
    const ok = await confirm({
      message: `להסיר את כל ${eventGuests.length} האורחים מ״${event.ceremony_name}״? (הם לא יימחקו מרשימת האורחים הכללית)`,
      confirmText: "הסר הכל",
    });
    if (!ok) return;
    await httpRequests.removeEventGuests(userID, event.id, eventGuests.map((g) => g.guest_id));
    setEventGuests([]);
    updateEventGuests(event.id, []);
  };

  const handleDeleteEvent = async () => {
    const ok = await confirm({ message: `למחוק את האירוע ״${event.ceremony_name}״?` });
    if (!ok) return;
    await httpRequests.deleteEvent(userID, event.id);
    onEventDeleted();
  };

  const closeAddFromList = () => {
    setIsAddFromListOpen(false);
    setSelectedGuestIds(new Set());
    setGuestSearchQuery("");
  };

  const handleAddFromList = async () => {
    const ids = Array.from(selectedGuestIds);
    if (!ids.length) return;
    closeAddFromList(); // close panel immediately
    await httpRequests.setEventGuests(userID, event.id, ids);
    await syncGuests();
  };

  const toggleGuest = (id: number, checked: boolean) => {
    setSelectedGuestIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const eventGuestIdSet = new Set(eventGuests.map((g) => g.guest_id));
  const availableGuests = guestsList.filter((g) => g.id != null && !eventGuestIdSet.has(g.id!));
  const filteredGuests = availableGuests.filter((g) =>
    g.name.toLowerCase().includes(guestSearchQuery.toLowerCase())
  );

  const rsvpCounts = getRsvpCounts(eventGuests);

  return (
    <Box direction="vertical" gap="20px" align="center">
      {/* Back + title */}
      <Box direction="vertical" gap="12px" verticalAlign="middle" width='100%'>
        <Box align="left" width="100%">
          <Button priority="secondary" size="small" onClick={onBack}>
            <ArrowRight size={14} /> חזרה
          </Button>
        </Box>
        <Box direction="vertical" align='center'>
          <h2 style={{ margin: 0 }}>{event.ceremony_name}</h2>
          {event.date && <span style={{ color: "#888", fontSize: 14 }}>📅 {new Date(event.date).toLocaleDateString("he-IL")}</span>}
          {event.location && <span style={{ color: "#888", fontSize: 14 }}>📍 {event.location}</span>}
        </Box>
      </Box>

      {/* ControlPanel-style cards — same layout as wedding tab */}
      <Box direction="horizontal" gap="20px" padding="20px">
        <div className="control-panel">
          {/* Stats card */}
          <Card>
            <Card.Header title="ספירת אורחים" />
            <Card.Content>
              <Box gap="16px" className="guest-summary">
                <Box direction="vertical" gap="4px">
                  <span>סה״כ מוזמנים</span>
                  <span className="pending">{getNumberOfGuests(eventGuests)}</span>
                </Box>
                <Box direction="vertical" gap="4px">
                  <span>סה״כ אישרו</span>
                  <span className="confirmed">{getNumberOfGuestsRSVP(eventGuests)}</span>
                </Box>
                <Box direction="vertical" gap="4px">
                  <span>סה״כ סירבו</span>
                  <span className="declined">{getNumberOfGuestsDeclined(eventGuests)}</span>
                </Box>
              </Box>
            </Card.Content>
          </Card>

          {/* Response rate card */}
          <Card>
            <Card.Header title="שיעורי תגובה נוכחיים" />
            <Card.Content>
              <div className="rsvp-summary">
                <Box direction="horizontal" verticalAlign="middle" className="confirmed" gap="8px">
                  <Check /><span>אישרו</span><span>{rsvpCounts.confirmed}</span>
                </Box>
                <Box direction="horizontal" verticalAlign="middle" className="pending" gap="8px">
                  <Clock /><span>ממתינים</span><span>{rsvpCounts.pending}</span>
                </Box>
                <Box direction="horizontal" verticalAlign="middle" className="declined" gap="8px">
                  <X /><span>סירבו</span><span>{rsvpCounts.declined}</span>
                </Box>
              </div>
            </Card.Content>
          </Card>

          {/* Actions card */}
          <Card>
            <Card.Header title="פעולות מהירות" />
            <Card.Content>
              <div className="quick-actions">
                <Button onClick={() => setIsAddFromListOpen(true)} priority="secondary">
                  <UserPlus />
                  <span style={{ marginRight: "8px" }}>הוסף מרשימת אורחים</span>
                </Button>
                <Button onClick={() => setIsSendModalOpen(true)} priority="secondary" disabled={!eventGuests.length}>
                  <MessageSquare />
                  <span style={{ marginRight: "8px" }}>שליחת הודעות</span>
                </Button>
                <Button onClick={() => setIsEditModalOpen(true)} priority="secondary">
                  <Edit2 />
                  <span style={{ marginRight: "8px" }}>עריכת פרטים</span>
                </Button>
                <Button onClick={() => handleExport(eventGuests)} priority="secondary">
                  <Download />
                  <span style={{ marginRight: "8px" }}>ייצוא</span>
                </Button>
                <Button onClick={handleRemoveAll} priority="secondary" disabled={!eventGuests.length}>
                  <Trash2 />
                  <span style={{ marginRight: "8px" }}>הסר כל האורחים</span>
                </Button>
                <Button onClick={handleDeleteEvent} priority="secondary" skin="destructive">
                  <Trash2 />
                  <span style={{ marginRight: "8px" }}>מחק אירוע</span>
                </Button>
              </div>
            </Card.Content>
          </Card>
        </div>
      </Box>

      {/* Same GuestList component as the wedding tab */}
      {eventGuests.length > 0 ? (
        <GuestList
          userID={userID}
          eventGuests={eventGuests}
          eventId={event.id}
          onEventGuestsChange={setEventGuests}
          primaryGuestsList={guestsList}
          onDeleteGuest={handleDeleteFromEvent}
        />
      ) : (
        <Box direction="vertical" align="center" background="WHITE" padding="20px" borderRadius="10px" gap="20px">
          <h3>אין אורחים באירוע זה</h3>
        </Box>
      )}

      {/* Send messages modal */}
      <Modal isOpen={isSendModalOpen}>
        <MessageGroupsModal
          setIsMessageGroupsModalOpen={(open) => {
            setIsSendModalOpen(open);
            if (!open) syncGuests();
          }}
          userID={userID}
          eventId={event.id}
          eventGuests={eventGuests}
          event={{
            ...event,
            bride_name: event.bride_name || primaryEvent?.bride_name,
            groom_name: event.groom_name || primaryEvent?.groom_name,
          }}
        />
      </Modal>

      {/* Add guests from global list */}
      <Modal isOpen={isAddFromListOpen}>
        <SidePanel onCloseButtonClick={closeAddFromList} skin="floating" height="auto">
          <SidePanel.Header title="הוספת אורחים לאירוע" />
          <SidePanel.Content>
            <Box direction="vertical" gap="12px">
              <Input
                value={guestSearchQuery}
                onChange={(e) => setGuestSearchQuery(e.target.value)}
                placeholder="חיפוש לפי שם..."
              />
              {filteredGuests.length === 0 ? (
                <Text secondary size="small">
                  {availableGuests.length === 0 ? "כל האורחים כבר נמצאים באירוע" : "לא נמצאו תוצאות"}
                </Text>
              ) : (
                <Box direction="vertical" gap="8px" style={{ maxHeight: 360, overflowY: "auto" }}>
                  {filteredGuests.map((g) => (
                    <Box key={g.id} direction="horizontal" gap="8px" verticalAlign="middle">
                      <Checkbox
                        checked={selectedGuestIds.has(g.id!)}
                        onChange={(e) => toggleGuest(g.id!, e.target.checked)}
                      />
                      <Box direction="vertical" gap="2px">
                        <Text size="small" weight="bold">{g.name}</Text>
                        <Text size="tiny" secondary>{g.phone}</Text>
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
              <Box align="space-between" style={{ marginTop: 8 }}>
                <Button priority="secondary" onClick={closeAddFromList}>ביטול</Button>
                <Button disabled={selectedGuestIds.size === 0} onClick={handleAddFromList}>
                  הוסף ({selectedGuestIds.size})
                </Button>
              </Box>
            </Box>
          </SidePanel.Content>
        </SidePanel>
      </Modal>

      {/* Edit event modal */}
      {isEditModalOpen && (
        <Modal isOpen>
          <EventEditModal
            event={event}
            userID={userID}
            onClose={() => setIsEditModalOpen(false)}
            onSaved={(updated) => {
              setEvent(updated);
              setIsEditModalOpen(false);
              onEventUpdated?.(updated);
            }}
          />
        </Modal>
      )}
      {ConfirmDialog}
    </Box>
  );
};

export default EventDetail;
