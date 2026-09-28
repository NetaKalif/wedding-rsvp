import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BudgetOverviewCard from "./BudgetOverviewCard";
import { BudgetOverview } from "../../types";
import { BUDGET_STAT_EXPLANATIONS } from "../global/tourSteps";

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

it("shows the tour explanation only when hovering a stat card's (i) icon, not the card itself", async () => {
  const { container } = render(
    <BudgetOverviewCard
      budgetData={budgetData}
      onUpdateBudget={jest.fn()}
      onUpdateGuests={jest.fn()}
      formatCurrency={(amount) => `₪${amount}`}
    />
  );

  for (const [anchor, { text }] of Object.entries(BUDGET_STAT_EXPLANATIONS)) {
    // Hovering the card body does nothing
    const card = container.querySelector(`[data-tour="${anchor}"]`)!;
    userEvent.hover(card);
    expect(screen.queryByText(text)).toBeNull();
    userEvent.unhover(card);

    // Hovering the (i) icon shows the explanation
    const icon = container.querySelector(`[data-hook="stat-info-${anchor}"]`)!;
    expect(icon).not.toBeNull();
    userEvent.hover(icon);
    expect(await screen.findByText(text)).toBeInTheDocument();
    userEvent.unhover(icon);
  }
});
