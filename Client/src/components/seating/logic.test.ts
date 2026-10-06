import { EventGuest, SeatingAssignment, SeatingItem } from "../../types";
import {
  buildDuplicate,
  buildGuestExportRows,
  buildSwapEntries,
  canvasSeatStats,
  clampToRoom,
  clearTableNumberEntries,
  fillState,
  findOverlappingIds,
  fitScale,
  clampFontSize,
  clampPanelWidth,
  isLabelTruncated,
  itemsOverlap,
  loadStoredFontSize,
  loadStoredPanelWidth,
  moveItemsBy,
  needsAttention,
  nextTableNumber,
  renumberAfterDelete,
  snapRotationDeg,
  toggleSelection,
  OBJECT_COLORS,
  parseDragPayload,
  PRESET_OBJECTS,
  remapItemId,
  SeatingHistoryEntry,
  seatCount,
  seatingProgress,
  snapToGrid,
  tableAtPoint,
  tableDisplayName,
  tableTopLines,
  tableOccupancy,
} from "./logic";

const baseItem = (overrides: Partial<SeatingItem> = {}): SeatingItem => ({
  id: 1,
  event_id: 1,
  kind: "table",
  shape: "circle",
  label: null,
  table_number: 1,
  capacity: 12,
  x_cm: 100,
  y_cm: 100,
  width_cm: 180,
  height_cm: 180,
  rotation_deg: 0,
  ...overrides,
});

const baseAssignment = (overrides: Partial<SeatingAssignment> = {}): SeatingAssignment => ({
  id: 1,
  item_id: 1,
  event_guest_id: 1,
  rsvp_status: 3,
  name: "אורח",
  number_of_guests: 4,
  ...overrides,
});

const baseEventGuest = (overrides: Partial<EventGuest> = {}): EventGuest => ({
  id: 1,
  event_id: 1,
  guest_id: 1,
  rsvp_status: 3,
  name: "אורח",
  number_of_guests: 4,
  ...overrides,
});

describe("snapToGrid / clampToRoom", () => {
  it("snaps to the 50cm grid", () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(24)).toBe(0);
    expect(snapToGrid(25)).toBe(50);
    expect(snapToGrid(180)).toBe(200);
  });

  it("keeps an item inside the room", () => {
    const item = { x_cm: -50, y_cm: 2900, width_cm: 200, height_cm: 200 };
    expect(clampToRoom(item, 2000, 3000)).toEqual({ x_cm: 0, y_cm: 2800 });
  });

  it("pins an item larger than the room to the origin", () => {
    const item = { x_cm: 100, y_cm: 100, width_cm: 5000, height_cm: 5000 };
    expect(clampToRoom(item, 2000, 3000)).toEqual({ x_cm: 0, y_cm: 0 });
  });
});

describe("seatCount — occupancy per RSVP state", () => {
  it("confirmed guests occupy their confirmed count", () => {
    expect(seatCount({ rsvp_status: 3, number_of_guests: 5 })).toBe(3);
  });

  it("pending guests reserve their invited count (tentative)", () => {
    expect(seatCount({ rsvp_status: null, number_of_guests: 5 })).toBe(5);
    expect(seatCount({ rsvp_status: undefined, number_of_guests: 5 })).toBe(5);
  });

  it("declined guests occupy nothing", () => {
    expect(seatCount({ rsvp_status: 0, number_of_guests: 5 })).toBe(0);
  });

  it("falls back to a single seat when the invited count is missing", () => {
    expect(seatCount({ rsvp_status: null })).toBe(1);
  });
});

describe("tableOccupancy", () => {
  const assignments = [
    baseAssignment({ id: 1, item_id: 7, event_guest_id: 1, rsvp_status: 3 }),
    baseAssignment({ id: 2, item_id: 7, event_guest_id: 2, rsvp_status: null, number_of_guests: 2 }),
    baseAssignment({ id: 3, item_id: 7, event_guest_id: 3, rsvp_status: 0 }),
    baseAssignment({ id: 4, item_id: 8, event_guest_id: 4, rsvp_status: 5 }),
  ];

  it("sums confirmed + tentative for the table only, and flags both states", () => {
    expect(tableOccupancy(7, assignments)).toEqual({
      seated: 5, // 3 confirmed + 2 tentative + 0 declined
      hasTentative: true,
      hasDeclined: true,
    });
    expect(tableOccupancy(8, assignments)).toEqual({
      seated: 5,
      hasTentative: false,
      hasDeclined: false,
    });
  });
});

