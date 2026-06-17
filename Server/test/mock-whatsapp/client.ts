import axios from "axios";
import type { StoredMessage } from "./server";

export class MockWhatsAppClient {
  private baseUrl: string;

  constructor(port = 3001) {
    this.baseUrl = `http://localhost:${port}`;
  }

  async getMessages(filter?: { to?: string }): Promise<StoredMessage[]> {
    const params = filter?.to ? { to: filter.to } : {};
    const res = await axios.get(`${this.baseUrl}/mock/messages`, { params });
    return res.data;
  }

  async reset(): Promise<void> {
    await axios.delete(`${this.baseUrl}/mock/messages`);
  }

  async simulateReply(opts: { from: string; type: "button" | "text"; payload: string }): Promise<void> {
    await axios.post(`${this.baseUrl}/mock/simulate-reply`, opts);
  }

  // Convenience: wait until at least `count` messages have been captured for `to`,
  // polling up to `timeoutMs`. Useful because handleButtonReply / handleTextResponse
  // are async and may arrive after the webhook returns 200.
  async waitForMessages(to: string, count: number, timeoutMs = 3000): Promise<StoredMessage[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const msgs = await this.getMessages({ to });
      if (msgs.length >= count) return msgs;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timed out waiting for ${count} message(s) to ${to}`);
  }
}
