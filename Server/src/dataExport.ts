import ExcelJS from "exceljs";
import { Document, Packer, Paragraph, HeadingLevel } from "docx";
import archiver from "archiver";
import Database from "./dbUtils";
import { EventGuest, Task, VendorFile } from "./types";

/**
 * Disambiguates a file name against ones already used in the same zip folder
 * (e.g. two vendors both uploaded "חוזה.pdf"), preserving the extension.
 */
const uniqueFileName = (rawName: string, usedNames: Set<string>): string => {
  if (!usedNames.has(rawName)) {
    usedNames.add(rawName);
    return rawName;
  }
  const dot = rawName.lastIndexOf(".");
  const base = dot > 0 ? rawName.slice(0, dot) : rawName;
  const ext = dot > 0 ? rawName.slice(dot) : "";

  let suffix = 2;
  let name = `${base} (${suffix})${ext}`;
  while (usedNames.has(name)) {
    suffix++;
    name = `${base} (${suffix})${ext}`;
  }
  usedNames.add(name);
  return name;
};

/** Human-readable RSVP label from the eg.rsvp_status convention: null=pending, 0=declined, >0=confirmed(count). */
const rsvpStatusLabel = (status: EventGuest["rsvp_status"]): string => {
  if (status === null || status === undefined) return "ממתין";
  if (status === 0) return "לא מגיע/ה";
  return "מגיע/ה";
};

/** The confirmed attending-guest count, only meaningful once rsvp_status is a positive number. */
const rsvpGuestCount = (status: EventGuest["rsvp_status"]): number | string => {
  if (status === null || status === undefined || status === 0) return "";
  return status;
};

/**
 * exceljs worksheet names must be non-empty, <=31 chars, and can't contain
 * \ / * ? : [ ] — and addWorksheet throws on a duplicate name, which would
 * otherwise crash the whole export if two events share a ceremony_name (or
 * share the same first 31 chars, or both contain one of those characters).
 */