describe("fillState", () => {
  it("maps occupancy to the fill state", () => {
    expect(fillState(0, 10)).toBe("empty");
    expect(fillState(4, 10)).toBe("partial");
    expect(fillState(10, 10)).toBe("full");
    expect(fillState(11, 10)).toBe("over"); // warn, never block
    expect(fillState(3, null)).toBe("partial");
  });
});

describe("needsAttention", () => {
  it("returns only declined-but-seated assignments", () => {
    const declined = baseAssignment({ id: 2, rsvp_status: 0 });
    expect(needsAttention([baseAssignment(), declined, baseAssignment({ id: 3, rsvp_status: null })]))
      .toEqual([declined]);
  });
});

describe("seatingProgress", () => {
  it("counts seated confirmed attendees out of all confirmed attendees", () => {
    const guests = [
      baseEventGuest({ id: 1, rsvp_status: 3 }), // seated
      baseEventGuest({ id: 2, rsvp_status: 2 }), // not seated
      baseEventGuest({ id: 3, rsvp_status: null }), // pending — excluded
      baseEventGuest({ id: 4, rsvp_status: 0 }), // declined — excluded
    ];
    const assignments = [baseAssignment({ event_guest_id: 1, rsvp_status: 3 })];
    expect(seatingProgress(guests, assignments)).toEqual({ seatedGuests: 3, totalGuests: 5 });
  });
});

describe("table identity", () => {
  it("auto-numbers past the highest existing table, ignoring objects", () => {
    const items = [
      baseItem({ id: 1, table_number: 2 }),
      baseItem({ id: 2, kind: "object", table_number: null }),
      baseItem({ id: 3, table_number: 7 }),
    ];
    expect(nextTableNumber(items)).toBe(8);
    expect(nextTableNumber([])).toBe(1);
  });

  it("prefers the label over the table number", () => {
    expect(tableDisplayName({ label: "שולחן ילדים", table_number: 3 })).toBe("שולחן ילדים");
    expect(tableDisplayName({ label: "  ", table_number: 3 })).toBe("שולחן 3");
    expect(tableDisplayName({ label: null, table_number: 3 })).toBe("שולחן 3");
  });
});

describe("tableTopLines", () => {
  it("shows the table number even when a custom label hides it, plus the occupancy flags", () => {
    expect(tableTopLines(
      { table_number: 5, capacity: 12 },
      { seated: 7, hasTentative: true, hasDeclined: true },
    )).toEqual({ numberLine: "5", capacityLine: "7/12 ? ✕" });
  });

  it("omits the number line when the table has none, and tolerates missing data", () => {
    expect(tableTopLines({ table_number: null, capacity: null }, null))
      .toEqual({ numberLine: null, capacityLine: "0/?" });
  });
});

describe("renumberAfterDelete", () => {
  it("shifts only the tables numbered above the deleted number", () => {
    const items = [
      baseItem({ id: 1, table_number: 1 }),
      baseItem({ id: 3, table_number: 3 }),
      baseItem({ id: 4, table_number: 4 }),
    ];
    expect(renumberAfterDelete(items, [2])).toEqual([
      { id: 3, before: 3, after: 2 },
      { id: 4, before: 4, after: 3 },
    ]);
  });

  it("returns nothing when the deleted table had the highest number", () => {
    const items = [baseItem({ id: 1, table_number: 1 }), baseItem({ id: 2, table_number: 2 })];
    expect(renumberAfterDelete(items, [3])).toEqual([]);
  });

  it("closes multiple gaps at once (multi-delete)", () => {
    const items = [
      baseItem({ id: 1, table_number: 1 }),
      baseItem({ id: 4, table_number: 4 }),
      baseItem({ id: 6, table_number: 6 }),
    ];
    // tables 2, 3 and 5 were deleted
    expect(renumberAfterDelete(items, [2, 3, 5])).toEqual([
      { id: 4, before: 4, after: 2 },
      { id: 6, before: 6, after: 3 },
    ]);
  });

  it("ignores objects and tables without a number", () => {
    const items = [
      baseItem({ id: 1, kind: "object", table_number: null }),
      baseItem({ id: 2, table_number: null }),
      baseItem({ id: 3, table_number: 5 }),
    ];
    expect(renumberAfterDelete(items, [2])).toEqual([{ id: 3, before: 5, after: 4 }]);
  });
});

