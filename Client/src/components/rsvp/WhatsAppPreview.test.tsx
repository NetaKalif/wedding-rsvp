import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import WhatsAppPreview from "./WhatsAppPreview";
import { Event } from "../../types";
import { MessageType } from "./MessageGroupsModal";

const baseEvent: Event = {
  id: 1,
  user_id: "user-1",
  is_primary: true,
  ceremony_name: "חתונה",
  bride_name: "דנה",
  groom_name: "יוסי",
  time: "19:30:00",
};

const renderPreview = (event: Event, messageType: MessageType) => {
  render(
    <WhatsAppPreview
      event={event}
      showAllMessages={false}
      messageType={messageType}
    />
  );
  fireEvent.click(screen.getByText("הצג תצוגה מקדימה"));
};

describe("WhatsAppPreview - unified event reminder template", () => {
  it("shows day-before wording for a wedding reminder scheduled the day before", () => {
    renderPreview({ ...baseEvent, reminder_day: "day_before" }, "eventReminder");

    expect(
      screen.getByText(/מתרגשים לראותכם מחר בחתונה של דנה ויוסי בשעה 19:30/)
    ).toBeInTheDocument();
    expect(screen.getByText(/נתראה ! 🎊 🪩/)).toBeInTheDocument();
  });

  it("shows same-day wording for a wedding-day reminder", () => {
    renderPreview({ ...baseEvent, reminder_day: "wedding_day" }, "eventReminder");

    expect(
      screen.getByText(/מתרגשים לראותכם היום בחתונה של דנה ויוסי/)
    ).toBeInTheDocument();
  });

  it("shows same-day wording with the ceremony name for a non-primary event reminder", () => {
    renderPreview(
      { ...baseEvent, is_primary: false, ceremony_name: "חינה" },
      "eventReminder"
    );

    expect(
      screen.getByText(/מתרגשים לראותכם היום בחינה של דנה ויוסי/)
    ).toBeInTheDocument();
  });

  it("includes waze and payment links on one line when both are set", () => {
    renderPreview(
      {
        ...baseEvent,
        reminder_day: "day_before",
        waze_link: "https://waze.com/ul/abc",
        gift_link: "https://pay.example.com/gift",
      },
      "eventReminder"
    );

    expect(
      screen.getByText(
        /לניווט: https:\/\/waze\.com\/ul\/abc \| לנוחיותכם, ניתן להעניק מתנות באשראי בקישור: https:\/\/pay\.example\.com\/gift/
      )
    ).toBeInTheDocument();
  });

  it("omits the links line entirely when the event has no links", () => {
    renderPreview({ ...baseEvent, reminder_day: "day_before" }, "eventReminder");

    expect(screen.queryByText(/לניווט:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/מתנות באשראי/)).not.toBeInTheDocument();
  });

  it("shows only the waze link when there is no payment link", () => {
    renderPreview(
      { ...baseEvent, reminder_day: "day_before", waze_link: "https://waze.com/ul/abc" },
      "eventReminder"
    );

    expect(screen.getByText(/לניווט: https:\/\/waze\.com\/ul\/abc/)).toBeInTheDocument();
    expect(screen.queryByText(/מתנות באשראי/)).not.toBeInTheDocument();
  });
});
