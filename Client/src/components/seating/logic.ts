import { EventGuest, SeatingAssignment, SeatingItem, SeatingShape } from "../../types";

// All geometry is in integer centimeters (the canvas is scaled, never the data).

export const GRID_CM = 50;
export const MIN_ITEM_CM = 30;

export const snapToGrid = (cm: number): number => Math.round(cm / GRID_CM) * GRID_CM;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** Keep an item's bounding box inside the room (top-left position clamp). */
export const clampToRoom = (
  item: Pick<SeatingItem, "x_cm" | "y_cm" | "width_cm" | "height_cm">,
  roomWidthCm: number,
  roomHeightCm: number,
): { x_cm: number; y_cm: number } => ({
  x_cm: clamp(item.x_cm, 0, Math.max(0, roomWidthCm - item.width_cm)),
  y_cm: clamp(item.y_cm, 0, Math.max(0, roomHeightCm - item.height_cm)),
});

// ==================== Occupancy ====================

/**
 * Seats a party occupies at its table:
 * confirmed (rsvp_status > 0) → the confirmed count;
 * pending (null/undefined) → the invited count, reserved as tentative;
 * declined (0) → 0 (flagged via needsAttention, not silently removed).
 */
export const seatCount = (a: Pick<SeatingAssignment, "rsvp_status" | "number_of_guests">): number => {
  if (a.rsvp_status === 0) return 0;
  if (a.rsvp_status != null && a.rsvp_status > 0) return a.rsvp_status;
  return a.number_of_guests ?? 1;
};

export const isPendingAssignment = (a: Pick<SeatingAssignment, "rsvp_status">): boolean =>
  a.rsvp_status == null;

export const isDeclinedAssignment = (a: Pick<SeatingAssignment, "rsvp_status">): boolean =>
  a.rsvp_status === 0;

export interface TableOccupancy {
  seated: number;
  hasTentative: boolean;
  hasDeclined: boolean;
}

export const tableOccupancy = (
  itemId: number,
  assignments: SeatingAssignment[],
): TableOccupancy => {
  const mine = assignments.filter((a) => a.item_id === itemId);
  return {
    seated: mine.reduce((sum, a) => sum + seatCount(a), 0),
    hasTentative: mine.some(isPendingAssignment),
    hasDeclined: mine.some(isDeclinedAssignment),
  };
};

export type FillState = "empty" | "partial" | "full" | "over";

export const fillState = (seated: number, capacity: number | null): FillState => {
  if (seated === 0) return "empty";
  if (capacity == null || seated < capacity) return "partial";
  if (seated === capacity) return "full";
  return "over";
};

export const FILL_COLORS: Record<FillState, string> = {
  empty: "#ffffff",
  partial: "#e3f2e8",
  full: "#a8dcbc",
  over: "#f8c9c9",
};

/** Assignments whose guest declined after being seated — surfaced, never auto-removed. */
export const needsAttention = (assignments: SeatingAssignment[]): SeatingAssignment[] =>
  assignments.filter(isDeclinedAssignment);

export interface SeatingProgress {
  seatedGuests: number;
  totalGuests: number;
}

/**
 * Progress over confirmed guests: how many confirmed attendees are seated out
 * of all confirmed attendees in the event.
 */
export const seatingProgress = (
  eventGuests: EventGuest[],
  assignments: SeatingAssignment[],
): SeatingProgress => {
  const confirmed = eventGuests.filter((g) => (g.rsvp_status ?? 0) > 0);
  const assignedIds = new Set(assignments.map((a) => a.event_guest_id));
  return {
    seatedGuests: confirmed
      .filter((g) => g.id != null && assignedIds.has(g.id))
      .reduce((sum, g) => sum + (g.rsvp_status ?? 0), 0),
    totalGuests: confirmed.reduce((sum, g) => sum + (g.rsvp_status ?? 0), 0),
  };
};

export interface CanvasSeatStats {
  totalSeats: number;
  takenSeats: number;
  freeSeats: number;
}

