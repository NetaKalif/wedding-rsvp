import React, { useState } from "react";
import {
  Modal,
  Box,
  Text,
  Button,
  Input,
  Heading,
  Loader,
  Badge,
  Divider,
} from "@wix/design-system";
import { Users, Link, Copy, Check, UserMinus, UserPlus } from "lucide-react";
import { PartnerInfo, User } from "../../types";
import { httpRequests } from "../../httpClient";
import "./css/PartnerModal.css";

interface PartnerModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
  partnerInfo: PartnerInfo | undefined;
  onPartnerChange: () => Promise<void>;
}

export const PartnerModal: React.FC<PartnerModalProps> = ({
  isOpen,
  onClose,
  user,
  partnerInfo,
  onPartnerChange,
}) => {
  const [inviteCode, setInviteCode] = useState<string>(
    partnerInfo?.inviteCode || ""
  );
  const [joinCode, setJoinCode] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>("");
  const [showJoinForm, setShowJoinForm] = useState(false);

  const handleGenerateCode = async () => {
    setIsGenerating(true);
    setError("");
    try {
      const code = await httpRequests.generateInviteCode();
      setInviteCode(code);
      await onPartnerChange();
    } catch (err: any) {
      setError(err.message || "יצירת קוד ההזמנה נכשלה");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleJoinPartner = async () => {
    if (!joinCode.trim()) {
      setError("אנא הכניסו קוד הזמנה");
      return;
    }
    setIsJoining(true);
    setError("");
    try {
      const result = await httpRequests.acceptInvite(joinCode);
      if (result.success) {
        await onPartnerChange();
        setShowJoinForm(false);
        setJoinCode("");
      } else {
        setError(result.error || "ההצטרפות לבן/בת הזוג נכשלה");
      }
    } catch (err: any) {
      setError(err.message || "ההצטרפות לבן/בת הזוג נכשלה");
    } finally {
      setIsJoining(false);
    }
  };

  const handleUnlink = async () => {
    const confirmed = window.confirm(
      "האם אתם בטוחים שברצונכם לבטל את הקישור עם בן/בת הזוג? תאבדו גישה לנתוני החתונה המשותפים."
    );
    if (!confirmed) return;

    setIsUnlinking(true);
    setError("");
    try {
      await httpRequests.unlinkPartner();
      await onPartnerChange();
    } catch (err: any) {
      setError(err.message || "ביטול הקישור נכשל");
    } finally {
      setIsUnlinking(false);
    }
  };

  const renderLinkedPartnerView = () => {
    if (!partnerInfo) return null;

    if (partnerInfo.isLinkedAccount && partnerInfo.primaryUser) {
      // User is the secondary/partner account
      return (
        <Box direction="vertical" gap="16px" align="center">
          <Box className="partner-icon-box linked">
            <Users size={32} />
          </Box>
          <Badge skin="success" size="medium">
            חשבון מקושר
          </Badge>
          <Text size="medium">
            אתם מחוברים לחשבון החתונה של{" "}
            <strong>{partnerInfo.primaryUser.name}</strong>.
          </Text>
          <Text size="small" secondary>
            כל נתוני החתונה משותפים עם בן/בת הזוג.
          </Text>
          <Divider />
          <Button
            size="small"
            skin="destructive"
            prefixIcon={<UserMinus size={16} />}
            onClick={handleUnlink}
            disabled={isUnlinking}
          >
            {isUnlinking ? <Loader size="tiny" /> : "ביטול קישור"}
          </Button>
        </Box>
      );
    }

    if (partnerInfo.hasPartner && partnerInfo.partner) {
      // User is the primary account with a partner
      return (
        <Box direction="vertical" gap="16px" align="center">
          <Box className="partner-icon-box linked">
            <Users size={32} />
          </Box>
          <Badge skin="success" size="medium">
            בן/בת זוג מחובר/ת
          </Badge>
          <Text size="medium">
            <strong>{partnerInfo.partner.name}</strong> מחובר/ת לחשבון החתונה
            שלכם.
          </Text>
          <Text size="small" secondary>
            שניכם משתפים את אותם נתוני חתונה.
          </Text>
          <Divider />
          <Button
            size="small"
            skin="destructive"
            prefixIcon={<UserMinus size={16} />}
            onClick={handleUnlink}
            disabled={isUnlinking}
          >
            {isUnlinking ? <Loader size="tiny" /> : "הסרת בן/בת זוג"}
          </Button>
        </Box>
      );
    }

    return null;
  };

  const renderInviteView = () => (
    <Box direction="vertical" gap="20px">
      <Box direction="vertical" gap="8px" align="center">
        <Box className="partner-icon-box">
          <Link size={32} />
        </Box>
        <Text size="medium" weight="bold">
          הזמינו את בן/בת הזוג
        </Text>
        <Text size="small" secondary className="partner-description">
          צרו קוד לשיתוף עם בן/בת הזוג. הם יוכלו להשתמש בו כדי לקשר את החשבון
          שלהם ולגשת יחד לכל נתוני החתונה.
        </Text>
      </Box>

      {inviteCode ? (
        <Box direction="vertical" gap="12px" align="center">
          <Box className="invite-code-display">
            <Text size="medium" weight="bold" className="invite-code-text">
              {inviteCode}
            </Text>
          </Box>
          <Button
            size="small"
            skin="light"
            prefixIcon={copied ? <Check size={16} /> : <Copy size={16} />}
            onClick={handleCopyCode}
          >
            {copied ? "הועתק!" : "העתקת קוד"}
          </Button>
          <Text size="tiny" secondary>
            הקוד תקף ל-7 ימים
          </Text>
        </Box>
      ) : (
        <Button
          size="medium"
          skin="premium"
          onClick={handleGenerateCode}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <Loader size="tiny" />
          ) : (
            <>
              <Link size={16} />{" "}
              <span style={{ marginRight: "8px" }}>יצירת קוד הזמנה</span>
            </>
          )}
        </Button>
      )}

      <Divider />

      <Box direction="vertical" gap="12px" align="center">
        <Text size="small" secondary>
          יש לכם קוד הזמנה מבן/בת הזוג?
        </Text>
        {showJoinForm ? (
          <Box direction="vertical" gap="8px" width="100%">
            <Input
              size="medium"
              placeholder="הכניסו קוד הזמנה"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={8}
            />
            <Box gap="8px">
              <Button
                size="small"
                skin="standard"
                onClick={() => {
                  setShowJoinForm(false);
                  setJoinCode("");
                  setError("");
                }}
              >
                ביטול
              </Button>
              <Button
                size="small"
                skin="premium"
                onClick={handleJoinPartner}
                disabled={isJoining}
              >
                {isJoining ? (
                  <Loader size="tiny" />
                ) : (
                  <>
                    <UserPlus size={16} /> בן/בת הזוג
                  </>
                )}
              </Button>
            </Box>
          </Box>
        ) : (
          <Button
            size="small"
            skin="light"
            onClick={() => setShowJoinForm(true)}
          >
            <>
              <UserPlus size={16} />{" "}
              <span style={{ marginRight: "8px" }}>הצטרפות לחשבון קיים</span>
            </>
          </Button>
        )}
      </Box>
    </Box>
  );

  return (
    <Modal isOpen={isOpen} onRequestClose={onClose} shouldCloseOnOverlayClick>
      <Box
        direction="vertical"
        gap="24px"
        padding="24px"
        backgroundColor="white"
      >
        <Heading size="medium">שיתוף פעולה עם בן/בת הזוג</Heading>

        {error && (
          <Box className="error-message">
            <Text size="small" skin="error">
              {error}
            </Text>
          </Box>
        )}

        {partnerInfo?.hasPartner
          ? renderLinkedPartnerView()
          : renderInviteView()}
      </Box>
    </Modal>
  );
};

export default PartnerModal;
