import React from "react";
import { render, act } from "@testing-library/react";
import { TourProvider, useTour } from "./useTour";

const mockTour = {
  addStep: jest.fn(),
  on: jest.fn(),
  start: jest.fn(),
  show: jest.fn(),
  getById: jest.fn(),
  complete: jest.fn(),
  cancel: jest.fn(),
};
jest.mock("shepherd.js", () => ({
  __esModule: true,
  default: {
    // A plain function so `new Shepherd.Tour()` reliably returns the mock
    Tour: function MockShepherdTour() {
      return mockTour;
    },
  },
}));

const mockHasTourBeenSeen = jest.fn();
const mockMarkTourAsSeen = jest.fn();
jest.mock("../httpClient", () => ({
  httpRequests: {
    hasTourBeenSeen: (...args: unknown[]) => mockHasTourBeenSeen(...args),
    markTourAsSeen: (...args: unknown[]) => mockMarkTourAsSeen(...args),
  },
}));

const fullWeddingInfo = {
  bride_name: "נטע",
  groom_name: "דן",
  date: "2027-06-04",
};
let mockUser: { userID: string } | null = { userID: "user-a" };
let mockWeddingInfo: Partial<typeof fullWeddingInfo> | null = null;
jest.mock("./useAuth", () => ({
  useAuth: () => ({ user: mockUser, weddingInfo: mockWeddingInfo }),
}));

const mockEnterTourDemoMode = jest.fn(() => false);
const mockExitTourDemoMode = jest.fn();
jest.mock("./useAppData", () => ({
  useAppData: () => ({
    enterTourDemoMode: mockEnterTourDemoMode,
    exitTourDemoMode: mockExitTourDemoMode,
  }),
}));

let tourContext: ReturnType<typeof useTour>;
const Consumer = () => {
  tourContext = useTour();
  return null;
};

const providerTree = () => (
  <TourProvider tourSteps={[]}>
    <Consumer />
  </TourProvider>
);

const renderProvider = async () => {
  const view = render(providerTree());
  // Flush the hasTourBeenSeen load
  await act(async () => {});
  return view;
};

describe("tour auto-start", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockUser = { userID: "user-a" };
    mockWeddingInfo = null;
    mockTour.start.mockClear();
    mockTour.on.mockClear();
    mockMarkTourAsSeen.mockClear();
    mockEnterTourDemoMode.mockClear();
    mockExitTourDemoMode.mockClear();
    mockEnterTourDemoMode.mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts the tour for a new user once the wedding data exists", async () => {
    mockHasTourBeenSeen.mockResolvedValue(false);
    const view = await renderProvider();

    // Before setup: no wedding data yet, so nothing starts
    act(() => jest.advanceTimersByTime(2000));
    expect(mockTour.start).not.toHaveBeenCalled();

    // Wedding setup completes and the refreshed wedding info reaches context
    mockWeddingInfo = fullWeddingInfo;
    view.rerender(providerTree());
    act(() => jest.advanceTimersByTime(1000));

    expect(mockTour.start).toHaveBeenCalledTimes(1);
  });

  it("does not start while the wedding data is still partial", async () => {
    mockHasTourBeenSeen.mockResolvedValue(false);
    mockWeddingInfo = { bride_name: "נטע" };
    await renderProvider();

    act(() => tourContext.autoStartTour());
    act(() => jest.advanceTimersByTime(2000));

    expect(mockTour.start).not.toHaveBeenCalled();
  });

  it("does not pop the tour back up after the user cancels it", async () => {
    mockHasTourBeenSeen.mockResolvedValue(false);
    mockWeddingInfo = fullWeddingInfo;
    await renderProvider();

    // Auto-start fires on mount (setup already complete)
    act(() => jest.advanceTimersByTime(1000));
    expect(mockTour.start).toHaveBeenCalledTimes(1);

    // User clicks skip / the X button → Shepherd fires 'cancel'
    const cancelHandler = mockTour.on.mock.calls.find(
      ([event]) => event === "cancel"
    )?.[1];
    expect(cancelHandler).toBeDefined();
    act(() => cancelHandler());

    // Dismissal is persisted to the server so the tour won't auto-start on
    // the next login either
    expect(mockMarkTourAsSeen).toHaveBeenCalledTimes(1);

    // The re-armed auto-start effect must not restart the tour
    act(() => tourContext.autoStartTour());
    act(() => jest.advanceTimersByTime(5000));
    expect(mockTour.start).toHaveBeenCalledTimes(1);
  });

  it("does not auto-start for a user who already saw the tour", async () => {
    mockHasTourBeenSeen.mockResolvedValue(true);
    mockWeddingInfo = fullWeddingInfo;
    await renderProvider();

    act(() => tourContext.autoStartTour());
    act(() => jest.advanceTimersByTime(2000));

    expect(mockTour.start).not.toHaveBeenCalled();
  });

  it("seeds demo data when the tour starts and drops it when the tour is cancelled", async () => {
    mockHasTourBeenSeen.mockResolvedValue(false);
    mockWeddingInfo = fullWeddingInfo;
    mockEnterTourDemoMode.mockReturnValue(true);
    await renderProvider();

    // Auto-start: demo data is seeded, then the tour begins after the
    // render-settle delay
    act(() => jest.advanceTimersByTime(1000));
    expect(mockEnterTourDemoMode).toHaveBeenCalled();
    expect(mockTour.start).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(200));
    expect(mockTour.start).toHaveBeenCalledTimes(1);

    // Cancelling the tour drops the demo data
    const cancelHandler = mockTour.on.mock.calls.find(
      ([event]) => event === "cancel"
    )?.[1];
    act(() => cancelHandler());
    expect(mockExitTourDemoMode).toHaveBeenCalled();
  });

  it("starts for a new user signing in after a previous user finished the tour", async () => {
    // User A already saw the tour — no auto-start
    mockHasTourBeenSeen.mockResolvedValueOnce(true);
    mockWeddingInfo = fullWeddingInfo;
    const view = await renderProvider();
    act(() => jest.advanceTimersByTime(2000));
    expect(mockTour.start).not.toHaveBeenCalled();

    // User B (brand new, wedding already set up) signs in on the same browser
    mockUser = { userID: "user-b" };
    mockHasTourBeenSeen.mockResolvedValueOnce(false);
    view.rerender(providerTree());
    await act(async () => {});
    act(() => jest.advanceTimersByTime(1000));

    expect(mockTour.start).toHaveBeenCalledTimes(1);
  });
});
