import React, { useState } from "react";
import { Box, Button, FieldSet, Input, InputArea, Loader, SidePanel, Text } from "@wix/design-system";
import { Event } from "../../types";

interface EventEditModalProps {
  event: Event;
  userID: string;
  onClose: () => void;
  onSaved: (updated: Event) => void;
}

const EventEditModal: React.FC<EventEditModalProps> = ({ event, userID, onClose, onSaved }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | undefined>(undefined);
  const [form, setForm] = useState({
    ceremony_name: event.ceremony_name || "",
    date: event.date || "",
    time: event.time || "",
    location: event.location || "",
    additional_info: event.additional_info || "",
  });

  const handleSave = async () => {
    if (!form.ceremony_name.trim()) return;
    setIsSaving(true);
    try {
      // createEvent with is_primary=false is used for updates via the general event endpoint
      // We use saveEventInfo if is_primary, otherwise updateEvent via createEvent API pattern
      // For non-primary events we use the PATCH /events/:id indirectly via saveEventInfo
      // Actually we'll just re-use the same createEvent flow but we need a PATCH endpoint
      // For now, delete + recreate guests approach is too destructive
      // The server has updateEvent — let's call it directly
      const response = await fetch(
        `${process.env.REACT_APP_SERVER_URL}/events/${event.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...form, userID }),
        }
      );
      if (!response.ok) throw new Error(await response.text());
      const updated: Event = await response.json();

      // Upload new image if provided
      if (imageFile) {
        const formData = new FormData();
        formData.append("userID", userID);
        formData.append("image", imageFile);
        const imgRes = await fetch(`${process.env.REACT_APP_SERVER_URL}/events/${event.id}/image`, {
          method: "POST",
          body: formData,
        });
        if (imgRes.ok) {
          const { file_id } = await imgRes.json();
          onSaved({ ...updated, file_id });
          return;
        }
      }
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
          <FieldSet legend="שם הטקס *">
            <Input
              value={form.ceremony_name}
              onChange={(e) => setForm((f) => ({ ...f, ceremony_name: e.target.value }))}
            />
          </FieldSet>

          <Box direction="horizontal" gap={2}>
            <FieldSet legend="תאריך">
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </FieldSet>
            <FieldSet legend="שעה">
              <Input
                type="time"
                value={form.time}
                onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
              />
            </FieldSet>
          </Box>

          <FieldSet legend="מיקום">
            <Input
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
            />
          </FieldSet>

          <FieldSet legend="פרטים נוספים">
            <InputArea
              rows={3}
              value={form.additional_info}
              onChange={(e) => setForm((f) => ({ ...f, additional_info: e.target.value }))}
            />
          </FieldSet>

          <FieldSet legend="תמונת הזמנה חדשה (אופציונלי)">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setImageFile(e.target.files?.[0])}
            />
            {imageFile && <Text size="small" secondary>{imageFile.name}</Text>}
          </FieldSet>

          <Box direction="horizontal" gap={2} style={{ justifyContent: "flex-end" }}>
            <Button priority="secondary" onClick={onClose}>ביטול</Button>
            <Button onClick={handleSave} disabled={isSaving || !form.ceremony_name.trim()}>
              {isSaving ? <Loader size="tiny" /> : "שמירה"}
            </Button>
          </Box>
        </Box>
      </SidePanel.Content>
    </SidePanel>
  );
};

export default EventEditModal;
