import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EventEditModal from "./EventEditModal";
import { Event } from "../../types";
import { httpRequests } from "../../httpClient";

jest.mock("../../httpClient", () => ({
  httpRequests: {
    updateEvent: jest.fn(),
    getEventImageUrl: jest.fn(),
  },
}));

const mockUpdateEvent = httpRequests.updateEvent as jest.Mock;
const mockGetEventImageUrl = httpRequests.getEventImageUrl as jest.Mock;

const event: Event = {
  id: 2,
  user_id: "user-1",
  is_primary: false,
  ceremony_name: "חינה",
  date: "2026-09-01",
  time: "19:00",
  location: "אולם הדקל",
  waze_link: "",
  gift_link: "",
  file_id: "existing-file-id",
};

// CRA's jest config resets mock implementations before each test, so they are
// (re)defined here rather than in the jest.mock factory.
beforeEach(() => {
  mockUpdateEvent.mockImplementation((id: number, updates: object) =>
    Promise.resolve({ id, ...updates })
  );
  mockGetEventImageUrl.mockResolvedValue(
    "https://server.test/events/2/image?mediaToken=abc"
  );
});

// The file input is rendered (hidden) by the design-system FileUpload, and
// modal content may live in a portal — query document rather than container.
const selectImage = (name = "invite.png") => {
  const file = new File(["img"], name, { type: "image/png" });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return file;
};

const saveButton = () => screen.getByText("שמירה").closest("button")!;

describe("EventEditModal - optional waze and payment links", () => {
  it("renders both link fields as optional and saves their values", async () => {
    const onSaved = jest.fn();
    render(<EventEditModal event={event} onClose={jest.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByPlaceholderText("הזינו קישור לוויז"), {
      target: { value: "https://waze.com/ul/abc" },
    });
    fireEvent.change(screen.getByPlaceholderText("הזינו קישור למתנות באשראי"), {
      target: { value: "https://pay.example.com/gift" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdateEvent).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        waze_link: "https://waze.com/ul/abc",
        gift_link: "https://pay.example.com/gift",
      }),
      undefined
    );
  });

  it("saves successfully with both link fields left empty", async () => {
    const onSaved = jest.fn();
    render(<EventEditModal event={event} onClose={jest.fn()} onSaved={onSaved} />);

    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdateEvent).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ waze_link: "", gift_link: "" }),
      undefined
    );
  });

  it("prefills existing link values from the event", () => {
    render(
      <EventEditModal
        event={{ ...event, waze_link: "https://waze.com/ul/xyz", gift_link: "https://pay.me/1" }}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    );

    expect(screen.getByDisplayValue("https://waze.com/ul/xyz")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://pay.me/1")).toBeInTheDocument();
  });
});

