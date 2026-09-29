import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { GuestsPanel } from "./GuestsPanel";
import { EventGuest, SeatingAssignment, SeatingItem } from "../../../types";
import { DRAG_MIME, GUEST_DRAG_TYPE } from "../logic";

const item = (overrides: Partial<SeatingItem> = {}): SeatingItem => ({
  id: 1,
  event_id: 1,
  kind: "table",
  shape: "circle",
  label: null,
  table_number: 1,
  capacity: 10,
  x_cm: 0,
  y_cm: 0,
  width_cm: 180,
  height_cm: 180,
  rotation_deg: 0,
  ...overrides,
});

const guest = (overrides: Partial<EventGuest> = {}): EventGuest => ({
  id: 1,
  event_id: 1,
  guest_id: 1,
  rsvp_status: 3,
  name: "אבי כהן",
  whose: "כלה",
  circle: "משפחה",
  number_of_guests: 3,
  ...overrides,
});

const assignment = (overrides: Partial<SeatingAssignment> = {}): SeatingAssignment => ({
  id: 1,
  item_id: 1,
  event_guest_id: 1,
  rsvp_status: 3,
  name: "אבי כהן",
  number_of_guests: 3,
  ...overrides,
});

describe("GuestsPanel", () => {
  // The drag ghost is appended to document.body and removed on a 0ms timeout,
  // which can land after the test ends — sweep it so it can't leak into
  // another test's queries.
  afterEach(() => {
    document.querySelectorAll(".guest-drag-ghost").forEach((el) => el.remove());
  });

  it("shows the seated/confirmed progress line", () => {
    render(
      <GuestsPanel
        eventGuests={[guest({ id: 1, rsvp_status: 3 }), guest({ id: 2, name: "דנה", rsvp_status: 2 })]}
        assignments={[assignment({ event_guest_id: 1 })]}
        items={[item()]}
        onUnassign={jest.fn()}
      />,
    );
    expect(screen.getByTestId("seating-progress")).toHaveTextContent("הושבו 3 מתוך 5 אורחים שאישרו");
  });

  it("shows a table badge for assigned guests", () => {
    render(
      <GuestsPanel
        eventGuests={[guest()]}
        assignments={[assignment()]}
        items={[item({ label: "שולחן משפחה" })]}
        onUnassign={jest.fn()}
      />,
    );
    expect(screen.getByText("שולחן משפחה")).toBeInTheDocument();
  });

  it("lists declined-but-seated guests under needs-attention and unassigns them", () => {
    const onUnassign = jest.fn();
    render(
      <GuestsPanel
        eventGuests={[guest({ rsvp_status: 0 })]}
        assignments={[assignment({ rsvp_status: 0, event_guest_id: 1 })]}
        items={[item()]}
        onUnassign={onUnassign}
      />,
    );
    const attention = screen.getByTestId("needs-attention");
    expect(attention).toHaveTextContent("אבי כהן");
    fireEvent.click(attention.querySelector("button") as HTMLElement);
    expect(onUnassign).toHaveBeenCalledWith(1);
  });

  it("hides the needs-attention section when nothing is wrong", () => {
    render(
      <GuestsPanel eventGuests={[guest()]} assignments={[]} items={[item()]} onUnassign={jest.fn()} />,
    );
    expect(screen.queryByTestId("needs-attention")).not.toBeInTheDocument();
  });

  it("filters guests by search text", () => {
    render(
      <GuestsPanel
        eventGuests={[guest({ id: 1 }), guest({ id: 2, guest_id: 2, name: "דנה לוי" })]}
        assignments={[]}
        items={[]}
        onUnassign={jest.fn()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("חיפוש אורחים..."), { target: { value: "דנה" } });
    expect(screen.getByText("דנה לוי")).toBeInTheDocument();
    expect(screen.queryByText("אבי כהן")).not.toBeInTheDocument();
  });

  it("hides assigned guests when 'unassigned only' is checked", () => {
    render(
      <GuestsPanel
        eventGuests={[guest({ id: 1 }), guest({ id: 2, guest_id: 2, name: "דנה לוי" })]}
        assignments={[assignment({ event_guest_id: 1 })]}
        items={[item()]}
        onUnassign={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByText("רק אורחים ללא שולחן"));
    expect(screen.getByText("דנה לוי")).toBeInTheDocument();
    expect(screen.queryByText("אבי כהן")).not.toBeInTheDocument();
  });

  it("drags from the dedicated handle, carrying the payload and the guest-drag type marker", () => {
    render(
      <GuestsPanel eventGuests={[guest({ id: 42 })]} assignments={[]} items={[]} onUnassign={jest.fn()} />,
    );
    const handle = screen.getByTitle("גררו אל שולחן באולם");
    expect(handle).toHaveClass("guest-drag-handle"); // the small square, not the whole row
    expect(handle).toHaveAttribute("draggable", "true");
    const setData = jest.fn();
    const setDragImage = jest.fn();
    fireEvent.dragStart(handle, { dataTransfer: { setData, setDragImage, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledWith(DRAG_MIME, JSON.stringify({ type: "guest", eventGuestId: 42 }));
    // The marker is what lets the canvas show a no-drop cursor over empty floor
    expect(setData).toHaveBeenCalledWith(GUEST_DRAG_TYPE, "1");
    // The drag image is a pill with the seat count and the guest's name,
    // anchored at its corner so the cursor doesn't cover the number
    expect(setDragImage).toHaveBeenCalled();
    const [ghost, offsetX, offsetY] = setDragImage.mock.calls[0] as [HTMLElement, number, number];
    expect(ghost).toHaveClass("guest-drag-ghost");
    expect(ghost.querySelector(".guest-drag-ghost-count")?.textContent).toBe("3"); // confirmed rsvp count
    expect(ghost.textContent).toContain("אבי כהן");
    expect(offsetX).toBe(ghost.offsetWidth);
    expect(offsetY).toBe(ghost.offsetHeight);
  });

  it("clicking a seated guest's row highlights their table on the canvas", () => {
    const onHighlightTable = jest.fn();
    render(
      <GuestsPanel
        eventGuests={[guest({ id: 1 }), guest({ id: 2, guest_id: 2, name: "דנה לוי" })]}
        assignments={[assignment({ event_guest_id: 1, item_id: 9 })]}
        items={[item({ id: 9 })]}
        onUnassign={jest.fn()}
        onHighlightTable={onHighlightTable}
      />,
    );
    fireEvent.click(screen.getByTitle("לחיצה תסמן את השולחן באולם"));
    expect(onHighlightTable).toHaveBeenCalledWith(9);
    // Unseated guests' rows are not clickable
    fireEvent.click(screen.getByText("דנה לוי"));
    expect(onHighlightTable).toHaveBeenCalledTimes(1);
  });

  it("filters via the shared checkbox filter panel (whose)", () => {
    render(
      <GuestsPanel
        eventGuests={[
          guest({ id: 1, name: "אבי כהן", whose: "כלה" }),
          guest({ id: 2, guest_id: 2, name: "דנה לוי", whose: "חתן" }),
        ]}
        assignments={[]}
        items={[]}
        onUnassign={jest.fn()}
      />,
    );
    fireEvent.click(screen.getByText("סינון"));
    fireEvent.click(screen.getByText("כלה")); // whose checkbox in the filter modal
    expect(screen.getByText("אבי כהן")).toBeInTheDocument();
    expect(screen.queryByText("דנה לוי")).not.toBeInTheDocument();
  });

  it("renders no drag handle for declined guests", () => {
    render(
      <GuestsPanel
        eventGuests={[guest({ rsvp_status: 0 })]}
        assignments={[]}
        items={[]}
        onUnassign={jest.fn()}
      />,
    );
    expect(screen.getByTitle("האורח ביטל הגעה")).toBeInTheDocument();
    expect(screen.queryByTitle("גררו אל שולחן באולם")).not.toBeInTheDocument();
  });
});
