import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WeddingDashboard } from "./WeddingDashboard";

// Regression tests for the accidental-account-deletion incident (2026-09-26):
// 1. a failed wedding-info fetch must NOT classify an existing user as
//    first-time (which showed them the account setup wizard), and
// 2. cancelling the setup wizard must never delete the account.

const mockDeleteUser = jest.fn();
jest.mock("../../httpClient", () => ({
  httpRequests: new Proxy({}, { get: (_t, prop) => (prop === "deleteUser" ? mockDeleteUser : jest.fn()) }),
}));

const mockHandleLogout = jest.fn();
const baseAuth = {
  user: { userID: "u1", email: "u1@test.com", name: "משתמש" },
  partnerInfo: undefined,
  weddingInfo: null,
  weddingInfoError: false,
  isLoading: false,
  refreshPartnerInfo: jest.fn(),
  refreshWeddingInfo: jest.fn(),
  handleLogout: mockHandleLogout,
};
let mockAuth = { ...baseAuth };
jest.mock("../../hooks/useAuth", () => ({
  useAuth: () => mockAuth,
}));

jest.mock("./AccountTypeSelector", () => ({
  __esModule: true,
  default: ({ onCancel }: { onCancel: () => void }) => (
    <div data-testid="account-type-selector">
      <button onClick={onCancel}>ביטול</button>
    </div>
  ),
}));
jest.mock("./WeddingSetupModal", () => ({ __esModule: true, default: () => null }));
jest.mock("./WeddingCountdown", () => ({ WeddingCountdown: () => null }));
jest.mock("../global/Header", () => ({ __esModule: true, default: () => <div /> }));

const renderDashboard = () =>
  render(
    <MemoryRouter>
      <WeddingDashboard />
    </MemoryRouter>
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { ...baseAuth };
});

describe("WeddingDashboard first-time-user classification", () => {
  test("shows the setup wizard for a genuinely new user (no wedding info, no error)", () => {
    mockAuth.weddingInfo = null;
    mockAuth.weddingInfoError = false;
    renderDashboard();
    expect(screen.getByTestId("account-type-selector")).toBeInTheDocument();
  });

  test("does NOT show the setup wizard when wedding info failed to load", () => {
    mockAuth.weddingInfo = null;
    mockAuth.weddingInfoError = true;
    renderDashboard();
    expect(screen.queryByTestId("account-type-selector")).not.toBeInTheDocument();
  });
});

describe("WeddingDashboard account setup cancel", () => {
  test("cancelling the wizard logs out without deleting the account", () => {
    mockAuth.weddingInfo = null;
    mockAuth.weddingInfoError = false;
    renderDashboard();

    fireEvent.click(screen.getByText("ביטול"));

    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockHandleLogout).toHaveBeenCalled();
  });
});
