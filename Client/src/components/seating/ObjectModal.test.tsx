import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ObjectModal } from "./ObjectModal";
import { SeatingItem } from "../../types";

const object = (overrides: Partial<SeatingItem> = {}): SeatingItem => ({
  id: 1,
  event_id: 1,
  kind: "object",
  shape: "rect",
  label: "עמדת DJ",
  table_number: null,
  capacity: null,
  x_cm: 0,
  y_cm: 0,
  width_cm: 200,
  height_cm: 150,
  rotation_deg: 0,
  color: "#e8e4f5",
  ...overrides,
});

const renderModal = (props: Partial<React.ComponentProps<typeof ObjectModal>> = {}) => {
  const defaults: React.ComponentProps<typeof ObjectModal> = {
    object: object(),
    onApply: jest.fn(),
    onClose: jest.fn(),
  };
  return render(<ObjectModal {...defaults} {...props} />);
};

describe("ObjectModal", () => {
  it("prefills label and exact dimensions", () => {
    renderModal();
    expect(screen.getByDisplayValue("עמדת DJ")).toBeInTheDocument();
    expect(screen.getByDisplayValue("200")).toBeInTheDocument();
    expect(screen.getByDisplayValue("150")).toBeInTheDocument();
  });

  it("shows a single diameter field for circle objects", () => {
    renderModal({ object: object({ shape: "circle", width_cm: 100, height_cm: 100 }) });
    expect(screen.getByText('קוטר (ס"מ)')).toBeInTheDocument();
    expect(screen.queryByText('רוחב (ס"מ)')).not.toBeInTheDocument();
  });

  it("applies label, dimensions and color as one save", async () => {
    const onApply = jest.fn();
    const onClose = jest.fn();
    renderModal({ onApply, onClose });

    fireEvent.change(screen.getByDisplayValue("עמדת DJ"), { target: { value: "עמדת תקליטן" } });
    fireEvent.change(screen.getByDisplayValue("200"), { target: { value: "250" } });
    fireEvent.click(screen.getAllByTitle("צבע האובייקט")[0]); // first palette swatch
    fireEvent.click(screen.getByText("שמירה"));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      label: "עמדת תקליטן",
      width_cm: 250,
      height_cm: 150,
      color: "#e8e4f5",
    });
  });

  it("disables save on invalid dimensions", () => {
    renderModal();
    fireEvent.change(screen.getByDisplayValue("200"), { target: { value: "0" } });
    // Wix buttons disable via aria-disabled, not the native attribute
    expect(screen.getByText("שמירה").closest("button")).toHaveAttribute("aria-disabled", "true");
  });
});