/** Capacity stats of the floor plan: seats the tables offer vs. seats occupied. */
export const canvasSeatStats = (
  items: SeatingItem[],
  assignments: SeatingAssignment[],
): CanvasSeatStats => {
  const tables = items.filter((i) => i.kind === "table");
  const tableIds = new Set(tables.map((i) => i.id));
  const totalSeats = tables.reduce((sum, i) => sum + (i.capacity ?? 0), 0);
  const takenSeats = assignments
    .filter((a) => tableIds.has(a.item_id))
    .reduce((sum, a) => sum + seatCount(a), 0);
  return { totalSeats, takenSeats, freeSeats: Math.max(0, totalSeats - takenSeats) };
};

// ==================== Item text ====================

/**
 * Canvas-wide label font size, in cm (the canvas is cm-scaled, so this is
 * on-floor text height). A viewer preference, not floor-plan data — it lives
 * in localStorage, not in the DB.
 */
export const DEFAULT_FONT_CM = 30;
export const MIN_FONT_CM = 10;
export const MAX_FONT_CM = 100;
export const FONT_STEP_CM = 5;
export const FONT_STORAGE_KEY = "seating_font_size_cm";

/** Parses a stored integer preference; missing/invalid falls back, valid is clamped. */
const loadStoredInt = (raw: string | null, min: number, max: number, fallback: number): number => {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export const clampFontSize = (sizeCm: number): number =>
  Math.min(MAX_FONT_CM, Math.max(MIN_FONT_CM, sizeCm));

export const loadStoredFontSize = (raw: string | null): number =>
  loadStoredInt(raw, MIN_FONT_CM, MAX_FONT_CM, DEFAULT_FONT_CM);

// ==================== Side-panel width ====================

/** The objects/guests side panel is drag-resizable; the width is a viewer preference. */
export const DEFAULT_PANEL_WIDTH_PX = 380;
export const MIN_PANEL_WIDTH_PX = 240;
export const MAX_PANEL_WIDTH_PX = 640;
export const PANEL_WIDTH_STORAGE_KEY = "seating_side_panel_px";

export const clampPanelWidth = (px: number): number =>
  Math.min(MAX_PANEL_WIDTH_PX, Math.max(MIN_PANEL_WIDTH_PX, Math.round(px)));

export const loadStoredPanelWidth = (raw: string | null): number =>
  loadStoredInt(raw, MIN_PANEL_WIDTH_PX, MAX_PANEL_WIDTH_PX, DEFAULT_PANEL_WIDTH_PX);

/**
 * The stacked status lines at the top of a table on the canvas: the table
 * number (bold, topmost — shown even when a custom label hides it from the
 * display name) and the occupancy line under it.
 */
export const tableTopLines = (
  item: Pick<SeatingItem, "table_number" | "capacity">,
  occupancy: TableOccupancy | null,
): { numberLine: string | null; capacityLine: string } => ({
  numberLine: item.table_number != null ? String(item.table_number) : null,
  capacityLine: `${occupancy?.seated ?? 0}/${item.capacity ?? "?"}${occupancy?.hasTentative ? " ?" : ""}${occupancy?.hasDeclined ? " ✕" : ""}`,
});

/** Pixel width of a text at a font size; injectable for tests / no-canvas environments. */
export type TextMeasurer = (text: string, fontSizeCm: number) => number;

let measureCtx: CanvasRenderingContext2D | null | undefined;
const defaultMeasurer: TextMeasurer = (text, fontSizeCm) => {
  if (measureCtx === undefined) {
    measureCtx = typeof document !== "undefined"
      ? document.createElement("canvas").getContext("2d")
      : null;
  }
  if (!measureCtx) return text.length * fontSizeCm * 0.6; // rough fallback
  // Matches the Konva Text props on CanvasItem (bold, Konva's default Arial)
  measureCtx.font = `bold ${fontSizeCm}px Arial`;
  return measureCtx.measureText(text).width;
};

/** Whether the item label gets cut with an ellipsis (drives the hover tooltip). */
export const isLabelTruncated = (
  text: string,
  fontSizeCm: number,
  widthCm: number,
  measure: TextMeasurer = defaultMeasurer,
): boolean => text.length > 0 && measure(text, fontSizeCm) > widthCm;

// ==================== Rotation snapping ====================

/** Right angles the transformer magnetically locks onto. */
export const ROTATION_SNAPS = [0, 90, 180, 270];
export const ROTATION_SNAP_TOLERANCE_DEG = 7;

/**
 * Normalizes a rotation to [0, 360) and locks it onto the nearest right angle
 * when within tolerance — the committed value is then exactly 0/90/180/270.
 */
export const snapRotationDeg = (
  deg: number,
  tolerance = ROTATION_SNAP_TOLERANCE_DEG,
): number => {
  const normalized = ((Math.round(deg) % 360) + 360) % 360;
  const nearestRight = Math.round(normalized / 90) * 90;
  if (Math.abs(normalized - nearestRight) <= tolerance) return nearestRight % 360;
  return normalized;
};

// ==================== Selection ====================

/** Click selection semantics: plain click selects one; additive click toggles. */
export const toggleSelection = (current: number[], id: number, additive: boolean): number[] => {
  if (!additive) return [id];
  return current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
};

/**
 * New positions for a group of items moved by one drag delta: each item snaps
 * to the grid and clamps to the room independently (same rules as a single drag).
 */
export const moveItemsBy = (
  items: SeatingItem[],
  ids: number[],
  dxCm: number,
  dyCm: number,
  roomWidthCm: number,
  roomHeightCm: number,
): Array<{ id: number; x_cm: number; y_cm: number }> =>
  ids.flatMap((id) => {
    const item = items.find((i) => i.id === id);
    if (!item) return [];
    const pos = clampToRoom(
      {
        ...item,
        x_cm: snapToGrid(Math.round(item.x_cm + dxCm)),
        y_cm: snapToGrid(Math.round(item.y_cm + dyCm)),
      },
      roomWidthCm,
      roomHeightCm,
    );
    return [{ id, x_cm: pos.x_cm, y_cm: pos.y_cm }];
  });

// ==================== Table identity ====================

export const nextTableNumber = (items: SeatingItem[]): number =>
  items
    .filter((i) => i.kind === "table")
    .reduce((max, i) => Math.max(max, i.table_number ?? 0), 0) + 1;

export const tableDisplayName = (item: Pick<SeatingItem, "label" | "table_number">): string =>
  item.label?.trim() || `שולחן ${item.table_number ?? "?"}`;

/**
 * Updates that close the numbering gaps left by deleting tables: every
 * remaining table shifts down by how many deleted numbers were below it,
 * keeping the sequence chronological. Numbers below the gap are untouched.
 */
export const renumberAfterDelete = (
  items: SeatingItem[],
  deletedNumbers: number[],
): Array<{ id: number; before: number; after: number }> =>
  items
    .filter((i) => i.kind === "table" && i.table_number != null)
    .flatMap((i) => {
      const shift = deletedNumbers.filter((n) => n < i.table_number!).length;
      return shift > 0
        ? [{ id: i.id, before: i.table_number!, after: i.table_number! - shift }]
        : [];
    });

// ==================== Geometry ====================

interface Bounds { left: number; top: number; right: number; bottom: number; }

/**
 * Axis-aligned bounds of an item, accounting for rotation about its center.
 * For circles rotation is irrelevant; for rotated rects this is the enclosing
 * box — a slight over-approximation, acceptable for warn-only overlap flags.
 */
export const itemBounds = (item: SeatingItem): Bounds => {
  const cx = item.x_cm + item.width_cm / 2;
  const cy = item.y_cm + item.height_cm / 2;
  if (item.shape === "circle" || item.rotation_deg % 180 === 0) {
    return { left: item.x_cm, top: item.y_cm, right: item.x_cm + item.width_cm, bottom: item.y_cm + item.height_cm };
  }
  const rad = (item.rotation_deg * Math.PI) / 180;
  const halfW = (Math.abs(Math.cos(rad)) * item.width_cm + Math.abs(Math.sin(rad)) * item.height_cm) / 2;
  const halfH = (Math.abs(Math.sin(rad)) * item.width_cm + Math.abs(Math.cos(rad)) * item.height_cm) / 2;
  return { left: cx - halfW, top: cy - halfH, right: cx + halfW, bottom: cy + halfH };
};

export const itemsOverlap = (a: SeatingItem, b: SeatingItem): boolean => {
  if (a.shape === "circle" && b.shape === "circle") {
    const dx = (a.x_cm + a.width_cm / 2) - (b.x_cm + b.width_cm / 2);
    const dy = (a.y_cm + a.height_cm / 2) - (b.y_cm + b.height_cm / 2);
    return Math.hypot(dx, dy) < (a.width_cm + b.width_cm) / 2;
  }
  const ba = itemBounds(a);
  const bb = itemBounds(b);
  return ba.left < bb.right && ba.right > bb.left && ba.top < bb.bottom && ba.bottom > bb.top;
};

/** Ids of every item that overlaps at least one other item (warn, never block). */
export const findOverlappingIds = (items: SeatingItem[]): Set<number> => {
  const ids = new Set<number>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (itemsOverlap(items[i], items[j])) {
        ids.add(items[i].id);
        ids.add(items[j].id);
      }
    }
  }
  return ids;
};

