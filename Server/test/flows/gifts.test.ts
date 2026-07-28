/**
 * Gift tracking tests.
 * Covers adding, listing, validating, and deleting monetary gifts from guests.
 */

import axios from "axios";
import { authHeader } from "../helpers/auth";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";

// ── Helpers ──────────────────────────────────────────────────────────────────

const addGuest = async (name: string, phone: string): Promise<{ id: number }> => {
  const { data } = await axios.patch(
    `${REAL_SERVER}/addGuests`,
    { guestsToAdd: [{ name, phone, whose: "bride", circle: "friends", number_of_guests: 2 }] },
    { headers: authHeader() },
  );
  return (data as Array<{ id: number; name: string }>).find((g) => g.name === name)!;
};

const deleteGuest = (guestId: number) =>
  axios.delete(`${REAL_SERVER}/deleteGuest`, { data: { guestId }, headers: authHeader() });

const addGift = (guestId: number, giftType: string, amount: number, userID?: string, otherDescription?: string) =>
  axios.post(
    `${REAL_SERVER}/gifts`,
    { guest_id: guestId, gift_type: giftType, amount, other_description: otherDescription },
    { headers: authHeader(userID) },
  );

const getGifts = async (userID?: string): Promise<Array<{ gift_id: number; guest_id: number; gift_type: string; amount: number }>> => {
  const { data } = await axios.get(`${REAL_SERVER}/gifts`, { headers: authHeader(userID) });
  return data;
};

const updateGift = (giftId: number, giftType: string, amount: number, userID?: string, otherDescription?: string) =>
  axios.patch(
    `${REAL_SERVER}/gifts/${giftId}`,
    { gift_type: giftType, amount, other_description: otherDescription },
    { headers: authHeader(userID) },
  );

const deleteGift = (giftId: number, userID?: string) =>
  axios.delete(`${REAL_SERVER}/gifts/${giftId}`, { headers: authHeader(userID) });

// ── Track rows added during tests so they can be cleaned up ──────────────────

const createdGuestIds: number[] = [];
const createdGiftIds: number[] = [];

