import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

// ============================================================================
// In-memory message store
// ============================================================================

export interface StoredMessage {
  to: string;
  type: "text" | "template";
  text?: { body: string };
  template?: { name: string; language: { code: string }; components: unknown[] };
  timestamp: number;
}

const messages: StoredMessage[] = [];

// ============================================================================
// Meta Graph API surface — what the real server calls
// ============================================================================

// POST /v19.0/:phoneId/messages  (outgoing text / template messages)
app.post("/v19.0/:phoneId/messages", (req: any, res: any) => {
  const { to, type, text, template } = req.body;
  messages.push({ to, type, text, template, timestamp: Date.now() });
  res.status(200).json({ messaging_product: "whatsapp", contacts: [{ wa_id: to }], messages: [{ id: `mock-msg-${messages.length}` }] });
});

// POST /v17.0/:phoneId/media  (media uploads)
app.post("/v17.0/:phoneId/media", (_req: any, res: any) => {
  res.status(200).json({ id: `mock-media-${Date.now()}` });
});

// POST /oauth/access_token  (token refresh)
app.post("/oauth/access_token", (_req: any, res: any) => {
  res.status(200).json({ access_token: "mock-access-token", token_type: "bearer" });
});

// ============================================================================
// Test control API
// ============================================================================

// GET /mock/messages  — list all captured outgoing messages, optionally filter by ?to=
app.get("/mock/messages", (req: any, res: any) => {
  const { to } = req.query;
  const result = to ? messages.filter((m) => m.to === to) : messages;
  res.json(result);
});

// DELETE /mock/messages  — reset state between tests
app.delete("/mock/messages", (_req: any, res: any) => {
  messages.splice(0, messages.length);
  res.sendStatus(204);
});

// POST /mock/simulate-reply  — inject a guest reply into the real server's webhook
// Body: { from: "972501234567", type: "button"|"text", payload: "..." }
// REAL_SERVER_URL defaults to http://localhost:3000 but can be overridden via env
app.post("/mock/simulate-reply", async (req: any, res: any) => {
  const { from, type, payload } = req.body as { from: string; type: "button" | "text"; payload: string };
  const realServerUrl = process.env.REAL_SERVER_URL ?? "http://localhost:8080";

  const message =
    type === "button"
      ? { from, type: "button", button: { payload, text: payload } }
      : { from, type: "text", text: { body: payload } };

  const webhookPayload = {
    entry: [{ changes: [{ value: { messages: [message] } }] }],
  };

  try {
    await axios.post(`${realServerUrl}/sms`, webhookPayload);
    res.sendStatus(200);
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
});

// ============================================================================
// Start
// ============================================================================

const PORT = Number(process.env.MOCK_WA_PORT ?? 3001);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Mock WhatsApp server listening on port ${PORT}`);
  });
}

export default app;
