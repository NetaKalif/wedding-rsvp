import React, { useMemo, useState } from "react";
import { Checkbox, Text } from "@wix/design-system";
import { AlertTriangle, GripVertical, X } from "lucide-react";
import { EventGuest, FilterOptions, SeatingAssignment, SeatingItem } from "../../../types";
import SearchAndFilterBar from "../../rsvp/SearchAndFilterBar";
import { filterGuests } from "../../rsvp/logic";
import {
  DRAG_MIME,
  GUEST_DRAG_TYPE,
  needsAttention,
  seatingProgress,
  tableDisplayName,
} from "../logic";

interface GuestsPanelProps {
  eventGuests: EventGuest[];
  assignments: SeatingAssignment[];
  items: SeatingItem[];
  onUnassign: (eventGuestId: number) => void;
  /** Clicking a seated guest's row selects (highlights) their table on the canvas. */
  onHighlightTable?: (tableId: number) => void;
}

// The panel opens filtered to confirmed guests — pending/declined are opted
// back in through the regular filter UI (uncheck the status chip / add others).
const DEFAULT_FILTERS: FilterOptions = { whose: [], circle: [], rsvpStatus: ["confirmed"], searchTerm: "" };

const guestSeats = (g: EventGuest): number =>
  g.rsvp_status != null && g.rsvp_status > 0 ? g.rsvp_status : g.number_of_guests ?? 1;

/**
 * Custom drag image: a pill with the seat count and the guest's name. Anchored
 * at its bottom-right corner so the ghost floats above-left of the cursor and
 * the cursor never covers the number. The element must be in the DOM when
 * setDragImage is called; it's parked offscreen and removed right after the
 * browser snapshots it.
 */
const setGuestDragImage = (e: React.DragEvent, seats: number, name: string) => {
  if (typeof e.dataTransfer.setDragImage !== "function") return;
  const ghost = document.createElement("div");
  ghost.className = "guest-drag-ghost";
  const count = document.createElement("span");
  count.className = "guest-drag-ghost-count";
  count.textContent = String(seats);
  const label = document.createElement("span");
  label.textContent = name;
  ghost.append(count, label);
  document.body.appendChild(ghost);
  e.dataTransfer.setDragImage(ghost, ghost.offsetWidth, ghost.offsetHeight);
  setTimeout(() => ghost.remove(), 0);
};

export const GuestsPanel: React.FC<GuestsPanelProps> = ({
  eventGuests, assignments, items, onUnassign, onHighlightTable,
}) => {
  // Same checkbox-based filter UX as the RSVP page (shared component + logic)
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(DEFAULT_FILTERS);
  const [unassignedOnly, setUnassignedOnly] = useState(false);

  const tableByEventGuest = useMemo(() => {
    const itemById = new Map(items.map((i) => [i.id, i]));
    const map = new Map<number, SeatingItem>();
    for (const a of assignments) {
      const table = itemById.get(a.item_id);
      if (table) map.set(a.event_guest_id, table);
    }
    return map;
  }, [assignments, items]);

  const filtered = useMemo(() => {
    const base = filterGuests(eventGuests, filterOptions);
    return unassignedOnly
      ? base.filter((g) => g.id == null || !tableByEventGuest.has(g.id))
      : base;
  }, [eventGuests, filterOptions, unassignedOnly, tableByEventGuest]);

  const progress = useMemo(
    () => seatingProgress(eventGuests, assignments),
    [eventGuests, assignments],
  );
  const attention = useMemo(() => needsAttention(assignments), [assignments]);

  const progressPct = progress.totalGuests > 0
    ? Math.round((progress.seatedGuests / progress.totalGuests) * 100)
    : 0;

  return (
    <div className="guests-panel">
      <div className="seating-progress" data-testid="seating-progress">
        <Text size="small" weight="bold">
          {`הושבו ${progress.seatedGuests} מתוך ${progress.totalGuests} אורחים שאישרו`}
        </Text>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {attention.length > 0 && (
        <div className="needs-attention" data-testid="needs-attention">
          <Text size="small" weight="bold">
            <AlertTriangle size={14} style={{ verticalAlign: "middle", marginLeft: 4 }} />
            דורש טיפול — ביטלו הגעה אך משובצים לשולחן:
          </Text>
          {attention.map((a) => (
            <div key={a.id} className="attention-row">
              <Text size="small">{a.name}</Text>
              <button
                type="button"
                className="attention-remove"
                onClick={() => onUnassign(a.event_guest_id)}
                title="הסרה מהשולחן"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="guests-filters">
        <SearchAndFilterBar
          guestsList={eventGuests}
          filterOptions={filterOptions}
          setFilterOptions={setFilterOptions}
        />
        <Checkbox
          size="small"
          checked={unassignedOnly}
          onChange={() => setUnassignedOnly((v) => !v)}
        >
          רק אורחים ללא שולחן
        </Checkbox>
      </div>

      <div className="guests-list">
        {filtered.map((g) => {
          const table = g.id != null ? tableByEventGuest.get(g.id) : undefined;
          const declined = g.rsvp_status === 0;
          return (
            <div
              key={g.id ?? g.guest_id}
              className={`guest-row ${declined ? "guest-row-declined" : ""} ${table ? "guest-row-clickable" : ""}`}
              title={declined ? "האורח ביטל הגעה" : table ? "לחיצה תסמן את השולחן באולם" : undefined}
              onClick={() => table && onHighlightTable?.(table.id)}
            >
              {!declined && g.id != null && (
                <div
                  className="guest-drag-handle"
                  draggable
                  title="גררו אל שולחן באולם"
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ type: "guest", eventGuestId: g.id }));
                    // Type marker readable during dragover — drives the drop-cursor feedback
                    e.dataTransfer.setData(GUEST_DRAG_TYPE, "1");
                    e.dataTransfer.effectAllowed = "move";
                    setGuestDragImage(e, guestSeats(g), g.name ?? "");
                  }}
                >
                  <GripVertical size={14} />
                </div>
              )}
              <div className="guest-row-main">
                <Text size="small" weight="bold">{g.name}</Text>
                <Text size="tiny" secondary>
                  {[g.whose, g.circle].filter(Boolean).join(" · ")}
                </Text>
              </div>
              <div className="guest-row-side">
                <span className={`guest-seats ${g.rsvp_status == null ? "guest-seats-pending" : ""}`}>
                  {guestSeats(g)}
                  {g.rsvp_status == null ? "?" : ""}
                </span>
                {table && <span className="guest-table-badge">{tableDisplayName(table)}</span>}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <Text size="small" secondary>לא נמצאו אורחים</Text>
        )}
      </div>
    </div>
  );
};
