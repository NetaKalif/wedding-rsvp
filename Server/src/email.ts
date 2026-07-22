import nodemailer from "nodemailer";
import { logWarn } from "./logger";

const transporter =
  process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD
    ? nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.EMAIL_USER,
          pass: process.env.EMAIL_APP_PASSWORD,
        },
      })
    : null;

export const sendDataExportWarningEmail = async ({
  userID,
  name,
  email,
  weddingDate,
  deletionDate,
  attachments,
}: {
  userID: string;
  name: string;
  email: string;
  weddingDate: string;
  deletionDate: string;
  attachments: { rsvpXlsx: Buffer; tasksDocx: Buffer; budgetDocx: Buffer };
}): Promise<void> => {
  if (!transporter) {
    logWarn(
      userID,
      `[email] EMAIL_USER/EMAIL_APP_PASSWORD not set — skipping deletion warning email for ${name} <${email}>`,
    );
    return;
  }

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: "החתונה שלכם עברה - תוך 3 ימים כל הנתונים באפליקציה יימחקו",
    text: `שלום ${name},\n\nהחתונה שלכם (${weddingDate}) כבר מאחורינו במזל טוב! בהתאם למדיניות שמירת הנתונים שלנו, בתאריך ${deletionDate} (בעוד 3 ימים) כל הנתונים שלכם באפליקציה יימחקו לצמיתות - כולל החשבון עצמו.\n\nמצורפים לכם קבצים עם כל הנתונים שנשמרו במערכת: רשימת המוזמנים וסטטוס אישורי ההגעה (xlsx), רשימת המשימות שביצעתם ושטרם ביצעתם (docx), וסיכום התקציב (docx).\n\nבברכה,\nצוות ה-RSVP`,
    attachments: [
      { filename: "רשימת-מוזמנים.xlsx", content: attachments.rsvpXlsx },
      { filename: "משימות.docx", content: attachments.tasksDocx },
      { filename: "תקציב.docx", content: attachments.budgetDocx },
    ],
  });
};
