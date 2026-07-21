/**
 * Verifies the budget export:
 * - renders as a readable .docx (Hebrew text via the `docx` library),
 *   replacing the old pdfkit-based export whose default fonts couldn't
 *   render Hebrew glyphs and produced unreadable garbled text.
 * - bundles the docx together with every file the user uploaded to a vendor
 *   (contracts, receipts, etc.) inside a "תקציב/" folder in the export zip.
 */

import axios from "axios";
import FormData from "form-data";
import JSZip from "jszip";
import { Pool } from "pg";
import { authHeader } from "../helpers/auth";
import { DATABASE_URL } from "../globalSetup";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
const USER_ID = "budget-export-format-user";

const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });

const addCategory = async (name: string): Promise<number> => {
  const { data } = await axios.post(
    `${REAL_SERVER}/budget/categories`,
    { name },
    { headers: authHeader(USER_ID) },
  );
  return data.category_id;
};

const addVendor = async (
  name: string,
  categoryId: number,
  agreedCost: number,
  extra: { job_title?: string; phone?: string; email?: string; notes?: string } = {},
): Promise<number> => {
  const form = new FormData();
  form.append(
    "vendor",
    JSON.stringify({ name, category_id: categoryId, agreed_cost: agreedCost, status: "סוכם", ...extra }),
  );
  const { data } = await axios.post(`${REAL_SERVER}/budget/vendors`, form, {
    headers: { ...form.getHeaders(), ...authHeader(USER_ID) },
  });
  return data.vendor_id;
};

const addPayment = async (vendorId: number, amount: number, paymentDate: string, notes?: string): Promise<void> => {
  await axios.post(
    `${REAL_SERVER}/budget/payments`,
    { vendor_id: vendorId, amount, payment_date: paymentDate, notes },
    { headers: authHeader(USER_ID) },
  );
};

// POST /budget/vendors uploads files fire-and-forget (not awaited by the
// route), so it isn't safe to assert on right after the response — insert
// directly instead, since this test is about the export/zip, not the upload
// endpoint's own timing.
const addVendorFileDirect = async (vendorId: number, fileName: string, content: string): Promise<void> => {
  await pool.query(
    `INSERT INTO vendor_files (vendor_id, file_name, file_type, file_size, file_data) VALUES ($1, $2, $3, $4, $5)`,
    [vendorId, fileName, "text/plain", Buffer.byteLength(content), Buffer.from(content, "utf-8")],
  );
};

const downloadExportZip = async (): Promise<JSZip> => {
  const { data: tokenData } = await axios.post(
    `${REAL_SERVER}/media/token`,
    { resource: "dataExport" },
    { headers: authHeader(USER_ID) },
  );
  const { data } = await axios.get(`${REAL_SERVER}/export/my-data/download`, {
    params: { mediaToken: tokenData.token },
    responseType: "arraybuffer",
  });

  return JSZip.loadAsync(data as Buffer);
};

const readDocxText = async (docxBuffer: Buffer): Promise<string> => {
  const innerZip = await JSZip.loadAsync(docxBuffer);
  const documentXml = await innerZip.file("word/document.xml")!.async("string");
  return Array.from(documentXml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g))
    .map((m) => m[1])
    .join("\n");
};

beforeAll(async () => {
  await pool.query(
    `INSERT INTO users ("userID", email, name) VALUES ($1, $2, $3) ON CONFLICT ("userID") DO NOTHING`,
    [USER_ID, `${USER_ID}@test.com`, USER_ID],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM users WHERE "userID" = $1`, [USER_ID]);
  await pool.end();
});

describe("Budget export document", () => {
  it("renders Hebrew category and vendor names as real text, not gibberish, inside a תקציב/ folder", async () => {
    const categoryId = await addCategory("קייטרינג");
    await addVendor("אולם הגן הקסום", categoryId, 25000);

    const zip = await downloadExportZip();
    const docxBuffer = await zip.file("תקציב/תקציב.docx")!.async("nodebuffer");
    const text = await readDocxText(docxBuffer);

    expect(text).toContain("סיכום תקציב");
    expect(text).toContain("קייטרינג");
    expect(text).toContain("אולם הגן הקסום");
  });

  it("includes each vendor's job title, contact details, notes, and payment history", async () => {
    const categoryId = await addCategory("הגברה");
    const vendorId = await addVendor("די. ג׳יי דני", categoryId, 4000, {
      job_title: "תקליטן",
      phone: "0501234567",
      email: "dani@example.com",
      notes: "להביא ציוד תאורה",
    });
    await addPayment(vendorId, 1500, "2027-01-01", "מקדמה");

    const zip = await downloadExportZip();
    const docxBuffer = await zip.file("תקציב/תקציב.docx")!.async("nodebuffer");
    const text = await readDocxText(docxBuffer);

    expect(text).toContain("די. ג׳יי דני");
    expect(text).toContain("תקליטן");
    expect(text).toContain("0501234567");
    expect(text).toContain("dani@example.com");
    expect(text).toContain("להביא ציוד תאורה");
    expect(text).toContain("1500");
    expect(text).toContain("מקדמה");
  });

  it("includes every uploaded vendor file inside the תקציב/ folder", async () => {
    const categoryId = await addCategory("צילום");
    const vendorId = await addVendor("סטודיו הצילום", categoryId, 8000);
    await addVendorFileDirect(vendorId, "חוזה.pdf", "contract contents");
    await addVendorFileDirect(vendorId, "קבלה.pdf", "receipt contents");

    const zip = await downloadExportZip();

    expect(zip.file("תקציב/חוזה.pdf")).not.toBeNull();
    expect(zip.file("תקציב/קבלה.pdf")).not.toBeNull();
    const contractContent = await zip.file("תקציב/חוזה.pdf")!.async("string");
    expect(contractContent).toBe("contract contents");
  });
});
