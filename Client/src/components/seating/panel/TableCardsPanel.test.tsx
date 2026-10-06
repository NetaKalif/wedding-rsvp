import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TableCardsPanel } from "./TableCardsPanel";
import { SeatingAssignment, SeatingItem } from "../../../types";
import { DRAG_MIME, GUEST_DRAG_TYPE } from "../logic";

const table = (overrides: Partial<SeatingItem> = {}): SeatingItem => ({
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

const assignment = (overrides: Partial<SeatingAssignment> = {}): SeatingAssignment => ({
  id: 1,
  item_id: 1,
  event_guest_id: 1,
  rsvp_status: 3,
  name: "אבי כהן",
  number_of_guests: 3,
  ...overrides,
});

const renderPanel = (props: Partial<React.ComponentProps<typeof TableCardsPanel>> = {}) => {
  const defaults: React.ComponentProps<typeof TableCardsPanel> = {
    tables: [table()],
    assignments: [],
    onAssignGuest: jest.fn(),
    onUnassignGuest: jest.fn(),
    onOpenTable: jest.fn(),
    onClose: jest.fn(),
  };
  return render(<TableCardsPanel {...defaults} {...props} />);
};

describe("TableCardsPanel", () => {
  it("renders a card per selected table with its guests and occupancy", () => {
    renderPanel({
      tables: [table({ id: 1 }), table({ id: 2, table_number: 2, label: "שולחן חברים" })],
      assignments: [
        assignment({ event_guest_id: 1, item_id: 1, name: "אבי כהן", rsvp_status: 3 }),
        assignment({ id: 2, event_guest_id: 2, item_id: 2, name: "דנה לוי", rsvp_status: 2 }),
      ],
    });
    const card1 = screen.getByTestId("table-card-1");
    const card2 = screen.getByTestId("table-card-2");
    expect(card1).toHaveTextContent("שולחן 1");
    expect(card1).toHaveTextContent("אבי כהן");
    expect(card1).toHaveTextContent("3/10");
    expect(card2).toHaveTextContent("שולחן חברים");
    expect(card2).toHaveTextContent("דנה לוי");
    expect(card2).toHaveTextContent("2/10");
  });

  it("renders a card for every selected table, with the count in the header", () => {
    renderPanel({
      tables: [1, 2, 3, 4, 5].map((id) => table({ id, table_number: id })),
    });
    [1, 2, 3, 4, 5].forEach((id) => {
      expect(screen.getByTestId(`table-card-${id}`)).toBeInTheDocument();
    });
    expect(screen.getByText("פרטי שולחנות (5)")).toBeInTheDocument();
  });

  it("guest rows start a drag carrying the shared guest payload", () => {
    renderPanel({
      assignments: [assignment({ event_guest_id: 42, item_id: 1 })],
    });
    const row = screen.getByTitle("גררו לשולחן אחר");
    expect(row).toHaveAttribute("draggable", "true");
    const setData = jest.fn();
    fireEvent.dragStart(row, { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalledWith(DRAG_MIME, JSON.stringify({ type: "guest", eventGuestId: 42 }));
    expect(setData).toHaveBeenCalledWith(GUEST_DRAG_TYPE, "1");
  });

  it("dropping a guest on another card reassigns them to that table", () => {
    const onAssignGuest = jest.fn();
    renderPanel({
      tables: [table({ id: 1 }), table({ id: 2, table_number: 2 })],
      assignments: [assignment({ event_guest_id: 42, item_id: 1 })],
      onAssignGuest,
    });
    fireEvent.drop(screen.getByTestId("table-card-2"), {
      dataTransfer: {
        types: [GUEST_DRAG_TYPE, DRAG_MIME],
        getData: (mime: string) =>
          mime === DRAG_MIME ? JSON.stringify({ type: "guest", eventGuestId: 42 }) : "",
      },
    });
    expect(onAssignGuest).toHaveBeenCalledWith(42, 2);
  });

  it("highlights a card while a guest drag hovers it, and only for guest drags", () => {
    renderPanel({
      tables: [table({ id: 1 }), table({ id: 2, table_number: 2 })],
    });
    const card = screen.getByTestId("table-card-2");
    // A non-guest drag (e.g. a bank item) is ignored
    fireEvent.dragOver(card, { dataTransfer: { types: [DRAG_MIME] } });
    expect(card).not.toHaveClass("table-card-drop-target");
    fireEvent.dragOver(card, { dataTransfer: { types: [GUEST_DRAG_TYPE, DRAG_MIME], dropEffect: "" } });
    expect(card).toHaveClass("table-card-drop-target");
    fireEvent.dragLeave(card);
    expect(card).not.toHaveClass("table-card-drop-target");
  });

  it("unassigns a guest from the card", () => {
    const onUnassignGuest = jest.fn();
    renderPanel({
      assignments: [assignment({ event_guest_id: 7, item_id: 1 })],
      onUnassignGuest,
    });
    fireEvent.click(screen.getByTitle("הסרה מהשולחן"));
    expect(onUnassignGuest).toHaveBeenCalledWith(7);
  });

  it("opens the full table modal from the edit button", () => {
    const onOpenTable = jest.fn();
    renderPanel({ onOpenTable });
    fireEvent.click(screen.getByTitle("עריכת השולחן"));
    expect(onOpenTable).toHaveBeenCalledWith(1);
  });

  it("closes via the X button", () => {
    const onClose = jest.fn();
    renderPanel({ onClose });
    fireEvent.click(screen.getByTitle("סגירת הפאנל"));
    expect(onClose).toHaveBeenCalled();
  });

  it("declined guests are not draggable and show an explanation", () => {
    renderPanel({
      assignments: [assignment({ event_guest_id: 7, item_id: 1, rsvp_status: 0 })],
    });
    const row = screen.getByTitle("האורח ביטל הגעה");
    expect(row).toHaveAttribute("draggable", "false");
  });
});
