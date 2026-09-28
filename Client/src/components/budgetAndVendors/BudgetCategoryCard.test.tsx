/**
 * Verifies the "offer to add a payment" flow: whenever a vendor is saved with
 * a status that just changed to "שולם" or "שולם חלקית", the user is asked
 * whether to record a payment too — nothing is created automatically. Saying
 * yes opens the payment modal; saving it calls the payments API.
 */
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BudgetCategoryCard from "./BudgetCategoryCard";
import { BudgetCategoryWithSpending, VendorWithPayments } from "../../types";
import { httpRequests } from "../../httpClient";

jest.mock("../../httpClient", () => ({
  httpRequests: {
    addVendor: jest.fn(),
    updateVendor: jest.fn(),
    addPayment: jest.fn(),
  },
}));

jest.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ user: { name: "test-user" }, isLoading: false }),
}));

const mockRefreshBudget = jest.fn();
jest.mock("../../hooks/useAppData", () => ({
  useAppData: () => ({
    setBudgetOverview: jest.fn(),
    refreshBudget: (...args: unknown[]) => mockRefreshBudget(...args),
  }),
}));

// Stub the vendor form: expose one save button per status so tests can submit
// a vendor with the status they need without driving wix form internals.
jest.mock("./VendorModal", () => (props: any) => (
  <div>
    {["שולם", "שולם חלקית", "יצרנו קשר"].map((status) => (
      <button
        key={status}
        onClick={() =>
          props.onSave(
            {
              name: "ספק בדיקה",
              category_id: 1,
              agreed_cost: 1000,
              status,
              is_favorite: false,
            },
            undefined
          )
        }
      >
        {`vendor-stub-save-${status}`}
      </button>
    ))}
  </div>
));

jest.mock("./PaymentModal", () => (props: any) => (
  <button
    onClick={() =>
      props.onSave({ amount: 500, payment_date: "2026-01-15", notes: "בדיקה" })
    }
  >
    payment-stub-save
  </button>
));

jest.mock("./VendorCard", () => (props: any) => (
  <button onClick={props.onEdit}>vendor-stub-edit</button>
));

const makeVendor = (status: string): VendorWithPayments =>
  ({
    vendor_id: 77,
    user_id: "u1",
    name: "ספק בדיקה",
    category_id: 1,
    agreed_cost: 1000,
    status,
    is_favorite: false,
    payments: [],
    files: [],
    total_paid: 0,
    remaining_balance: 1000,
  } as VendorWithPayments);

const makeCategory = (
  vendors: VendorWithPayments[] = []
): BudgetCategoryWithSpending =>
  ({
    category_id: 1,
    user_id: "u1",
    name: "אולם",
    vendors,
    agreed_cost: 0,
    actual_spending: 0,
  } as BudgetCategoryWithSpending);

const renderCard = (vendors: VendorWithPayments[] = []) =>
  render(
    <BudgetCategoryCard
      category={makeCategory(vendors)}
      icon="📦"
      isExpanded={true}
      onToggleExpand={jest.fn()}
      formatCurrency={(n) => `₪${n}`}
      highlightedVendorId={null}
    />
  );

// user-event v13 doesn't act()-wrap, so clicks need wrapping for React 18
const click = async (element: Element) => {
  await act(async () => {
    userEvent.click(element);
  });
};

const saveNewVendorWithStatus = async (status: string) => {
  await click(screen.getByText("הוסף ספק"));
  await click(screen.getByText(`vendor-stub-save-${status}`));
};

beforeEach(() => {
  jest.clearAllMocks();
  (httpRequests.addVendor as jest.Mock).mockImplementation(async (data) => ({
    vendor_id: 77,
    ...data,
  }));
  (httpRequests.updateVendor as jest.Mock).mockImplementation(
    async (_id, data) => ({ vendor_id: 77, ...data })
  );
  (httpRequests.addPayment as jest.Mock).mockResolvedValue({
    payment_id: 5,
    vendor_id: 77,
    amount: 500,
    payment_date: "2026-01-15",
  });
});

it('offers to add a payment when a vendor is added as "שולם", and opens the payment modal on yes', async () => {
  renderCard();

  await saveNewVendorWithStatus("שולם");

  expect(
    await screen.findByText(/רוצים לתעד עכשיו את התשלום/)
  ).toBeInTheDocument();
  await click(screen.getByText("כן, הוסף תשלום"));

  await click(await screen.findByText("payment-stub-save"));
  await waitFor(() =>
    expect(httpRequests.addPayment).toHaveBeenCalledWith(
      77,
      500,
      "2026-01-15",
      "בדיקה"
    )
  );
  expect(mockRefreshBudget).toHaveBeenCalled();
});

it('also offers a payment for "שולם חלקית"', async () => {
  renderCard();

  await saveNewVendorWithStatus("שולם חלקית");

  expect(
    await screen.findByText(/רוצים לתעד עכשיו את התשלום/)
  ).toBeInTheDocument();
});

it("does not offer a payment for a non-paid status", async () => {
  renderCard();

  await saveNewVendorWithStatus("יצרנו קשר");

  await waitFor(() => expect(httpRequests.addVendor).toHaveBeenCalled());
  expect(screen.queryByText(/רוצים לתעד עכשיו את התשלום/)).toBeNull();
});

it("does not create anything when the user declines the offer", async () => {
  renderCard();

  await saveNewVendorWithStatus("שולם");

  await screen.findByText(/רוצים לתעד עכשיו את התשלום/);
  await click(screen.getByText("ביטול"));

  expect(screen.queryByText("payment-stub-save")).toBeNull();
  expect(httpRequests.addPayment).not.toHaveBeenCalled();
});

it('does not re-offer when editing a vendor whose status was already "שולם"', async () => {
  renderCard([makeVendor("שולם")]);

  await click(screen.getByText("vendor-stub-edit"));
  await click(screen.getByText("vendor-stub-save-שולם"));

  await waitFor(() => expect(httpRequests.updateVendor).toHaveBeenCalled());
  expect(screen.queryByText(/רוצים לתעד עכשיו את התשלום/)).toBeNull();
});

it('offers when an existing vendor\'s status changes from "הוזמן" to "שולם"', async () => {
  renderCard([makeVendor("הוזמן")]);

  await click(screen.getByText("vendor-stub-edit"));
  await click(screen.getByText("vendor-stub-save-שולם"));

  expect(
    await screen.findByText(/רוצים לתעד עכשיו את התשלום/)
  ).toBeInTheDocument();
});
