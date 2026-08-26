import React, { useState } from "react";
import { Box, Button, Loader, SidePanel } from "@wix/design-system";
import { Event } from "../../types";
import { httpRequests } from "../../httpClient";
import EventFormFields, { EventFormValues, isEventFormValid } from "./EventFormFields";

interface EventEditModalProps {
  event: Event;
  onClose: () => void;
  onSaved: (updated: Event) => void;
}

const EventEditModal: React.FC<EventEditModalProps> = ({ event, onClose, onSaved }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | undefined>(undefined);
  const [form, setForm] = useState<EventFormValues>({
    ceremony_name: event.ceremony_name || "",
    date: event.date || "",
    time: event.time || "",
    location: event.location || "",
    additional_info: event.additional_info || "",
    waze_link: event.waze_link || "",
    gift_link: event.gift_link || "",
    send_reminder: event.send_reminder || false,
    reminder_day: event.reminder_day || "wedding_day",
    // TIME columns come back as "HH:MM:SS" — the time input wants "HH:MM"
    reminder_time: (event.reminder_time || "10:00").slice(0, 5),
  });

  const hasImage = Boolean(event.file_id) || Boolean(imageFile);
  const isFormValid = isEventFormValid(form, hasImage);

  const handleSave = async () => {
    if (!isFormValid) return;
    setIsSaving(true);
    try {
      const updated = await httpRequests.updateEvent(event.id, form, imageFile);
      onSaved(updated);
    } catch (err) {
      console.error(err);
      alert("שגיאה בשמירת האירוע");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SidePanel skin="floating" onCloseButtonClick={onClose} height="auto">
      <SidePanel.Header title={`עריכת אירוע — ${event.ceremony_name}`} />
      <SidePanel.Content>
        <Box direction="vertical" gap={3}>
          <EventFormFields
            form={form}
            onChange={(updates) => setForm((f) => ({ ...f, ...updates }))}
            imageFile={imageFile}
            onImageChange={setImageFile}
            hasExistingImage={Boolean(event.file_id)}
            eventId={event.id}
          />

          <Box direction="horizontal" gap={2} style={{ justifyContent: "flex-end" }}>
            <Button priority="secondary" onClick={onClose}>ביטול</Button>
            <Button onClick={handleSave} disabled={isSaving || !isFormValid}>
              {isSaving ? <Loader size="tiny" /> : "שמירה"}
            </Button>
          </Box>
        </Box>
      </SidePanel.Content>
    </SidePanel>
  );
};

export default EventEditModal;