describe("clearTableNumberEntries", () => {
  it("builds an update entry per numbered table, remembering the old number", () => {
    const items = [
      baseItem({ id: 1, table_number: 3 }),
      baseItem({ id: 2, table_number: 7 }),
    ];
    expect(clearTableNumberEntries(items)).toEqual([
      { type: "update", itemId: 1, before: { table_number: 3 }, after: { table_number: null } },
      { type: "update", itemId: 2, before: { table_number: 7 }, after: { table_number: null } },
    ]);
  });

  it("skips objects and tables that already have no number", () => {
    const items = [
      baseItem({ id: 1, kind: "object", table_number: null }),
      baseItem({ id: 2, table_number: null }),
      baseItem({ id: 3, table_number: 2 }),
    ];
    expect(clearTableNumberEntries(items)).toEqual([
      { type: "update", itemId: 3, before: { table_number: 2 }, after: { table_number: null } },
    ]);
  });

  it("returns nothing when no table is numbered (button stays disabled)", () => {
    expect(clearTableNumberEntries([baseItem({ id: 1, table_number: null })])).toEqual([]);
  });
});

describe("overlap detection", () => {
  it("detects circle-circle overlap by center distance", () => {
    const a = baseItem({ id: 1, x_cm: 0, y_cm: 0 }); // center (90,90), r=90
    const near = baseItem({ id: 2, x_cm: 100, y_cm: 0 }); // center (190,90) — 100 < 180
    const far = baseItem({ id: 3, x_cm: 200, y_cm: 0 }); // center (290,90) — 200 > 180
    expect(itemsOverlap(a, near)).toBe(true);
    expect(itemsOverlap(a, far)).toBe(false);
  });

  it("detects rect-rect overlap and respects rotation bounds", () => {
    const a = baseItem({ id: 1, shape: "rect", x_cm: 0, y_cm: 0, width_cm: 200, height_cm: 100 });
    // Just below a (y 110..210) — clear when unrotated
    const below = baseItem({ id: 2, shape: "rect", x_cm: 0, y_cm: 110, width_cm: 200, height_cm: 100 });
    expect(itemsOverlap(a, below)).toBe(false);
    // Rotated 90° about its center (100,160), its bounds become y∈[60,260] — into a's space
    const rotated = baseItem({ id: 2, shape: "rect", x_cm: 0, y_cm: 110, width_cm: 200, height_cm: 100, rotation_deg: 90 });
    expect(itemsOverlap(a, rotated)).toBe(true);
  });

  it("collects the ids of every overlapping item", () => {
    const items = [
      baseItem({ id: 1, x_cm: 0, y_cm: 0 }),
      baseItem({ id: 2, x_cm: 100, y_cm: 0 }),
      baseItem({ id: 3, x_cm: 1000, y_cm: 1000 }),
    ];
    expect(findOverlappingIds(items)).toEqual(new Set([1, 2]));
  });
});

describe("tableAtPoint (guest drop hit-testing)", () => {
  it("hits circles by radius and ignores objects", () => {
    const items = [
      baseItem({ id: 1, kind: "object", shape: "rect", x_cm: 0, y_cm: 0, width_cm: 400, height_cm: 400 }),
      baseItem({ id: 2, x_cm: 100, y_cm: 100 }), // circle table, center (190,190), r=90
    ];
    expect(tableAtPoint(items, 190, 190)?.id).toBe(2);
    expect(tableAtPoint(items, 50, 50)).toBeNull(); // inside the object only
  });

  it("hits rotated rects in their local frame", () => {
    // 200×100 rect centered at (100,50), rotated 90° → occupies x∈[50,150], y∈[-50,150]
    const table = baseItem({ id: 1, shape: "rect", x_cm: 0, y_cm: 0, width_cm: 200, height_cm: 100, rotation_deg: 90 });
    expect(tableAtPoint([table], 100, 140)?.id).toBe(1); // inside only when rotated
    expect(tableAtPoint([table], 190, 90)).toBeNull(); // inside only when NOT rotated
  });
});

describe("fitScale", () => {
  it("fits the room into the viewport with padding", () => {
    // 2000×1000cm room into 1040×540px view with 20px padding → 1000×500 usable → 0.5
    expect(fitScale(2000, 1000, 1040, 540, 20)).toBe(0.5);
  });
});

