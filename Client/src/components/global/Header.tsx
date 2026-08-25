import { Button, IconButton, Modal, PopoverMenu, Tooltip } from "@wix/design-system";
import React, { useState } from "react";
import { ChevronDown } from "@wix/wix-ui-icons-common";
import { ArrowLeft, Heart, HelpCircle, Users } from "lucide-react";
import { useAuth } from "../../hooks/useAuth";
import { httpRequests } from "../../httpClient";
import "./css/Header.css";
import { useLocation, useNavigate } from "react-router-dom";
import { TOUR_PAGE_START_STEPS } from "./tourSteps";
import PartnerModal from "../userDashboard/PartnerModal";
import ViewLogsModal from "../rsvp/ViewLogsModal";
import { useTour } from "../../hooks/useTour";
import { useConfirm } from "../../hooks/useConfirm";

type HeaderProps = {
  showBackToDashboardButton?: boolean;
};
const Header = ({
  showBackToDashboardButton = false,
}: HeaderProps): JSX.Element => {
  const { user, isAdmin, handleLogout, partnerInfo, refreshPartnerInfo } =
    useAuth();
  const { startTour } = useTour();
  const { confirm, ConfirmDialog } = useConfirm();
  const navigate = useNavigate();
  const location = useLocation();
  const pageStartStep = TOUR_PAGE_START_STEPS[location.pathname];
  const [isPartnerModalOpen, setIsPartnerModalOpen] = useState(false);
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
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <Tooltip
            content={pageStartStep ? "הסבר על העמוד הזה" : "סיור מודרך"}
            placement="bottom"
          >
            <IconButton
              priority="secondary"
              size="small"
              dataHook="help-button"
              onClick={() => startTour(pageStartStep)}
            >
              <HelpCircle size={18} />
            </IconButton>
          </Tooltip>
          <PopoverMenu
            triggerElement={
              <Button priority="secondary" data-tour="user-menu">
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
              ? <PopoverMenu.MenuItem text="משתמשים" onClick={() => navigate("/admin")} />
              : null}
            {isAdmin ? <PopoverMenu.Divider /> : null}
            <PopoverMenu.MenuItem
              text="🎯 סיור מודרך מלא"
              onClick={() => {
                // The full tour begins on the dashboard — go there first
                if (location.pathname !== "/") navigate("/");
                setTimeout(() => startTour(), 300);
              }}
            />
            <PopoverMenu.Divider />
            <PopoverMenu.MenuItem text="יומן" onClick={() => setIsViewLogsModalOpen(true)} />
            <PopoverMenu.MenuItem
              text="הורדת הנתונים שלי"
              onClick={async () => {
                try {
                  const exportUrl = await httpRequests.getMyDataExportUrl();
                  window.open(exportUrl, "_blank");
                } catch (error) {
                  console.error("Error downloading data export:", error);
                }
              }}
            />
            <PopoverMenu.Divider />
            <PopoverMenu.MenuItem text="התנתקות" onClick={handleLogout} />
            <PopoverMenu.MenuItem
              text="מחיקת חשבון"
              onClick={async () => {
                const ok = await confirm({
                  title: "מחיקת חשבון",
                  message:
                    "האם למחוק את החשבון לצמיתות? כל הנתונים שלך — אורחים, אירועים, משימות ותקציב — יימחקו ולא ניתן יהיה לשחזר אותם.",
                  confirmText: "מחק חשבון",
                });
                if (!ok) return;
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
          <Modal isOpen={isViewLogsModalOpen}>
            <ViewLogsModal
              setIsViewLogsModalOpen={setIsViewLogsModalOpen}
            />
          </Modal>
          {ConfirmDialog}
        </div>
      )}
    </div>
  );
};

export default Header;
