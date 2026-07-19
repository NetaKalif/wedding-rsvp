import { useState } from "react";
import { formFieldsData, validateGuestsInfo } from "./logic";
import {
  Box,
  Button,
  FormField,
  Input,
  NumberInput,
  SectionHelper,
  SidePanel,
} from "@wix/design-system";
import { EventGuest, Guest, User } from "../../types";
import React from "react";
import { httpRequests } from "../../httpClient";
import { useAppData } from "../../hooks/useAppData";

interface EditGuestModalProps {
  guest: EventGuest;
  primaryGuestsList: Guest[];
  setIsEditGuestModalOpen: (isOpen: boolean) => void;
  userID: User["userID"];
  eventId: number;
  onEventGuestsChange: (guests: EventGuest[]) => void;
}

const EditGuestModal: React.FC<EditGuestModalProps> = ({
  guest,
  primaryGuestsList,
  setIsEditGuestModalOpen,
  userID,
  eventId,
  onEventGuestsChange,
}) => {
  const { eventGuestsByEventId, updateEventGuests, setGuests } = useAppData();
  const [name, setName] = useState<string>(guest.name ?? "");
  const [numberOfGuests, setNumberOfGuests] = useState<number>(guest.number_of_guests ?? 0);
  const [phone, setPhone] = useState<string>(guest.phone ?? "");
  const [whose, setWhose] = useState<string>(guest.whose ?? "");
  const [circle, setCircle] = useState<string>(guest.circle ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const formFields = [
    {
      fieldId: formFieldsData["name"].fieldId,
      label: "שם",
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
      value: name,
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
      value: phone,
      mandatory: formFieldsData["phone"].mandatory,
      isEmpty: () => phone.length === 0,
    },
    {
      fieldId: formFieldsData["whose"].fieldId,
      label: "מוזמן ע״י",
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setWhose(e.target.value),
      value: whose,
      mandatory: formFieldsData["whose"].mandatory,
      isEmpty: () => whose.length === 0,
    },
    {
      fieldId: formFieldsData["circle"].fieldId,
      label: "מעגל",
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCircle(e.target.value),
      value: circle,
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
        />
      ),
      mandatory: formFieldsData["number_of_guests"].mandatory,
      isEmpty: () => numberOfGuests === 0,
    },
  ];

  const shouldSaveBeDisabled = () =>
    isSaving || formFields.some((field) => field.mandatory && field.isEmpty());

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Validate (including phone format + duplicate check) the same way as adding a new guest,
    // excluding this guest's own current record so an unchanged phone isn't flagged as a duplicate.
    const otherGuests = primaryGuestsList.filter((g) => g.id !== guest.guest_id);
    const { valid, rejected } = validateGuestsInfo(
      [{ name, phone, whose, circle, number_of_guests: numberOfGuests }],
      otherGuests
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
      return;
    }

    if (valid.length === 0 || !guest.guest_id) return;
    const [updatedFields] = valid;
    const guestId = guest.guest_id;

    setIsSaving(true);
    try {
      const updatedGuest = await httpRequests.updateGuest(userID, guestId, updatedFields);

      const currentGuests = eventGuestsByEventId[eventId] ?? [];
      const withUpdate = currentGuests.map((g) =>
        g.guest_id === guestId ? { ...g, ...updatedGuest } : g
      );
      updateEventGuests(eventId, withUpdate);
      onEventGuestsChange(withUpdate);
      setGuests((prev) => prev.map((g) => (g.id === guestId ? { ...g, ...updatedGuest } : g)));

      setIsEditGuestModalOpen(false);
    } catch (error) {
      console.error("Error updating guest:", error);
      setFormError("שגיאה בשמירת האורח. אנא נסה שוב.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SidePanel
      onCloseButtonClick={() => setIsEditGuestModalOpen(false)}
      skin="floating"
      height="auto"
    >
      <SidePanel.Header title="עריכת אורח" />
      <SidePanel.Content>
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
                <Input value={field.value} onChange={field.onChange} />
              )}
            </FormField>
          </div>
        ))}
        <Box align="space-between">
          <Button priority="secondary" onClick={() => setIsEditGuestModalOpen(false)}>
            ביטול
          </Button>
          <Button disabled={shouldSaveBeDisabled()} onClick={handleSave}>
            שמירה
          </Button>
        </Box>
      </SidePanel.Content>
    </SidePanel>
  );
};

export default EditGuestModal;
