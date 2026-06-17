import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import GuestList from "./GuestList";
import AddGuestModal from "./AddGuestModal";
import ControlPanel from "./ControlPanel";
import InfoModal from "./InfoModal";
import MessageGroupsModal from "./MessageGroupsModal";
import EventsList from "./EventsList";
import "@wix/design-system/styles.global.css";
import { useAuth } from "../../hooks/useAuth";
import { useAppData } from "../../hooks/useAppData";
import { Button, Loader, Modal, Box } from "@wix/design-system";
import { Check } from "lucide-react";
import Header from "../global/Header";

const CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID;

export const RSVPDashboard = () => {
  const navigate = useNavigate();
  const { user, isLoading, weddingInfo } = useAuth();
  const { guests, eventGuestsByEventId, updateEventGuests, refreshGuests, refreshEventGuests } = useAppData();

  const [activeTab, setActiveTab] = useState<"guests" | "events">("guests");
  const [isAddGuestModalOpen, setIsAddGuestModalOpen] = useState(false);
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  const [isMessageGroupsModalOpen, setIsMessageGroupsModalOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const eventGuests = weddingInfo ? (eventGuestsByEventId[weddingInfo.id] ?? []) : [];

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
      await Promise.all([
        refreshGuests(),
        weddingInfo ? refreshEventGuests(weddingInfo.id) : Promise.resolve(),
      ]);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 1000);
    } catch (error) {
      console.error("Error refreshing data:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleEventGuestsChange = (eg: typeof eventGuests) => {
    if (weddingInfo) updateEventGuests(weddingInfo.id, eg);
  };

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
        {activeTab === "events" && (
          <Box padding="20px" style={{ width: "100%", maxWidth: 800 }}>
            <EventsList userID={user.userID} guestsList={guests} primaryEvent={weddingInfo} />
          </Box>
        )}

        {activeTab === "guests" && (
          <>
            <Box direction="horizontal" gap="20px" padding="20px">
              <ControlPanel
                setIsAddGuestModalOpen={setIsAddGuestModalOpen}
                setEventGuests={handleEventGuestsChange}
                eventGuests={eventGuests}
                setIsInfoModalOpen={setIsInfoModalOpen}
                setIsMessageGroupsModalOpen={setIsMessageGroupsModalOpen}
                userID={user.userID}
              />
            </Box>

            {eventGuests.length > 0 ? (
              weddingInfo ? (
                <GuestList
                  userID={user.userID}
                  eventGuests={eventGuests}
                  eventId={weddingInfo.id}
                  onEventGuestsChange={handleEventGuestsChange}
                  primaryGuestsList={guests}
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
              {weddingInfo && (
                <AddGuestModal
                  primaryGuestsList={guests}
                  setIsAddGuestModalOpen={setIsAddGuestModalOpen}
                  userID={user.userID}
                  eventId={weddingInfo.id}
                  onEventGuestsChange={handleEventGuestsChange}
                />
              )}
            </Modal>

            <Modal isOpen={isInfoModalOpen}>
              <InfoModal setIsInfoModalOpen={setIsInfoModalOpen} />
            </Modal>

            <Modal isOpen={isMessageGroupsModalOpen}>
              {weddingInfo && (
                <MessageGroupsModal
                  setIsMessageGroupsModalOpen={setIsMessageGroupsModalOpen}
                  userID={user.userID}
                  eventId={weddingInfo.id}
                  eventGuests={eventGuests}
                  event={weddingInfo}
                />
              )}
            </Modal>
          </>
        )}

      </Box>


    </Box>
  );
};
