/**
 * Seating arrangement tests.
 * Covers layout upsert, item CRUD + validation, guest-to-table assignments
 * (atomic parties, move-on-reassign, cascade on item delete, live RSVP join),
 * custom table presets, and ownership guards.
 */

import axios from "axios";
import { authHeader, TEST_USER_ID } from "../helpers/auth";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";

const USER_ID = TEST_USER_ID;
const WEDDING_EVENT_ID = 1;
const HENNA_EVENT_ID = 2;

type SeatingItem = {
  id: number;
  event_id: number;
  kind: string;
  shape: string;
  label: string | null;
  table_number: number | null;
  capacity: number | null;
  x_cm: number;
  y_cm: number;
  width_cm: number;
  height_cm: number;
  rotation_deg: number;
};

type SeatingAssignment = {
  id: number;
  item_id: number;
  event_guest_id: number;
  rsvp_status: number | null;
  name: string;
  number_of_guests: number;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const getSeating = async (eventId = WEDDING_EVENT_ID, userID = USER_ID) => {
  const { data } = await axios.get(`${REAL_SERVER}/events/${eventId}/seating`, {
    headers: authHeader(userID),
  });
  return data as {
    layout: { room_width_cm: number; room_height_cm: number } | null;
    items: SeatingItem[];
    assignments: SeatingAssignment[];
  };
};

const saveLayout = async (widthCm: number, heightCm: number, eventId = WEDDING_EVENT_ID) => {
  const { data } = await axios.patch(
    `${REAL_SERVER}/events/${eventId}/seating/layout`,
    { room_width_cm: widthCm, room_height_cm: heightCm },
    { headers: authHeader() },
  );
  return data as { id: number; room_width_cm: number; room_height_cm: number };
};

const baseTable = (overrides: Record<string, unknown> = {}) => ({
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

const createItem = async (item: Record<string, unknown>, eventId = WEDDING_EVENT_ID) => {
  const { data } = await axios.post(`${REAL_SERVER}/events/${eventId}/seating/items`, item, {
    headers: authHeader(),
  });
  return data as SeatingItem;
};

const updateItems = async (updates: Array<Record<string, unknown>>, eventId = WEDDING_EVENT_ID) => {
  const { data } = await axios.patch(
    `${REAL_SERVER}/events/${eventId}/seating/items`,
    { updates },
    { headers: authHeader() },
  );
  return data as SeatingItem[];
};

const deleteItem = (itemId: number, eventId = WEDDING_EVENT_ID) =>
  axios.delete(`${REAL_SERVER}/events/${eventId}/seating/items/${itemId}`, {
    headers: authHeader(),
  });

const assignGuest = async (itemId: number, eventGuestId: number, eventId = WEDDING_EVENT_ID) => {
  const { data } = await axios.post(
    `${REAL_SERVER}/events/${eventId}/seating/items/${itemId}/guests`,
    { eventGuestId },
    { headers: authHeader() },
  );
  return data as { id: number; item_id: number; event_guest_id: number };
};

const unassignGuest = (eventGuestId: number, eventId = WEDDING_EVENT_ID) =>
  axios.delete(`${REAL_SERVER}/events/${eventId}/seating/guests/${eventGuestId}`, {
    headers: authHeader(),
  });

/** The event_guests row id for a seeded guest, looked up by name (stable across id drift). */
const eventGuestIdByName = async (name: string, eventId = WEDDING_EVENT_ID) => {
  const { data } = await axios.get(`${REAL_SERVER}/events/${eventId}/guests`, {
    headers: authHeader(),
  });
  const row = (data as Array<{ id: number; name: string }>).find((g) => g.name === name);
  if (!row) throw new Error(`Seeded guest ${name} not found in event ${eventId}`);
  return row.id;
};

const setRsvp = (guestId: number, rsvpStatus: number | null, eventId = WEDDING_EVENT_ID) =>
  axios.post(
    `${REAL_SERVER}/updateRsvp`,
    { eventId, guestId, rsvpStatus },
    { headers: authHeader() },
  );

const createPreset = async (preset: Record<string, unknown>) => {
  const { data } = await axios.post(`${REAL_SERVER}/table-presets`, preset, {
    headers: authHeader(),
  });
  return data as { id: number; name: string };
};

// ── Cleanup: remove items/presets created during tests ───────────────────────
const createdItemIds: number[] = [];
const createdPresetIds: number[] = [];

afterEach(async () => {
  for (const id of createdItemIds) {
    try { await deleteItem(id); } catch { /* already deleted */ }
  }
  createdItemIds.length = 0;
  for (const id of createdPresetIds) {
    try {
      await axios.delete(`${REAL_SERVER}/table-presets/${id}`, { headers: authHeader() });
    } catch { /* already deleted */ }
  }
  createdPresetIds.length = 0;
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Seating layout", () => {
  it("starts empty and upserts room dimensions (update, not duplicate)", async () => {
    const first = await saveLayout(2000, 3000);
    expect(first.room_width_cm).toBe(2000);

    const second = await saveLayout(2500, 3000);
    expect(second.id).toBe(first.id);

    const { layout } = await getSeating();
    expect(layout).toMatchObject({ room_width_cm: 2500, room_height_cm: 3000 });
  });

  it("rejects non-positive-integer dimensions", async () => {
    await expect(
      axios.patch(
        `${REAL_SERVER}/events/${WEDDING_EVENT_ID}/seating/layout`,
        { room_width_cm: 20.5, room_height_cm: 3000 },
        { headers: authHeader() },
      ),
    ).rejects.toMatchObject({ response: { status: 400 } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Seating items", () => {
  it("creates a table and returns it with a DB id", async () => {
    const item = await createItem(baseTable({ label: "שולחן משפחה" }));
    createdItemIds.push(item.id);

    expect(item.id).toBeGreaterThan(0);
    expect(item).toMatchObject({
      event_id: WEDDING_EVENT_ID,
      kind: "table",
      shape: "circle",
      label: "שולחן משפחה",
      capacity: 12,
      width_cm: 180,
      height_cm: 180,
    });

    const { items } = await getSeating();
    expect(items.some((i) => i.id === item.id)).toBe(true);
  });

  it("rejects invalid items: bad kind, circle with width≠height, table without capacity", async () => {
    const invalid = [
      baseTable({ kind: "chair" }),
      baseTable({ shape: "circle", width_cm: 180, height_cm: 90 }),
      baseTable({ capacity: undefined }),
    ];
    for (const item of invalid) {
      await expect(
        axios.post(`${REAL_SERVER}/events/${WEDDING_EVENT_ID}/seating/items`, item, {
          headers: authHeader(),
        }),
      ).rejects.toMatchObject({ response: { status: 400 } });
    }
  });

  it("nulls table-only fields on objects", async () => {
    const item = await createItem({
      kind: "object", shape: "rect", label: "רחבת ריקודים",
      capacity: 50, table_number: 9, // should be ignored for objects
      x_cm: 0, y_cm: 0, width_cm: 500, height_cm: 500, rotation_deg: 0,
    });
    createdItemIds.push(item.id);
    expect(item.capacity).toBeNull();
    expect(item.table_number).toBeNull();
  });

  it("stores and updates an object's fill color, rejecting non-hex values", async () => {
    const obj = await createItem({
      kind: "object", shape: "circle", label: "עץ",
      x_cm: 0, y_cm: 0, width_cm: 100, height_cm: 100, rotation_deg: 0,
      color: "#a5c8a5",
    });
    createdItemIds.push(obj.id);
    expect((obj as any).color).toBe("#a5c8a5");

    const updated = await updateItems([{ id: obj.id, color: "#c9c9c9" }]);
    expect((updated[0] as any).color).toBe("#c9c9c9");

    await expect(updateItems([{ id: obj.id, color: "not-a-color" }]))
      .rejects.toMatchObject({ response: { status: 400 } });
  });

  it("batch-updates geometry (the autosave path)", async () => {
    const a = await createItem(baseTable({ table_number: 1 }));
    const b = await createItem(baseTable({ table_number: 2, x_cm: 500 }));
    createdItemIds.push(a.id, b.id);

    const updated = await updateItems([
      { id: a.id, x_cm: 350, y_cm: 400, rotation_deg: 45 },
      { id: b.id, label: "שולחן חברים", capacity: 10 },
    ]);

    expect(updated).toHaveLength(2);
    expect(updated.find((i) => i.id === a.id)).toMatchObject({ x_cm: 350, y_cm: 400, rotation_deg: 45 });
    expect(updated.find((i) => i.id === b.id)).toMatchObject({ label: "שולחן חברים", capacity: 10 });
  });

  it("batch update ignores items belonging to another event", async () => {
    const hennaItem = await createItem(baseTable(), HENNA_EVENT_ID);

    const updated = await updateItems([{ id: hennaItem.id, x_cm: 999 }], WEDDING_EVENT_ID);
    expect(updated).toHaveLength(0);

    const { items } = await getSeating(HENNA_EVENT_ID);
    expect(items.find((i) => i.id === hennaItem.id)?.x_cm).toBe(100);
    await deleteItem(hennaItem.id, HENNA_EVENT_ID);
  });

  it("clean canvas: deletes every item and its assignments, keeps the layout", async () => {
    await saveLayout(2000, 3000);
    const table = await createItem(baseTable());
    const obj = await createItem({
      kind: "object", shape: "rect", x_cm: 0, y_cm: 0, width_cm: 300, height_cm: 200, rotation_deg: 0,
    });
    const aliceEg = await eventGuestIdByName("Alice");
    await assignGuest(table.id, aliceEg);

    const { data } = await axios.delete(`${REAL_SERVER}/events/${WEDDING_EVENT_ID}/seating/items`, {
      headers: authHeader(),
    });
    expect(data).toEqual({ success: true, deleted: 2 });

    const seating = await getSeating();
    expect(seating.items).toHaveLength(0);
    expect(seating.assignments).toHaveLength(0);
    expect(seating.layout).not.toBeNull(); // the room itself survives
    void obj;
  });

  it("clean canvas is ownership-guarded", async () => {
    await expect(
      axios.delete(`${REAL_SERVER}/events/${WEDDING_EVENT_ID}/seating/items`, {
        headers: authHeader("someone-else"),
      }),
    ).rejects.toMatchObject({ response: { status: 404 } });
  });

  it("deletes an item; deleting again returns 404", async () => {
    const item = await createItem(baseTable());
    await deleteItem(item.id);
    const { items } = await getSeating();
    expect(items.some((i) => i.id === item.id)).toBe(false);

    await expect(deleteItem(item.id)).rejects.toMatchObject({ response: { status: 404 } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Guest assignments", () => {
  it("assigns a guest, joins live guest data, and moves them on re-assign (atomic party)", async () => {
    const table1 = await createItem(baseTable({ table_number: 1 }));
    const table2 = await createItem(baseTable({ table_number: 2, x_cm: 500 }));
    createdItemIds.push(table1.id, table2.id);
    const aliceEg = await eventGuestIdByName("Alice");

    await assignGuest(table1.id, aliceEg);
    let { assignments } = await getSeating();
    expect(assignments).toHaveLength(1);
    expect(assignments[0]).toMatchObject({
      item_id: table1.id,
      event_guest_id: aliceEg,
      name: "Alice",
      number_of_guests: 1,
    });

    // Re-assign → moved, still exactly one assignment
    await assignGuest(table2.id, aliceEg);
    ({ assignments } = await getSeating());
    expect(assignments).toHaveLength(1);
    expect(assignments[0].item_id).toBe(table2.id);

    await unassignGuest(aliceEg);
    ({ assignments } = await getSeating());
    expect(assignments).toHaveLength(0);
  });

  it("reflects live rsvp_status in the assignments join", async () => {
    const table = await createItem(baseTable());
    createdItemIds.push(table.id);
    const aliceEg = await eventGuestIdByName("Alice");
    const ALICE_GUEST_ID = 2; // seeded

    await assignGuest(table.id, aliceEg);
    try {
      await setRsvp(ALICE_GUEST_ID, 3);
      const { assignments } = await getSeating();
      expect(assignments[0].rsvp_status).toBe(3);
    } finally {
      // Restore the seeded state — other test files rely on Alice being pending
      await setRsvp(ALICE_GUEST_ID, null);
      await unassignGuest(aliceEg);
    }
  });

  it("rejects assigning to an object, to a foreign-event guest, or to a missing item", async () => {
    const object = await createItem({
      kind: "object", shape: "rect", x_cm: 0, y_cm: 0, width_cm: 300, height_cm: 200, rotation_deg: 0,
    });
    const table = await createItem(baseTable());
    createdItemIds.push(object.id, table.id);
    const aliceWeddingEg = await eventGuestIdByName("Alice");
    const aliceHennaEg = await eventGuestIdByName("Alice", HENNA_EVENT_ID);

    await expect(assignGuest(object.id, aliceWeddingEg))
      .rejects.toMatchObject({ response: { status: 400 } });
    await expect(assignGuest(table.id, aliceHennaEg))
      .rejects.toMatchObject({ response: { status: 404 } });
    await expect(assignGuest(999999, aliceWeddingEg))
      .rejects.toMatchObject({ response: { status: 404 } });
  });

  it("cascades assignments when their table is deleted", async () => {
    const table = await createItem(baseTable());
    const bobEg = await eventGuestIdByName("Bob");
    await assignGuest(table.id, bobEg);

    await deleteItem(table.id);
    const { assignments } = await getSeating();
    expect(assignments.some((a) => a.event_guest_id === bobEg)).toBe(false);
  });

  it("unassigning a guest with no assignment returns 404", async () => {
    const clareEg = await eventGuestIdByName("Clare");
    await expect(unassignGuest(clareEg)).rejects.toMatchObject({ response: { status: 404 } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Ownership guards", () => {
  it("returns 404 for another user's event across seating routes", async () => {
    const foreign = { headers: authHeader("someone-else") };
    await expect(
      axios.get(`${REAL_SERVER}/events/${WEDDING_EVENT_ID}/seating`, foreign),
    ).rejects.toMatchObject({ response: { status: 404 } });
    await expect(
      axios.post(`${REAL_SERVER}/events/${WEDDING_EVENT_ID}/seating/items`, baseTable(), foreign),
    ).rejects.toMatchObject({ response: { status: 404 } });
    await expect(
      axios.patch(
        `${REAL_SERVER}/events/${WEDDING_EVENT_ID}/seating/layout`,
        { room_width_cm: 1000, room_height_cm: 1000 },
        foreign,
      ),
    ).rejects.toMatchObject({ response: { status: 404 } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Custom table presets", () => {
  const basePreset = (overrides: Record<string, unknown> = {}) => ({
    name: "אביר 10",
    shape: "rect",
    width_cm: 300,
    height_cm: 100,
    capacity: 10,
    ...overrides,
  });

  it("creates, lists and deletes a preset", async () => {
    const preset = await createPreset(basePreset());
    createdPresetIds.push(preset.id);

    const { data: presets } = await axios.get(`${REAL_SERVER}/table-presets`, {
      headers: authHeader(),
    });
    expect(presets.some((p: any) => p.id === preset.id && p.name === "אביר 10")).toBe(true);

    await axios.delete(`${REAL_SERVER}/table-presets/${preset.id}`, { headers: authHeader() });
    createdPresetIds.length = 0;

    await expect(
      axios.delete(`${REAL_SERVER}/table-presets/${preset.id}`, { headers: authHeader() }),
    ).rejects.toMatchObject({ response: { status: 404 } });
  });

  it("rejects a duplicate name with 400 (unique per user)", async () => {
    const preset = await createPreset(basePreset({ name: "עגול 14" }));
    createdPresetIds.push(preset.id);

    await expect(createPreset(basePreset({ name: "עגול 14" })))
      .rejects.toMatchObject({ response: { status: 400 } });
  });

  it("rejects invalid presets: circle with width≠height, missing capacity", async () => {
    await expect(createPreset(basePreset({ shape: "circle", width_cm: 200, height_cm: 100 })))
      .rejects.toMatchObject({ response: { status: 400 } });
    await expect(createPreset(basePreset({ capacity: undefined })))
      .rejects.toMatchObject({ response: { status: 400 } });
  });

  it("creates an object preset without capacity (tree/stand style)", async () => {
    const preset = await createPreset({
      kind: "object", name: "עץ זית", shape: "circle", width_cm: 100, height_cm: 100,
      capacity: 999, // ignored for objects
    });
    createdPresetIds.push(preset.id);
    expect(preset).toMatchObject({ kind: "object", name: "עץ זית", capacity: null });
  });

  it("requires capacity when a preset is (or becomes) a table", async () => {
    // Creating a table without capacity fails (kind defaults to table)
    await expect(createPreset(basePreset({ name: "בלי מקומות", capacity: undefined })))
      .rejects.toMatchObject({ response: { status: 400 } });

    // Turning an object into a table without providing capacity fails too
    const obj = await createPreset({
      kind: "object", name: "עמוד", shape: "circle", width_cm: 60, height_cm: 60,
    });
    createdPresetIds.push(obj.id);
    await expect(
      axios.patch(`${REAL_SERVER}/table-presets/${obj.id}`, { kind: "table" }, { headers: authHeader() }),
    ).rejects.toMatchObject({ response: { status: 400 } });
  });

  it("updates a preset's fields (partial PATCH)", async () => {
    const preset = await createPreset(basePreset({ name: "לעריכה" }));
    createdPresetIds.push(preset.id);

    const { data: updated } = await axios.patch(
      `${REAL_SERVER}/table-presets/${preset.id}`,
      { name: "אחרי עריכה", capacity: 14 },
      { headers: authHeader() },
    );
    expect(updated).toMatchObject({
      id: preset.id, name: "אחרי עריכה", capacity: 14, width_cm: 300, height_cm: 100,
    });
  });

  it("validates PATCH against the merged preset (circle needs width==height)", async () => {
    const preset = await createPreset(basePreset({ name: "מלבן לעיגול" })); // 300×100 rect
    createdPresetIds.push(preset.id);

    // Turning it into a circle without fixing the dimensions must fail
    await expect(
      axios.patch(`${REAL_SERVER}/table-presets/${preset.id}`, { shape: "circle" }, { headers: authHeader() }),
    ).rejects.toMatchObject({ response: { status: 400 } });

    // With matching dimensions it succeeds
    const { data: updated } = await axios.patch(
      `${REAL_SERVER}/table-presets/${preset.id}`,
      { shape: "circle", width_cm: 180, height_cm: 180 },
      { headers: authHeader() },
    );
    expect(updated).toMatchObject({ shape: "circle", width_cm: 180, height_cm: 180 });
  });

  it("rejects renaming a preset onto an existing name, and 404s unknown/foreign presets", async () => {
    const a = await createPreset(basePreset({ name: "שם תפוס" }));
    const b = await createPreset(basePreset({ name: "שם פנוי" }));
    createdPresetIds.push(a.id, b.id);

    await expect(
      axios.patch(`${REAL_SERVER}/table-presets/${b.id}`, { name: "שם תפוס" }, { headers: authHeader() }),
    ).rejects.toMatchObject({ response: { status: 400 } });

    await expect(
      axios.patch(`${REAL_SERVER}/table-presets/999999`, { name: "לא קיים" }, { headers: authHeader() }),
    ).rejects.toMatchObject({ response: { status: 404 } });

    await expect(
      axios.patch(`${REAL_SERVER}/table-presets/${a.id}`, { name: "גנוב" }, { headers: authHeader("someone-else") }),
    ).rejects.toMatchObject({ response: { status: 404 } });
  });
});
