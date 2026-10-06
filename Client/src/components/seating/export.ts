import { Workbook } from "exceljs";
import Konva from "konva";
import { SeatingAssignment, SeatingItem, SeatingLayout } from "../../types";
import { downloadXlsx } from "../rsvp/logic";
import { buildGuestExportRows, fitScale } from "./logic";

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

/**
 * Single-sheet workbook: guests alphabetically, with a blank "arrived" column
 * for marking the actual head-count on the wedding day.
 */
export const downloadSeatingXlsx = async (
  items: SeatingItem[],
  assignments: SeatingAssignment[],
) => {
  const workbook = new Workbook();

  const sheet = workbook.addWorksheet("רשימת אורחים", { views: [{ rightToLeft: true }] });
  sheet.columns = [
    { header: "אורח", key: "guestName", width: 28 },
    { header: "מספר אורחים", key: "seats", width: 12 },
    { header: "הגיעו בפועל", key: "arrived", width: 12 },
    { header: "מספר שולחן", key: "tableNumber", width: 12 },
  ];
  buildGuestExportRows(items, assignments).forEach((row) => sheet.addRow(row));

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
  const guestRowsHtml = buildGuestExportRows(items, assignments)
    .map((r) => `<tr><td>${escapeHtml(r.guestName)}</td><td>${r.seats}</td><td class="arrived"></td><td>${r.tableNumber ?? ""}</td></tr>`)
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
  td.arrived { min-width: 70px; } /* room to hand-write the actual head-count */
  .page-break { page-break-before: always; }
</style>
</head>
<body>
  <h1>סידורי הושבה — ${escapeHtml(eventTitle)}</h1>
  <img src="${floorPlanDataUrl}" alt="מפת האולם">
  <h2 class="page-break">רשימת אורחים (א-ב)</h2>
  <table><thead><tr><th>אורח</th><th>מספר אורחים</th><th>הגיעו בפועל</th><th>מספר שולחן</th></tr></thead>
  <tbody>${guestRowsHtml}</tbody></table>
  <script>window.onload = () => setTimeout(() => window.print(), 300);</script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
};
