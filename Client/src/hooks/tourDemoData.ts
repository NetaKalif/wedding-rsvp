import { BudgetOverview, EventGuest, Gift, Guest } from "../types";

// Example rows shown during the guided tour when the account has no real data
// yet, so every step has something real to point at. All ids are negative so
// they can never collide with server rows, and nothing here is persisted —
// leaving the tour reloads the real data from the server.

export const DEMO_GUESTS: Guest[] = [
  { id: -101, name: "דנה לוי (דוגמה)", phone: "0521111111", whose: "כלה", circle: "משפחה", number_of_guests: 2 },
  { id: -102, name: "יוסי כהן (דוגמה)", phone: "0522222222", whose: "חתן", circle: "חברים מהצבא", number_of_guests: 1 },
  { id: -103, name: "רות אברהם (דוגמה)", phone: "0523333333", whose: "כלה", circle: "לימודים", number_of_guests: 3 },
  { id: -104, name: "אבי מזרחי (דוגמה)", phone: "0524444444", whose: "חתן", circle: "עבודה", number_of_guests: 2 },
];

// One of each status: confirmed (2), pending, declined, confirmed (1)
const DEMO_RSVP_STATUSES: Array<number | null> = [2, null, 0, 1];

export const buildDemoEventGuests = (eventId: number): EventGuest[] =>
  DEMO_GUESTS.map((guest, i) => ({
    id: guest.id!,
    event_id: eventId,
    guest_id: guest.id!,
    rsvp_status: DEMO_RSVP_STATUSES[i],
    name: guest.name,
    phone: guest.phone,
    whose: guest.whose,
    circle: guest.circle,
    number_of_guests: guest.number_of_guests,
  }));

export const buildDemoBudget = (
  existing: BudgetOverview | null
): BudgetOverview => {
  const totalBudget = existing?.total_budget || 120000;
  const estimatedGuests = existing?.estimated_guests || 100;
  const agreedCost = 60000;
  const totalPaid = 10000;

  return {
    total_budget: totalBudget,
    estimated_guests: estimatedGuests,
    planned_expenses: agreedCost,
    total_expenses: totalPaid,
    remaining_budget: totalBudget - agreedCost,
    usage_percentage: totalBudget > 0 ? (agreedCost / totalBudget) * 100 : 0,
    price_per_guest: estimatedGuests > 0 ? agreedCost / estimatedGuests : 0,
    categories: [
      {
        category_id: -1,
        user_id: "demo",
        name: "אולם",
        agreed_cost: agreedCost,
        actual_spending: totalPaid,
        vendors: [
          {
            vendor_id: -1,
            user_id: "demo",
            name: "אולמי הדוגמה",
            job_title: "אולם אירועים",
            category_id: -1,
            category_name: "אולם",
            agreed_cost: agreedCost,
            status: "שולם חלקית",
            phone: "039999999",
            notes: "ספק לדוגמה — נעלם בסיום הסיור",
            is_favorite: true,
            payments: [
              {
                payment_id: -1,
                vendor_id: -1,
                amount: totalPaid,
                payment_date: "2026-01-15",
                notes: "מקדמה",
              },
            ],
            files: [],
            total_paid: totalPaid,
            remaining_balance: agreedCost - totalPaid,
          },
        ],
      },
    ],
  };
};

export const DEMO_GIFTS: Gift[] = [
  { gift_id: -1, guest_id: -101, gift_type: "bit", amount: 800 },
  { gift_id: -2, guest_id: -104, gift_type: "check", amount: 1000 },
];