/** The topmost TABLE whose shape contains the point (used for guest drops). */
export const tableAtPoint = (items: SeatingItem[], xCm: number, yCm: number): SeatingItem | null => {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind !== "table") continue;
    const cx = item.x_cm + item.width_cm / 2;
    const cy = item.y_cm + item.height_cm / 2;
    if (item.shape === "circle") {
      if (Math.hypot(xCm - cx, yCm - cy) <= item.width_cm / 2) return item;
    } else {
      // Transform the point into the rect's unrotated local frame
      const rad = (-item.rotation_deg * Math.PI) / 180;
      const dx = xCm - cx;
      const dy = yCm - cy;
      const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
      const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
      if (Math.abs(localX) <= item.width_cm / 2 && Math.abs(localY) <= item.height_cm / 2) return item;
    }
  }
  return null;
};

/** Scale (px per cm) that fits the whole room in the given viewport with padding. */
export const fitScale = (
  roomWidthCm: number,
  roomHeightCm: number,
  viewWidthPx: number,
  viewHeightPx: number,
  paddingPx = 40,
): number => {
  const w = Math.max(1, viewWidthPx - paddingPx * 2);
  const h = Math.max(1, viewHeightPx - paddingPx * 2);
  return Math.min(w / roomWidthCm, h / roomHeightCm);
};

