import React, { useMemo, useState } from "react";
import {
  CustomModalLayout,
  FormField,
  Input,
  Checkbox,
  Box,
  Button,
  Text,
} from "@wix/design-system";
import { X, Plus } from "lucide-react";
import { EventGuest, FilterOptions, SeatingAssignment, SeatingItem } from "../../types";
import SearchAndFilterBar from "../rsvp/SearchAndFilterBar";
import { filterGuests } from "../rsvp/logic";
import { seatCount, tableDisplayName, MIN_ITEM_CM } from "./logic";

interface TableModalProps {
  table: SeatingItem;
  items: SeatingItem[];
  assignments: SeatingAssignment[];
  eventGuests: EventGuest[];
  /** Applies the whole save (props + staged guest changes) as one undoable action. */
  onApply: (
    changes: Partial<SeatingItem>,
    guestChanges: { assign: number[]; unassign: number[] },
  ) => void | Promise<void>;
  onClose: () => void;
}

const EMPTY_FILTERS: FilterOptions = { whose: [], circle: [], rsvpStatus: [], searchTerm: "" };

const parsePositiveInt = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const guestSeatsLabel = (g: EventGuest): string =>
  g.rsvp_status != null && g.rsvp_status > 0 ? String(g.rsvp_status) : `${g.number_of_guests ?? 1}?`;

