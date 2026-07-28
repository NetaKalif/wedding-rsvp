/**
 * On-demand "download my data" export tests.
 * Covers the /media/token + /export/my-data/download pair used by the user
 * menu's "הורדת הנתונים שלי" action — the same three-file export used by the
 * 60-day deletion warning email, but available any time without touching
 * deletion state. Uses the shared seeded fixture user since this flow is
 * read-only.
 */

import axios from "axios";
import ExcelJS from "exceljs";
import JSZip from "jszip";
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

  it("includes a gifts xlsx in the same format as the gifts page's export button", async () => {
    // Seeded guest "Test Guest" (id=1, in the wedding event, RSVP pending)
    // gives a gift, then we download the export
    const { data: gift } = await axios.post(
      `${REAL_SERVER}/gifts`,
      { guest_id: 1, gift_type: "other", amount: 500, other_description: "שובר מתנה" },
      { headers: authHeader() },
    );

    try {
      const token = await mintMediaToken("dataExport");
      const response = await downloadExport(token);

      const zip = await JSZip.loadAsync(response.data as Buffer);
      const giftsEntry = zip.file("מתנות.xlsx");
      expect(giftsEntry).not.toBeNull();

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load((await giftsEntry!.async("nodebuffer")) as any);
      const sheet = workbook.worksheets[0];

      // Same columns as the client's gifts-page export (giftExportColumns)
      const headers: string[] = [];
      sheet.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
      expect(headers).toEqual([
        "שם", "טלפון", "מוזמן ע״י", "מעגל", "סטטוס אישור",
        "מספר מאושרים", "מספר אורחים", "סוג מתנה", "סכום מתנה",
      ]);

      // One row per guest: the gifting guest carries RSVP + gift data...
      let giftRowValues: string[] = [];
      let aliceRowValues: string[] = [];
      sheet.eachRow((row) => {
        const values = (row.values as any[]).map(String);
        if (values.includes("Test Guest")) giftRowValues = values;
        if (values.includes("Alice")) aliceRowValues = values;
      });
      expect(giftRowValues).toEqual(
        expect.arrayContaining(["Test Guest", "ממתין", "שובר מתנה", "500"]),
      );
      // ...and guests without gifts still appear (like the page's table export)
      expect(aliceRowValues).toEqual(expect.arrayContaining(["Alice"]));
    } finally {
      await axios.delete(`${REAL_SERVER}/gifts/${gift.gift_id}`, { headers: authHeader() });
    }
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
