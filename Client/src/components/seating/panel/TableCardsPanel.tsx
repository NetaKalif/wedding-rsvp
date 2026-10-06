import React, { useMemo, useState } from "react";
import { Text } from "@wix/design-system";
import { GripVertical, Pencil, X } from "lucide-react";
import { SeatingAssignment, SeatingItem } from "../../../types";
import {
  DRAG_MIME,
  GUEST_DRAG_TYPE,
  isDeclinedAssignment,
  parseDragPayload,
  seatCount,
  tableDisplayName,
} from "../logic";

/**
 * Selected-tables view of the side panel: one card per selected table, each
 * listing its guests. Guests are draggable between cards (and onto canvas
 * tables — same payload as the guests panel). The list scrolls.
 */
interface TableCardsPanelProps {
  /** Selected tables, in selection order. */
  tables: SeatingItem[];
  assignments: SeatingAssignment[];
  onAssignGuest: (eventGuestId: number, tableId: number) => void;
  onUnassignGuest: (eventGuestId: number) => void;
  /** Opens the full table modal (same as double-clicking the table). */
  onOpenTable: (tableId: number) => void;
  /** Clears the table selection (closes the panel). */
  onClose: () => void;
}

export const TableCardsPanel: React.FC<TableCardsPanelProps> = ({
  tables, assignments, onAssignGuest, onUnassignGuest, onOpenTable, onClose,
}) => {
  const [dragOverTableId, setDragOverTableId] = useState<number | null>(null);

  const assignmentsByTable = useMemo(() => {
    const map = new Map<number, SeatingAssignment[]>();
    for (const a of assignments) {
      const list = map.get(a.item_id);
      if (list) list.push(a);
      else map.set(a.item_id, [a]);
    }
    return map;
  }, [assignments]);

  const handleDrop = (e: React.DragEvent, tableId: number) => {
    e.preventDefault();
    setDragOverTableId(null);
    const payload = parseDragPayload(e.dataTransfer.getData(DRAG_MIME));
    if (payload?.type === "guest") onAssignGuest(payload.eventGuestId, tableId);
  };

  return (
    <div className="table-cards-panel" data-testid="table-cards-panel">
      <div className="table-cards-header">
        <Text weight="bold" size="small">
          {tables.length === 1 ? "פרטי שולחן" : `פרטי שולחנות (${tables.length})`}
        </Text>
        <button type="button" className="table-cards-close" onClick={onClose} title="סגירת הפאנל">
          <X size={16} />
        </button>
      </div>

      <div className="table-cards-list">
        {tables.map((table) => {
          const tableAssignments = assignmentsByTable.get(table.id) ?? [];
          const seated = tableAssignments.reduce((sum, a) => sum + seatCount(a), 0);
          return (
            <div
              key={table.id}
              className={`table-card ${dragOverTableId === table.id ? "table-card-drop-target" : ""}`}
              data-testid={`table-card-${table.id}`}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(GUEST_DRAG_TYPE)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOverTableId(table.id);
              }}
              onDragLeave={() => setDragOverTableId((prev) => (prev === table.id ? null : prev))}
              onDrop={(e) => handleDrop(e, table.id)}
            >
              <div className="table-card-header">
                <Text weight="bold" size="small">{tableDisplayName(table)}</Text>
                <div className="table-card-header-side">
                  <span className="table-card-occupancy">
                    {`${seated}/${table.capacity ?? "?"}`}
                  </span>
                  <button
                    type="button"
                    className="table-card-edit"
                    onClick={() => onOpenTable(table.id)}
                    title="עריכת השולחן"
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              </div>

              <div className="table-card-guests">
                {tableAssignments.map((a) => {
                  const declined = isDeclinedAssignment(a);
                  return (
                    <div
                      key={a.event_guest_id}
                      className={`table-card-guest ${declined ? "guest-row-declined" : ""}`}
                      draggable={!declined}
                      title={declined ? "האורח ביטל הגעה" : "גררו לשולחן אחר"}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          DRAG_MIME,
                          JSON.stringify({ type: "guest", eventGuestId: a.event_guest_id }),
                        );
                        // Type marker readable during dragover — lights up drop targets
                        e.dataTransfer.setData(GUEST_DRAG_TYPE, "1");
                        e.dataTransfer.effectAllowed = "move";
                      }}
                    >
                      {!declined && <GripVertical size={13} className="table-card-grip" />}
                      <span className="table-card-guest-name">{a.name}</span>
                      <span className={`guest-seats ${a.rsvp_status == null ? "guest-seats-pending" : ""}`}>
                        {seatCount(a)}
                        {a.rsvp_status == null ? "?" : ""}
                      </span>
                      <button
                        type="button"
                        className="attention-remove"
                        onClick={() => onUnassignGuest(a.event_guest_id)}
                        title="הסרה מהשולחן"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  );
                })}
                {tableAssignments.length === 0 && (
                  <Text size="tiny" secondary>אין אורחים בשולחן זה — גררו אורחים לכאן</Text>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
