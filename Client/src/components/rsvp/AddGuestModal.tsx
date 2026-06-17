import { useState } from "react";
import "./css/AddGuestModal.css";
import {
  formFieldsData,
  handleEmptyTableTemplate,
  handleImport,
  validateGuestsInfo,
  downloadRejectedGuests,
  RejectedGuest,
} from "./logic";
import {
  AddItem,
  Box,
  Button,
  FileUpload,
  FormField,
  Input,
  Loader,
  SectionHelper,
  SidePanel,
  Tabs,
  Text,
  NumberInput,
  IconButton,
} from "@wix/design-system";
import { EventGuest, Guest, User } from "../../types";
import React from "react";
import { httpRequests } from "../../httpClient";
import { useAppData } from "../../hooks/useAppData";
import { Attachment, UploadExport } from "@wix/wix-ui-icons-common";
import { DocDownload } from "@wix/wix-ui-icons-common";
import { Download } from "lucide-react";

interface AddGuestModalProps {
  primaryGuestsList: Guest[];
  setIsAddGuestModalOpen: (isOpen: boolean) => void;
  userID: User["userID"];
  eventId: number;
  onEventGuestsChange: (guests: EventGuest[]) => void;
}

const AddGuestModal: React.FC<AddGuestModalProps> = ({
  primaryGuestsList,
  setIsAddGuestModalOpen,
  userID,
  eventId,
  onEventGuestsChange,
}) => {
  const { eventGuestsByEventId, updateEventGuests } = useAppData();
  const [name, setName] = useState<string>("");
  const [numberOfGuests, setNumberOfGuests] = useState<number>(0);
  const [phone, setPhone] = useState<string>("");
  const [whose, setWhose] = useState<string>("");
  const [circle, setCircle] = useState<string>("");
  const [activeTabId, setActiveTabId] = useState<string>("1");
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{
    addedCount: number;
    rejectedGuests: RejectedGuest[];
  } | null>(null);

  const formFields = [
    {
      fieldId: formFieldsData["name"].fieldId,
      label: "שם",
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
      placeholder: "נטע כליף",
      mandatory: formFieldsData["name"].mandatory,
      isEmpty: () => name.length === 0,
    },
    {
      fieldId: formFieldsData["phone"].fieldId,
      label: "טלפון",
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        setPhone(e.target.value);
        setFormError(null);
      },
      placeholder: "0545541120",
      mandatory: formFieldsData["phone"].mandatory,
      isEmpty: () => phone.length === 0,
    },
    {
      fieldId: formFieldsData["whose"].fieldId,
      label: "מוזמן ע״י",
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setWhose(e.target.value),
      placeholder: "כלה",
      mandatory: formFieldsData["whose"].mandatory,
      isEmpty: () => whose.length === 0,
    },
    {
      fieldId: formFieldsData["circle"].fieldId,
      label: "מעגל",
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCircle(e.target.value),
      placeholder: "חברים מהצבא",
      mandatory: formFieldsData["circle"].mandatory,
      isEmpty: () => circle.length === 0,
    },
    {
      fieldId: formFieldsData["number_of_guests"].fieldId,
      label: "מספר אורחים",
      component: (
        <NumberInput
          value={numberOfGuests}
          onChange={(value) => setNumberOfGuests(value ?? 0)}
          min={0}
          placeholder="2"
        />
      ),
      mandatory: formFieldsData["number_of_guests"].mandatory,
      isEmpty: () => numberOfGuests === 0,
    },
  ];

  const shouldAddGuestBeDisabled = () =>
    formFields.some((field) => field.mandatory && field.isEmpty());

  // ── Case 1 & 2: single guest manual entry ─────────────────────────────────
  const handleSubmitManually = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const { valid, rejected } = validateGuestsInfo(
      [{ name, phone, whose, circle, number_of_guests: numberOfGuests }],
      primaryGuestsList
    );

    if (rejected.length > 0) {
      const r = rejected[0];
      if (r.reason === "invalid_phone") {
        setFormError("מספר הטלפון שהוזן אינו תקין. אנא בדוק ונסה שוב.");
      } else if (r.reason === "duplicate_phone") {
        setFormError("מספר הטלפון כבר קשור לאורח קיים ברשימה.");
      } else {
        setFormError(r.reasonHe);
      }
      return; // keep modal open with existing form data
    }

    if (valid.length === 0) return;
    const [goodGuest] = valid;

    // Optimistic: show guest immediately with a temp ID
    const tempId = -(performance.now() | 0);
    const tempGuest: EventGuest = {
      id: tempId,
      event_id: eventId,
      guest_id: tempId,
      rsvp_status: null,
      last_rsvp_sent_at: undefined,
      name: goodGuest.name,
      phone: goodGuest.phone,
      whose: goodGuest.whose,
      circle: goodGuest.circle,
      number_of_guests: goodGuest.number_of_guests,
      user_id: userID,
    };
    const currentGuests = eventGuestsByEventId[eventId] ?? [];
    const withTemp = [...currentGuests, tempGuest];
    updateEventGuests(eventId, withTemp);
    onEventGuestsChange(withTemp);

    setIsAddGuestModalOpen(false);

    // Background sync — replace temp guest with real server data
    const newGuests = await httpRequests.addGuests(userID, valid);
    const newGuestIds = newGuests.map((g) => g.id).filter((id): id is number => id != null);
    if (newGuestIds.length > 0) {
      await httpRequests.setEventGuests(userID, eventId, newGuestIds);
    }
    const updatedEventGuests = await httpRequests.getEventGuests(userID, eventId);
    onEventGuestsChange(updatedEventGuests);
  };

  // ── Case 3: bulk file upload ───────────────────────────────────────────────
  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setIsUploading(true);
    const wrappedSetGuestsList = async (updatedGuests: Guest[] | ((prev: Guest[]) => Guest[])) => {
      const resolved = typeof updatedGuests === "function"
        ? updatedGuests(primaryGuestsList)
        : updatedGuests;
      const existingIds = new Set(primaryGuestsList.map((g) => g.id).filter(Boolean));
      const newIds = resolved
        .map((g) => g.id)
        .filter((id): id is number => id != null && !existingIds.has(id));
      if (newIds.length > 0) {
        await httpRequests.setEventGuests(userID, eventId, newIds);
      }
      const updatedEventGuests = await httpRequests.getEventGuests(userID, eventId);
      onEventGuestsChange(updatedEventGuests);
    };

    const { rejected, addedCount, fileError: importFileError } = await handleImport(userID, file, primaryGuestsList, wrappedSetGuestsList);
    setIsUploading(false);

    if (importFileError) {
      setFileError(importFileError);
    } else if (rejected.length > 0) {
      await downloadRejectedGuests(rejected);
      setUploadResult({ addedCount, rejectedGuests: rejected });
    } else {
      setIsAddGuestModalOpen(false);
    }
  };

  return (
    <SidePanel
      onCloseButtonClick={() => setIsAddGuestModalOpen(false)}
      skin="floating"
      height={"auto"}
    >
      <SidePanel.Header title="הוספת אורח">
        <Tabs
          items={[
            { id: "1", title: "מילוי ידני" },
            { id: "2", title: "העלאת קובץ" },
          ]}
          activeId={activeTabId}
          type="uniformSide"
          minWidth={100}
          width="100%"
          onClick={(tab) => { setActiveTabId("" + tab.id); setFormError(null); setFileError(null); setUploadResult(null); }}
        />
      </SidePanel.Header>

      <SidePanel.Content>
        {/* ── Tab 1: manual entry ── */}
        {activeTabId === "1" && (
          <>
            {formError && (
              <Box paddingBottom="8px">
                <SectionHelper skin="danger">{formError}</SectionHelper>
              </Box>
            )}
            {formFields.map((field) => (
              <div style={{ padding: "6px 0px" }} key={field.fieldId}>
                <FormField
                  labelPlacement="top"
                  label={field.mandatory ? "*  " + field.label : field.label}
                  id={"" + field.fieldId}
                >
                  {field.component || (
                    <Input onChange={field.onChange} placeholder={field.placeholder} />
                  )}
                </FormField>
              </div>
            ))}
            <Box align="space-between">
              <Button priority="secondary" onClick={() => setIsAddGuestModalOpen(false)}>
                ביטול
              </Button>
              <Button disabled={shouldAddGuestBeDisabled()} onClick={handleSubmitManually}>
                הוספת אורח
              </Button>
            </Box>
          </>
        )}

        {/* ── Tab 2: file upload ── */}
        {activeTabId === "2" && (
          <Box direction="vertical" gap={10}>
            {/* Result view after upload with rejections */}
            {uploadResult ? (
              <Box direction="vertical" gap={3}>
                {uploadResult.addedCount > 0 && (
                  <SectionHelper skin="success">
                    {uploadResult.addedCount} אורחים נוספו בהצלחה.
                  </SectionHelper>
                )}
                <SectionHelper skin="warning">
                  {uploadResult.rejectedGuests.length} אורחים לא נוספו. קובץ עם הפרטים הורד אוטומטית.
                </SectionHelper>
                <Box direction="vertical" gap={1} style={{ maxHeight: 180, overflowY: "auto" }}>
                  {uploadResult.rejectedGuests.map((r: RejectedGuest, i: number) => (
                    <Text size="small" key={i} secondary>
                      {r.guest.name} — {r.reasonHe}
                    </Text>
                  ))}
                </Box>
                <Box align="space-between">
                  <Button
                    priority="secondary"
                    prefixIcon={<Download size={14} />}
                    onClick={() => downloadRejectedGuests(uploadResult.rejectedGuests)}
                  >
                    הורד שוב
                  </Button>
                  <Button onClick={() => setIsAddGuestModalOpen(false)}>סגור</Button>
                </Box>
              </Box>
            ) : (
              <>
                {fileError && (
                  <Box paddingBottom="8px">
                    <SectionHelper skin="danger">{fileError}</SectionHelper>
                  </Box>
                )}
                <FileUpload
                  multiple={false}
                  accept=".xlsx, .xls"
                  onChange={(files) => { if (files) { setFile(files[0]); setFileError(null); } }}
                >
                  {({ openFileUploadDialog }) => (
                    <AddItem
                      icon={<UploadExport />}
                      size="small"
                      subtitle={file ? "החלפת קובץ" : "העלו קובץ אקסל עם רשימת האורחים שלכם"}
                      onClick={openFileUploadDialog}
                    >
                      {file ? "החלפת קובץ" : "העלאת קובץ"}
                    </AddItem>
                  )}
                </FileUpload>
                <Box direction="horizontal" gap={2} verticalAlign="middle">
                  <IconButton skin="standard" priority="secondary" onClick={handleEmptyTableTemplate}>
                    <DocDownload />
                  </IconButton>
                  <Text size="small">הורדת תבנית טבלה ריקה</Text>
                </Box>
                {file && (
                  <Box gap={2}>
                    <Text secondary>
                      <Attachment />
                      {file.name}
                    </Text>
                  </Box>
                )}
                <Box align="space-between">
                  <Button priority="secondary" onClick={() => setIsAddGuestModalOpen(false)}>
                    ביטול
                  </Button>
                  <Button onClick={handleFileUpload} disabled={!file || isUploading}>
                    {isUploading ? <Loader size="tiny" /> : "הוספת אורחים"}
                  </Button>
                </Box>
              </>
            )}
          </Box>
        )}
      </SidePanel.Content>
    </SidePanel>
  );
};

export default AddGuestModal;
