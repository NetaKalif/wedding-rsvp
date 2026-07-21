import React, { useCallback, useEffect, useState } from "react";
import "./css/InfoModal.css";
import "./css/WhatsAppMessage.css";
import { httpRequests } from "../../httpClient";
import EmojiPicker from "emoji-picker-react";
import {
  FormField,
  SidePanel,
  Box,
  Text,
  Button,
  Input,
  InputArea,
  FileUpload,
  AddItem,
  IconButton,
  Popover,
  Loader,
  Image,
  RadioGroup,
  SectionHelper,
} from "@wix/design-system";
import { Event } from "../../types";
import { UploadExport } from "@wix/wix-ui-icons-common";
import { Smile } from "@wix/wix-ui-icons-common";
import WhatsAppPreview from "./WhatsAppPreview";
import { useAuth } from "../../hooks/useAuth";

interface InfoModalProps {
  isOpen: boolean;
  setIsInfoModalOpen: (value: boolean) => void;
}

const InfoModal: React.FC<InfoModalProps> = ({ isOpen, setIsInfoModalOpen }) => {
  const {
    user,
    weddingInfo: contextWeddingInfo,
    refreshWeddingInfo,
  } = useAuth();
  const [eventDetails, setEventDetails] = useState<Partial<Event>>({
    bride_name: "",
    groom_name: "",
    date: "2025-01-01",
    time: "",
    location: "",
    additional_info: "",
    waze_link: "",
    gift_link: "",
    thank_you_message: "",
    file_id: "",
    reminder_day: "day_before",
    reminder_time: "10:00",
  });
  const [file, setFile] = useState<File | undefined>(undefined);
  const [showEmojiPicker, setShowEmojiPicker] = useState({
    additionalInfo: false,
    thankYou: false,
  });
  const [imageUrl, setImageUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Initialize form with data from context
  useEffect(() => {
    if (contextWeddingInfo) {
      setEventDetails((prev) => ({ ...prev, ...contextWeddingInfo }));
    }
  }, [contextWeddingInfo]);

  useEffect(() => {
    if (!isOpen || !contextWeddingInfo?.file_id) return;
    let cancelled = false;
    httpRequests.getPrimaryImageUrl().then((resolvedUrl) => {
      if (!cancelled) setImageUrl(resolvedUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, contextWeddingInfo?.file_id]);

  const getPreviewImageUrl = useCallback(() => httpRequests.getPrimaryImageUrl(), []);

  useEffect(() => {
    if (file) {
      const objectUrl = URL.createObjectURL(file);
      setImageUrl(objectUrl);

      // 🧹 Clean up the object URL when component unmounts or file changes
      return () => URL.revokeObjectURL(objectUrl);
    }
  }, [file]);

  const onEmojiClick = (
    field: "additional_info" | "thank_you_message",
    emojiData: any
  ) => {
    setEventDetails((prev) => ({
      ...prev,
      [field]: (prev[field] ?? "") + emojiData.emoji,
    }));
  };

  const handleSend = async () => {
    if (!user) return;

    // Validate all required fields
    if (
      !eventDetails.bride_name ||
      !eventDetails.groom_name ||
      !eventDetails.date ||
      !eventDetails.time ||
      !eventDetails.location ||
      !eventDetails.waze_link ||
      (!file && !imageUrl)
    ) {
      setFormError("אנא מלאו את כל השדות הנדרשים והעלו תמונת הזמנה");
      return;
    }

    setFormError(null);
    try {
      setIsSubmitting(true);
      await httpRequests.saveEventInfo(eventDetails, file);
      await refreshWeddingInfo();
      setIsInfoModalOpen(false);
    } catch (error) {
      console.error("Error saving wedding information:", error);
      setFormError("אירעה שגיאה. אנא נסו שנית.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SidePanel
      skin="floating"
      onCloseButtonClick={() => setIsInfoModalOpen(false)}
      // height={"800px"}
      // width={"800px"}
    >
      <SidePanel.Header title="פרטי החתונה והודעות" />
      <SidePanel.Content>
        <Box direction="vertical" gap={4}>
          {/* Basic Wedding Information */}

          <Box direction="vertical" gap={4} width="100%">
            <FormField label="שם הכלה" required>
              <div dir="rtl">
                <Input
                  value={eventDetails.bride_name}
                  onChange={(e) =>
                    setEventDetails((prev) => ({
                      ...prev,
                      bride_name: e.target.value,
                    }))
                  }
                  placeholder="הכניסו את שם הכלה"
                />
              </div>
            </FormField>
            <FormField label="שם החתן" required>
              <div dir="rtl">
                <Input
                  value={eventDetails.groom_name}
                  onChange={(e) =>
                    setEventDetails((prev) => ({
                      ...prev,
                      groom_name: e.target.value,
                    }))
                  }
                  placeholder="הכניסו את שם החתן"
                />
              </div>
            </FormField>
            <FormField label="תאריך החתונה" required>
              <Input
                type="date"
                onChange={(e) => {
                  setEventDetails((prev) => ({
                    ...prev,
                    date: e.target.value,
                  }));
                }}
                value={eventDetails.date}
                size="large"
              />
            </FormField>
            <FormField label="שעת החתונה" required>
              <Input
                type="time"
                value={eventDetails.time}
                onChange={(e) =>
                  setEventDetails((prev) => ({
                    ...prev,
                    time: e.target.value,
                  }))
                }
              />
            </FormField>
            <FormField label="הגדרות תזכורת">
              <Box direction="vertical" gap={2}>
                <Text size="small" secondary>
                  בחרו מתי לשלוח תזכורת אוטומטית לאורחים שאישרו
                </Text>
                <RadioGroup
                  value={eventDetails.reminder_day || "day_before"}
                  onChange={(value) =>
                    setEventDetails((prev) => ({
                      ...prev,
                      reminder_day: value as "day_before" | "wedding_day",
                    }))
                  }
                >
                  <RadioGroup.Radio value="day_before">
                    יום לפני החתונה
                  </RadioGroup.Radio>
                  <RadioGroup.Radio value="wedding_day">
                    יום החתונה
                  </RadioGroup.Radio>
                </RadioGroup>
                <FormField label="שעת התזכורת">
                  <Input
                    type="time"
                    value={eventDetails.reminder_time || "10:00"}
                    onChange={(e) =>
                      setEventDetails((prev) => ({
                        ...prev,
                        reminder_time: e.target.value,
                      }))
                    }
                  />
                </FormField>
              </Box>
            </FormField>
            <FormField label="שם המקום" required>
              <div dir="rtl">
                <Input
                  value={eventDetails.location}
                  onChange={(e) =>
                    setEventDetails((prev) => ({
                      ...prev,
                      location: e.target.value,
                    }))
                  }
                  placeholder="הכניסו את מיקום החתונה"
                />
              </div>
            </FormField>
            <FormField label="הזמנה לחתונה" required>
              {imageUrl ? (
                <Box direction="vertical" gap={2}>
                  <Image src={imageUrl} width={"200px"} />
                  <FileUpload
                    accept=".png, .jpeg, .jpg"
                    multiple={false}
                    onChange={(files) => {
                      if (files) {
                        setFile(files[0]);
                      }
                    }}
                  >
                    {({ openFileUploadDialog }) => (
                      <Button skin="light" onClick={openFileUploadDialog}>
                        <UploadExport />
                        <span style={{ marginRight: "8px" }}>החלפת הזמנה</span>
                      </Button>
                    )}
                  </FileUpload>
                </Box>
              ) : (
                <FileUpload
                  multiple={false}
                  accept=".png, .jpeg, .JPG"
                  onChange={(files) => {
                    if (files) {
                      setFile(files[0]);
                    }
                  }}
                >
                  {({ openFileUploadDialog }) => (
                    <AddItem
                      icon={<UploadExport />}
                      size="small"
                      subtitle={
                        file
                          ? "החלפת תמונת הזמנה"
                          : "העלו את הזמנת החתונה שלכם (חובה)"
                      }
                      onClick={openFileUploadDialog}
                    >
                      {file ? "החלפת מדיה" : "העלאת מדיה"}
                    </AddItem>
                  )}
                </FileUpload>
              )}
              {file && (
                <Box gap={2} marginTop={2}>
                  <Text secondary>{file.name}</Text>
                </Box>
              )}
            </FormField>

            <FormField label="מידע נוסף">
              <Box direction="vertical" gap={1}>
                <div dir="rtl">
                  <InputArea
                    value={eventDetails.additional_info}
                    onChange={(e) =>
                      setEventDetails((prev) => ({
                        ...prev,
                        additional_info: e.target.value.replace(
                          /\n/g,
                          " "
                        ),
                      }))
                    }
                    placeholder="הזינו מידע נוסף להודעת אישור ההגעה (שורה אחת בלבד). לדוגמה: קישור לקבוצת וואטסאפ של ההסעה"
                    rows={3}
                  />
                </div>
                <Popover
                  shown={showEmojiPicker.additionalInfo}
                  placement="top"
                  onClickOutside={() =>
                    setShowEmojiPicker((prev) => ({
                      ...prev,
                      additionalInfo: false,
                    }))
                  }
                >
                  <Popover.Element>
                    <IconButton
                      size="small"
                      onClick={() =>
                        setShowEmojiPicker((prev) => ({
                          ...prev,
                          additionalInfo: !prev.additionalInfo,
                        }))
                      }
                    >
                      <Smile />
                    </IconButton>
                  </Popover.Element>
                  <Popover.Content>
                    <Box width="350px">
                      <EmojiPicker
                        onEmojiClick={(emojiData) =>
                          onEmojiClick("additional_info", emojiData)
                        }
                        width="100%"
                      />
                    </Box>
                  </Popover.Content>
                </Popover>
              </Box>
            </FormField>
            <FormField label="הודעת תודה מותאמת אישית">
              <Box direction="vertical" gap={1}>
                <div dir="rtl">
                  <InputArea
                    value={eventDetails.thank_you_message}
                    onChange={(e) =>
                      setEventDetails((prev) => ({
                        ...prev,
                        thank_you_message: e.target.value,
                      }))
                    }
                    placeholder="הזינו הודעת תודה מותאמת אישית (אופציונלי). אם ריק, תישלח הודעה ברירת מחדל."
                    rows={3}
                  />
                </div>
                <Popover
                  shown={showEmojiPicker.thankYou}
                  placement="top"
                  onClickOutside={() =>
                    setShowEmojiPicker((prev) => ({
                      ...prev,
                      thankYou: false,
                    }))
                  }
                >
                  <Popover.Element>
                    <IconButton
                      size="small"
                      onClick={() =>
                        setShowEmojiPicker((prev) => ({
                          ...prev,
                          thankYou: !prev.thankYou,
                        }))
                      }
                    >
                      <Smile />
                    </IconButton>
                  </Popover.Element>
                  <Popover.Content>
                    <Box width="350px">
                      <EmojiPicker
                        onEmojiClick={(emojiData) =>
                          onEmojiClick("thank_you_message", emojiData)
                        }
                        width="100%"
                      />
                    </Box>
                  </Popover.Content>
                </Popover>
              </Box>
            </FormField>
            <FormField label="קישור לוויז" required>
              <Input
                value={eventDetails.waze_link}
                onChange={(e) =>
                  setEventDetails((prev) => ({
                    ...prev,
                    waze_link: e.target.value,
                  }))
                }
                placeholder="הזינו קישור לוויז"
              />
            </FormField>
            <FormField label=" קישור למתנות באשראי">
              <Input
                value={eventDetails.gift_link}
                onChange={(e) =>
                  setEventDetails((prev) => ({
                    ...prev,
                    gift_link: e.target.value,
                  }))
                }
                placeholder="הזינו קישור למתנות באשראי"
              />
            </FormField>
          </Box>

          {/* Message Previews */}
          <WhatsAppPreview
            event={eventDetails as Event}
            getImageUrl={getPreviewImageUrl}
            showAllMessages={true}
          />

          {file && isSubmitting && (
            <Box>
              <Text>העלאת תמונת ההזמנה עשויה לקחת מספר רגעים.</Text>
            </Box>
          )}
          {/* Action Buttons */}
          <Box align="space-between">
            <Button size="small" onClick={handleSend} disabled={isSubmitting}>
              {isSubmitting ? <Loader size="tiny" /> : "שמירה"}
            </Button>
            <Button
              priority="secondary"
              size="small"
              onClick={() => setIsInfoModalOpen(false)}
            >
              ביטול
            </Button>
          </Box>
          {formError && (
            <Box paddingTop="8px">
              <SectionHelper skin="danger">{formError}</SectionHelper>
            </Box>
          )}
        </Box>
      </SidePanel.Content>
    </SidePanel>
  );
};

export default InfoModal;