// ==================== Item banks ====================

export interface BankEntry {
  key: string;
  name: string;
  kind: "table" | "object";
  shape: SeatingShape;
  width_cm: number;
  height_cm: number;
  capacity: number | null;
  color?: string;
}

export const PRESET_TABLES: BankEntry[] = [
  { key: "round12", name: "עגול 12", kind: "table", shape: "circle", width_cm: 180, height_cm: 180, capacity: 12 },
  { key: "round8", name: "עגול 8", kind: "table", shape: "circle", width_cm: 150, height_cm: 150, capacity: 8 },
  { key: "knight10", name: "אביר 10", kind: "table", shape: "rect", width_cm: 300, height_cm: 100, capacity: 10 },
  { key: "square16", name: "מרובע 16", kind: "table", shape: "rect", width_cm: 240, height_cm: 240, capacity: 16 },
];

export const PRESET_OBJECTS: BankEntry[] = [
  { key: "dance", name: "רחבת ריקודים", kind: "object", shape: "rect", width_cm: 600, height_cm: 600, capacity: null, color: "#d9c9b8" }, // parquet wood
  { key: "dj", name: "עמדת DJ", kind: "object", shape: "rect", width_cm: 200, height_cm: 150, capacity: null, color: "#e8e4f5" }, // lavender
  { key: "buffet", name: "בופה", kind: "object", shape: "rect", width_cm: 400, height_cm: 100, capacity: null, color: "#f9e2b8" }, // sand
  { key: "bar", name: "בר", kind: "object", shape: "rect", width_cm: 300, height_cm: 100, capacity: null, color: "#f5d6d6" }, // rose
  { key: "stage", name: "במה", kind: "object", shape: "rect", width_cm: 400, height_cm: 300, capacity: null, color: "#cfe8f5" }, // light blue
  { key: "chuppah", name: "חופה", kind: "object", shape: "rect", width_cm: 300, height_cm: 300, capacity: null, color: "#d4edda" }, // light green
  { key: "entrance", name: "כניסה", kind: "object", shape: "rect", width_cm: 200, height_cm: 50, capacity: null, color: "#c9c9c9" }, // concrete
  { key: "tree", name: "עץ", kind: "object", shape: "circle", width_cm: 100, height_cm: 100, capacity: null, color: "#a5c8a5" }, // tree green
];

