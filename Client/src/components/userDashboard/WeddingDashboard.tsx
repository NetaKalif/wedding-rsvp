import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Users, CheckSquare, DollarSign } from "lucide-react";
import { Box, Card, Badge, Loader } from "@wix/design-system";
import "@wix/design-system/styles.global.css";
import "./css/WeddingDashboard.css";
import { useAuth } from "../../hooks/useAuth";
import { WeddingCountdown } from "./WeddingCountdown";
import Header from "../global/Header";
import WeddingSetupModal from "./WeddingSetupModal";
import AccountTypeSelector from "./AccountTypeSelector";
import { httpRequests } from "../../httpClient";

export const WeddingDashboard = () => {
  const {
    user,
    partnerInfo,
    weddingInfo,
    isLoading,
    refreshPartnerInfo,
    refreshWeddingInfo,
    handleLogout,
  } = useAuth();
  const navigate = useNavigate();
  const [showAccountSelector, setShowAccountSelector] = useState(false);
  const [showWeddingSetup, setShowWeddingSetup] = useState(false);

  // Compute if this is a first-time user based on wedding info
  const isFirstTimeUser = useMemo(() => {
    if (isLoading) return null;
    const hasBasicInfo =
      weddingInfo &&
      weddingInfo.bride_name &&
      weddingInfo.groom_name &&
      weddingInfo.date &&
      weddingInfo.time &&
      weddingInfo.location;
    return !hasBasicInfo && !partnerInfo?.isLinkedAccount;
  }, [weddingInfo, partnerInfo?.isLinkedAccount, isLoading]);

  // Show account selector for first-time users (only on initial load)
  const shouldShowAccountSelector = useMemo(() => {
    if (isFirstTimeUser && !showWeddingSetup) {
      return true;
    }
    return showAccountSelector;
  }, [isFirstTimeUser, showAccountSelector, showWeddingSetup]);

  const handleSetupComplete = async () => {
    setShowWeddingSetup(false);
    setShowAccountSelector(false);
    // Refresh wedding info from context
    await refreshWeddingInfo();
  };

  const handleCreateNew = () => {
    setShowAccountSelector(false);
    setShowWeddingSetup(true);
  };

  const handleJoinSuccess = async () => {
    setShowAccountSelector(false);
    // Refresh partner info and wedding info
    await Promise.all([refreshPartnerInfo(), refreshWeddingInfo()]);
  };

  const handleCancelAccountSetup = () => {
    if (!user) return;
    // Delete the newly created user and log them out
    httpRequests.deleteUser();
    handleLogout();
  };

  if (!user) {
    return null;
  }

  // Show loading while auth is initializing
  if (isLoading) {
    return (
      <div className="wedding-dashboard">
        <Header />
        <Box
          direction="vertical"
          align="center"
          verticalAlign="middle"
          height="50vh"
        >
          <Loader size="medium" />
        </Box>
      </div>
    );
  }

  // Show account type selector for first-time users
  if (isFirstTimeUser && shouldShowAccountSelector) {
    return (
      <AccountTypeSelector
        user={user}
        onCreateNew={handleCreateNew}
        onJoinSuccess={handleJoinSuccess}
        onCancel={handleCancelAccountSetup}
      />
    );
  }

  // Show setup modal if user chose to create new wedding
  if (showWeddingSetup) {
    return (
      <WeddingSetupModal
        onComplete={handleSetupComplete}
      />
    );
  }

  const featureCards = [
    {
      id: "tasks",
      title: "משימות לחתונה",
      description: "עקבו אחר רשימת המשימות שלכם",
      icon: <CheckSquare size={28} />,
      path: "/tasks",
      skin: "purple" as const,
      available: true,
    },
    {
      id: "budget",
      title: "תקציב וספקים",
      description: "נהלו הוצאות ופרטי ספקים",
      icon: <DollarSign size={28} />,
      path: "/budget",
      skin: "blue" as const,
      available: true,
    },
    {
      id: "rsvp",
      title: "ניהול אישורי הגעה",
      description: "נהלו את רשימת האורחים ועקבו אחר התגובות",
      icon: <Users size={28} />,
      path: "/rsvp",
      skin: "pink" as const,
      available: true,
    },
  ];

  return (
    <div className="wedding-dashboard">
      <Header />

      <Box direction="vertical" gap="24px" padding="24px 0">
        <Box direction="vertical" gap="6px">
          <h1 className="dashboard-title">
            {weddingInfo?.bride_name && weddingInfo?.groom_name
              ? `החתונה של ${weddingInfo.bride_name} ו${weddingInfo.groom_name}`
              : "המסע לחתונה שלכם"}
          </h1>
        </Box>

        <WeddingCountdown weddingInfo={weddingInfo} isLoading={isLoading} />

        <Box
          direction="horizontal"
          gap="16px"
          className="feature-cards"
          align="center"
        >
          {featureCards.map((feature) => (
            <div
              key={feature.id}
              className={`feature-card-wrapper ${
                !feature.available ? "coming-soon-card" : ""
              }`}
              onClick={() => feature.available && navigate(feature.path)}
            >
              <Card stretchVertically={true}>
                <Card.Header
                  className="feature-card-header"
                  title={feature.title}
                  subtitle={feature.description}
                />
                <Card.Content>
                  <Box
                    direction="vertical"
                    align="center"
                    padding="12px 0"
                    gap="12px"
                  >
                    {!feature.available ? (
                      <Badge skin="warningLight" size="tiny">
                        בקרוב
                      </Badge>
                    ) : undefined}
                    <Box
                      align="center"
                      verticalAlign="middle"
                      width="56px"
                      height="56px"
                      className={`feature-icon-box feature-icon-${feature.skin}`}
                    >
                      {feature.icon}
                    </Box>
                  </Box>
                </Card.Content>
              </Card>
            </div>
          ))}
        </Box>
      </Box>
    </div>
  );
};