export const TableModal: React.FC<TableModalProps> = ({
  table, items, assignments, eventGuests, onApply, onClose,
}) => {
  const [label, setLabel] = useState(table.label ?? "");
  const [capacity, setCapacity] = useState(String(table.capacity ?? ""));
  const [widthCm, setWidthCm] = useState(String(table.width_cm));
  const [heightCm, setHeightCm] = useState(String(table.height_cm));
  // Add-guest list: same checkbox filter UX as the RSVP page, plus a toggle
  // between unassigned-only (default) and every guest (assigned ones move here)
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(EMPTY_FILTERS);
  const [showAssigned, setShowAssigned] = useState(false);
  // Guest changes are STAGED and only applied on save — closing discards them.
  const [pendingAssign, setPendingAssign] = useState<number[]>([]);
  const [pendingUnassign, setPendingUnassign] = useState<number[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const tableAssignments = useMemo(
    () => assignments.filter(
      (a) => a.item_id === table.id && !pendingUnassign.includes(a.event_guest_id),
    ),
    [assignments, table.id, pendingUnassign],
  );
  const stagedGuests = useMemo(
    () => pendingAssign
      .map((id) => eventGuests.find((g) => g.id === id))
      .filter((g): g is EventGuest => g != null),
    [pendingAssign, eventGuests],
  );
  const seated =
    tableAssignments.reduce((sum, a) => sum + seatCount(a), 0) +
    stagedGuests.reduce((sum, g) => sum + seatCount(g), 0);

  const tableById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const assignedTableByGuest = useMemo(
    () => new Map(assignments.map((a) => [a.event_guest_id, a.item_id])),
    [assignments],
  );
  // Where the guest sits once pending removals are taken into account
  const effectiveTableOf = (eventGuestId: number): number | undefined =>
    pendingUnassign.includes(eventGuestId) ? undefined : assignedTableByGuest.get(eventGuestId);

  const addableGuests = useMemo(
    () => filterGuests(eventGuests, filterOptions).filter((g) => {
      if (g.id == null || g.rsvp_status === 0) return false; // declined are handled via needs-attention
      if (pendingAssign.includes(g.id)) return false; // already staged (listed above)
      const atTable = effectiveTableOf(g.id);
      if (atTable === table.id) return false; // already at this table (listed above)
      if (!showAssigned && atTable != null) return false;
      return true;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eventGuests, filterOptions, assignedTableByGuest, table.id, showAssigned, pendingAssign, pendingUnassign],
  );

  const stageAssign = (eventGuestId: number) =>
    setPendingAssign((prev) => [...prev, eventGuestId]);

  const stageRemove = (eventGuestId: number) => {
    // A staged addition is simply unstaged; an existing guest is staged for removal
    setPendingAssign((prev) => prev.filter((id) => id !== eventGuestId));
    if (assignedTableByGuest.get(eventGuestId) === table.id) {
      setPendingUnassign((prev) => [...prev, eventGuestId]);
    }
  };

  const capacityNum = parsePositiveInt(capacity);
  const widthNum = parsePositiveInt(widthCm);
  const heightNum = table.shape === "circle" ? widthNum : parsePositiveInt(heightCm);
  const isValid =
    capacityNum != null &&
    widthNum != null && widthNum >= MIN_ITEM_CM &&
    heightNum != null && heightNum >= MIN_ITEM_CM;

  const handleSave = async () => {
    if (!isValid || isSaving) return;
    setIsSaving(true);
    try {
      // Everything goes out as one action so a single undo reverts the save
      await Promise.resolve(onApply(
        {
          label: label.trim() || null,
          capacity: capacityNum,
          width_cm: widthNum,
          height_cm: heightNum,
        },
        { assign: pendingAssign, unassign: pendingUnassign },
      ));
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <CustomModalLayout
      title={tableDisplayName(table)}
      primaryButtonText={isSaving ? "שומר..." : "שמירה"}
      primaryButtonOnClick={() => void handleSave()}
      primaryButtonProps={{ disabled: !isValid || isSaving }}
      secondaryButtonText="סגירה"
      secondaryButtonOnClick={onClose}
      onCloseButtonClick={onClose}
      width="480px"
      maxHeight="85vh"
      overflowY="auto"
      content={
        <div dir="rtl">
          <Box direction="vertical" gap="14px" paddingTop="6px">
            <FormField label="שם השולחן">
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={`שולחן ${table.table_number ?? ""}`}
              />
            </FormField>

            <Box direction="horizontal" gap="10px">
              <FormField label="מקומות ישיבה" required>
                <Input value={capacity} onChange={(e) => setCapacity(e.target.value)} type="number" />
              </FormField>
              {table.shape === "circle" ? (
                <FormField label='קוטר (ס"מ)' required>
                  <Input value={widthCm} onChange={(e) => setWidthCm(e.target.value)} type="number" />
                </FormField>
              ) : (
                <>
                  <FormField label='רוחב (ס"מ)' required>
                    <Input value={widthCm} onChange={(e) => setWidthCm(e.target.value)} type="number" />
                  </FormField>
                  <FormField label='אורך (ס"מ)' required>
                    <Input value={heightCm} onChange={(e) => setHeightCm(e.target.value)} type="number" />
                  </FormField>
                </>
              )}
            </Box>

            <Text weight="bold" size="small">
              {`אורחים בשולחן (${seated}/${capacityNum ?? table.capacity ?? "?"})`}
            </Text>
            <div className="table-modal-guests">
              {tableAssignments.map((a) => (
                <div key={a.id} className="table-modal-guest-row">
                  <Text size="small">
                    {a.name}
                    {a.rsvp_status === 0 ? " (ביטלו הגעה)" : ` — ${seatCount(a)} מקומות${a.rsvp_status == null ? " (ממתין)" : ""}`}
                  </Text>
                  <button
                    type="button"
                    className="attention-remove"
                    onClick={() => stageRemove(a.event_guest_id)}
                    title="הסרה מהשולחן"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              {stagedGuests.map((g) => (
                <div key={`staged-${g.id}`} className="table-modal-guest-row table-modal-staged-row">
                  <Text size="small">{`${g.name} — ${seatCount(g)} מקומות (יתווסף בשמירה)`}</Text>
                  <button
                    type="button"
                    className="attention-remove"
                    onClick={() => g.id != null && stageRemove(g.id)}
                    title="ביטול ההוספה"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
              {tableAssignments.length === 0 && stagedGuests.length === 0 && (
                <Text size="small" secondary>אין אורחים בשולחן זה עדיין</Text>
              )}
            </div>

            <Text weight="bold" size="small">הוספת אורחים לשולחן</Text>
            <SearchAndFilterBar
              guestsList={eventGuests}
              filterOptions={filterOptions}
              setFilterOptions={setFilterOptions}
            />
            <Checkbox
              size="small"
              checked={showAssigned}
              onChange={() => setShowAssigned((v) => !v)}
            >
              הצג גם אורחים שכבר משובצים (הוספה תעביר אותם לשולחן זה)
            </Checkbox>
            <div className="table-modal-guests table-modal-addable">
              {addableGuests.map((g) => {
                const atTable = g.id != null ? effectiveTableOf(g.id) : undefined;
                const currentTable = atTable != null ? tableById.get(atTable) : undefined;
                return (
                  <div key={g.id} className="table-modal-guest-row">
                    <div className="guest-row-main">
                      <Text size="small">{`${g.name} (${guestSeatsLabel(g)})`}</Text>
                      {currentTable && (
                        <span className="guest-table-badge">{tableDisplayName(currentTable)}</span>
                      )}
                    </div>
                    <Button
                      size="tiny"
                      skin="light"
                      prefixIcon={<Plus size={12} />}
                      onClick={() => g.id != null && stageAssign(g.id)}
                    >
                      {currentTable ? "העבר" : "הוסף"}
                    </Button>
                  </div>
                );
              })}
              {addableGuests.length === 0 && (
                <Text size="small" secondary>לא נמצאו אורחים להוספה</Text>
              )}
            </div>
          </Box>
        </div>
      }
    />
  );
};