describe("parseDragPayload", () => {
  it("accepts known payloads and rejects garbage", () => {
    expect(parseDragPayload(JSON.stringify({ type: "guest", eventGuestId: 5 })))
      .toEqual({ type: "guest", eventGuestId: 5 });
    expect(parseDragPayload("not json")).toBeNull();
    expect(parseDragPayload(JSON.stringify({ type: "unknown" }))).toBeNull();
    expect(parseDragPayload("")).toBeNull();
  });
});

describe("canvasSeatStats", () => {
  it("sums table capacities against occupied seats, ignoring objects", () => {
    const items = [
      baseItem({ id: 1, capacity: 12 }),
      baseItem({ id: 2, capacity: 8 }),
      baseItem({ id: 3, kind: "object", capacity: null }),
    ];
    const assignments = [
      baseAssignment({ id: 1, item_id: 1, rsvp_status: 3 }), // 3 confirmed
      baseAssignment({ id: 2, item_id: 2, event_guest_id: 2, rsvp_status: null, number_of_guests: 2 }), // 2 tentative
      baseAssignment({ id: 3, item_id: 2, event_guest_id: 3, rsvp_status: 0 }), // declined — 0
    ];
    expect(canvasSeatStats(items, assignments)).toEqual({
      totalSeats: 20,
      takenSeats: 5,
      freeSeats: 15,
    });
  });

  it("never reports negative free seats on overbooked plans", () => {
    const items = [baseItem({ id: 1, capacity: 2 })];
    const assignments = [baseAssignment({ item_id: 1, rsvp_status: 5 })];
    expect(canvasSeatStats(items, assignments)).toEqual({
      totalSeats: 2,
      takenSeats: 5,
      freeSeats: 0,
    });
  });

  it("is all zeros on an empty canvas", () => {
    expect(canvasSeatStats([], [])).toEqual({ totalSeats: 0, takenSeats: 0, freeSeats: 0 });
  });
});

describe("preset object colors", () => {
  it("every preset object has a default color from the offered palette", () => {
    for (const entry of PRESET_OBJECTS) {
      expect(entry.color).toBeDefined();
      expect(OBJECT_COLORS).toContain(entry.color);
    }
  });
});

describe("buildSwapEntries", () => {
  const assignments = [
    baseAssignment({ id: 1, item_id: 10, event_guest_id: 1 }),
    baseAssignment({ id: 2, item_id: 10, event_guest_id: 2 }),
    baseAssignment({ id: 3, item_id: 20, event_guest_id: 3 }),
    baseAssignment({ id: 4, item_id: 99, event_guest_id: 4 }), // another table — untouched
  ];

  it("moves each side's guests to the other table, remembering their origin", () => {
    expect(buildSwapEntries(10, 20, assignments)).toEqual([
      { type: "assign", eventGuestId: 1, itemId: 20, previousItemId: 10 },
      { type: "assign", eventGuestId: 2, itemId: 20, previousItemId: 10 },
      { type: "assign", eventGuestId: 3, itemId: 10, previousItemId: 20 },
    ]);
  });

  it("swapping with an empty table is a plain move", () => {
    expect(buildSwapEntries(20, 30, assignments)).toEqual([
      { type: "assign", eventGuestId: 3, itemId: 30, previousItemId: 20 },
    ]);
  });
});

describe("buildDuplicate", () => {
  it("copies the item one grid cell over, without its guests, with the next table number", () => {
    const source = baseItem({ id: 5, table_number: 3, label: "שולחן ילדים", x_cm: 100, y_cm: 200, rotation_deg: 45 });
    const items = [source, baseItem({ id: 6, table_number: 7 })];
    const dup = buildDuplicate(source, items, 2000, 3000);
    expect(dup).toEqual({
      kind: "table",
      shape: "circle",
      label: "שולחן ילדים",
      table_number: 8, // next free number, not the source's
      capacity: 12,
      x_cm: 150,
      y_cm: 250,
      width_cm: 180,
      height_cm: 180,
      rotation_deg: 45,
    });
    expect((dup as any).id).toBeUndefined();
  });

  it("clamps the offset copy inside the room", () => {
    const source = baseItem({ x_cm: 1820, y_cm: 2820 }); // 180-wide item at the far corner
    const dup = buildDuplicate(source, [source], 2000, 3000);
    expect(dup.x_cm).toBe(1820);
    expect(dup.y_cm).toBe(2820);
  });

  it("keeps objects unnumbered and copies their color", () => {
    const source = baseItem({ kind: "object", table_number: null, capacity: null, label: "בר", color: "#c9c9c9" });
    const dup = buildDuplicate(source, [source], 2000, 3000);
    expect(dup.table_number).toBeNull();
    expect(dup.color).toBe("#c9c9c9");
  });
});

