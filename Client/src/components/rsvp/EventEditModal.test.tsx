import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EventEditModal from "./EventEditModal";
import { Event } from "../../types";
import { httpRequests } from "../../httpClient";

jest.mock("../../httpClient", () => ({
  httpRequests: {
    updateEvent: jest.fn((id: number, updates: object) =>
      Promise.resolve({ id, ...updates })
    ),
  },
}));

const mockUpdateEvent = httpRequests.updateEvent as jest.Mock;

const event: Event = {
  id: 2,
  user_id: "user-1",
  is_primary: false,
  ceremony_name: "חינה",
  waze_link: "",
  gift_link: "",
};

beforeEach(() => jest.clearAllMocks());

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
    fireEvent.click(screen.getByText("שמירה"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdateEvent).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        waze_link: "https://waze.com/ul/abc",
        gift_link: "https://pay.example.com/gift",
      })
    );
  });

  it("saves successfully with both link fields left empty", async () => {
    const onSaved = jest.fn();
    render(<EventEditModal event={event} onClose={jest.fn()} onSaved={onSaved} />);

    fireEvent.click(screen.getByText("שמירה"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(mockUpdateEvent).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ waze_link: "", gift_link: "" })
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
