import React from "react";
import { render, fireEvent, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Header from "./Header";

const mockStartTour = jest.fn();
jest.mock("../../hooks/useTour", () => ({
  useTour: () => ({ startTour: mockStartTour }),
}));
jest.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({
    user: { userID: "u1", name: "Neta" },
    isAdmin: false,
    handleLogout: jest.fn(),
    partnerInfo: null,
    refreshPartnerInfo: jest.fn(),
  }),
}));
jest.mock("../userDashboard/PartnerModal", () => () => null);
jest.mock("../rsvp/ViewLogsModal", () => () => null);

describe("Header tour entry points", () => {
  afterEach(() => mockStartTour.mockClear());

  const renderAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Header />
      </MemoryRouter>
    );

  const helpButton = (container: HTMLElement) =>
    container.querySelector('[data-hook="help-button"]') as HTMLElement;

  it("help button starts the tour for the current page", () => {
    const { container } = renderAt("/rsvp");
    fireEvent.click(helpButton(container));
    expect(mockStartTour).toHaveBeenCalledWith("guest-counts");
  });

  it("help button starts the full tour on the dashboard", () => {
    const { container } = renderAt("/");
    fireEvent.click(helpButton(container));
    expect(mockStartTour).toHaveBeenCalledWith(undefined);
  });

  it("menu item starts the full tour from the beginning", () => {
    jest.useFakeTimers();
    renderAt("/rsvp");
    fireEvent.click(screen.getByText(/Neta/));
    fireEvent.click(screen.getByText("🎯 סיור מודרך מלא"));
    act(() => {
      jest.advanceTimersByTime(300);
    });
    expect(mockStartTour).toHaveBeenCalledWith();
    jest.useRealTimers();
  });
});
