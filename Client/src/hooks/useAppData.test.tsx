import React from "react";
import { render, act } from "@testing-library/react";
import { AppDataProvider, useAppData } from "./useAppData";
import { httpRequests } from "../httpClient";

jest.mock("../httpClient", () => ({
  httpRequests: {
    getGuests: jest.fn(),
    getEvents: jest.fn(),
    getTasks: jest.fn(),
    getBudgetOverview: jest.fn(),
    getEventGuests: jest.fn(),
  },
}));
// A stable user object — a fresh identity per render would re-trigger the
// provider's load effect forever
jest.mock("./useAuth", () => {
  const stableUser = { userID: "u1" };
  return { useAuth: () => ({ user: stableUser }) };
});

const mocked = httpRequests as jest.Mocked<typeof httpRequests>;

let appData: ReturnType<typeof useAppData>;
const Consumer = () => {
  appData = useAppData();
  return null;
};

const renderProvider = async () => {
  render(
    <AppDataProvider>
      <Consumer />
    </AppDataProvider>
  );
  await act(async () => {});
};

describe("tour demo mode", () => {
  beforeEach(() => {
    mocked.getGuests.mockResolvedValue([]);
    mocked.getEvents.mockResolvedValue([{ id: 1, is_primary: true } as any]);
    mocked.getTasks.mockResolvedValue([]);
    mocked.getBudgetOverview.mockResolvedValue(null as any);
    mocked.getEventGuests.mockResolvedValue([]);
  });

  it("seeds guests, budget and gifts into an empty account and clears them on exit", async () => {
    await renderProvider();

    let seeded = false;
    act(() => {
      seeded = appData.enterTourDemoMode();
    });

    expect(seeded).toBe(true);
    expect(appData.isTourDemoMode).toBe(true);
    expect(appData.guests.length).toBeGreaterThan(0);
    expect(appData.eventGuestsByEventId[1].length).toBeGreaterThan(0);
    expect(appData.budgetOverview?.categories).toHaveLength(1);
    expect(
      appData.budgetOverview?.categories[0].vendors[0].remaining_balance
    ).toBeGreaterThan(0);
    expect(appData.demoGifts?.length).toBeGreaterThan(0);

    await act(async () => {
      appData.exitTourDemoMode();
    });

    expect(appData.isTourDemoMode).toBe(false);
    expect(appData.demoGifts).toBeNull();
    // The seeded slices are reloaded from the server (which is empty)
    expect(appData.guests).toEqual([]);
    expect(appData.eventGuestsByEventId[1]).toEqual([]);
    expect(appData.budgetOverview).toBeNull();
  });

  it("does not seed slices that already have real data", async () => {
    mocked.getEventGuests.mockResolvedValue([
      { id: 5, event_id: 1, guest_id: 5, name: "אורח אמיתי" } as any,
    ]);
    mocked.getBudgetOverview.mockResolvedValue({
      total_budget: 50000,
      categories: [{ category_id: 9, vendors: [] }],
    } as any);
    await renderProvider();

    let seeded = true;
    act(() => {
      seeded = appData.enterTourDemoMode();
    });

    expect(seeded).toBe(false);
    expect(appData.isTourDemoMode).toBe(false);
    expect(appData.demoGifts).toBeNull();
    expect(appData.eventGuestsByEventId[1]).toHaveLength(1);
    expect(appData.budgetOverview?.total_budget).toBe(50000);
  });
});
