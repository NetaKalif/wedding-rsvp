import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CreateEventWizard from "./CreateEventWizard";
import { httpRequests } from "../../httpClient";

jest.mock("../../httpClient", () => ({
  httpRequests: {
    createEvent: jest.fn(),
    setEventGuests: jest.fn(),
  },
}));

const mockCreateEvent = httpRequests.createEvent as jest.Mock;

// CRA's jest config resets mock implementations before each test, so they are
// (re)defined here rather than in the jest.mock factory.
beforeEach(() => {
  mockCreateEvent.mockImplementation((event: object) => Promise.resolve({ id: 7, ...event }));
  (httpRequests.setEventGuests as jest.Mock).mockResolvedValue([]);
});

const renderWizard = (onCreated = jest.fn()) =>
  render(
    <CreateEventWizard
      userID="user-1"
      guestsList={[]}
      onClose={jest.fn()}
      onCreated={onCreated}
    />
  );

// The wizard renders inside a Modal portal and the file input is hidden inside
// the design-system FileUpload — query document rather than container.
const fillRequiredFields = () => {
  fireEvent.change(screen.getByPlaceholderText("לדוגמה: חינה, מסיבת רווקות..."), {
    target: { value: "חינה" },
  });
  const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
  fireEvent.change(dateInput, { target: { value: "2026-09-01" } });
  const timeInput = document.querySelector('input[type="time"]') as HTMLInputElement;
  fireEvent.change(timeInput, { target: { value: "19:30" } });
  fireEvent.change(screen.getByPlaceholderText("שם המקום"), {
    target: { value: "אולם הדקל" },
  });
};

const selectImage = () => {
  const file = new File(["img"], "invite.png", { type: "image/png" });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return file;
};

const nextButton = () => screen.getByText("הבא: בחירת אורחים").closest("button")!;

describe("CreateEventWizard - required event details", () => {
  it("keeps the next-step button disabled until name, date, time, location and image are all provided", () => {
    renderWizard();

    expect(nextButton()).toHaveAttribute("aria-disabled", "true");
    fillRequiredFields();
    expect(nextButton()).toHaveAttribute("aria-disabled", "true");

    selectImage();
    expect(nextButton()).not.toHaveAttribute("aria-disabled", "true");
  });

  it("includes the optional waze and gift links in the created event", async () => {
    const onCreated = jest.fn();
    renderWizard(onCreated);

    fillRequiredFields();
    const file = selectImage();
    fireEvent.change(screen.getByPlaceholderText("הזינו קישור לוויז"), {
      target: { value: "https://waze.com/ul/abc" },
    });
    fireEvent.change(screen.getByPlaceholderText("הזינו קישור למתנות באשראי"), {
      target: { value: "https://pay.example.com/gift" },
    });

    fireEvent.click(nextButton());
    fireEvent.click(screen.getByText("צור אירוע"));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(mockCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        ceremony_name: "חינה",
        date: "2026-09-01",
        time: "19:30",
        location: "אולם הדקל",
        waze_link: "https://waze.com/ul/abc",
        gift_link: "https://pay.example.com/gift",
        is_primary: false,
      }),
      file
    );
  });
});
