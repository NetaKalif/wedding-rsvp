import React, { useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  FieldSet,
  Input,
  InputArea,
  Modal,
  Text,
  Loader,
} from "@wix/design-system";
import { Guest, Event } from "../../types";
import { httpRequests } from "../../httpClient";
import { getCirclesValues, getUniqueValues } from "./logic";
import { FilterOptions } from "../../types";

interface CreateEventWizardProps {
  userID: string;
  guestsList: Guest[];
  onClose: () => void;
  onCreated: (event: Event) => void;
}

const CreateEventWizard: React.FC<CreateEventWizardProps> = ({
  userID,
  guestsList,
  onClose,
  onCreated,
}) => {
  const [step, setStep] = useState<1 | 2>(1);
  const [isSaving, setIsSaving] = useState(false);
  const [imageFile, setImageFile] = useState<File | undefined>(undefined);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    whose: [],
    circle: [],
    rsvpStatus: [],
    searchTerm: "",
  });
  const [selectedGuestIds, setSelectedGuestIds] = useState<Set<number>>(new Set());
  const [form, setForm] = useState({
    ceremony_name: "",
    date: "",
    time: "",
    location: "",
    additional_info: "",
  });

  const invitedByOptions = getUniqueValues(guestsList, "whose");
  const circleOptions = getCirclesValues(guestsList);
  const filteredGuests = guestsList.filter((guest) => {
    const matchesWhose = filterOptions.whose.length === 0 || filterOptions.whose.includes(guest.whose);
    const matchesCircle = filterOptions.circle.length === 0 || filterOptions.circle.includes(guest.circle);
    const matchesSearch = !filterOptions.searchTerm ||
      guest.name.includes(filterOptions.searchTerm) ||
      guest.phone.includes(filterOptions.searchTerm);
    return matchesWhose && matchesCircle && matchesSearch;
  });

  const toggleGuest = (id: number) => {
    setSelectedGuestIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const allSelected = filteredGuests.every((g) => g.id != null && selectedGuestIds.has(g.id));
    setSelectedGuestIds((prev) => {
      const next = new Set(prev);
      filteredGuests.forEach((g) => {
        if (g.id != null) allSelected ? next.delete(g.id) : next.add(g.id);
      });
      return next;
    });
  };

  const allFilteredSelected =
    filteredGuests.length > 0 && filteredGuests.every((g) => g.id != null && selectedGuestIds.has(g.id));

  const handleCreate = async () => {
    if (!form.ceremony_name.trim()) return;
    setIsSaving(true);
    try {
      const event = await httpRequests.createEvent(userID, { ...form, is_primary: false }, imageFile);
      if (selectedGuestIds.size > 0) {
        await httpRequests.setEventGuests(userID, event.id, Array.from(selectedGuestIds));
      }
      onCreated(event);
    } catch (err) {
      console.error(err);
      alert("שגיאה ביצירת האירוע, אנא נסו שנית");
    } finally {
      setIsSaving(false);
    }
  };

  const renderStep1 = () => (
    <Box direction="vertical" gap={3}>
      <Text size="medium" weight="bold">פרטי האירוע</Text>

      <FieldSet legend="שם הטקס *">
        <Input
          placeholder="לדוגמה: חינה, מסיבת רווקות..."
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
          placeholder="שם המקום"
          value={form.location}
          onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
        />
      </FieldSet>

      <FieldSet legend="פרטים נוספים">
        <InputArea
          placeholder="מידע נוסף שיופיע בהזמנה..."
          value={form.additional_info}
          onChange={(e) => setForm((f) => ({ ...f, additional_info: e.target.value }))}
          rows={3}
        />
      </FieldSet>

      <FieldSet legend="תמונת הזמנה">
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setImageFile(e.target.files?.[0])}
        />
        {imageFile && <Text size="small" secondary>{imageFile.name}</Text>}
      </FieldSet>

      <Box direction="horizontal" gap={2} align="right">
        <Button priority="secondary" onClick={onClose}>ביטול</Button>
        <Button
          disabled={!form.ceremony_name.trim()}
          onClick={() => setStep(2)}
        >
          הבא: בחירת אורחים
        </Button>
      </Box>
    </Box>
  );

  const renderStep2 = () => (
    <Box direction="vertical" gap={3}>
      <Text size="medium" weight="bold">
        בחירת אורחים לאירוע — {form.ceremony_name}
      </Text>
      <Text size="small" secondary>
        {selectedGuestIds.size} אורחים נבחרו
      </Text>

      {/* Filters */}
      <Box direction="horizontal" gap={2} style={{ flexWrap: "wrap", display: "flex" }}>
        <Input
          placeholder="חיפוש..."
          value={filterOptions.searchTerm}
          onChange={(e) => setFilterOptions((f) => ({ ...f, searchTerm: e.target.value }))}
          size="small"
        />

        <FieldSet legend="צד">
          <Box direction="horizontal" gap={1} style={{ flexWrap: "wrap", display: "flex" }}>
            {invitedByOptions.map((whose) => (
              <Checkbox
                key={whose}
                checked={filterOptions.whose.includes(whose)}
                onChange={() =>
                  setFilterOptions((f) => ({
                    ...f,
                    whose: f.whose.includes(whose)
                      ? f.whose.filter((w) => w !== whose)
                      : [...f.whose, whose],
                  }))
                }
              >
                {whose}
              </Checkbox>
            ))}
          </Box>
        </FieldSet>

        {Object.entries(circleOptions).map(([whose, circles]) => (
          <FieldSet key={whose} legend={`קשרים — ${whose}`}>
            <Box direction="horizontal" gap={1} style={{ flexWrap: "wrap", display: "flex" }}>
              {(circles as string[]).map((circle) => (
                <Checkbox
                  key={circle}
                  checked={filterOptions.circle.includes(circle)}
                  onChange={() =>
                    setFilterOptions((f) => ({
                      ...f,
                      circle: f.circle.includes(circle)
                        ? f.circle.filter((c) => c !== circle)
                        : [...f.circle, circle],
                    }))
                  }
                >
                  {circle}
                </Checkbox>
              ))}
            </Box>
          </FieldSet>
        ))}
      </Box>

      {/* Select all toggle */}
      <Checkbox checked={allFilteredSelected} onChange={toggleAll}>
        {allFilteredSelected ? "בטל בחירת כולם" : "בחר כולם"} ({filteredGuests.length} מסוננים)
      </Checkbox>

      {/* Guest list */}
      <Box direction="vertical" gap={1} style={{ maxHeight: 300, overflowY: "auto" }}>
        {filteredGuests.map((guest) => (
          <Checkbox
            key={guest.phone}
            checked={guest.id != null && selectedGuestIds.has(guest.id)}
            onChange={() => guest.id != null && toggleGuest(guest.id)}
          >
            <Box direction="horizontal" gap={1}>
              <Text>{guest.name}</Text>
              <Text size="small" secondary>({guest.whose} · {guest.circle})</Text>
            </Box>
          </Checkbox>
        ))}
      </Box>

      <Box direction="horizontal" gap={2} align="right">
        <Button priority="secondary" onClick={() => setStep(1)}>חזרה</Button>
        <Button onClick={handleCreate} disabled={isSaving}>
          {isSaving ? <Loader size="tiny" /> : `צור אירוע${selectedGuestIds.size > 0 ? ` עם ${selectedGuestIds.size} אורחים` : ""}`}
        </Button>
      </Box>
    </Box>
  );

  return (
    <Modal isOpen screen="desktop">
      <Box
        direction="vertical"
        padding="24px"
        background="WHITE"
        borderRadius="8px"
        style={{ minWidth: 480, maxWidth: 600, maxHeight: "80vh", overflowY: "auto" }}
        gap={2}
      >
        <Box direction="horizontal" style={{ justifyContent: "space-between" }}>
          <Text size="medium" weight="bold">
            {step === 1 ? "יצירת אירוע חדש — שלב 1/2" : "יצירת אירוע חדש — שלב 2/2"}
          </Text>
        </Box>
        {step === 1 ? renderStep1() : renderStep2()}
      </Box>
    </Modal>
  );
};

export default CreateEventWizard;
