import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import GuestList from "./GuestList";
import AddGuestModal from "./AddGuestModal";
import ControlPanel from "./ControlPanel";
import InfoModal from "./InfoModal";
import MessageGroupsModal from "./MessageGroupsModal";
import EventsList from "./EventsList";
import "@wix/design-system/styles.global.css";
import { Event, EventGuest, Guest } from "../../types";
import { httpRequests } from "../../httpClient";
import { useAuth } from "../../hooks/useAuth";
import { Button, Loader, Modal, Box } from "@wix/design-system";
import { Check } from "lucide-react";
import Header from "../global/Header";

const CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;

export const RSVPDashboard = () => {
  const navigate = useNavigate();
  const { user, isLoading } = useAuth();

  // Global guest list (primary list, used for add/import)
  const [primaryGuestsList, setPrimaryGuestsList] = useState<Guest[] | undefined>(undefined);
  // Primary event (wedding)
  const [primaryEvent, setPrimaryEvent] = useState<Event | null>(null);
  // EventGuests for the primary event
  const [eventGuests, setEventGuests] = useState<EventGuest[] | undefined>(undefined);

  const [activeTab, setActiveTab] = useState<"guests" | "events">("guests");
  const [isAddGuestModalOpen, setIsAddGuestModalOpen] = useState(false);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [isMessageGroupsModalOpen, setIsMessageGroupsModalOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const fetchData = async (userID: string) => {
    const [guests, event] = await Promise.all([
      httpRequests.getGuests(userID),
      httpRequests.getPrimaryEvent(userID),
    ]);
    setPrimaryGuestsList(guests);
    setPrimaryEvent(event);
    if (event) {
      const eg = await httpRequests.getEventGuests(userID, event.id);
      setEventGuests(eg);
    } else {
      setEventGuests([]);
    }
  };

  useEffect(() => {
    if (user) {
      fetchData(user.userID);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/");
    }
  }, [user, isLoading, navigate]);

  if (isLoading) return null;
  if (!user) return null;
  if (!CLIENT_ID) {
    throw new Error("REACT_APP_GOOGLE_CLIENT_ID is not set in .env file");
  }

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setShowSuccess(false);
    try {
      await fetchData(user.userID);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 1000);
    } catch (error) {
      console.error("Error refreshing data:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const isDataReady = primaryGuestsList !== undefined && eventGuests !== undefined;

  return (
    <Box direction="vertical" gap="0" align="center" style={{ width: "100%" }}>
      <Header showBackToDashboardButton={true} />

      {/* Heading row with refresh + logs at the end */}
      <Box
        paddingTop={"12px"}
        width="100%"
        direction="vertical"
        verticalAlign="middle"
        style={{ width: "100%", maxWidth: 900, padding: "20px 20px 0", justifyContent: "space-between" }}
      >

        <Box direction="horizontal" gap="8px">
          <Button size="small" priority="secondary" onClick={handleRefresh}>
            {isRefreshing ? <Loader size="tiny" /> : showSuccess ? <Check size={16} /> : "רענון"}
          </Button>
        </Box>
        <h1 style={{ margin: 0 }}>ניהול אישורי הגעה</h1>
      </Box>

      {/* Tab bar — CSS tab style */}
      <div style={{ width: "100%", maxWidth: 900, padding: "0 20px" }}>
        <div style={{ display: "flex", borderBottom: "2px solid #e0e0e0", marginTop: 16 }}>
          {(["guests", "events"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "10px 24px",
                background: "none",
                border: "none",
                borderBottom: activeTab === tab ? "2px solid #116DFF" : "2px solid transparent",
                marginBottom: -2,
                cursor: "pointer",
                fontWeight: activeTab === tab ? 600 : 400,
                color: activeTab === tab ? "#116DFF" : "#666",
                fontSize: 15,
              }}
            >
              {tab === "guests" ? "💍 אורחי החתונה" : "🎉 אירועים נוספים"}
            </button>
          ))}
        </div>
      </div>
      <Box direction="vertical" width="100%">
        {activeTab === "events" && primaryGuestsList && (
          <Box padding="20px" style={{ width: "100%", maxWidth: 800 }}>
            <EventsList userID={user.userID} guestsList={primaryGuestsList} primaryEvent={primaryEvent} />
          </Box>
        )}

        {activeTab === "guests" && (
          isDataReady ? (
            <>
              <Box direction="horizontal" gap="20px" padding="20px">
                <ControlPanel
                  setIsAddGuestModalOpen={setIsAddGuestModalOpen}
                  setEventGuests={setEventGuests}
                  eventGuests={eventGuests}
                  setIsInfoModalOpen={setIsInfoModalOpen}
                  setIsMessageGroupsModalOpen={setIsMessageGroupsModalOpen}
                  userID={user.userID}
                />
              </Box>

              {eventGuests.length > 0 ? (
                primaryEvent ? (
                  <GuestList
                    userID={user.userID}
                    eventGuests={eventGuests}
                    eventId={primaryEvent.id}
                    onEventGuestsChange={setEventGuests}
                    primaryGuestsList={primaryGuestsList}
                  />
                ) : null
              ) : (
                <Box
                  direction="vertical"
                  align="center"
                  background={"WHITE"}
                  padding="20px"
                  borderRadius="10px"
                  gap="20px"
                >
                  <h3>אין אורחים ברשימה</h3>
                  <Button size="small" onClick={() => setIsAddGuestModalOpen(true)}>
                    הוספת אורח
                  </Button>
                </Box>
              )}

              <Modal isOpen={isAddGuestModalOpen}>
                {primaryEvent && (
                  <AddGuestModal
                    primaryGuestsList={primaryGuestsList}
                    setIsAddGuestModalOpen={setIsAddGuestModalOpen}
                    userID={user.userID}
                    eventId={primaryEvent.id}
                    onEventGuestsChange={setEventGuests}
                  />
                )}
              </Modal>

              <Modal isOpen={isInfoModalOpen}>
                <InfoModal setIsInfoModalOpen={setIsInfoModalOpen} />
              </Modal>

              <Modal isOpen={isMessageGroupsModalOpen}>
                {primaryEvent && (
                  <MessageGroupsModal
                    setIsMessageGroupsModalOpen={setIsMessageGroupsModalOpen}
                    userID={user.userID}
                    eventId={primaryEvent.id}
                    eventGuests={eventGuests}
                    event={primaryEvent}
                  />
                )}
              </Modal>


            </>
          ) : (
            <Loader size="large" />
          )
        )}

      </Box>


    </Box>
  );
};
