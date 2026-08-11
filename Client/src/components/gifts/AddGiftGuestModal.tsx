import React, { useState } from "react";
import {
  Box,
  CustomModalLayout,
  FormField,
  Input,
  Modal,
  NumberInput,
  SectionHelper,
  Text,
} from "@wix/design-system";
import { Guest } from "../../types";
import { httpRequests } from "../../httpClient";
import { useAppData } from "../../hooks/useAppData";
import { validatePhoneNumber } from "../rsvp/logic";

interface AddGiftGuestModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the newly created guest so the gift form can select them. */
  onGuestAdded: (guest: Guest) => void;
}

/**
 * Adds a guest straight from the gifts page — for someone who came uninvited
 * or just sent a gift without showing up. The guest is added to the global
 * guest list (without being assigned to any event), so they appear in the
 * gifts table and can receive a gift entry.
 */
const AddGiftGuestModal: React.FC<AddGiftGuestModalProps> = ({
  isOpen,
  onClose,
  onGuestAdded,
}) => {
  const { guests, setGuests } = useAppData();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [whose, setWhose] = useState("");
  const [circle, setCircle] = useState("אחר");
  const [numberOfGuests, setNumberOfGuests] = useState(1);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const resetAndClose = () => {
    setName("");
    setPhone("");
    setWhose("");
    setCircle("אחר");
    setNumberOfGuests(1);
    setFormError(null);
    onClose();
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setFormError("יש להזין שם");
      return;
    }
    if (!whose.trim()) {
      setFormError("יש להזין מי הזמין (מוזמן ע״י)");
      return;
    }

    // Phone is optional here — uninvited gifters often have no number on file.
    let normalizedPhone: string | null = null;
    if (phone.trim()) {
      normalizedPhone = validatePhoneNumber(phone.trim()) ?? phone.trim();
      if (guests.some((g) => g.phone === normalizedPhone)) {
        setFormError("מספר טלפון כבר קיים ברשימת האורחים");
        return;
      }
    }

    setIsSaving(true);
    try {
      const updatedGuests = await httpRequests.addGuests([
        {
          name: name.trim(),
          phone: normalizedPhone,
          whose: whose.trim(),
          circle: circle.trim() || "אחר",
          number_of_guests: numberOfGuests,
        },
      ]);
      setGuests(updatedGuests);
      const newGuest = updatedGuests.find(
        (g) => g.name === name.trim() && !guests.some((existing) => existing.id === g.id)
      );
      if (newGuest) onGuestAdded(newGuest);
      resetAndClose();
    } catch (error) {
      console.error("Error adding guest:", error);
      setFormError("הוספת האורח נכשלה, נסו שוב");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onRequestClose={resetAndClose} shouldCloseOnOverlayClick>
      <CustomModalLayout
        title="הוספת אורח לא מוזמן"
        primaryButtonText={isSaving ? "שומר..." : "הוספה"}
        primaryButtonOnClick={handleSave}
        primaryButtonProps={{ disabled: isSaving }}
        secondaryButtonText="ביטול"
        secondaryButtonOnClick={resetAndClose}
        width="440px"
        content={
          <div dir="rtl" data-tour="add-gift-guest-form">
            <Box direction="vertical" gap="16px" paddingTop="12px">
              <Text size="small" secondary>
                לאורחים שהגיעו ללא הזמנה או שלחו מתנה בלי להגיע — האורח יתווסף
                לרשימת האורחים בלי שיוך לאירוע.
              </Text>
              <FormField label="שם" required>
                <Input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setFormError(null);
                  }}
                  placeholder="שם האורח"
                />
              </FormField>
              <FormField label="טלפון (לא חובה)">
                <Input
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setFormError(null);
                  }}
                  placeholder="050-0000000"
                />
              </FormField>
              <FormField label="מוזמן ע״י" required>
                <Input
                  value={whose}
                  onChange={(e) => {
                    setWhose(e.target.value);
                    setFormError(null);
                  }}
                  placeholder="למשל: כלה / חתן"
                />
              </FormField>
              <FormField label="מעגל">
                <Input
                  value={circle}
                  onChange={(e) => setCircle(e.target.value)}
                  placeholder="למשל: חברים, משפחה"
                />
              </FormField>
              <FormField label="מספר אורחים">
                <NumberInput
                  value={numberOfGuests}
                  onChange={(value) => setNumberOfGuests(value ?? 1)}
                  min={1}
                />
              </FormField>
              {formError && (
                <SectionHelper appearance="danger">{formError}</SectionHelper>
              )}
            </Box>
          </div>
        }
      />
    </Modal>
  );
};

export default AddGiftGuestModal;
