import React from "react";
import { render } from "@testing-library/react";
import BudgetOverviewCard from "./BudgetOverviewCard";
import { BudgetOverview } from "../../types";

const budgetData: BudgetOverview = {
  total_budget: 120000,
  total_expenses: 9000,
  remaining_budget: 18000,
  usage_percentage: 85,
  estimated_guests: 200,
  price_per_guest: 510,
  planned_expenses: 102000,
  categories: [],
};

it("renders real data-tour anchors for the budget tour steps", () => {
  const { container } = render(
    <BudgetOverviewCard
      budgetData={budgetData}
      onUpdateBudget={jest.fn()}
      onUpdateGuests={jest.fn()}
      formatCurrency={(amount) => `₪${amount}`}
    />
  );

  [
    "total-budget",
    "planned-expenses",
    "remaining-budget",
    "paid-total",
    "guest-count",
  ].forEach((anchor) => {
    expect(container.querySelector(`[data-tour="${anchor}"]`)).not.toBeNull();
  });
});
