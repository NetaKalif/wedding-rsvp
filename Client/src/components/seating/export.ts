import { Workbook } from "exceljs";
import Konva from "konva";
import { SeatingAssignment, SeatingItem, SeatingLayout } from "../../types";
import { downloadXlsx } from "../rsvp/logic";
import { buildEscortRows, buildTableRows, fitScale } from "./logic";

const EXPORT_WIDTH_PX = 2000;

/**
 * Renders the whole room to a PNG data URL, independent of the current
 * zoom/pan: the stage transform is temporarily reset to a fit-the-room view
 * and restored afterwards. The caller must clear the selection first so the
 * transformer handles aren't captured.
 */
export const stageToRoomPng = (stage: Konva.Stage, layout: SeatingLayout): string => {
  const prev = {
    scaleX: stage.scaleX(), scaleY: stage.scaleY(),
    x: stage.x(), y: stage.y(),
    width: stage.width(), height: stage.height(),
  };
  const margin = 20; // cm around the room edge
  const scale = fitScale(layout.room_width_cm, layout.room_height_cm, EXPORT_WIDTH_PX,
    (EXPORT_WIDTH_PX * layout.room_height_cm) / layout.room_width_cm, 0);
  try {
    stage.scale({ x: scale, y: scale });
    stage.position({ x: margin * scale, y: margin * scale });
    return stage.toDataURL({
      x: 0,
      y: 0,
      width: (layout.room_width_cm + margin * 2) * scale,
      height: (layout.room_height_cm + margin * 2) * scale,
      pixelRatio: 1,
      mimeType: "image/png",
    });
  } finally {
    stage.scale({ x: prev.scaleX, y: prev.scaleY });
    stage.position({ x: prev.x, y: prev.y });
  }
};

export const downloadDataUrl = (dataUrl: string, filename: string) => {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  a.click();
};

/** Two-sheet workbook: guests grouped by table, and the alphabetical escort list. */
export const downloadSeatingXlsx = async (
  items: SeatingItem[],
  assignments: SeatingAssignment[],
) => {
  const workbook = new Workbook();

  const byTable = workbook.addWorksheet("לפי שולחן", { views: [{ rightToLeft: true }] });
  byTable.columns = [
    { header: "שולחן", key: "tableName", width: 24 },
    { header: "אורח", key: "guestName", width: 28 },
    { header: "מקומות", key: "seats", width: 10 },
    { header: "סטטוס", key: "status", width: 14 },
  ];
  buildTableRows(items, assignments).forEach((row) => byTable.addRow(row));

  const escort = workbook.addWorksheet("לפי אורח", { views: [{ rightToLeft: true }] });
  escort.columns = [
    { header: "אורח", key: "guestName", width: 28 },
    { header: "שולחן", key: "tableName", width: 24 },
    { header: "מקומות", key: "seats", width: 10 },
  ];
  buildEscortRows(items, assignments).forEach((row) => escort.addRow(row));

  await downloadXlsx(workbook, "seating_arrangement.xlsx");
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Opens a print-optimized window (floor plan image + per-table lists + escort
 * list) and invokes the browser's print dialog — the native path to a Hebrew/RTL
 * PDF without font embedding.
 */
export const openPrintView = (
  floorPlanDataUrl: string,
  items: SeatingItem[],
  assignments: SeatingAssignment[],
  eventTitle: string,
) => {
  const tableRows = buildTableRows(items, assignments);
  const escortRows = buildEscortRows(items, assignments);

  const tableRowsHtml = tableRows
    .map((r) => `<tr><td>${escapeHtml(r.tableName)}</td><td>${escapeHtml(r.guestName)}</td><td>${r.seats}</td><td>${escapeHtml(r.status)}</td></tr>`)
    .join("");
  const escortRowsHtml = escortRows
    .map((r) => `<tr><td>${escapeHtml(r.guestName)}</td><td>${escapeHtml(r.tableName)}</td><td>${r.seats}</td></tr>`)
    .join("");

  const html = `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8">
<title>סידורי הושבה — ${escapeHtml(eventTitle)}</title>
<style>
  body { font-family: Arial, sans-serif; margin: 24px; color: #222; }
  h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 28px; }
  img { max-width: 100%; border: 1px solid #ccc; }
  table { border-collapse: collapse; width: 100%; margin-top: 8px; }
  th, td { border: 1px solid #bbb; padding: 4px 10px; text-align: right; font-size: 12px; }
  th { background: #f0f0f0; }
  .page-break { page-break-before: always; }
</style>
</head>
<body>
  <h1>סידורי הושבה — ${escapeHtml(eventTitle)}</h1>
  <img src="${floorPlanDataUrl}" alt="מפת האולם">
  <h2 class="page-break">אורחים לפי שולחן</h2>
  <table><thead><tr><th>שולחן</th><th>אורח</th><th>מקומות</th><th>סטטוס</th></tr></thead>
  <tbody>${tableRowsHtml}</tbody></table>
  <h2 class="page-break">רשימת אורחים (א-ב) — מספרי שולחן</h2>
  <table><thead><tr><th>אורח</th><th>שולחן</th><th>מקומות</th></tr></thead>
  <tbody>${escortRowsHtml}</tbody></table>
  <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
};
