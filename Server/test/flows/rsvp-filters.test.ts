/**
 * sendMessage messageType filter tests.
 * Verifies that rsvpReminder targets only pending guests,
 * weddingReminder targets only approved guests,
 * and guestIds filtering works correctly.
 *
 * Uses the wedding event (id=1) with:
 *   Alice (id=2)  +972501111111
 *   Bob   (id=3)  +972502222222
 *   Clare (id=4)  +972503333333
 */

import axios from "axios";
import { MockWhatsAppClient } from "../mock-whatsapp/client";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
const mock = new MockWhatsAppClient(3001);

const USER_ID = "test-user-id";
const WEDDING_EVENT_ID = 1;
const ALICE_ID = 2;
const BOB_ID = 3;
const CLARE_ID = 4;
const ALICE_PHONE = "+972501111111";
const BOB_PHONE = "+972502222222";
const CLARE_PHONE = "+972503333333";

const setRsvp = (guestId: number, rsvpStatus: number | null) =>
  axios.post(`${REAL_SERVER}/updateRsvp`, {
    userID: USER_ID,
    eventId: WEDDING_EVENT_ID,
    guestId,
    rsvpStatus,
  });

const setAllWeddingGuestsRsvp = async (rsvpStatus: number | null) => {
  const { data } = await axios.get(`${REAL_SERVER}/events/${WEDDING_EVENT_ID}/guests`, {
    params: { userID: USER_ID },
  });
  for (const g of data as Array<{ guest_id: number }>) {
    await setRsvp(g.guest_id, rsvpStatus);
  }
};

const send = (messageType: string, guestIds?: number[]) =>
  axios.post(`${REAL_SERVER}/sendMessage`, {
    userID: USER_ID,
    options: { messageType, eventId: WEDDING_EVENT_ID, ...(guestIds ? { guestIds } : {}) },
  });

beforeEach(async () => {
  await mock.reset();
  // Reset ALL guests currently in the wedding event — guards against guests
  // added by other test files that weren't fully cleaned up.
  const { data } = await axios.get(`${REAL_SERVER}/events/${WEDDING_EVENT_ID}/guests`, {
    params: { userID: USER_ID },
  });
  for (const g of data as Array<{ guest_id: number }>) {
    await setRsvp(g.guest_id, null);
  }
});

// ─────────────────────────────────────────────────────────────────────────────

describe("rsvpReminder — targets only pending guests", () => {
  it("sends only to guests with null rsvp_status", async () => {
    // Alice = pending (null), Bob = approved, Clare = declined
    await setRsvp(BOB_ID, 2);
    await setRsvp(CLARE_ID, 0);

    await send("rsvpReminder");

    await mock.waitForMessages(ALICE_PHONE, 1);

    const bobMsgs = await mock.getMessages({ to: BOB_PHONE });
    const clareMsgs = await mock.getMessages({ to: CLARE_PHONE });
    expect(bobMsgs).toHaveLength(0);
    expect(clareMsgs).toHaveLength(0);
  });

  it("returns 400 when no pending guests exist", async () => {
    await setAllWeddingGuestsRsvp(1);

    await expect(send("rsvpReminder")).rejects.toMatchObject({
      response: { status: 400 },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("weddingReminder — targets only approved guests", () => {
  it("sends only to guests with rsvp_status > 0", async () => {
    // Alice = approved, Bob = approved, Clare = pending
    await setRsvp(ALICE_ID, 3);
    await setRsvp(BOB_ID, 1);
    // Clare stays null

    await send("weddingReminder");

    await mock.waitForMessages(ALICE_PHONE, 1);
    await mock.waitForMessages(BOB_PHONE, 1);

    const clareMsgs = await mock.getMessages({ to: CLARE_PHONE });
    expect(clareMsgs).toHaveLength(0);
  });

  it("returns 400 when no approved guests exist", async () => {
    // beforeEach already reset all to null — explicitly confirm via helper
    await setAllWeddingGuestsRsvp(null);

    await expect(send("weddingReminder")).rejects.toMatchObject({
      response: { status: 400 },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("guestIds filter", () => {
  it("sending to a subset only reaches those guests", async () => {
    await send("rsvp", [ALICE_ID]);

    await mock.waitForMessages(ALICE_PHONE, 1);

    expect(await mock.getMessages({ to: BOB_PHONE })).toHaveLength(0);
    expect(await mock.getMessages({ to: CLARE_PHONE })).toHaveLength(0);
  });

  it("guestIds containing a guest not in the event is ignored — no 500", async () => {
    const NON_EXISTENT_GUEST_ID = 9999;
    // Only Alice is valid; 9999 is not in the event
    await send("rsvp", [ALICE_ID, NON_EXISTENT_GUEST_ID]);

    await mock.waitForMessages(ALICE_PHONE, 1);
    const allMsgs = await mock.getMessages();
    expect(allMsgs).toHaveLength(1);
  });
});
