import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import SearchAndFilterBar from "./SearchAndFilterBar";
import { EventGuest, FilterOptions } from "../../types";

const guest = (overrides: Partial<EventGuest> = {}): EventGuest => ({
  id: 1,
  event_id: 1,
  guest_id: 1,
  rsvp_status: null,
  name: "אורח",
  whose: "כלה",
  circle: "משפחה",
  number_of_guests: 1,
  ...overrides,
});

const renderBar = (filterOptions: Partial<FilterOptions> = {}) => {
  const setFilterOptions = jest.fn();
  const options: FilterOptions = {
    whose: [],
    circle: [],
    rsvpStatus: [],
    searchTerm: "",
    ...filterOptions,
  };
  render(
    <SearchAndFilterBar
      guestsList={[guest()]}
      filterOptions={options}
      setFilterOptions={setFilterOptions}
    />,
  );
  return { setFilterOptions, options };
};

describe("SearchAndFilterBar active-filter chips", () => {
  it("shows no chips when no filters are active", () => {
    renderBar();
    expect(screen.queryByTestId("active-filter-chips")).not.toBeInTheDocument();
  });

  it("shows a labeled chip for every active filter value", () => {
    renderBar({ whose: ["כלה"], circle: ["משפחה", "עבודה"], rsvpStatus: ["pending"] });
    const chips = screen.getByTestId("active-filter-chips");
    expect(chips).toHaveTextContent("מוזמן ע״י: כלה");
    expect(chips).toHaveTextContent("מעגל: משפחה");
    expect(chips).toHaveTextContent("מעגל: עבודה");
    expect(chips).toHaveTextContent("סטטוס: ממתין");
  });

  it("clears all filters (but not the search text) via the נקה הכל pill", () => {
    const { setFilterOptions, options } = renderBar({
      whose: ["כלה"],
      circle: ["משפחה"],
      rsvpStatus: ["pending"],
      searchTerm: "אבי",
    });
    fireEvent.click(screen.getByText("נקה הכל"));
    const updater = setFilterOptions.mock.calls[0][0];
    expect(updater(options)).toEqual({
      whose: [],
      circle: [],
      rsvpStatus: [],
      searchTerm: "אבי", // the search input shows its own text — not part of the chips
    });
  });

  it("hides the נקה הכל pill when no filters are active", () => {
    renderBar({ searchTerm: "אבי" });
    expect(screen.queryByText("נקה הכל")).not.toBeInTheDocument();
  });

  it("removes only the clicked filter value", () => {
    const { setFilterOptions, options } = renderBar({
      whose: ["כלה"],
      circle: ["משפחה", "עבודה"],
      rsvpStatus: ["pending"],
    });
    fireEvent.click(screen.getByTitle("הסרת הסינון מעגל: משפחה"));
    expect(setFilterOptions).toHaveBeenCalledTimes(1);
    // The setter receives a functional updater — apply it to verify the result
    const updater = setFilterOptions.mock.calls[0][0];
    expect(updater(options)).toEqual({
      whose: ["כלה"],
      circle: ["עבודה"],
      rsvpStatus: ["pending"],
      searchTerm: "",
    });
  });
});
