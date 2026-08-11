import { getTourSteps, TOUR_PAGE_START_STEPS } from "./tourSteps";

describe("TOUR_PAGE_START_STEPS", () => {
  it("maps every feature page to an existing tour step", () => {
    const ids = new Set(getTourSteps().map((s) => s.id));
    expect(TOUR_PAGE_START_STEPS).toEqual({
      "/tasks": "tasks-overview",
      "/budget": "budget-overview",
      "/rsvp": "guest-counts",
      "/gifts": "gift-stats",
    });
    Object.values(TOUR_PAGE_START_STEPS).forEach((stepId) => {
      expect(ids.has(stepId)).toBe(true);
    });
  });
});

describe("navigation between tour pages", () => {
  afterEach(() => {
    delete (window as any).shepherdTour;
    document.body.innerHTML = "";
    jest.useRealTimers();
  });

  const getNavigateAction = () => {
    const step = getTourSteps().find((s) => s.id === "tasks-intro");
    const button = (step?.buttons as any[]).find(
      (b) => b.text === "עבור למשימות"
    );
    return button.action as () => Promise<void>;
  };

  it("hides the current step immediately and advances once the next anchor exists", async () => {
    jest.useFakeTimers();
    const steps = [
      { id: "tasks-intro" },
      { options: { attachTo: { element: '[data-tour="tasks-container"]' } } },
    ];
    const tour = {
      hide: jest.fn(),
      next: jest.fn(),
      steps,
      getCurrentStep: () => steps[0],
    };
    (window as any).shepherdTour = tour;

    await getNavigateAction()();

    expect(tour.hide).toHaveBeenCalled();
    expect(tour.next).not.toHaveBeenCalled();

    // Anchor not in the DOM yet — keeps waiting
    jest.advanceTimersByTime(300);
    expect(tour.next).not.toHaveBeenCalled();

    const anchor = document.createElement("div");
    anchor.setAttribute("data-tour", "tasks-container");
    document.body.appendChild(anchor);

    jest.advanceTimersByTime(100);
    expect(tour.next).toHaveBeenCalled();
  });

  it("advances anyway after the max wait if the anchor never appears", async () => {
    jest.useFakeTimers();
    const steps = [
      { id: "tasks-intro" },
      { options: { attachTo: { element: '[data-tour="never-appears"]' } } },
    ];
    const tour = {
      hide: jest.fn(),
      next: jest.fn(),
      steps,
      getCurrentStep: () => steps[0],
    };
    (window as any).shepherdTour = tour;

    await getNavigateAction()();

    jest.advanceTimersByTime(5100);
    expect(tour.next).toHaveBeenCalled();
  });
});

