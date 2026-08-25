import React, { useState } from "react";
import {
  Box,
  Button,
  Input,
  Modal,
  Text,
  Loader,
} from "@wix/design-system";
import { Guest, Event } from "../../types";
import { httpRequests } from "../../httpClient";
import { getUniqueValues } from "./logic";
import { FilterOptions } from "../../types";
import EventFormFields, { emptyEventForm, isEventFormValid } from "./EventFormFields";

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
  const [form, setForm] = useState(emptyEventForm);

  const invitedByOptions = getUniqueValues(guestsList, "whose");
  const allCircleOptions = getUniqueValues(guestsList, "circle");
  const filteredGuests = guestsList.filter((guest) => {
    const matchesWhose = filterOptions.whose.length === 0 || filterOptions.whose.includes(guest.whose);
    const matchesCircle = filterOptions.circle.length === 0 || filterOptions.circle.includes(guest.circle);
    const matchesSearch = !filterOptions.searchTerm ||
      guest.name.includes(filterOptions.searchTerm) ||
      (guest.phone ?? "").includes(filterOptions.searchTerm);
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

  const isFormValid = isEventFormValid(form, Boolean(imageFile));

  const handleCreate = async () => {
    if (!isFormValid) return;
    setIsSaving(true);
    try {
      const event = await httpRequests.createEvent({ ...form, is_primary: false }, imageFile);
      if (selectedGuestIds.size > 0) {
        await httpRequests.setEventGuests(event.id, Array.from(selectedGuestIds));
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

      <EventFormFields
        form={form}
        onChange={(updates) => setForm((f) => ({ ...f, ...updates }))}
        imageFile={imageFile}
        onImageChange={setImageFile}
      />

      <Box direction="horizontal" gap={2} align="right">
        <Button priority="secondary" onClick={onClose}>ביטול</Button>
        <Button
          disabled={!isFormValid}
          onClick={() => setStep(2)}
        >
          הבא: בחירת אורחים
        </Button>
      </Box>
    </Box>
  );

  const activeFilterCount = filterOptions.whose.length + filterOptions.circle.length;
  const clearFilters = () => setFilterOptions({ whose: [], circle: [], rsvpStatus: [], searchTerm: "" });

  const renderFilterPill = (
    label: string,
    isActive: boolean,
    onClick: () => void
  ) => (
    <button
      key={label}
      onClick={onClick}
      style={{
        padding: "4px 12px",
        borderRadius: 20,
        border: `1.5px solid ${isActive ? "#3b6ef6" : "#d9d9d9"}`,
        background: isActive ? "#eef2ff" : "#fafafa",
        color: isActive ? "#3b6ef6" : "#555",
        fontWeight: isActive ? 600 : 400,
        fontSize: 13,
        cursor: "pointer",
        whiteSpace: "nowrap",
        transition: "all 0.15s",
      }}
    >
      {label}
    </button>
  );

  const renderStep2 = () => (
    <Box direction="vertical" gap={3}>
      {/* Header */}
      <Box direction="vertical" gap="3px">
        <Text size="medium" weight="bold">
          בחירת אורחים — {form.ceremony_name}
        </Text>
        <Text size="small" secondary>
          בחר את האורחים שיוזמנו לאירוע זה
        </Text>
      </Box>

      {/* Search */}
      <Input
        placeholder="חיפוש לפי שם או טלפון..."
        value={filterOptions.searchTerm}
        onChange={(e) => setFilterOptions((f) => ({ ...f, searchTerm: e.target.value }))}
      />

      {/* Filters */}
      {(invitedByOptions.length > 0 || allCircleOptions.length > 0) && (
        <Box direction="vertical" gap={2} style={{ background: "#f8f8f8", borderRadius: 8, padding: "12px 14px" }}>
          {invitedByOptions.length > 0 && (
            <Box direction="vertical" gap={1}>
              <Text size="tiny" secondary weight="bold">לפי צד</Text>
              <Box direction="horizontal" gap={1} style={{ flexWrap: "wrap" }}>
                {invitedByOptions.map((whose) =>
                  renderFilterPill(whose, filterOptions.whose.includes(whose), () =>
                    setFilterOptions((f) => ({
                      ...f,
                      whose: f.whose.includes(whose)
                        ? f.whose.filter((w) => w !== whose)
                        : [...f.whose, whose],
                    }))
                  )
                )}
              </Box>
            </Box>
          )}

          {allCircleOptions.length > 0 && (
            <Box direction="vertical" gap={1}>
              <Text size="tiny" secondary weight="bold">לפי קשר</Text>
              <Box direction="horizontal" gap={1} style={{ flexWrap: "wrap" }}>
                {allCircleOptions.map((circle) =>
                  renderFilterPill(circle, filterOptions.circle.includes(circle), () =>
                    setFilterOptions((f) => ({
                      ...f,
                      circle: f.circle.includes(circle)
                        ? f.circle.filter((c) => c !== circle)
                        : [...f.circle, circle],
                    }))
                  )
                )}
              </Box>
            </Box>
          )}

          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              style={{ background: "none", border: "none", color: "#888", fontSize: 12, cursor: "pointer", textAlign: "right", padding: 0 }}
            >
              נקה סינון ({activeFilterCount})
            </button>
          )}
        </Box>
      )}

      {/* Summary row */}
      <Box direction="horizontal" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <Text size="small" secondary>
          {filteredGuests.length} אורחים מוצגים
          {selectedGuestIds.size > 0 && ` · ${selectedGuestIds.size} נבחרו`}
        </Text>
        <button
          onClick={toggleAll}
          style={{
            background: "none",
            border: "none",
            color: "#3b6ef6",
            fontSize: 13,
            cursor: "pointer",
            fontWeight: 600,
            padding: 0,
          }}
        >
          {allFilteredSelected ? "בטל בחירת כולם" : "בחר כולם"}
        </button>
      </Box>

      {/* Guest list */}
      <Box
        direction="vertical"
        gap={0}
        style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #e8e8e8", borderRadius: 8 }}
      >
        {filteredGuests.length === 0 ? (
          <Box style={{ padding: "20px", textAlign: "center" }}>
            <Text size="small" secondary>לא נמצאו אורחים</Text>
          </Box>
        ) : (
          filteredGuests.map((guest, idx) => {
            const isChecked = guest.id != null && selectedGuestIds.has(guest.id);
            return (
              <div
                key={guest.phone}
                onClick={() => guest.id != null && toggleGuest(guest.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 14px",
                  cursor: "pointer",
                  background: isChecked ? "#f0f4ff" : "white",
                  borderTop: idx > 0 ? "1px solid #f0f0f0" : "none",
                  transition: "background 0.1s",
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => {}}
                  style={{ accentColor: "#3b6ef6", width: 15, height: 15, cursor: "pointer", flexShrink: 0 }}
                />
                <span style={{ flex: 1, fontSize: 14, color: "#222" }}>{guest.name}</span>
                <span style={{ fontSize: 12, color: "#aaa", direction: "rtl" }}>
                  {guest.whose} · {guest.circle}
                </span>
              </div>
            );
          })
        )}
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
