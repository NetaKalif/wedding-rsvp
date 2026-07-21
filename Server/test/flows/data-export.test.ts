/**
 * On-demand "download my data" export tests.
 * Covers the /media/token + /export/my-data/download pair used by the user
 * menu's "הורדת הנתונים שלי" action — the same three-file export used by the
 * 60-day deletion warning email, but available any time without touching
 * deletion state. Uses the shared seeded fixture user since this flow is
 * read-only.
 */

import axios from "axios";
import { authHeader, TEST_USER_ID } from "../helpers/auth";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";

const mintMediaToken = async (resource: string, userID = TEST_USER_ID): Promise<string> => {
  const { data } = await axios.post(
    `${REAL_SERVER}/media/token`,
    { resource },
    { headers: authHeader(userID) },
  );
  return data.token;
};

const downloadExport = (mediaToken: string) =>
  axios.get(`${REAL_SERVER}/export/my-data/download`, {
    params: { mediaToken },
    responseType: "arraybuffer",
  });

// ─────────────────────────────────────────────────────────────────────────────

describe("Download my data export", () => {
  it("returns a non-empty zip file for a valid dataExport media token", async () => {
    const token = await mintMediaToken("dataExport");

    const response = await downloadExport(token);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/zip");
    expect(response.headers["content-disposition"]).toContain('attachment; filename="wedding-data.zip"');
    expect((response.data as Buffer).length).toBeGreaterThan(0);
  });

  it("rejects a missing media token", async () => {
    await expect(
      axios.get(`${REAL_SERVER}/export/my-data/download`),
    ).rejects.toMatchObject({ response: { status: 401 } });
  });

  it("rejects a media token minted for a different resource", async () => {
    const token = await mintMediaToken("vendorFile");

    await expect(downloadExport(token)).rejects.toMatchObject({ response: { status: 401 } });
  });
});
