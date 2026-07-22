/**
 * New-user sign-up admin notification.
 * Covers the WhatsApp template (new_user_request) sent to the admin when a
 * new user signs up and needs approval — replaces the old approval email.
 *
 * Exercised via a test-only endpoint (/test/trigger-new-user-notification)
 * since the real path (/auth/google) requires a real Google credential.
 */

import axios from "axios";
import { MockWhatsAppClient } from "../mock-whatsapp/client";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
const MOCK_PORT = 3001;
const mock = new MockWhatsAppClient(MOCK_PORT);

// Matches ADMIN_NOTIFY_WHATSAPP in test/start-test-server.sh — never the real
// admin number, so tests can never send a live WhatsApp message.
const ADMIN_TEST_PHONE = "972500000000";

const triggerNotification = (name: string, email: string) =>
  axios.post(`${REAL_SERVER}/test/trigger-new-user-notification`, { name, email });

beforeEach(async () => {
  await mock.reset();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("New user request WhatsApp notification", () => {
  it("sends the new_user_request template to the admin with the requester's name and email", async () => {
    await triggerNotification("Dana Levi", "dana@example.com");

    const [msg] = await mock.waitForMessages(ADMIN_TEST_PHONE, 1);

    expect(msg.type).toBe("template");
    expect(msg.template?.name).toBe("new_user_request");

    const bodyComponent = msg.template?.components.find((c: any) => c.type === "body") as any;
    expect(bodyComponent.parameters).toContainEqual({ type: "text", parameter_name: "name", text: "Dana Levi" });
    expect(bodyComponent.parameters).toContainEqual({
      type: "text",
      parameter_name: "email",
      text: "dana@example.com",
    });
  });
});
