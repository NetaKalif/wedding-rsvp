import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import TestMessageSend from "./TestMessageSend";
import { Event } from "../../types";
import { httpRequests } from "../../httpClient";

jest.mock("../../httpClient", () => ({
  httpRequests: {
    sendTestMessage: jest.fn(() => Promise.resolve({ success: true })),
  },
}));

const mockHttp = httpRequests as unknown as { sendTestMessage: jest.Mock };

const completeEvent: Event = {
  id: 1,
  user_id: "user-1",
  is_primary: true,
  ceremony_name: "חתונה",
  date: "2027-01-01",
  location: "תל אביב",
  file_id: "file-1",
  bride_name: "כלה",
  groom_name: "חתן",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockHttp.sendTestMessage.mockResolvedValue({ success: true });
});

const typePhone = (value: string) =>
  fireEvent.change(screen.getByLabelText("מספר טלפון להודעת ניסיון"), {
    target: { value },
  });

const clickSend = () =>
  fireEvent.click(screen.getByRole("button", { name: "שליחת הודעת ניסיון" }));

describe("TestMessageSend", () => {
  it("sends the selected message type to the normalized phone", async () => {
    render(<TestMessageSend eventId={1} event={completeEvent} />);

    fireEvent.click(screen.getByText("תזכורת לממתינים"));
    typePhone("052-1234567");
    clickSend();

    await screen.findByText(/הודעת הניסיון נשלחה/);
    expect(mockHttp.sendTestMessage).toHaveBeenCalledWith({
      eventId: 1,
      messageType: "rsvpReminder",
      phone: "+972521234567",
    });
  });

  it("defaults to the invitation when the invitation content is complete", async () => {
    render(<TestMessageSend eventId={1} event={completeEvent} />);

    typePhone("0521234567");
    clickSend();

    await screen.findByText(/הודעת הניסיון נשלחה/);
    expect(mockHttp.sendTestMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: "rsvp" }),
    );
  });

  it("rejects an invalid phone without calling the server", async () => {
    render(<TestMessageSend eventId={1} event={completeEvent} />);

    typePhone("12345");
    clickSend();

    expect(await screen.findByText(/מספר הטלפון אינו תקין/)).toBeInTheDocument();
    expect(mockHttp.sendTestMessage).not.toHaveBeenCalled();
  });

  it("shows a failure message when the send fails", async () => {
    mockHttp.sendTestMessage.mockResolvedValue({ success: false, error: "boom" });
    render(<TestMessageSend eventId={1} event={completeEvent} />);

    typePhone("0521234567");
    clickSend();

    expect(await screen.findByText(/שליחת הודעת הניסיון נכשלה/)).toBeInTheDocument();
  });

  it("disables the invitation option and defaults to the reminder when invitation content is missing", async () => {
    render(
      <TestMessageSend eventId={1} event={{ ...completeEvent, file_id: undefined }} />,
    );

    expect(screen.getByText(/חסרים פרטים בהזמנה/)).toBeInTheDocument();

    typePhone("0521234567");
    clickSend();

    await waitFor(() => expect(mockHttp.sendTestMessage).toHaveBeenCalled());
    expect(mockHttp.sendTestMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: "rsvpReminder" }),
    );
  });

  it("warns not to tap the buttons in the test message", () => {
    render(<TestMessageSend eventId={1} event={completeEvent} />);

    expect(
      screen.getByText("שימו לב — לא ללחוץ על הכפתורים בהודעה"),
    ).toBeInTheDocument();
    expect(screen.getByText(/לחיצה תעדכן בפועל את אישור ההגעה/)).toBeInTheDocument();
  });

  it("hides the thank-you option for non-primary events", () => {
    render(
      <TestMessageSend eventId={2} event={{ ...completeEvent, id: 2, is_primary: false }} />,
    );

    expect(screen.queryByText("הודעת תודה")).not.toBeInTheDocument();
    expect(screen.getByText("תזכורת ליום האירוע")).toBeInTheDocument();
  });
});