describe("getTourSteps", () => {
  it("anchors the dashboard-overview step to the wedding countdown", () => {
    const step = getTourSteps().find((s) => s.id === "dashboard-overview");

    expect(step).toBeDefined();
    expect(step?.attachTo).toEqual({
      element: '[data-tour="wedding-countdown"]',
      on: "bottom",
    });
  });

  it("anchors the tasks-intro step to the tasks feature card", () => {
    const step = getTourSteps().find((s) => s.id === "tasks-intro");

    expect(step).toBeDefined();
    expect(step?.attachTo).toEqual({
      element: '[data-tour="nav-tasks"]',
      on: "bottom",
    });
  });

  it("anchors the tasks page steps to the first group, edit button and add form", () => {
    const steps = getTourSteps();
    const anchors = Object.fromEntries(
      steps.map((s) => [s.id, (s.attachTo as any)?.element])
    );

    expect(anchors["tasks-overview"]).toBe('[data-tour="first-task-group"]');
    expect(anchors["edit-task"]).toBe('[data-tour="edit-task-btn"]');
    expect(anchors["add-task"]).toBe('[data-tour="add-task-form"]');
    // The old standalone form/management steps are gone
    expect(steps.find((s) => s.id === "task-form")).toBeUndefined();
    expect(steps.find((s) => s.id === "task-management")).toBeUndefined();
  });

  it("anchors the budget stat steps to their cards, in order", () => {
    const steps = getTourSteps();
    const budgetStatIds = [
      "total-budget",
      "planned-expenses",
      "remaining-budget",
      "paid-total",
    ];

    budgetStatIds.forEach((id) => {
      const step = steps.find((s) => s.id === id);
      expect(step?.attachTo).toEqual({
        element: `[data-tour="${id}"]`,
        on: "bottom",
      });
    });

    const order = steps
      .map((s) => s.id)
      .filter((id) =>
        ["budget-overview", ...budgetStatIds, "guest-count"].includes(id as string)
      );
    expect(order).toEqual([
      "budget-overview",
      ...budgetStatIds,
      "guest-count",
    ]);
  });

  it("anchors the vendor flow steps and drops the old unanchored ones", () => {
    const steps = getTourSteps();
    const anchors = Object.fromEntries(
      steps.map((s) => [s.id, (s.attachTo as any)?.element])
    );

    expect(anchors["add-vendor"]).toBe('[data-tour="add-vendor-btn"]');
    expect(anchors["vendor-status"]).toBe('[data-tour="vendor-status"]');
    expect(anchors["vendor-files"]).toBe('[data-tour="vendor-files"]');
    expect(anchors["add-payment"]).toBe('[data-tour="add-payment-btn"]');
    expect(anchors["vendor-balance"]).toBe('[data-tour="vendor-balance"]');

    ["category-example", "vendor-details", "payment-status", "upload-contract"].forEach(
      (id) => expect(steps.find((s) => s.id === id)).toBeUndefined()
    );
  });

  it("anchors the RSVP page steps, in order, and drops the old broken ones", () => {
    const steps = getTourSteps();
    const anchors = Object.fromEntries(
      steps.map((s) => [s.id, (s.attachTo as any)?.element])
    );

    const expectedAnchors: Record<string, string> = {
      "guest-counts": '[data-tour="guest-counts"]',
      "response-rates": '[data-tour="response-rates"]',
      "add-guests-intro": '[data-tour="add-guests-btn"]',
      "manual-guest-form": '[data-tour="manual-guest-form"]',
      "excel-upload": '[data-tour="excel-upload"]',
      "guests-table": '[data-tour="guests-table"]',
      "search-filter": '[data-tour="search-filter"]',
      "edit-details": '[data-tour="edit-details-btn"]',
      "send-messages-intro": '[data-tour="send-messages-btn"]',
      "message-types": '[data-tour="message-types"]',
      "select-specific-guests": '[data-tour="select-specific-guests"]',
      "whatsapp-preview": '[data-tour="whatsapp-preview"]',
      "call-pending": '[data-tour="call-pending-btn"]',
      "export-rsvp": '[data-tour="export-btn"]',
      "events-tab": '[data-tour="events-tab"]',
      "add-event": '[data-tour="add-event-btn"]',
    };
    Object.entries(expectedAnchors).forEach(([id, anchor]) => {
      expect({ id, anchor: anchors[id] }).toEqual({ id, anchor });
    });

    // Steps appear in the intended order
    const rsvpIds = steps
      .map((s) => s.id as string)
      .filter((id) => id in expectedAnchors);
    expect(rsvpIds).toEqual(Object.keys(expectedAnchors));

    // Old unanchored / broken-anchor steps are gone
    [
      "rsvp-overview",
      "manual-tab",
      "single-guest",
      "guest-list-explanation",
      "send-invitations",
      "resend-strategy",
      "selective-sending",
      "rsvp-responses",
      "guest-filters",
      "reminders",
      "thank-you-messages",
      "additional-events",
      "sub-events",
    ].forEach((id) => expect(steps.find((s) => s.id === id)).toBeUndefined());
  });

  it("anchors the gifts and post-wedding steps, in order, and drops the old ones", () => {
    const steps = getTourSteps();
    const anchors = Object.fromEntries(
      steps.map((s) => [s.id, (s.attachTo as any)?.element])
    );

    const expectedAnchors: Record<string, string> = {
      "gift-stats": '[data-tour="gift-stats"]',
      "guest-search": '[data-tour="guest-search"]',
      "gift-form": '[data-tour="gift-form"]',
      "add-gift-guest": '[data-tour="add-gift-guest-btn"]',
      "add-gift-guest-form": '[data-tour="add-gift-guest-form"]',
      "gifts-table": '[data-tour="gifts-table"]',
      "export-gifts": '[data-tour="export-gifts-btn"]',
      "data-export": '[data-tour="user-menu"]',
      "cleanup-flow": '[data-tour="user-menu"]',
    };
    Object.entries(expectedAnchors).forEach(([id, anchor]) => {
      expect({ id, anchor: anchors[id] }).toEqual({ id, anchor });
    });

    const giftIds = steps
      .map((s) => s.id as string)
      .filter((id) => id in expectedAnchors);
    expect(giftIds).toEqual(Object.keys(expectedAnchors));

    ["gifts-overview", "search-guests", "record-gift", "gift-types", "non-invited-guests", "post-wedding-intro"].forEach(
      (id) => expect(steps.find((s) => s.id === id)).toBeUndefined()
    );

    // Every step in the tour is anchored except the intro/transition/final ones
    const unanchored = steps.filter((s) => !s.attachTo).map((s) => s.id);
    expect(unanchored).toEqual([
      "welcome",
      "budget-intro",
      "rsvp-intro",
      "gifts-intro",
      "tour-complete",
    ]);
  });
});

