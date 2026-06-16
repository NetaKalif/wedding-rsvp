import React, { useEffect, useState } from "react";
import { Box, Button, Card, Text, Loader } from "@wix/design-system";
import { Plus } from "lucide-react";
import { Event, EventGuest, Guest } from "../../types";
import { httpRequests } from "../../httpClient";
import CreateEventWizard from "./CreateEventWizard";
import EventDetail from "./EventDetail";

interface EventsListProps {
  userID: string;
  guestsList: Guest[];
  primaryEvent: Event | null;
}

const EventsList: React.FC<EventsListProps> = ({ userID, guestsList, primaryEvent }) => {
  const [events, setEvents] = useState<Event[] | undefined>(undefined);
  const [eventGuestCounts, setEventGuestCounts] = useState<Record<number, { total: number; confirmed: number; pending: number; declined: number }>>({});
  const [selectedEvent, setSelectedEvent] = useState<Event | undefined>(undefined);
  const [isCreating, setIsCreating] = useState(false);

  const loadEvents = async () => {
    const data = await httpRequests.getEvents(userID);
    // Exclude the primary (wedding) event — it lives in the wedding tab
    const secondary = data.filter((e) => !e.is_primary);
    setEvents(secondary);

    // Load guest counts for each event
    const counts: typeof eventGuestCounts = {};
    await Promise.all(
      secondary.map(async (e) => {
        try {
          const eg: EventGuest[] = await httpRequests.getEventGuests(userID, e.id);
          counts[e.id] = {
            total: eg.length,
            confirmed: eg.filter((g) => g.rsvp_status != null && g.rsvp_status > 0).length,
            pending: eg.filter((g) => g.rsvp_status == null).length,
            declined: eg.filter((g) => g.rsvp_status === 0).length,
          };
        } catch {
          counts[e.id] = { total: 0, confirmed: 0, pending: 0, declined: 0 };
        }
      })
    );
    setEventGuestCounts(counts);
  };

  useEffect(() => { loadEvents(); }, [userID]);

  if (selectedEvent) {
    return (
      <EventDetail
        event={selectedEvent}
        userID={userID}
        guestsList={guestsList}
        primaryEvent={primaryEvent}
        onBack={() => setSelectedEvent(undefined)}
        onEventDeleted={() => {
          setSelectedEvent(undefined);
          loadEvents();
        }}
        onEventUpdated={(updated) => {
          setSelectedEvent(updated);
          setEvents((prev) => prev?.map((e) => (e.id === updated.id ? updated : e)));
        }}
      />
    );
  }

  return (
    <Box direction="vertical" gap={3} style={{ width: "100%" }}>
      <Box direction="horizontal" gap={2} verticalAlign="middle">
        <Button size="small" onClick={() => setIsCreating(true)}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Plus size={14} />
            אירוע חדש
          </span>
        </Button>
      </Box>

      {!events ? (
        <Loader size="medium" />
      ) : events.length === 0 ? (
        <Box direction="vertical" align="center" background="WHITE" padding="32px" borderRadius="8px" gap={2}>
          <Text secondary>אין אירועים עדיין</Text>
          <Text size="small" secondary>
            הוסיפו אירועים כגון חינה, מסיבת רווקות וכד׳ ושלחו להם הזמנות בנפרד
          </Text>
          <Button size="small" onClick={() => setIsCreating(true)}>
            צרו את האירוע הראשון
          </Button>
        </Box>
      ) : (
        <Box direction="vertical" gap={2} width={"100%"} >
          {events.map((event) => {
            const counts = eventGuestCounts[event.id];
            return (
              <div
                key={event.id}
                onClick={() => setSelectedEvent(event)}
                style={{ cursor: "pointer" }}
              >
                <Card>
                  <Card.Content>
                    <Box direction="horizontal" gap={3} verticalAlign="middle" style={{ justifyContent: "space-between" }}>
                      <Box direction="vertical" gap={1}>
                        <Text weight="bold">{event.ceremony_name}</Text>
                        <Box direction="horizontal" gap={2}>
                          {event.date && (
                            <Text size="small" secondary>
                              📅 {new Date(event.date).toLocaleDateString("he-IL")}
                            </Text>
                          )}
                          {event.location && (
                            <Text size="small" secondary>📍 {event.location}</Text>
                          )}
                        </Box>
                        {counts && counts.total > 0 && (
                          <Box direction="horizontal" gap={2}>
                            <Text size="small" secondary>{counts.total} מוזמנים</Text>
                            <Text size="small" skin="success">✅ {counts.confirmed}</Text>
                            <Text size="small" secondary>⏳ {counts.pending}</Text>
                            {counts.declined > 0 && <Text size="small" skin="error">❌ {counts.declined}</Text>}
                          </Box>
                        )}
                        {counts && counts.total === 0 && (
                          <Text size="small" secondary>אין אורחים עדיין</Text>
                        )}
                      </Box>
                      <Text size="small" secondary>←</Text>
                    </Box>
                  </Card.Content>
                </Card>
              </div>
            );
          })}
        </Box>
      )}

      {isCreating && (
        <CreateEventWizard
          userID={userID}
          guestsList={guestsList}
          onClose={() => setIsCreating(false)}
          onCreated={(event) => {
            setIsCreating(false);
            setEvents((prev) => [event, ...(prev || [])]);
            setEventGuestCounts((prev) => ({
              ...prev,
              [event.id]: { total: 0, confirmed: 0, pending: 0, declined: 0 },
            }));
            setSelectedEvent(event);
          }}
        />
      )}
    </Box>
  );
};

export default EventsList;