describe("remapItemId (undo-of-delete id remapping)", () => {
  const entries: SeatingHistoryEntry[] = [
    { type: "update", itemId: 5, before: { x_cm: 0 }, after: { x_cm: 50 } },
    { type: "update", itemId: 9, before: { x_cm: 0 }, after: { x_cm: 100 } },
    {
      type: "delete",
      item: baseItem({ id: 5 }),
      assignments: [baseAssignment({ item_id: 5 }), baseAssignment({ id: 2, item_id: 9 })],
    },
    { type: "assign", eventGuestId: 1, itemId: 5, previousItemId: 9 },
    { type: "assign", eventGuestId: 2, itemId: 9, previousItemId: 5 },
    { type: "unassign", eventGuestId: 3, itemId: 5 },
    {
      type: "batch",
      entries: [
        { type: "update", itemId: 5, before: { label: null }, after: { label: "x" } },
        { type: "assign", eventGuestId: 4, itemId: 5, previousItemId: null },
      ],
    },
  ];

  it("rewrites the old id everywhere it appears, leaving other ids alone", () => {
    const remapped = remapItemId(entries, 5, 77);
    expect(remapped[0]).toMatchObject({ type: "update", itemId: 77 });
    expect(remapped[1]).toMatchObject({ type: "update", itemId: 9 });
    const del = remapped[2] as Extract<SeatingHistoryEntry, { type: "create" | "delete" }>;
    expect(del.item.id).toBe(77);
    expect(del.assignments.map((a) => a.item_id)).toEqual([77, 9]);
    expect(remapped[3]).toMatchObject({ type: "assign", itemId: 77, previousItemId: 9 });
    expect(remapped[4]).toMatchObject({ type: "assign", itemId: 9, previousItemId: 77 });
    expect(remapped[5]).toMatchObject({ type: "unassign", itemId: 77 });
    // Batch entries (modal saves) are remapped through their sub-entries
    expect(remapped[6]).toMatchObject({
      type: "batch",
      entries: [
        { type: "update", itemId: 77 },
        { type: "assign", itemId: 77, previousItemId: null },
      ],
    });
  });

  it("does not mutate the original entries", () => {
    remapItemId(entries, 5, 77);
    expect((entries[0] as any).itemId).toBe(5);
    expect((entries[2] as any).item.id).toBe(5);
  });
});

describe("export rows", () => {
  const items = [
    baseItem({ id: 1, table_number: 1 }),
    baseItem({ id: 2, table_number: 2, label: "שולחן חברים" }),
    baseItem({ id: 3, kind: "object", table_number: null, label: "בר" }),
  ];
  const assignments = [
    baseAssignment({ id: 1, item_id: 2, event_guest_id: 1, name: "גל", rsvp_status: 2 }),
    baseAssignment({ id: 2, item_id: 1, event_guest_id: 2, name: "אבי", rsvp_status: null, number_of_guests: 4 }),
  ];

  it("lists guests alphabetically with party size and table number only", () => {
    expect(buildGuestExportRows(items, assignments)).toEqual([
      { guestName: "אבי", seats: 4, tableNumber: 1 },
      // A labeled table still exports its number
      { guestName: "גל", seats: 2, tableNumber: 2 },
    ]);
  });

  it("exports a null table number when the table no longer exists", () => {
    expect(buildGuestExportRows([], assignments).map((r) => r.tableNumber)).toEqual([null, null]);
  });
});

