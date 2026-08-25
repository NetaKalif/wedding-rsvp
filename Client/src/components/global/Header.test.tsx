import React from "react";
import { render, fireEvent, screen, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Header from "./Header";

const mockStartTour = jest.fn();
const mockHandleLogout = jest.fn();
const mockDeleteUser = jest.fn();
jest.mock("../../hooks/useTour", () => ({
  useTour: () => ({ startTour: mockStartTour }),
}));
jest.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({
    user: { userID: "u1", name: "Neta" },
    isAdmin: false,
    handleLogout: mockHandleLogout,
    partnerInfo: null,
    refreshPartnerInfo: jest.fn(),
  }),
}));
jest.mock("../../httpClient", () => ({
  httpRequests: {
    deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
    getMyDataExportUrl: jest.fn(),
  },
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

describe("Header delete account confirmation", () => {
  afterEach(() => {
    mockDeleteUser.mockReset();
    mockHandleLogout.mockClear();
  });

  const openDeleteAccount = () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Header />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByText(/Neta/));
    fireEvent.click(screen.getByText("מחיקת חשבון"));
  };

  it("does not delete the account before the modal is confirmed", () => {
    openDeleteAccount();
    expect(screen.getByText("מחק חשבון")).toBeInTheDocument();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it("cancelling the modal keeps the account", async () => {
    openDeleteAccount();
    fireEvent.click(screen.getByText("ביטול"));
    await act(async () => {});
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockHandleLogout).not.toHaveBeenCalled();
    expect(screen.queryByText("מחק חשבון")).not.toBeInTheDocument();
  });

  it("confirming the modal deletes the account and logs out", async () => {
    mockDeleteUser.mockResolvedValue(undefined);
    openDeleteAccount();
    fireEvent.click(screen.getByText("מחק חשבון"));
    await act(async () => {});
    expect(mockDeleteUser).toHaveBeenCalledTimes(1);
    expect(mockHandleLogout).toHaveBeenCalledTimes(1);
  });
});
