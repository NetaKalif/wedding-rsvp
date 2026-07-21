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

export const sendApprovalRequestEmail = async ({
  userID,
  name,
  email,
}: {
  userID: string;
  name: string;
  email: string;
}): Promise<void> => {
  if (!transporter) {
    logWarn(
      userID,
      `[email] EMAIL_USER/EMAIL_APP_PASSWORD not set — skipping approval email for ${name} <${email}>`,
    );
    return;
  }

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.ADMIN_NOTIFY_EMAIL || "neta1019@gmail.com",
    subject: `בקשת הרשמה חדשה: ${name}`,
    text: `${name} (${email}) ביקש/ה להצטרף למערכת ה-RSVP.\n\nהתחבר/י כמנהל/ת ופתח/י את עמוד "בקשות הרשמה ממתינות" כדי לאשר או לדחות.`,
  });
};
