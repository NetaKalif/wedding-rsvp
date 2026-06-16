import React, { useState } from "react";
import {
  Box,
  Text,
  Button,
  Input,
  FormField,
  Heading,
  Loader,
} from "@wix/design-system";
import { Heart } from "lucide-react";
import { httpRequests } from "../../httpClient";
import { Event, User } from "../../types";
import "./css/WeddingSetupModal.css";

interface WeddingSetupModalProps {
  userID: User["userID"];
  onComplete: () => void;
}

const WeddingSetupModal: React.FC<WeddingSetupModalProps> = ({
  userID,
  onComplete,
}) => {
  const [weddingDetails, setWeddingDetails] = useState<
    Pick<Event, "bride_name" | "groom_name" | "date" | "time" | "location">
  >({
    bride_name: "",
    groom_name: "",
    date: "2026-05-01",
    time: "10:00",
    location: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const validateForm = () => {
    const newErrors: Record<string, boolean> = {};
    if (!weddingDetails.bride_name?.trim()) newErrors.bride_name = true;
    if (!weddingDetails.groom_name?.trim()) newErrors.groom_name = true;
    if (!weddingDetails.date) newErrors.date = true;
    if (!weddingDetails.time) newErrors.time = true;
    if (!weddingDetails.location?.trim()) newErrors.location = true;

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      setIsSubmitting(true);
      const formData = new FormData();
      formData.append("userID", userID);

      await httpRequests.saveEventInfo(userID, {
        ...weddingDetails,
        is_primary: true,
        ceremony_name: "חתונה",
        additional_info: "",
        waze_link: "",
        gift_link: "",
        thank_you_message: "",
        reminder_day: "day_before",
        reminder_time: "10:00",
      } as Partial<Event>);
      onComplete();
    } catch (error) {
      console.error("Error saving wedding information:", error);
      alert("אירעה שגיאה. אנא נסו שנית.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="wedding-setup-overlay">
      <div className="wedding-setup-modal" dir="rtl">
        <Box direction="vertical" gap="24px" align="center">
          <Box direction="vertical" gap="8px" align="center">
            <Heart className="setup-heart-icon" size={48} />
            <Heading size="medium">
              ברוכים הבאים! בואו נגדיר את החתונה שלכם
            </Heading>
            <Text size="small" secondary>
              אנא מלאו את הפרטים הבסיסיים כדי להתחיל
            </Text>
          </Box>

          <Box direction="vertical" gap="16px" width="100%">
            <Box gap="16px">
              <Box direction="vertical" width="50%">
                <FormField
                  label="שם הכלה"
                  required
                  status={errors.bride_name ? "error" : undefined}
                  statusMessage={errors.bride_name ? "שדה חובה" : undefined}
                >
                  <Input
                    value={weddingDetails.bride_name}
                    onChange={(e) => {
                      setWeddingDetails((prev) => ({
                        ...prev,
                        bride_name: e.target.value,
                      }));
                      setErrors((prev) => ({ ...prev, bride_name: false }));
                    }}
                    placeholder="הכניסו את שם הכלה"
                    status={errors.bride_name ? "error" : undefined}
                  />
                </FormField>
              </Box>
              <Box direction="vertical" width="50%">
                <FormField
                  label="שם החתן"
                  required
                  status={errors.groom_name ? "error" : undefined}
                  statusMessage={errors.groom_name ? "שדה חובה" : undefined}
                >
                  <Input
                    value={weddingDetails.groom_name}
                    onChange={(e) => {
                      setWeddingDetails((prev) => ({
                        ...prev,
                        groom_name: e.target.value,
                      }));
                      setErrors((prev) => ({ ...prev, groom_name: false }));
                    }}
                    placeholder="הכניסו את שם החתן"
                    status={errors.groom_name ? "error" : undefined}
                  />
                </FormField>
              </Box>
            </Box>

            <FormField
              label="מקום החתונה"
              required
              status={errors.location ? "error" : undefined}
              statusMessage={errors.location ? "שדה חובה" : undefined}
            >
              <Input
                value={weddingDetails.location}
                onChange={(e) => {
                  setWeddingDetails((prev) => ({
                    ...prev,
                    location: e.target.value,
                  }));
                  setErrors((prev) => ({ ...prev, location: false }));
                }}
                placeholder="הכניסו את מקום החתונה"
                status={errors.location ? "error" : undefined}
              />
            </FormField>

            <Box gap="16px">
              <Box direction="vertical" width="50%">
                <FormField
                  label="תאריך החתונה"
                  required
                  status={errors.date ? "error" : undefined}
                  statusMessage={errors.date ? "שדה חובה" : undefined}
                >
                  <Input
                    type="date"
                    value={weddingDetails.date}
                    onChange={(e) => {
                      setWeddingDetails((prev) => ({
                        ...prev,
                        date: e.target.value,
                      }));
                      setErrors((prev) => ({ ...prev, date: false }));
                    }}
                    status={errors.date ? "error" : undefined}
                  />
                </FormField>
              </Box>
              <Box direction="vertical" width="50%">
                <FormField
                  label="שעת החתונה"
                  required
                  status={errors.time ? "error" : undefined}
                  statusMessage={errors.time ? "שדה חובה" : undefined}
                >
                  <Input
                    type="time"
                    value={weddingDetails.time}
                    onChange={(e) => {
                      setWeddingDetails((prev) => ({
                        ...prev,
                        time: e.target.value,
                      }));
                      setErrors((prev) => ({ ...prev, hour: false }));
                    }}
                    status={errors.time ? "error" : undefined}
                  />
                </FormField>
              </Box>
            </Box>
          </Box>

          <Box width="100%">
            <Button
              size="large"
              onClick={handleSubmit}
              disabled={isSubmitting}
              fullWidth
            >
              {isSubmitting ? <Loader size="tiny" /> : "בואו נתחיל"}
            </Button>
          </Box>

          <Text size="tiny" secondary className="setup-note">
            תוכלו לעדכן פרטים אלו ולהוסיף מידע נוסף בהמשך
          </Text>
        </Box>
      </div>
    </div>
  );
};

export default WeddingSetupModal;