describe("back navigation between tour pages", () => {
  afterEach(() => {
    delete (window as any).shepherdTour;
    document.body.innerHTML = "";
    window.history.pushState({}, "", "/");
    jest.useRealTimers();
  });

  it("navigates back to the previous page and waits for the previous anchor", () => {
    jest.useFakeTimers();
    const steps = [
      { options: { attachTo: { element: '[data-tour="nav-tasks"]' } } },
      { id: "tasks-overview" },
    ];
    const tour = {
      hide: jest.fn(),
      back: jest.fn(),
      steps,
      getCurrentStep: () => steps[1],
    };
    (window as any).shepherdTour = tour;
    window.history.pushState({}, "", "/tasks");

    const step = getTourSteps().find((s) => s.id === "tasks-overview");
    const button = (step?.buttons as any[]).find((b) => b.text === "הקודם");
    button.action();

    expect(tour.hide).toHaveBeenCalled();
    expect(window.location.pathname).toBe("/");
    expect(tour.back).not.toHaveBeenCalled();

    // Waits until the previous step's anchor exists on the page
    jest.advanceTimersByTime(300);
    expect(tour.back).not.toHaveBeenCalled();

    const anchor = document.createElement("div");
    anchor.setAttribute("data-tour", "nav-tasks");
    document.body.appendChild(anchor);
    jest.advanceTimersByTime(100);
    expect(tour.back).toHaveBeenCalledTimes(1);
  });

  it("goes straight back when the previous step is on the same page", () => {
    const tour = { hide: jest.fn(), back: jest.fn() };
    (window as any).shepherdTour = tour;
    window.history.pushState({}, "", "/tasks");

    // edit-task's previous step (tasks-overview) is on the same page
    const step = getTourSteps().find((s) => s.id === "edit-task");
    const button = (step?.buttons as any[]).find((b) => b.text === "הקודם");
    button.action();

    expect(tour.back).toHaveBeenCalledTimes(1);
    expect(tour.hide).not.toHaveBeenCalled();
  });
});

