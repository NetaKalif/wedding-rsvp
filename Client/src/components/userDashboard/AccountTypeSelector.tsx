import React, { useState } from "react";
import { Box, Text, Button, Input, Heading, Loader } from "@wix/design-system";
import { Heart, UserPlus, Users, X } from "lucide-react";
import { User } from "../../types";
import { httpRequests } from "../../httpClient";
import "./css/AccountTypeSelector.css";

interface AccountTypeSelectorProps {
  user: User;
  onCreateNew: () => void;
  onJoinSuccess: () => void;
  onCancel: () => void;
}

const AccountTypeSelector: React.FC<AccountTypeSelectorProps> = ({
  user,
  onCreateNew,
  onJoinSuccess,
  onCancel,
}) => {
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [error, setError] = useState("");

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
        onJoinSuccess();
      } else {
        setError(result.error || "ההצטרפות לבן/בת הזוג נכשלה");
      }
    } catch (err: any) {
      setError(err.message || "ההצטרפות לבן/בת הזוג נכשלה");
    } finally {
      setIsJoining(false);
    }
  };

  if (showJoinForm) {
    return (
      <div className="account-selector-overlay">
        <div className="account-selector-modal" dir="rtl">
          <button className="selector-close-button" onClick={onCancel}>
            <X size={20} />
          </button>
          <Box direction="vertical" gap="24px" align="center">
            <Box direction="vertical" gap="8px" align="center">
              <Users className="selector-icon join" size={48} />
              <Heading size="medium">הצטרפות לחשבון בן/בת הזוג</Heading>
              <Text size="small" secondary className="selector-subtitle">
                הכניסו את קוד ההזמנה שבן/בת הזוג שיתפו איתכם
              </Text>
            </Box>

            {error && (
              <Box className="error-message" width="100%">
                <Text size="small" skin="error">
                  {error}
                </Text>
              </Box>
            )}

            <Box direction="vertical" gap="16px" width="100%">
              <Input
                size="large"
                placeholder="הכניסו קוד הזמנה"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                maxLength={8}
                className="join-code-input"
              />

              <Box gap="12px" width="100%">
                <Button
                  size="large"
                  skin="light"
                  onClick={() => {
                    setShowJoinForm(false);
                    setJoinCode("");
                    setError("");
                  }}
                  fullWidth
                >
                  חזרה
                </Button>
                <Button
                  size="large"
                  onClick={handleJoinPartner}
                  disabled={isJoining || !joinCode.trim()}
                  fullWidth
                >
                  {isJoining ? <Loader size="tiny" /> : "הצטרפות לחשבון"}
                </Button>
              </Box>
            </Box>

            <Text size="tiny" secondary className="selector-note">
              תהיה לכם גישה לכל נתוני החתונה של בן/בת הזוג
            </Text>
          </Box>
        </div>
      </div>
    );
  }

  return (
    <div className="account-selector-overlay">
      <div className="account-selector-modal" dir="rtl">
        <button className="selector-close-button" onClick={onCancel}>
          <X size={20} />
        </button>
        <Box direction="vertical" gap="32px" align="center">
          <Box direction="vertical" gap="8px" align="center">
            <Heart className="selector-heart-icon" size={48} />
            <Heading size="medium">ברוכים הבאים למסע לחתונה שלכם!</Heading>
            <Text size="small" secondary className="selector-subtitle">
              איך תרצו להתחיל?
            </Text>
          </Box>

          <Box direction="vertical" gap="16px" width="100%">
            <button
              className="account-option-card create-new"
              onClick={onCreateNew}
            >
              <Box className="option-icon-box create">
                <UserPlus size={28} />
              </Box>
              <Box direction="vertical" gap="4px" align="right">
                <Text size="medium" weight="bold">
                  יצירת חתונה חדשה
                </Text>
                <Text size="small" secondary>
                  התחילו מחדש והגדירו את פרטי החתונה שלכם
                </Text>
              </Box>
            </button>

            <button
              className="account-option-card join-existing"
              onClick={() => setShowJoinForm(true)}
            >
              <Box className="option-icon-box join">
                <Users size={28} />
              </Box>
              <Box direction="vertical" gap="4px" align="right">
                <Text size="medium" weight="bold">
                  הצטרפות לחשבון בן/בת הזוג
                </Text>
                <Text size="small" secondary>
                  התחברו לחתונה הקיימת של בן/בת הזוג
                </Text>
              </Box>
            </button>
          </Box>

          <Text size="tiny" secondary className="selector-note">
            תוכלו תמיד להזמין את בן/בת הזוג מאוחר יותר אם תיצרו חשבון חדש
          </Text>
        </Box>
      </div>
    </div>
  );
};

export default AccountTypeSelector;
