/**
 * Guest management tests.
 * Covers adding, removing, and event-assignment of guests.
 */

import axios from "axios";
import { authHeader, TEST_USER_ID } from "../helpers/auth";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";

const USER_ID = TEST_USER_ID;
const WEDDING_EVENT_ID = 1;
const HENNA_EVENT_ID = 2;

// ── Helpers ──────────────────────────────────────────────────────────────────

const addGuest = (name: string, phone: string) =>
  axios.patch(
    `${REAL_SERVER}/addGuests`,
    { guestsToAdd: [{ name, phone, whose: "bride", circle: "friends", number_of_guests: 1 }] },
    { headers: authHeader() },
  );

const deleteGuest = (guestId: number) =>
  axios.delete(`${REAL_SERVER}/deleteGuest`, {
    data: { guestId },
    headers: authHeader(),
  });

const addGuestToEvent = (eventId: number, guestIds: number[]) =>
  axios.post(`${REAL_SERVER}/events/${eventId}/guests`, { guestIds }, { headers: authHeader() });

const removeGuestFromEvent = (eventId: number, guestIds: number[]) =>
  axios.delete(`${REAL_SERVER}/events/${eventId}/guests`, {
    data: { guestIds },
    headers: authHeader(),
  });

const getEventGuests = async (eventId: number): Promise<Array<{ guest_id: number }>> => {
  const { data } = await axios.get(`${REAL_SERVER}/events/${eventId}/guests`, {
    headers: authHeader(),
  });
  return data;
};

const getAllGuests = async (): Promise<Array<{ id: number; name: string }>> => {
  const { data } = await axios.post(`${REAL_SERVER}/guestsList`, {}, { headers: authHeader() });
  return data;
};

// ── Track guests added during tests so they can be cleaned up ─────────────────
const createdGuestIds: number[] = [];

afterEach(async () => {
  for (const id of createdGuestIds) {
    try { await deleteGuest(id); } catch { /* already deleted */ }
  }
  createdGuestIds.length = 0;
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Add guest", () => {
  it("added guest appears in the global guest list", async () => {
    const { data } = await addGuest("Dana", "+972509999001");
    const newGuest = (data as Array<{ id: number; name: string }>).find((g) => g.name === "Dana");
    expect(newGuest).toBeDefined();
    createdGuestIds.push(newGuest!.id);
  });

  it("added guest can be assigned to an event and then appears in that event", async () => {
    const { data } = await addGuest("Ethan", "+972509999002");
    const newGuest = (data as Array<{ id: number }>).find((g: any) => g.name === "Ethan") as any;
    createdGuestIds.push(newGuest.id);

    await addGuestToEvent(WEDDING_EVENT_ID, [newGuest.id]);

    const eventGuests = await getEventGuests(WEDDING_EVENT_ID);
    expect(eventGuests.some((g) => g.guest_id === newGuest.id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Remove guest from event (not from account)", () => {
  it("removed from event → gone from that event, but still in global guest list", async () => {
    const { data } = await addGuest("Fiona", "+972509999003");
    const newGuest = (data as any[]).find((g) => g.name === "Fiona");
    createdGuestIds.push(newGuest.id);

    await addGuestToEvent(WEDDING_EVENT_ID, [newGuest.id]);
    await removeGuestFromEvent(WEDDING_EVENT_ID, [newGuest.id]);

    const eventGuests = await getEventGuests(WEDDING_EVENT_ID);
    expect(eventGuests.some((g) => g.guest_id === newGuest.id)).toBe(false);

    const allGuests = await getAllGuests();
    expect(allGuests.some((g) => g.id === newGuest.id)).toBe(true);
  });

  it("guest in two events, removed from one → still in the other", async () => {
    const { data } = await addGuest("George", "+972509999004");
    const newGuest = (data as any[]).find((g) => g.name === "George");
    createdGuestIds.push(newGuest.id);

    await addGuestToEvent(WEDDING_EVENT_ID, [newGuest.id]);
    await addGuestToEvent(HENNA_EVENT_ID, [newGuest.id]);

    await removeGuestFromEvent(HENNA_EVENT_ID, [newGuest.id]);

    const hennaGuests = await getEventGuests(HENNA_EVENT_ID);
    expect(hennaGuests.some((g) => g.guest_id === newGuest.id)).toBe(false);

    const weddingGuests = await getEventGuests(WEDDING_EVENT_ID);
    expect(weddingGuests.some((g) => g.guest_id === newGuest.id)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Delete guest entirely", () => {
  it("deleted guest disappears from the global guest list", async () => {
    const { data } = await addGuest("Hannah", "+972509999005");
    const newGuest = (data as any[]).find((g) => g.name === "Hannah");

    await deleteGuest(newGuest.id);

    const allGuests = await getAllGuests();
    expect(allGuests.some((g) => g.id === newGuest.id)).toBe(false);
  });

  it("deleted guest is removed from all events they were in", async () => {
    const { data } = await addGuest("Ivan", "+972509999006");
    const newGuest = (data as any[]).find((g) => g.name === "Ivan");

    await addGuestToEvent(WEDDING_EVENT_ID, [newGuest.id]);
    await addGuestToEvent(HENNA_EVENT_ID, [newGuest.id]);

    await deleteGuest(newGuest.id);

    const weddingGuests = await getEventGuests(WEDDING_EVENT_ID);
    const hennaGuests = await getEventGuests(HENNA_EVENT_ID);
    expect(weddingGuests.some((g) => g.guest_id === newGuest.id)).toBe(false);
    expect(hennaGuests.some((g) => g.guest_id === newGuest.id)).toBe(false);
  });
});