const uniqueSheetName = (rawName: string, fallback: string, usedNames: Set<string>): string => {
  const sanitized = rawName.replace(/[\\/*?:[\]]/g, " ").trim();
  const base = (sanitized || fallback).slice(0, 31);

  let name = base;
  let suffix = 2;
  while (usedNames.has(name)) {
    const suffixText = ` (${suffix})`;
    name = base.slice(0, 31 - suffixText.length) + suffixText;
    suffix++;
  }
  usedNames.add(name);
  return name;
};

export const buildRsvpWorkbook = async (db: Database, userID: string): Promise<Buffer> => {
  const workbook = new ExcelJS.Workbook();
  const events = await db.getEvents(userID);
  const usedSheetNames = new Set<string>();

  for (const event of events) {
    const sheetName = uniqueSheetName(event.ceremony_name, `Event ${event.id}`, usedSheetNames);
    const sheet = workbook.addWorksheet(sheetName);
    sheet.columns = [
      { header: "שם", key: "name", width: 25 },
      { header: "טלפון", key: "phone", width: 15 },
      { header: "מוזמן/ת של", key: "whose", width: 15 },
      { header: "מעגל", key: "circle", width: 15 },
      { header: "מספר מוזמנים", key: "number_of_guests", width: 15 },
      { header: "סטטוס אישור הגעה", key: "status", width: 20 },
      { header: "מספר מגיעים", key: "attending_count", width: 15 },
    ];
    const guests = await db.getEventGuests(event.id!);
    guests.forEach((g) => {
      sheet.addRow({
        name: g.name,
        phone: g.phone,
        whose: g.whose,
        circle: g.circle,
        number_of_guests: g.number_of_guests,
        status: rsvpStatusLabel(g.rsvp_status),
        attending_count: rsvpGuestCount(g.rsvp_status),
      });
    });
  }

  if (events.length === 0) {
    workbook.addWorksheet("RSVP");
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
};

export const buildTasksDocument = async (db: Database, userID: string): Promise<Buffer> => {
  const tasks = await db.getTasks(userID);

  const statusSection = (title: string, list: Task[]) => [
    new Paragraph({ text: title, heading: HeadingLevel.HEADING_2 }),
    ...(list.length === 0
      ? [new Paragraph({ text: "אין משימות" })]
      : list.map((t) => new Paragraph({ text: t.title, bullet: { level: 0 } }))),
  ];

  // db.getTasks already orders rows by timeline_group's canonical priority, so
  // taking each group's first appearance preserves that same group order here
  // without duplicating the canonical list from taskConstants.ts/dbUtils.ts.
  const orderedGroups = Array.from(new Set(tasks.map((t) => t.timeline_group)));

  const groupSections = orderedGroups.flatMap((group) => {
    const groupTasks = tasks.filter((t) => t.timeline_group === group);
    return [
      new Paragraph({ text: group, heading: HeadingLevel.HEADING_1 }),
      ...statusSection("בוצעו", groupTasks.filter((t) => t.is_completed)),
      ...statusSection("טרם בוצעו", groupTasks.filter((t) => !t.is_completed)),
    ];
  });

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "המשימות שלי", heading: HeadingLevel.TITLE }),
          ...(tasks.length === 0 ? [new Paragraph({ text: "אין משימות" })] : groupSections),
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
};

export const buildBudgetDocx = async (db: Database, userID: string): Promise<Buffer> => {
  const overview = await db.getBudgetOverview(userID);

  const categorySections = overview.categories.flatMap((cat) => [
    new Paragraph({ text: cat.name, heading: HeadingLevel.HEADING_2 }),
    ...cat.vendors.flatMap((v) => [
      new Paragraph({
        text: `${v.name}${v.job_title ? ` (${v.job_title})` : ""}`,
        heading: HeadingLevel.HEADING_3,
      }),
      new Paragraph({
        text: `סוכם: ${v.agreed_cost} | שולם: ${v.total_paid} | נותר: ${v.remaining_balance} | סטטוס: ${v.status}`,
      }),
      ...(v.phone ? [new Paragraph({ text: `טלפון: ${v.phone}` })] : []),
      ...(v.email ? [new Paragraph({ text: `אימייל: ${v.email}` })] : []),
      ...(v.notes ? [new Paragraph({ text: `הערות: ${v.notes}` })] : []),
      ...(v.payments.length > 0
        ? [
            new Paragraph({ text: "תשלומים:" }),
            ...v.payments.map(
              (p) =>
                new Paragraph({
                  text: `${p.payment_date} | ${p.amount}${p.notes ? ` | ${p.notes}` : ""}`,
                  bullet: { level: 1 },
                }),
            ),
          ]
        : []),
    ]),
  ]);

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: "סיכום תקציב", heading: HeadingLevel.TITLE }),
          new Paragraph({ text: `תקציב כולל: ${overview.total_budget}` }),
          new Paragraph({ text: `הוצאות בפועל: ${overview.total_expenses}` }),
          new Paragraph({ text: `יתרה: ${overview.remaining_budget}` }),
          new Paragraph({ text: `אחוז ניצול: ${overview.usage_percentage}%` }),
          ...categorySections,
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
};

export interface AccountExports {
  rsvpXlsx: Buffer;
  tasksDocx: Buffer;
  budgetDocx: Buffer;
  vendorFiles: VendorFile[];
}

export const buildAllExports = async (db: Database, userID: string): Promise<AccountExports> => {
  const [rsvpXlsx, tasksDocx, budgetDocx, vendorFiles] = await Promise.all([
    buildRsvpWorkbook(db, userID),
    buildTasksDocument(db, userID),
    buildBudgetDocx(db, userID),
    db.getAllVendorFilesForExport(userID),
  ]);
  return { rsvpXlsx, tasksDocx, budgetDocx, vendorFiles };
};

export const zipExports = async (exports: AccountExports): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip");
    const chunks: Buffer[] = [];
    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);

    archive.append(exports.rsvpXlsx, { name: "רשימת-מוזמנים.xlsx" });
    archive.append(exports.tasksDocx, { name: "משימות.docx" });

    const usedBudgetFileNames = new Set<string>();
    archive.append(exports.budgetDocx, {
      name: `תקציב/${uniqueFileName("תקציב.docx", usedBudgetFileNames)}`,
    });
    exports.vendorFiles.forEach((file) => {
      archive.append(file.file_data!, {
        name: `תקציב/${uniqueFileName(file.file_name, usedBudgetFileNames)}`,
      });
    });

    archive.finalize();
  });
};
