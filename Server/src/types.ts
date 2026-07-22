// ==================== Core entities ====================

export interface User {
  name: string;
  email: string;
  userID: string;
}

/** Full admin-view row: every user, any status, with partner links and deletion-timeline status. */
export interface AdminUserRow {
  userID: string;
  email: string;
  name: string;
  status: "pending" | "approved" | "declined";
  primaryUserID: string | null;
  linkedToName: string | null;
  partnerName: string | null;
  weddingDate: string | null;
  warningSentAt: Date | null;
  cancelledAt: Date | null;
}

/** Pure guest data — no RSVP, no event coupling. */
export interface Guest {
  id?: number;
  user_id: string;
  name: string;
  /** Null for guests with no cellphone — they're excluded from all WhatsApp sends. */
  phone: string | null;
  whose: string;
  circle: string;
  number_of_guests: number;
}

/**
 * An event — wedding (is_primary=true) or any other ceremony.
 * Wedding-specific fields (bride_name, groom_name, waze_link, etc.) are nullable
 * and only shown in the UI for the primary event.
 */
export interface Event {
  id?: number;
  user_id: string;
  is_primary: boolean;
  ceremony_name: string;
  date?: string;
  time?: string;
  location?: string;
  additional_info?: string;
  file_id?: string;
  // Primary-event (wedding) fields:
  bride_name?: string;
  groom_name?: string;
  waze_link?: string;
  gift_link?: string;
  thank_you_message?: string;
  send_reminder?: boolean;
  reminder_day?: "day_before" | "wedding_day";
  reminder_time?: string;
  send_thank_you?: boolean;
  estimated_guests?: number;
  total_budget?: number;
  created_at?: Date;
  // 60-day post-wedding data retention (primary event only):
  deletion_warning_sent_at?: Date | null;
  deletion_cancelled_at?: Date | null;
}

/**
 * A guest's membership in a specific event.
 * rsvp_status and last_rsvp_sent_at are per-event.
 * Guest fields (name, phone, etc.) are joined from the guests table at query time.
 */
export interface EventGuest {
  id?: number;
  event_id: number;
  guest_id: number;
  rsvp_status?: number | null;
  last_rsvp_sent_at?: Date;
  // Joined from guests at query time (not stored here):
  name?: string;
  phone?: string | null;
  whose?: string;
  circle?: string;
  number_of_guests?: number;
  user_id?: string;
}

// ==================== Utility types ====================

export type RsvpFilter = "all" | "pending" | "approved" | "declined";

export type TemplateName =
  | "wedding_rsvp_action"
  | "wedding_day_reminder"
  | "wedding_rsvp_reminder"
  | "day_before_wedding_reminder"
  | "wedding_reminders_no_gift"
  | "wedding_reminders_no_gift_same_day"
  | "custom_thank_you_message"
  | "thank_you_message";

export interface ClientLog {
  id?: number;
  userID?: string | null;
  message: string;
  createdAt?: Date;
}

// ==================== Task types ====================

export type TaskPriority = 1 | 2 | 3;
export type TaskAssignee = "bride" | "groom" | "both";

export interface Task {
  task_id?: number;
  user_id: string;
  title: string;
  timeline_group: string;
  is_completed: boolean;
  priority?: TaskPriority;
  assignee?: TaskAssignee;
  sort_order?: number;
  created_at?: Date;
  deleted_at?: Date | null;
}

export interface DefaultTask {
  timeline_group: string;
  title: string;
  assignee?: TaskAssignee;
  info?: string;
}

// ==================== Budget types ====================

export interface BudgetCategory {
  category_id?: number;
  user_id: string;
  name: string;
  created_at?: Date;
}

export type VendorStatus = "יצרנו קשר" | "הוזמן" | "שולם חלקית" | "שולם";

export interface VendorFile {
  file_id?: number;
  vendor_id: number;
  file_name: string;
  file_type: string;
  file_size: number;
  file_data?: Buffer;
  uploaded_at?: Date;
}

export interface Vendor {
  vendor_id?: number;
  user_id: string;
  name: string;
  job_title?: string;
  category_id: number;
  category_name?: string;
  agreed_cost: number;
  status: VendorStatus;
  phone?: string;
  email?: string;
  notes?: string;
  is_favorite: boolean;
  created_at?: Date;
  files?: VendorFile[];
}

export interface Payment {
  payment_id?: number;
  vendor_id: number;
  amount: number;
  payment_date: string;
  notes?: string;
  created_at?: Date;
}

export interface VendorWithPayments extends Vendor {
  payments: Payment[];
  files: VendorFile[];
  total_paid: number;
  remaining_balance: number;
}

export interface BudgetCategoryWithSpending extends BudgetCategory {
  actual_spending: number;
  agreed_cost: number;
  vendors: VendorWithPayments[];
}

export interface BudgetOverview {
  total_budget: number;
  total_expenses: number;
  remaining_budget: number;
  usage_percentage: number;
  estimated_guests: number;
  price_per_guest: number;
  categories: BudgetCategoryWithSpending[];
  planned_expenses: number;
}