describe("snapRotationDeg", () => {
  it("locks onto right angles within tolerance", () => {
    expect(snapRotationDeg(0)).toBe(0);
    expect(snapRotationDeg(4)).toBe(0);
    expect(snapRotationDeg(-5)).toBe(0); // 355 → snaps back to 0
    expect(snapRotationDeg(87)).toBe(90);
    expect(snapRotationDeg(93)).toBe(90);
    expect(snapRotationDeg(176)).toBe(180);
    expect(snapRotationDeg(267)).toBe(270);
    expect(snapRotationDeg(356)).toBe(0);
  });

  it("leaves angles outside the tolerance untouched (normalized to 0–359)", () => {
    expect(snapRotationDeg(45)).toBe(45);
    expect(snapRotationDeg(99)).toBe(99);
    expect(snapRotationDeg(-45)).toBe(315);
    expect(snapRotationDeg(405)).toBe(45);
  });
});

describe("toggleSelection", () => {
  it("plain click selects exactly the clicked item", () => {
    expect(toggleSelection([], 5, false)).toEqual([5]);
    expect(toggleSelection([1, 2], 5, false)).toEqual([5]);
    expect(toggleSelection([5], 5, false)).toEqual([5]);
  });

  it("additive click toggles membership, preserving selection order", () => {
    expect(toggleSelection([], 5, true)).toEqual([5]);
    expect(toggleSelection([1, 2], 5, true)).toEqual([1, 2, 5]);
    expect(toggleSelection([1, 5, 2], 5, true)).toEqual([1, 2]);
  });
});

describe("moveItemsBy", () => {
  const items = [
    baseItem({ id: 1, x_cm: 100, y_cm: 100 }),
    baseItem({ id: 2, x_cm: 400, y_cm: 300 }),
  ];

  it("moves every selected item by the same delta, snapped to the grid", () => {
    expect(moveItemsBy(items, [1, 2], 160, -40, 2000, 2000)).toEqual([
      { id: 1, x_cm: 250, y_cm: 50 },
      { id: 2, x_cm: 550, y_cm: 250 },
    ]);
  });

  it("clamps each item to the room independently", () => {
    // Items are 180cm wide; room 1000 → max top-left x is 820
    expect(moveItemsBy(items, [1, 2], 600, 0, 1000, 1000)).toEqual([
      { id: 1, x_cm: 700, y_cm: 100 },
      { id: 2, x_cm: 820, y_cm: 300 },
    ]);
  });

  it("ignores ids that are not on the canvas", () => {
    expect(moveItemsBy(items, [1, 99], 50, 0, 2000, 2000)).toEqual([
      { id: 1, x_cm: 150, y_cm: 100 },
    ]);
  });
});

describe("item text", () => {
  it("clampFontSize keeps the size inside the allowed range", () => {
    expect(clampFontSize(30)).toBe(30);
    expect(clampFontSize(5)).toBe(10);
    expect(clampFontSize(500)).toBe(100);
  });

  it("loadStoredFontSize parses the localStorage value, falling back to the default", () => {
    expect(loadStoredFontSize("45")).toBe(45);
    expect(loadStoredFontSize("5")).toBe(10); // clamped into range
    expect(loadStoredFontSize("200")).toBe(100);
    expect(loadStoredFontSize(null)).toBe(30);
    expect(loadStoredFontSize("not-a-number")).toBe(30);
    expect(loadStoredFontSize("30.5")).toBe(30); // non-integer → default
  });

  it("side-panel width: clamps drags and parses the stored preference", () => {
    expect(clampPanelWidth(380)).toBe(380);
    expect(clampPanelWidth(100)).toBe(240); // can't be dragged narrower
    expect(clampPanelWidth(5000)).toBe(640); // or wider
    expect(clampPanelWidth(380.6)).toBe(381);
    expect(loadStoredPanelWidth("420")).toBe(420);
    expect(loadStoredPanelWidth("100")).toBe(240);
    expect(loadStoredPanelWidth(null)).toBe(380);
    expect(loadStoredPanelWidth("garbage")).toBe(380);
  });

  it("isLabelTruncated compares measured text width against the item width", () => {
    const measure = (text: string, fontSize: number) => text.length * fontSize;
    expect(isLabelTruncated("שולחן ארוך מאוד", 30, 180, measure)).toBe(true);
    expect(isLabelTruncated("קצר", 30, 180, measure)).toBe(false);
    expect(isLabelTruncated("", 30, 180, measure)).toBe(false);
    // Bigger font can push the same text over the edge
    expect(isLabelTruncated("שולחן", 30, 180, measure)).toBe(false);
    expect(isLabelTruncated("שולחן", 40, 180, measure)).toBe(true);
  });
});
