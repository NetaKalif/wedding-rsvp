import { Button, IconButton, Modal, PopoverMenu } from "@wix/design-system";
import React, { useState } from "react";
import { ChevronDown } from "@wix/wix-ui-icons-common";
import { ArrowLeft, Heart, Users } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { httpRequests } from "../../httpClient";
import "./css/Header.css";
import { useNavigate } from "react-router-dom";
import PartnerModal from "../userDashboard/PartnerModal";
import { SwitchUserModal } from "../rsvp/SwitchUserModal";
import ViewLogsModal from "../rsvp/ViewLogsModal";

type HeaderProps = {
  showBackToDashboardButton?: boolean;
};
const Header = ({
  showBackToDashboardButton = false,
}: HeaderProps): JSX.Element => {
  const { user, isAdmin, handleLogout, partnerInfo, refreshPartnerInfo, switchUser } =
    useAuth();
  const navigate = useNavigate();
  const [isPartnerModalOpen, setIsPartnerModalOpen] = useState(false);
  const [isSwitchUserModalOpen, setIsSwitchUserModalOpen] = useState(false);
  const [isViewLogsModalOpen, setIsViewLogsModalOpen] = useState(false);

  const getPartnerMenuText = () => {
    if (partnerInfo?.hasPartner) {
      if (partnerInfo.isLinkedAccount && partnerInfo.primaryUser) {
        return `מקושר/ת עם ${partnerInfo.primaryUser.name?.split(" ")[0]}`;
      }
      if (partnerInfo.partner) {
        return `בן/בת זוג: ${partnerInfo.partner.name?.split(" ")[0]}`;
      }
    }
    return "הזמנת/חיבור בן זוג";
  };

  return (
    <div className="header-content">
      {showBackToDashboardButton && (
        <IconButton priority="secondary" onClick={() => navigate("/")}>
          <ArrowLeft size={16} />
        </IconButton>
      )}
      <div className="header-brand">
        <Heart className="brand-icon" />
        <span className="brand-text">The Wedding Hub</span>
        {isAdmin && <span className="admin-badge">מנהל</span>}
        {partnerInfo?.hasPartner && (
          <span className="partner-badge">
            <Users size={12} />
          </span>
        )}
      </div>
      {user && (
        <div>
          <PopoverMenu
            triggerElement={
              <Button priority="secondary">
                <ChevronDown /> {user.name || "חשבון"}
              </Button>
            }
          >
            <PopoverMenu.MenuItem
              text={getPartnerMenuText()}
              onClick={() => setIsPartnerModalOpen(true)}
            />
            <PopoverMenu.Divider />
            {isAdmin
              ? <PopoverMenu.MenuItem text="החלפת משתמש" onClick={() => setIsSwitchUserModalOpen(true)} />
              : null}
            {isAdmin ? <PopoverMenu.Divider /> : null}
            <PopoverMenu.MenuItem text="יומן" onClick={() => setIsViewLogsModalOpen(true)} />
            <PopoverMenu.Divider />
            <PopoverMenu.MenuItem text="התנתקות" onClick={handleLogout} />
            <PopoverMenu.MenuItem
              text="מחיקת חשבון"
              onClick={async () => {
                try {
                  await httpRequests.deleteUser();
                  handleLogout();
                } catch (error) {
                  console.error("Error deleting account:", error);
                }
              }}
            />
          </PopoverMenu>
          <PartnerModal
            isOpen={isPartnerModalOpen}
            onClose={() => setIsPartnerModalOpen(false)}
            user={user}
            partnerInfo={partnerInfo}
            onPartnerChange={async () => {
              await refreshPartnerInfo();
            }}
          />
          {isAdmin && (
            <SwitchUserModal
              isOpen={isSwitchUserModalOpen}
              onClose={() => setIsSwitchUserModalOpen(false)}
              currentUserID={user.userID}
              onSwitchUser={switchUser}
            />
          )}
          <Modal isOpen={isViewLogsModalOpen}>
            <ViewLogsModal
              setIsViewLogsModalOpen={setIsViewLogsModalOpen}
            />
          </Modal>
        </div>
      )}
    </div>
  );
};

export default Header;
