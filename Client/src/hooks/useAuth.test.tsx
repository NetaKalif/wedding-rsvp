import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider, useAuth } from "./useAuth";

// Regression test for the accidental-account-deletion incident (2026-09-26):
// when /getPrimaryEvent fails, useAuth must expose weddingInfoError=true so
// consumers can distinguish "no wedding info yet" from "failed to load it".

const mockGetMe = jest.fn();
const mockGetPartnerInfo = jest.fn();
const mockGetPrimaryEvent = jest.fn();

jest.mock("../httpClient", () => ({
  httpRequests: {
    getMe: (...args: unknown[]) => mockGetMe(...args),
    getPartnerInfo: (...args: unknown[]) => mockGetPartnerInfo(...args),
    getPrimaryEvent: (...args: unknown[]) => mockGetPrimaryEvent(...args),
  },
  setAuthToken: jest.fn(),
  setUnauthorizedHandler: jest.fn(),
}));

jest.mock("@react-oauth/google", () => ({ googleLogout: jest.fn() }));

const Probe = () => {
  const { isLoading, weddingInfoError, user } = useAuth();
  if (isLoading) return <div>loading</div>;
  return (
    <div>
      <div data-testid="wedding-info-error">{String(weddingInfoError)}</div>
      <div data-testid="user">{user?.name ?? "none"}</div>
    </div>
  );
};

const renderProvider = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </MemoryRouter>
  );

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.setItem("authToken", "test-token");
  mockGetMe.mockResolvedValue({
    user: { userID: "u1", email: "u1@test.com", name: "משתמש" },
    isAdmin: false,
    status: "approved",
  });
  mockGetPartnerInfo.mockResolvedValue({ isLinkedAccount: false });
});

afterEach(() => {
  localStorage.clear();
});

describe("useAuth weddingInfoError", () => {
  test("is false when wedding info loads (even as null for a new user)", async () => {
    mockGetPrimaryEvent.mockResolvedValue(null);
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("wedding-info-error")).toHaveTextContent("false")
    );
    expect(screen.getByTestId("user")).toHaveTextContent("משתמש");
  });

  test("is true when the wedding info fetch fails, and the user stays signed in", async () => {
    mockGetPrimaryEvent.mockRejectedValue(new Error("Connection terminated due to connection timeout"));
    renderProvider();
    await waitFor(() =>
      expect(screen.getByTestId("wedding-info-error")).toHaveTextContent("true")
    );
    // The failure must not be treated as an auth failure — user is still set.
    expect(screen.getByTestId("user")).toHaveTextContent("משתמש");
  });
});
