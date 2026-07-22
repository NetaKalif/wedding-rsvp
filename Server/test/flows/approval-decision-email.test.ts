/**
 * Approval-decision email — sent to a pending user once the admin approves
 * or declines their sign-up request (see /admin/approveUser and
 * /admin/declineUser in app.ts).
 *
 * Unlike the other test/flows/*.test.ts files, this doesn't go through the
 * running test server: email.ts builds its nodemailer transporter once at
 * import time from EMAIL_USER/EMAIL_APP_PASSWORD, and the real running test
 * server deliberately blanks those (test/start-test-server.sh) so tests can
 * never send real email. So nodemailer is mocked here and the module is
 * re-imported per-case (jest.resetModules) to control what env it sees at
 * that import-time evaluation.
 */

jest.mock("nodemailer");

const ORIGINAL_ENV = { ...process.env };
const sendMail = jest.fn().mockResolvedValue(undefined);

// jest.resetModules() (needed below so email.ts re-reads env at import time)
// also discards the auto-mocked nodemailer instance email.ts's own require()
// picks up, so it must be re-required and reconfigured every time, right
// before requiring email.ts — configuring the top-level `nodemailer` import
// only takes effect on the first, pre-reset load.
const loadEmailModule = () => {
  const nodemailer = require("nodemailer");
  (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
  return require("../../src/email");
};

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  sendMail.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("sendApprovalDecisionEmail", () => {
  it("sends an approval email with a login link when approved", async () => {
    jest.resetModules();
    process.env.EMAIL_USER = "bot@test.com";
    process.env.EMAIL_APP_PASSWORD = "app-password";
    process.env.CLIENT_URL = "https://client.test";
    const { sendApprovalDecisionEmail } = loadEmailModule();

    await sendApprovalDecisionEmail({ userID: "u1", name: "Dana", email: "dana@test.com", approved: true });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "dana@test.com",
        subject: expect.stringContaining("אושרה"),
        text: expect.stringContaining("https://client.test"),
      }),
    );
  });

  it("sends a decline email (no login link) when not approved", async () => {
    jest.resetModules();
    process.env.EMAIL_USER = "bot@test.com";
    process.env.EMAIL_APP_PASSWORD = "app-password";
    process.env.CLIENT_URL = "https://client.test";
    const { sendApprovalDecisionEmail } = loadEmailModule();

    await sendApprovalDecisionEmail({ userID: "u2", name: "Roi", email: "roi@test.com", approved: false });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "roi@test.com",
        text: expect.stringContaining("לא אושרה"),
      }),
    );
    expect(sendMail.mock.calls[0][0].text).not.toContain("https://client.test");
  });

  it("skips sending when EMAIL_USER/EMAIL_APP_PASSWORD are unset", async () => {
    jest.resetModules();
    delete process.env.EMAIL_USER;
    delete process.env.EMAIL_APP_PASSWORD;
    const { sendApprovalDecisionEmail } = loadEmailModule();

    await sendApprovalDecisionEmail({ userID: "u3", name: "Noa", email: "noa@test.com", approved: true });

    expect(sendMail).not.toHaveBeenCalled();
  });
});
