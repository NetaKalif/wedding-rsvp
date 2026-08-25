import React, { useEffect, useState } from "react";
import {
  AddItem,
  Box,
  Button,
  FieldSet,
  FileUpload,
  Image,
  Input,
  InputArea,
  Text,
} from "@wix/design-system";
import { UploadExport } from "@wix/wix-ui-icons-common";
import { httpRequests } from "../../httpClient";

// The single source of truth for an event's editable details — rendered by
// both CreateEventWizard (step 1) and EventEditModal so the two forms can't
// drift apart.

export interface EventFormValues {
  ceremony_name: string;
  date: string;
  time: string;
  location: string;
  additional_info: string;
  waze_link: string;
  gift_link: string;
}

export const emptyEventForm: EventFormValues = {
  ceremony_name: "",
  date: "",
  time: "",
  location: "",
  additional_info: "",
  waze_link: "",
  gift_link: "",
};

export const isEventFormValid = (form: EventFormValues, hasImage: boolean): boolean =>
  Boolean(form.ceremony_name.trim()) &&
  Boolean(form.date) &&
  Boolean(form.time) &&
  Boolean(form.location.trim()) &&
  hasImage;

interface EventFormFieldsProps {
  form: EventFormValues;
  onChange: (updates: Partial<EventFormValues>) => void;
  imageFile?: File;
  onImageChange: (file?: File) => void;
  // True when the event already has an uploaded invitation image, so picking
  // a new file is a replacement rather than a required first upload.
  hasExistingImage?: boolean;
  // Needed to fetch the existing image for preview when hasExistingImage.
  eventId?: number;
}

const EventFormFields: React.FC<EventFormFieldsProps> = ({
  form,
  onChange,
  imageFile,
  onImageChange,
  hasExistingImage = false,
  eventId,
}) => {
  const hasImage = hasExistingImage || Boolean(imageFile);
  const [previewUrl, setPreviewUrl] = useState("");

  useEffect(() => {
    if (!hasExistingImage || eventId == null) return;
    let cancelled = false;
    httpRequests.getEventImageUrl(eventId).then((resolvedUrl) => {
      if (!cancelled) setPreviewUrl(resolvedUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [hasExistingImage, eventId]);

  useEffect(() => {
    // jsdom doesn't implement createObjectURL — skip the preview there.
    if (imageFile && typeof URL.createObjectURL === "function") {
      const objectUrl = URL.createObjectURL(imageFile);
      setPreviewUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
  }, [imageFile]);

  const handleFiles = (files: File[] | FileList | null) => {
    if (files && files.length > 0) onImageChange(files[0]);
  };

  return (
    <Box direction="vertical" gap={3}>
      <FieldSet legend="שם הטקס *">
        <Input
          placeholder="לדוגמה: חינה, מסיבת רווקות..."
          value={form.ceremony_name}
          onChange={(e) => onChange({ ceremony_name: e.target.value })}
        />
      </FieldSet>

      <Box direction="horizontal" gap={2}>
        <FieldSet legend="תאריך *">
          <Input
            type="date"
            value={form.date}
            onChange={(e) => onChange({ date: e.target.value })}
          />
        </FieldSet>
        <FieldSet legend="שעה *">
          <Input
            type="time"
            value={form.time}
            onChange={(e) => onChange({ time: e.target.value })}
          />
        </FieldSet>
      </Box>

      <FieldSet legend="מיקום *">
        <Input
          placeholder="שם המקום"
          value={form.location}
          onChange={(e) => onChange({ location: e.target.value })}
        />
      </FieldSet>

      <FieldSet legend="תמונת הזמנה *">
        {previewUrl ? (
          <Box direction="vertical" gap={2}>
            <Image src={previewUrl} width="200px" />
            <FileUpload
              accept=".png, .jpeg, .jpg"
              multiple={false}
              onChange={handleFiles}
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
            accept=".png, .jpeg, .jpg"
            multiple={false}
            onChange={handleFiles}
          >
            {({ openFileUploadDialog }) => (
              <AddItem
                icon={<UploadExport />}
                size="small"
                subtitle="העלו תמונת הזמנה (חובה)"
                onClick={openFileUploadDialog}
              >
                העלאת מדיה
              </AddItem>
            )}
          </FileUpload>
        )}
        {imageFile && <Text size="small" secondary>{imageFile.name}</Text>}
        {!hasImage && <Text size="small" skin="error">חובה להעלות תמונת הזמנה</Text>}
      </FieldSet>

      <FieldSet legend="פרטים נוספים">
        <InputArea
          placeholder="מידע נוסף שיופיע בהזמנה..."
          rows={3}
          value={form.additional_info}
          onChange={(e) => onChange({ additional_info: e.target.value })}
        />
      </FieldSet>

      <FieldSet legend="קישור לוויז (אופציונלי)">
        <Input
          placeholder="הזינו קישור לוויז"
          value={form.waze_link}
          onChange={(e) => onChange({ waze_link: e.target.value })}
        />
      </FieldSet>

      <FieldSet legend="קישור למתנות באשראי (אופציונלי)">
        <Input
          placeholder="הזינו קישור למתנות באשראי"
          value={form.gift_link}
          onChange={(e) => onChange({ gift_link: e.target.value })}
        />
      </FieldSet>
    </Box>
  );
};

export default EventFormFields;