/** Fill colors offered for objects (tables are colored by occupancy state). */
export const OBJECT_COLORS = [
  "#e8e4f5", // default lavender
  "#cfe8f5", // light blue
  "#d4edda", // light green
  "#a5c8a5", // tree green
  "#f9e2b8", // sand
  "#f5d6d6", // rose
  "#d9c9b8", // wood
  "#c9c9c9", // concrete
];

// The payload carried by HTML5 drag-and-drop from the side panel to the canvas.
export const DRAG_MIME = "application/x-seating-drag";

// Extra type marker set only on guest drags. dataTransfer *data* is unreadable
// during dragover, but *types* are — this is how the canvas knows to show a
// no-drop cursor over empty floor while a guest is being dragged.
export const GUEST_DRAG_TYPE = "application/x-seating-guest";

export type DragPayload =
  | { type: "new-item"; entry: BankEntry; label: string | null }
  | { type: "guest"; eventGuestId: number };

export const parseDragPayload = (raw: string): DragPayload | null => {
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.type === "new-item" || parsed?.type === "guest") return parsed;
    return null;
  } catch {
    return null;
  }
};

// ==================== Undo/redo history ====================

/**
 * Canvas-scoped history. "update" entries carry only the changed fields of one
 * item; "create"/"delete" entries carry the full item plus the assignments it
 * had, so undoing a table deletion restores its guests too. "assign"/"unassign"
 * make guest seating undoable — previousItemId remembers the table a moved
 * guest came from (null = was unassigned). "batch" groups several of those into
 * ONE user action (the table-modal save), so a single undo reverts all of it.
 */
export type SeatingBatchableEntry =
  | { type: "update"; itemId: number; before: Partial<SeatingItem>; after: Partial<SeatingItem> }
  | { type: "assign"; eventGuestId: number; itemId: number; previousItemId: number | null }
  | { type: "unassign"; eventGuestId: number; itemId: number };

export type SeatingHistoryEntry =
  | SeatingBatchableEntry
  | { type: "create" | "delete"; item: SeatingItem; assignments: SeatingAssignment[] }
  | { type: "batch"; entries: SeatingBatchableEntry[] };

/**
 * Recreating a deleted item mints a new DB id; every history entry that still
 * references the old id (in either stack) must be remapped or later undos/redos
 * would target a row that no longer exists.
 */
