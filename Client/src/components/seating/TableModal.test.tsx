import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TableModal } from "./TableModal";
import { EventGuest, SeatingAssignment, SeatingItem } from "../../types";

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

const renderModal = (props: Partial<React.ComponentProps<typeof TableModal>> = {}) => {
  const defaults: React.ComponentProps<typeof TableModal> = {
    table: item(),
    items: [item(), item({ id: 2, table_number: 2, label: "שולחן חברים" })],
    assignments: [],
    eventGuests: [],
    onApply: jest.fn(),
    onClose: jest.fn(),
  };
  return render(<TableModal {...defaults} {...props} />);
};

describe("TableModal table number", () => {
  it("shows the current number and sends the edited one on save", async () => {
    const onApply = jest.fn();
    const onClose = jest.fn();
    renderModal({ onApply, onClose });
    // The number field holds the table's current number (1)
    fireEvent.change(screen.getByDisplayValue("1"), { target: { value: "5" } });
    fireEvent.click(screen.getByText("שמירה"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ table_number: 5 }),
      { assign: [], unassign: [] },
    );
  });

  it("blocks saving when the number already belongs to another table", () => {
    const onApply = jest.fn();
    renderModal({ onApply });
    fireEvent.change(screen.getByDisplayValue("1"), { target: { value: "2" } }); // table 2 exists
    fireEvent.click(screen.getByText("שמירה"));
    expect(onApply).not.toHaveBeenCalled();
  });

  it("blocks saving when the number is cleared or not a positive integer", () => {
    const onApply = jest.fn();
    renderModal({ onApply });
    const numberInput = screen.getByDisplayValue("1");
    fireEvent.change(numberInput, { target: { value: "" } });
    fireEvent.click(screen.getByText("שמירה"));
    fireEvent.change(numberInput, { target: { value: "0" } });
    fireEvent.click(screen.getByText("שמירה"));
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe("TableModal add-guest list", () => {
  it("shows only unassigned guests by default", () => {
    renderModal({
      eventGuests: [
        guest({ id: 1, name: "פנוי לגמרי" }),
        guest({ id: 2, guest_id: 2, name: "משובץ אחר" }),
      ],
      assignments: [assignment({ event_guest_id: 2, item_id: 2, name: "משובץ אחר" })],
    });
    expect(screen.getByText("פנוי לגמרי (3)")).toBeInTheDocument();
    expect(screen.queryByText("משובץ אחר (3)")).not.toBeInTheDocument();
  });

  it("shows assigned guests (with their table badge and a move button) when toggled", () => {
    renderModal({
      eventGuests: [guest({ id: 2, guest_id: 2, name: "משובץ אחר" })],
      assignments: [assignment({ event_guest_id: 2, item_id: 2, name: "משובץ אחר" })],
    });
    fireEvent.click(screen.getByText("הצג גם אורחים שכבר משובצים (הוספה תעביר אותם לשולחן זה)"));
    expect(screen.getByText("משובץ אחר (3)")).toBeInTheDocument();
    expect(screen.getByText("שולחן חברים")).toBeInTheDocument(); // current table badge
    expect(screen.getByText("העבר")).toBeInTheDocument(); // move, not add
  });

  it("never lists guests already at this table or declined guests", () => {
    renderModal({
      eventGuests: [
        guest({ id: 1, name: "כבר בשולחן" }),
        guest({ id: 3, guest_id: 3, name: "ביטל הגעה", rsvp_status: 0 }),
      ],
      assignments: [assignment({ event_guest_id: 1, item_id: 1, name: "כבר בשולחן" })],
    });
    fireEvent.click(screen.getByText("הצג גם אורחים שכבר משובצים (הוספה תעביר אותם לשולחן זה)"));
    // The seated guest appears in the table's list above, not the addable list
    expect(screen.queryByText("כבר בשולחן (3)")).not.toBeInTheDocument();
    expect(screen.queryByText(/ביטל הגעה \(/)).not.toBeInTheDocument();
  });

  it("filters the addable list with the search bar", () => {
    renderModal({
      eventGuests: [
        guest({ id: 1, name: "אבי כהן" }),
        guest({ id: 2, guest_id: 2, name: "דנה לוי" }),
      ],
    });
    fireEvent.change(screen.getByPlaceholderText("חיפוש אורחים..."), { target: { value: "דנה" } });
    expect(screen.getByText("דנה לוי (3)")).toBeInTheDocument();
    expect(screen.queryByText("אבי כהן (3)")).not.toBeInTheDocument();
  });

  it("stages an added guest without calling the API until save", () => {
    const onApply = jest.fn();
    renderModal({
      eventGuests: [guest({ id: 7, name: "להוספה" })],
      onApply,
    });
    fireEvent.click(screen.getByText("הוסף"));
    // Staged into the table's list, not sent to the server
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByText(/להוספה — 3 מקומות \(יתווסף בשמירה\)/)).toBeInTheDocument();
    // And the staged addition can be un-staged
    fireEvent.click(screen.getByTitle("ביטול ההוספה"));
    expect(screen.queryByText(/יתווסף בשמירה/)).not.toBeInTheDocument();
  });

  it("saving sends everything as ONE apply call (single undoable action)", async () => {
    const onApply = jest.fn();
    const onClose = jest.fn();
    renderModal({
      eventGuests: [
        guest({ id: 1, name: "יוסר" }),
        guest({ id: 7, guest_id: 7, name: "יתווסף" }),
      ],
      assignments: [assignment({ event_guest_id: 1, item_id: 1, name: "יוסר" })],
      onApply, onClose,
    });

    fireEvent.click(screen.getByText("הוסף")); // stage addition of the unassigned guest
    fireEvent.click(screen.getByTitle("הסרה מהשולחן")); // stage removal of the seated guest
    fireEvent.change(screen.getByPlaceholderText(/שולחן/), { target: { value: "שולחן צבא" } });
    expect(onApply).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("שמירה"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ label: "שולחן צבא", capacity: 10 }),
      { assign: [7], unassign: [1] },
    );
  });

  it("staging a removal frees the guest back into the addable list", () => {
    renderModal({
      eventGuests: [guest({ id: 1, name: "יוסר" })],
      assignments: [assignment({ event_guest_id: 1, item_id: 1, name: "יוסר" })],
    });
    // Seated at this table → not addable
    expect(screen.queryByText("יוסר (3)")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle("הסרה מהשולחן"));
    // Now staged for removal → offered for (re-)adding as unassigned
    expect(screen.getByText("יוסר (3)")).toBeInTheDocument();
  });
});