afterEach(async () => {
  for (const id of createdGiftIds) {
    try { await deleteGift(id); } catch { /* already deleted */ }
  }
  createdGiftIds.length = 0;
  for (const id of createdGuestIds) {
    try { await deleteGuest(id); } catch { /* already deleted */ }
  }
  createdGuestIds.length = 0;
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Add gift", () => {
  it("added gift appears in the gift list with its type and numeric amount", async () => {
    const guest = await addGuest("Gifty", "+972509998001");
    createdGuestIds.push(guest.id);

    const { status, data } = await addGift(guest.id, "check", 750.5);
    expect(status).toBe(201);
    createdGiftIds.push(data.gift_id);

    const gifts = await getGifts();
    const gift = gifts.find((g) => g.gift_id === data.gift_id);
    expect(gift).toBeDefined();
    expect(gift!.guest_id).toBe(guest.id);
    expect(gift!.gift_type).toBe("check");
    expect(gift!.amount).toBe(750.5);
  });

  it("a guest can give more than one gift", async () => {
    const guest = await addGuest("Doubly", "+972509998002");
    createdGuestIds.push(guest.id);

    const { data: cash } = await addGift(guest.id, "cash", 300);
    const { data: bit } = await addGift(guest.id, "bit", 200);
    createdGiftIds.push(cash.gift_id, bit.gift_id);

    const gifts = await getGifts();
    const guestGifts = gifts.filter((g) => g.guest_id === guest.id);
    expect(guestGifts).toHaveLength(2);
    expect(guestGifts.reduce((sum, g) => sum + g.amount, 0)).toBe(500);
  });

  it("rejects an unknown gift type", async () => {
    const guest = await addGuest("Picky", "+972509998003");
    createdGuestIds.push(guest.id);

    await expect(addGift(guest.id, "crypto", 100)).rejects.toMatchObject({
      response: { status: 400 },
    });
  });

  it("rejects a non-positive amount", async () => {
    const guest = await addGuest("Zero", "+972509998004");
    createdGuestIds.push(guest.id);

    await expect(addGift(guest.id, "cash", 0)).rejects.toMatchObject({
      response: { status: 400 },
    });
    await expect(addGift(guest.id, "cash", -50)).rejects.toMatchObject({
      response: { status: 400 },
    });
  });

  it("accepts an 'other' gift with a free-text description", async () => {
    const guest = await addGuest("Freeform", "+972509998013");
    createdGuestIds.push(guest.id);

    const { status, data } = await addGift(guest.id, "other", 350, undefined, "שובר מתנה");
    expect(status).toBe(201);
    createdGiftIds.push(data.gift_id);
    expect(data.gift_type).toBe("other");
    expect(data.other_description).toBe("שובר מתנה");

    const gifts = await getGifts();
    const persisted = gifts.find((g) => g.gift_id === data.gift_id) as any;
    expect(persisted.other_description).toBe("שובר מתנה");
  });

  it("rejects an 'other' gift without a description, and drops the description for named types", async () => {
    const guest = await addGuest("Vague", "+972509998014");
    createdGuestIds.push(guest.id);

    await expect(addGift(guest.id, "other", 100)).rejects.toMatchObject({
      response: { status: 400 },
    });
    await expect(addGift(guest.id, "other", 100, undefined, "   ")).rejects.toMatchObject({
      response: { status: 400 },
    });

    // A description sent with a named type is discarded, not stored
    const { data } = await addGift(guest.id, "cash", 100, undefined, "ignore me");
    createdGiftIds.push(data.gift_id);
    expect(data.other_description).toBeNull();
  });

  it("rejects a gift for a guest that belongs to another user", async () => {
    const guest = await addGuest("Foreign", "+972509998005");
    createdGuestIds.push(guest.id);

    await expect(addGift(guest.id, "cash", 100, "some-other-user")).rejects.toMatchObject({
      response: { status: 404 },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Update gift", () => {
  it("updates the gift's type and amount", async () => {
    const guest = await addGuest("Changer", "+972509998010");
    createdGuestIds.push(guest.id);

    const { data: gift } = await addGift(guest.id, "cash", 300);
    createdGiftIds.push(gift.gift_id);

    const { status, data: updated } = await updateGift(gift.gift_id, "check", 450);
    expect(status).toBe(200);
    expect(updated.gift_type).toBe("check");
    expect(updated.amount).toBe(450);

    const gifts = await getGifts();
    const persisted = gifts.find((g) => g.gift_id === gift.gift_id);
    expect(persisted!.gift_type).toBe("check");
    expect(persisted!.amount).toBe(450);
  });

  it("rejects an unknown gift type and a non-positive amount", async () => {
    const guest = await addGuest("Strict", "+972509998011");
    createdGuestIds.push(guest.id);

    const { data: gift } = await addGift(guest.id, "bit", 100);
    createdGiftIds.push(gift.gift_id);

    await expect(updateGift(gift.gift_id, "crypto", 100)).rejects.toMatchObject({
      response: { status: 400 },
    });
    await expect(updateGift(gift.gift_id, "cash", 0)).rejects.toMatchObject({
      response: { status: 400 },
    });
  });

  it("can change a gift to 'other' with a description, and back to a named type clearing it", async () => {
    const guest = await addGuest("Flipper", "+972509998015");
    createdGuestIds.push(guest.id);

    const { data: gift } = await addGift(guest.id, "cash", 300);
    createdGiftIds.push(gift.gift_id);

    // → other requires a description
    await expect(updateGift(gift.gift_id, "other", 300)).rejects.toMatchObject({
      response: { status: 400 },
    });
    const { data: asOther } = await updateGift(gift.gift_id, "other", 300, undefined, "תכשיט");
    expect(asOther.other_description).toBe("תכשיט");

    // → back to a named type clears the stored description
    const { data: asCheck } = await updateGift(gift.gift_id, "check", 300, undefined, "stale");
    expect(asCheck.gift_type).toBe("check");
    expect(asCheck.other_description).toBeNull();
  });

  it("cannot update another user's gift", async () => {
    const guest = await addGuest("Shielded", "+972509998012");
    createdGuestIds.push(guest.id);

    const { data: gift } = await addGift(guest.id, "cash", 200);
    createdGiftIds.push(gift.gift_id);

    await expect(updateGift(gift.gift_id, "check", 999, "some-other-user")).rejects.toMatchObject({
      response: { status: 404 },
    });

    // Original values are untouched
    const gifts = await getGifts();
    const persisted = gifts.find((g) => g.gift_id === gift.gift_id);
    expect(persisted!.gift_type).toBe("cash");
    expect(persisted!.amount).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Delete gift", () => {
  it("deleted gift disappears from the gift list", async () => {
    const guest = await addGuest("Briefly", "+972509998006");
    createdGuestIds.push(guest.id);

    const { data: gift } = await addGift(guest.id, "paybox", 400);
    const { status } = await deleteGift(gift.gift_id);
    expect(status).toBe(200);

    const gifts = await getGifts();
    expect(gifts.some((g) => g.gift_id === gift.gift_id)).toBe(false);
  });

  it("cannot delete another user's gift", async () => {
    const guest = await addGuest("Guarded", "+972509998007");
    createdGuestIds.push(guest.id);

    const { data: gift } = await addGift(guest.id, "buyme", 250);
    createdGiftIds.push(gift.gift_id);

    await expect(deleteGift(gift.gift_id, "some-other-user")).rejects.toMatchObject({
      response: { status: 404 },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Gift/guest coupling", () => {
  it("deleting a guest also deletes their gifts", async () => {
    const guest = await addGuest("Ephemeral", "+972509998008");

    const { data: gift } = await addGift(guest.id, "bank_transfer", 1000);
    await deleteGuest(guest.id);

    const gifts = await getGifts();
    expect(gifts.some((g) => g.gift_id === gift.gift_id)).toBe(false);
  });
});
