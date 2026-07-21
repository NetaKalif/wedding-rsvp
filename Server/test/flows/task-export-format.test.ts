/**
 * Verifies the tasks Word-document export (used by both the day-57 deletion
 * warning email and the on-demand "download my data" action) is grouped by
 * timeline period first, with a "done"/"not done" subsection inside each
 * period — matching the live Tasks page's grouping, rather than one global
 * done/not-done split across all periods.
 */

import axios from "axios";
import JSZip from "jszip";
import { Pool } from "pg";
import { authHeader } from "../helpers/auth";
import { DATABASE_URL } from "../globalSetup";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
const USER_ID = "task-export-format-user";

const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });

const addTask = async (title: string, timeline_group: string): Promise<number> => {
  const { data } = await axios.post(
    `${REAL_SERVER}/tasks`,
    { task: { title, timeline_group } },
    { headers: authHeader(USER_ID) },
  );
  return data.task_id;
};

const completeTask = (taskId: number) =>
  axios.patch(
    `${REAL_SERVER}/tasks/${taskId}/complete`,
    { isCompleted: true },
    { headers: authHeader(USER_ID) },
  );

const downloadTasksDocText = async (): Promise<string> => {
  const { data: tokenData } = await axios.post(
    `${REAL_SERVER}/media/token`,
    { resource: "dataExport" },
    { headers: authHeader(USER_ID) },
  );
  const { data } = await axios.get(`${REAL_SERVER}/export/my-data/download`, {
    params: { mediaToken: tokenData.token },
    responseType: "arraybuffer",
  });

  const outerZip = await JSZip.loadAsync(data as Buffer);
  const docxBuffer = await outerZip.file("משימות.docx")!.async("nodebuffer");
  const innerZip = await JSZip.loadAsync(docxBuffer);
  const documentXml = await innerZip.file("word/document.xml")!.async("string");

  return Array.from(documentXml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/g))
    .map((m) => m[1])
    .join("\n");
};

beforeAll(async () => {
  // tasks.user_id has a NOT NULL FK to users("userID") — this throwaway test
  // user needs a real row there before any /tasks insert will succeed.
  await pool.query(
    `INSERT INTO users ("userID", email, name) VALUES ($1, $2, $3) ON CONFLICT ("userID") DO NOTHING`,
    [USER_ID, `${USER_ID}@test.com`, USER_ID],
  );
});

afterAll(async () => {
  await pool.query(`DELETE FROM tasks WHERE user_id = $1`, [USER_ID]);
  await pool.query(`DELETE FROM users WHERE "userID" = $1`, [USER_ID]);
  await pool.end();
});

describe("Tasks export document grouping", () => {
  it("groups by timeline period, with a done/not-done subsection inside each period", async () => {
    const incompleteInFirstGroup = await addTask("לסגור אולם", "12 Months Before");
    const completeInFirstGroup = await addTask("לקבוע תאריך חתונה רשמי", "12 Months Before");
    await addTask("לאסוף את השמלה", "1 Week Before");
    await completeTask(completeInFirstGroup);

    const text = await downloadTasksDocText();

    const groupHeadingIndex = text.indexOf("12 Months Before");
    const laterGroupHeadingIndex = text.indexOf("1 Week Before");
    expect(groupHeadingIndex).toBeGreaterThanOrEqual(0);
    expect(laterGroupHeadingIndex).toBeGreaterThan(groupHeadingIndex);

    // Within "12 Months Before": בוצעו heading, then the completed task, then
    // טרם בוצעו heading, then the incomplete task — all before the next group.
    const doneHeadingIndex = text.indexOf("בוצעו", groupHeadingIndex);
    const completedTaskIndex = text.indexOf("לקבוע תאריך חתונה רשמי", doneHeadingIndex);
    const notDoneHeadingIndex = text.indexOf("טרם בוצעו", completedTaskIndex);
    const incompleteTaskIndex = text.indexOf("לסגור אולם", notDoneHeadingIndex);

    expect(doneHeadingIndex).toBeGreaterThan(groupHeadingIndex);
    expect(completedTaskIndex).toBeGreaterThan(doneHeadingIndex);
    expect(notDoneHeadingIndex).toBeGreaterThan(completedTaskIndex);
    expect(incompleteTaskIndex).toBeGreaterThan(notDoneHeadingIndex);
    expect(incompleteTaskIndex).toBeLessThan(laterGroupHeadingIndex);

    // "1 Week Before" has no completed tasks — its בוצעו subsection says so.
    const secondGroupDoneHeadingIndex = text.indexOf("בוצעו", laterGroupHeadingIndex);
    const noTasksIndex = text.indexOf("אין משימות", secondGroupDoneHeadingIndex);
    const collectDressIndex = text.indexOf("לאסוף את השמלה", laterGroupHeadingIndex);
    expect(noTasksIndex).toBeGreaterThan(secondGroupDoneHeadingIndex);
    expect(noTasksIndex).toBeLessThan(collectDressIndex);
  });
});