describe("EventEditModal - automatic reminder settings", () => {
  const reminderCheckboxLabel = "שליחת תזכורת אוטומטית לאורחים שאישרו הגעה";

  it("defaults to reminder off and saves send_reminder=false", async () => {
    const onSaved = jest.fn();
    render(<EventEditModal event={event} onClose={jest.fn()} onSaved={onSaved} />);

    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdateEvent).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ send_reminder: false }),
      undefined
    );
  });

  it("turning the reminder on reveals day/time options and saves them", async () => {
    const onSaved = jest.fn();
    render(<EventEditModal event={event} onClose={jest.fn()} onSaved={onSaved} />);

    // Day/time options are hidden until the reminder is turned on
    expect(screen.queryByText("יום לפני האירוע")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(reminderCheckboxLabel));
    fireEvent.click(screen.getByText("יום לפני האירוע"));
    const timeInputs = document.querySelectorAll('input[type="time"]');
    fireEvent.change(timeInputs[timeInputs.length - 1], { target: { value: "08:30" } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdateEvent).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        send_reminder: true,
        reminder_day: "day_before",
        reminder_time: "08:30",
      }),
      undefined
    );
  });

  it("turning the reminder on reveals the free-text box and saves it single-line", async () => {
    const onSaved = jest.fn();
    render(<EventEditModal event={event} onClose={jest.fn()} onSaved={onSaved} />);

    const freeTextPlaceholder =
      "טקסט חופשי שיצורף להודעת התזכורת (שורה אחת בלבד). לדוגמה: פרטי הסעות או חניה";
    // The free-text box is hidden until the reminder is turned on
    expect(screen.queryByPlaceholderText(freeTextPlaceholder)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(reminderCheckboxLabel));
    fireEvent.change(screen.getByPlaceholderText(freeTextPlaceholder), {
      target: { value: "הסעות יוצאות\nמהעירייה" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdateEvent).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        send_reminder: true,
        reminder_additional_text: "הסעות יוצאות מהעירייה",
      }),
      undefined
    );
  });

  it("prefills an existing reminder free text from the event", () => {
    render(
      <EventEditModal
        event={{ ...event, send_reminder: true, reminder_additional_text: "יש חניה בשפע" }}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    );

    expect(screen.getByDisplayValue("יש חניה בשפע")).toBeInTheDocument();
  });

  it("prefills existing reminder settings, normalizing HH:MM:SS times", () => {
    render(
      <EventEditModal
        event={{ ...event, send_reminder: true, reminder_day: "day_before", reminder_time: "08:15:00" }}
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    );

    expect(screen.getByText("יום לפני האירוע")).toBeInTheDocument();
    expect(screen.getByDisplayValue("08:15")).toBeInTheDocument();
  });
});

describe("EventEditModal - required date, time and location", () => {
  it.each([
    ["date", { date: "" }],
    ["time", { time: "" }],
    ["location", { location: "" }],
  ])("blocks saving when %s is missing", (_field, override) => {
    render(
      <EventEditModal event={{ ...event, ...override }} onClose={jest.fn()} onSaved={jest.fn()} />
    );

    expect(saveButton()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(saveButton());
    expect(mockUpdateEvent).not.toHaveBeenCalled();
  });

  it("saves once the missing field is filled in", async () => {
    const onSaved = jest.fn();
    render(
      <EventEditModal event={{ ...event, location: "" }} onClose={jest.fn()} onSaved={onSaved} />
    );

    fireEvent.change(screen.getByPlaceholderText("שם המקום"), {
      target: { value: "גן האירועים" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdateEvent).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ location: "גן האירועים" }),
      undefined
    );
  });
});

describe("EventEditModal - required invitation image", () => {
  const eventWithoutImage: Event = { ...event, file_id: undefined };

  it("blocks saving when the event has no image and none is selected", () => {
    render(<EventEditModal event={eventWithoutImage} onClose={jest.fn()} onSaved={jest.fn()} />);

    expect(screen.getByText("חובה להעלות תמונת הזמנה")).toBeInTheDocument();
    expect(saveButton()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(saveButton());
    expect(mockUpdateEvent).not.toHaveBeenCalled();
  });

  it("allows saving once an image is selected, and uploads it", async () => {
    const onSaved = jest.fn();
    render(<EventEditModal event={eventWithoutImage} onClose={jest.fn()} onSaved={onSaved} />);

    const file = selectImage();
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdateEvent).toHaveBeenCalledWith(2, expect.any(Object), file);
  });

  it("shows a preview of the event's existing invitation image", async () => {
    render(<EventEditModal event={event} onClose={jest.fn()} onSaved={jest.fn()} />);

    await waitFor(() => {
      const img = document.querySelector(
        'img[src="https://server.test/events/2/image?mediaToken=abc"]'
      );
      expect(img).toBeInTheDocument();
    });
    expect(mockGetEventImageUrl).toHaveBeenCalledWith(2);
  });

  it("uploads a replacement image for an event that already has one", async () => {
    const onSaved = jest.fn();
    render(<EventEditModal event={event} onClose={jest.fn()} onSaved={onSaved} />);

    const file = selectImage("new-invite.png");
    fireEvent.click(saveButton());

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdateEvent).toHaveBeenCalledWith(2, expect.any(Object), file);
  });
});