describe("opening the add-vendor modal from the tour", () => {
  afterEach(() => {
    delete (window as any).shepherdTour;
    document.body.innerHTML = "";
    jest.useRealTimers();
  });

  it("expands the first category to reveal the add-vendor button, then advances", async () => {
    jest.useFakeTimers();
    const tour = { hide: jest.fn(), next: jest.fn() };
    (window as any).shepherdTour = tour;

    // Collapsed category: clicking the header reveals the add-vendor button
    const header = document.createElement("div");
    header.setAttribute("data-tour", "category-header");
    header.addEventListener("click", () => {
      const addVendorBtn = document.createElement("button");
      addVendorBtn.setAttribute("data-tour", "add-vendor-btn");
      document.body.appendChild(addVendorBtn);
    });
    document.body.appendChild(header);

    const step = getTourSteps().find((s) => s.id === "add-category");
    const button = (step?.buttons as any[]).find((b) => b.text === "המשך");
    await button.action();

    expect(tour.hide).toHaveBeenCalled();

    jest.advanceTimersByTime(200);
    expect(document.querySelector('[data-tour="add-vendor-btn"]')).not.toBeNull();
    expect(tour.next).toHaveBeenCalledTimes(1);
  });

  it("does not collapse an already-expanded category on the way to the add-vendor step", async () => {
    jest.useFakeTimers();
    const tour = { hide: jest.fn(), next: jest.fn() };
    (window as any).shepherdTour = tour;

    const header = document.createElement("div");
    header.setAttribute("data-tour", "category-header");
    const onHeaderClick = jest.fn();
    header.addEventListener("click", onHeaderClick);
    document.body.appendChild(header);

    const addVendorBtn = document.createElement("button");
    addVendorBtn.setAttribute("data-tour", "add-vendor-btn");
    document.body.appendChild(addVendorBtn);

    const step = getTourSteps().find((s) => s.id === "add-category");
    const button = (step?.buttons as any[]).find((b) => b.text === "המשך");
    await button.action();

    expect(onHeaderClick).not.toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(tour.next).toHaveBeenCalledTimes(1);
  });

  it("switches the add-guest modal to the file tab from the manual step", async () => {
    jest.useFakeTimers();
    const tour = { hide: jest.fn(), next: jest.fn() };
    (window as any).shepherdTour = tour;

    // Tab bar as wix Tabs renders it: buttons with role="tab"
    const tabsWrapper = document.createElement("div");
    tabsWrapper.setAttribute("data-tour", "add-guest-tabs");
    const manualTab = document.createElement("button");
    manualTab.setAttribute("role", "tab");
    const fileTab = document.createElement("button");
    fileTab.setAttribute("role", "tab");
    fileTab.addEventListener("click", () => {
      const upload = document.createElement("div");
      upload.setAttribute("data-tour", "excel-upload");
      document.body.appendChild(upload);
    });
    tabsWrapper.append(manualTab, fileTab);
    document.body.appendChild(tabsWrapper);

    const step = getTourSteps().find((s) => s.id === "manual-guest-form");
    const button = (step?.buttons as any[]).find((b) => b.text === "המשך");
    await button.action();

    jest.advanceTimersByTime(200);
    expect(document.querySelector('[data-tour="excel-upload"]')).not.toBeNull();
    expect(tour.next).toHaveBeenCalledTimes(1);
  });

  it("opens the vendor modal from the add-vendor step", async () => {
    jest.useFakeTimers();
    const tour = { hide: jest.fn(), next: jest.fn() };
    (window as any).shepherdTour = tour;

    const addVendorBtn = document.createElement("button");
    addVendorBtn.setAttribute("data-tour", "add-vendor-btn");
    addVendorBtn.addEventListener("click", () => {
      const status = document.createElement("div");
      status.setAttribute("data-tour", "vendor-status");
      document.body.appendChild(status);
    });
    document.body.appendChild(addVendorBtn);

    const step = getTourSteps().find((s) => s.id === "add-vendor");
    const button = (step?.buttons as any[]).find((b) => b.text === "המשך");
    await button.action();

    expect(tour.hide).toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(document.querySelector('[data-tour="vendor-status"]')).not.toBeNull();
    expect(tour.next).toHaveBeenCalledTimes(1);
  });
});

describe("opening the add-task form from the tour", () => {
  afterEach(() => {
    delete (window as any).shepherdTour;
    document.body.innerHTML = "";
    jest.useRealTimers();
  });

  it("clicks the add-task button, waits for the form, then advances", async () => {
    jest.useFakeTimers();
    const tour = { hide: jest.fn(), next: jest.fn() };
    (window as any).shepherdTour = tour;

    const addTaskBtn = document.createElement("button");
    addTaskBtn.setAttribute("data-tour", "add-task-btn");
    const onClick = jest.fn(() => {
      const form = document.createElement("div");
      form.setAttribute("data-tour", "add-task-form");
      document.body.appendChild(form);
    });
    addTaskBtn.addEventListener("click", onClick);
    document.body.appendChild(addTaskBtn);

    const step = getTourSteps().find((s) => s.id === "edit-task");
    const button = (step?.buttons as any[]).find((b) => b.text === "המשך");
    await button.action();

    expect(tour.hide).toHaveBeenCalled();
    expect(onClick).toHaveBeenCalled();
    expect(tour.next).not.toHaveBeenCalled();

    jest.advanceTimersByTime(100);
    expect(tour.next).toHaveBeenCalled();
  });
});