const remapBatchableEntry = (
  entry: SeatingBatchableEntry,
  oldId: number,
  newId: number,
): SeatingBatchableEntry => {
  if (entry.type === "update") {
    return entry.itemId === oldId ? { ...entry, itemId: newId } : entry;
  }
  if (entry.type === "assign") {
    if (entry.itemId !== oldId && entry.previousItemId !== oldId) return entry;
    return {
      ...entry,
      itemId: entry.itemId === oldId ? newId : entry.itemId,
      previousItemId: entry.previousItemId === oldId ? newId : entry.previousItemId,
    };
  }
  return entry.itemId === oldId ? { ...entry, itemId: newId } : entry;
};

export const remapItemId = (
  entries: SeatingHistoryEntry[],
  oldId: number,
  newId: number,
): SeatingHistoryEntry[] =>
  entries.map((entry) => {
    if (entry.type === "update" || entry.type === "assign" || entry.type === "unassign") {
      return remapBatchableEntry(entry, oldId, newId);
    }
    if (entry.type === "batch") {
      return { ...entry, entries: entry.entries.map((e) => remapBatchableEntry(e, oldId, newId)) };
    }
    if (entry.item.id !== oldId && !entry.assignments.some((a) => a.item_id === oldId)) return entry;
    return {
      ...entry,
      item: entry.item.id === oldId ? { ...entry.item, id: newId } : entry.item,
      assignments: entry.assignments.map((a) => (a.item_id === oldId ? { ...a, item_id: newId } : a)),
    };
  });

/**
 * The assignment moves that swap all guests between two tables, expressed as
 * history sub-entries (each guest keeps its origin in previousItemId, so a
 * single batch undo restores both tables). The caller executes each move and
 * records the whole list as one batch.
 */
export const buildSwapEntries = (
  sourceId: number,
  targetId: number,
  assignments: SeatingAssignment[],
): SeatingBatchableEntry[] => [
  ...assignments
    .filter((a) => a.item_id === sourceId)
    .map((a) => ({
      type: "assign" as const,
      eventGuestId: a.event_guest_id,
      itemId: targetId,
      previousItemId: sourceId,
    })),
  ...assignments
    .filter((a) => a.item_id === targetId)
    .map((a) => ({
      type: "assign" as const,
      eventGuestId: a.event_guest_id,
      itemId: sourceId,
      previousItemId: targetId,
    })),
];

// ==================== Duplication ====================

/**
 * A copy of an item, offset one grid cell (clamped to the room) — tables get
 * the next free number; guests are never copied (assignments stay put).
 */
export const buildDuplicate = (
  source: SeatingItem,
  items: SeatingItem[],
  roomWidthCm: number,
  roomHeightCm: number,
): Omit<SeatingItem, "id" | "event_id"> => {
  const pos = clampToRoom(
    { ...source, x_cm: source.x_cm + GRID_CM, y_cm: source.y_cm + GRID_CM },
    roomWidthCm,
    roomHeightCm,
  );
  return {
    kind: source.kind,
    shape: source.shape,
    label: source.label,
    table_number: source.kind === "table" ? nextTableNumber(items) : null,
    capacity: source.capacity,
    x_cm: pos.x_cm,
    y_cm: pos.y_cm,
    width_cm: source.width_cm,
    height_cm: source.height_cm,
    rotation_deg: source.rotation_deg,
    color: source.color,
  };
};

// ==================== Export rows ====================

export interface GuestExportRow {
  guestName: string;
  seats: number;
  tableNumber: number | null;
}

/**
 * The single export table (xlsx + print): guests alphabetically, each with the
 * party size and the table number. The export layer adds a blank "arrived"
 * column next to the seats for marking day-of corrections by hand.
 */
export const buildGuestExportRows = (
  items: SeatingItem[],
  assignments: SeatingAssignment[],
): GuestExportRow[] => {
  const tableById = new Map(items.map((i) => [i.id, i]));
  return assignments
    .map((a) => ({
      guestName: a.name ?? "",
      seats: seatCount(a),
      tableNumber: tableById.get(a.item_id)?.table_number ?? null,
    }))
    .sort((a, b) => a.guestName.localeCompare(b.guestName, "he"));
};
