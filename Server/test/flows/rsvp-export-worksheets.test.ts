/**
 * Verifies the RSVP xlsx export (used by both the day-57 deletion warning
 * email and the on-demand "download my data" action) produces one worksheet
 * per event — including when two events share the same ceremony_name, which
 * previously crashed the whole export because exceljs throws on a duplicate
 * addWorksheet() name.
 */

import axios from "axios";
import ExcelJS from "exceljs";
import FormData from "form-data";
import JSZip from "jszip";
import { Pool } from "pg";
import { authHeader, TEST_USER_ID } from "../helpers/auth";
import { DATABASE_URL } from "../globalSetup";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";

const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });

// Seeded in globalSetup: "Test Guest" (id=1), attached only to the wedding
// event, with rsvp_status left NULL (pending).
const BASIC_GUEST_ID = 1;

const createEvent = async (ceremonyName: string) => {
  const form = new FormData();
  form.append("ceremony_name", ceremonyName);
  const { data } = await axios.post(`${REAL_SERVER}/events`, form, {
    headers: { ...form.getHeaders(), ...authHeader() },
  });
  return data as { id: number; ceremony_name: string };
};

const deleteEvent = (eventId: number) =>
  axios.delete(`${REAL_SERVER}/events/${eventId}`, { headers: authHeader() });

const addGuestToEvent = (eventId: number, guestId: number) =>
  axios.post(
    `${REAL_SERVER}/events/${eventId}/guests`,
    { guestIds: [guestId] },
    { headers: authHeader() },
  );

const setRsvpStatus = (eventId: number, guestId: number, status: number | null) =>
  pool.query(`UPDATE event_guests SET rsvp_status = $1 WHERE event_id = $2 AND guest_id = $3`, [
    status,
    eventId,
    guestId,
  ]);

const findColumnIndex = (sheet: ExcelJS.Worksheet, header: string): number => {
  let idx = -1;
  sheet.getRow(1).eachCell((cell, colNumber) => {
    if (cell.value === header) idx = colNumber;
  });
  return idx;
};

const findRowByName = (sheet: ExcelJS.Worksheet, nameColIdx: number, name: string): ExcelJS.Row | undefined => {
  let found: ExcelJS.Row | undefined;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    if (row.getCell(nameColIdx).value === name) found = row;
  });
  return found;
};

const downloadRsvpWorkbook = async (): Promise<ExcelJS.Workbook> => {
  const { data: tokenData } = await axios.post(
    `${REAL_SERVER}/media/token`,
    { resource: "dataExport" },
    { headers: authHeader(TEST_USER_ID) },
  );
  const { data } = await axios.get(`${REAL_SERVER}/export/my-data/download`, {
    params: { mediaToken: tokenData.token },
    responseType: "arraybuffer",
  });

  const outerZip = await JSZip.loadAsync(data as Buffer);
  const xlsxBuffer = await outerZip.file("רשימת-מוזמנים.xlsx")!.async("nodebuffer");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(xlsxBuffer);
  return workbook;
};

const createdEventIds: number[] = [];

afterAll(async () => {
  await pool.end();
});

afterEach(async () => {
  for (const id of createdEventIds) {
    try {
      await deleteEvent(id);
    } catch {
      // already deleted
    }
  }
  createdEventIds.length = 0;
});

describe("RSVP export worksheets", () => {
  it("gives the primary wedding event and the henna event their own worksheets", async () => {
    const workbook = await downloadRsvpWorkbook();

    const sheetNames = workbook.worksheets.map((s) => s.name);
    expect(sheetNames).toContain("חתונה");
    expect(sheetNames).toContain("חינה");
  });

  it("disambiguates worksheet names instead of crashing when two events share a ceremony_name", async () => {
    const first = await createEvent("מסיבת רווקות");
    createdEventIds.push(first.id);
    const second = await createEvent("מסיבת רווקות");
    createdEventIds.push(second.id);

    const workbook = await downloadRsvpWorkbook();

    const sheetNames = workbook.worksheets.map((s) => s.name);
    const matchingSheets = sheetNames.filter((name) => name.startsWith("מסיבת רווקות"));
    expect(matchingSheets).toHaveLength(2);
    expect(new Set(matchingSheets).size).toBe(2);
  });

  it("puts the rsvp status text and the attending guest count in separate columns", async () => {
    const event = await createEvent("אירוע בדיקת עמודות");
    createdEventIds.push(event.id);
    await addGuestToEvent(event.id, BASIC_GUEST_ID);
    await setRsvpStatus(event.id, BASIC_GUEST_ID, 3);

    const workbook = await downloadRsvpWorkbook();
    const sheet = workbook.getWorksheet(event.ceremony_name)!;

    const nameColIdx = findColumnIndex(sheet, "שם");
    const statusColIdx = findColumnIndex(sheet, "סטטוס אישור הגעה");
    const countColIdx = findColumnIndex(sheet, "מספר מגיעים");
    expect(statusColIdx).toBeGreaterThan(0);
    expect(countColIdx).toBeGreaterThan(0);
    expect(countColIdx).not.toBe(statusColIdx);

    const row = findRowByName(sheet, nameColIdx, "Test Guest");
    expect(row?.getCell(statusColIdx).value).toBe("מגיע/ה");
    expect(row?.getCell(countColIdx).value).toBe(3);
  });

  it("leaves the attending count blank for pending and declined guests", async () => {
    const event = await createEvent("אירוע בדיקת עמודות 2");
    createdEventIds.push(event.id);
    await addGuestToEvent(event.id, BASIC_GUEST_ID);
    await setRsvpStatus(event.id, BASIC_GUEST_ID, null);

    let workbook = await downloadRsvpWorkbook();
    let sheet = workbook.getWorksheet(event.ceremony_name)!;
    let nameColIdx = findColumnIndex(sheet, "שם");
    let statusColIdx = findColumnIndex(sheet, "סטטוס אישור הגעה");
    let countColIdx = findColumnIndex(sheet, "מספר מגיעים");
    let row = findRowByName(sheet, nameColIdx, "Test Guest");
    expect(row?.getCell(statusColIdx).value).toBe("ממתין");
    expect(row?.getCell(countColIdx).value).toBeFalsy();

    await setRsvpStatus(event.id, BASIC_GUEST_ID, 0);

    workbook = await downloadRsvpWorkbook();
    sheet = workbook.getWorksheet(event.ceremony_name)!;
    nameColIdx = findColumnIndex(sheet, "שם");
    statusColIdx = findColumnIndex(sheet, "סטטוס אישור הגעה");
    countColIdx = findColumnIndex(sheet, "מספר מגיעים");
    row = findRowByName(sheet, nameColIdx, "Test Guest");
    expect(row?.getCell(statusColIdx).value).toBe("לא מגיע/ה");
    expect(row?.getCell(countColIdx).value).toBeFalsy();
  });
});
