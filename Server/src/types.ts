// ==================== Core entities ====================

export interface User {
  name: string;
  email: string;
  userID: string;
}

/**
 * How a couple's messages go out:
 * - "manual"    — they open the send modal and fire each message themselves (default).
 * - "scheduled" — "send and go": they fill in all message content up front, pick a
 *   date/time per round (invitation, 3 reminders, 2 call rounds), and the server
 *   scheduler sends everything; manual sends are blocked except resending to
 *   guests whose delivery failed.
 */
export type MessagingPlan = "manual" | "scheduled";

export type ScheduledRoundType = "rsvp" | "rsvpReminder" | "call";

/** The fixed set of schedulable rounds per event: one invitation, three reminders, two call rounds. */
export const SCHEDULED_ROUND_LIMITS: Record<ScheduledRoundType, number> = {
  rsvp: 1,
  rsvpReminder: 3,
  call: 2,
};

/**
 * One scheduled send round for an event ("send and go" plan). A round is
 * editable while status is "pending"; once the scheduler claims it, it ends
 * up sent/failed/skipped and is immutable.
 */
export interface ScheduledRound {
  id?: number;
  event_id: number;
  round_type: ScheduledRoundType;
  round_number: number;
  scheduled_at: Date;
  status: "pending" | "processing" | "sent" | "failed" | "skipped";
  sent_at?: Date | null;
  failure_report_sent_at?: Date | null;
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
  messagingPermissionStatus: "denied" | "pending" | "approved";
  hasPendingMessageRequest: boolean;
  messagingPlan: MessagingPlan;
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
  /** When true, the post-approval follow-up states the guest's invited count. */
  ask_invited_count?: boolean;
  reminder_day?: "day_before" | "wedding_day";
  reminder_time?: string;
  /** Free text appended to the reminder's additional_data param (single line). */
  reminder_additional_text?: string;
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
  // Voice-RSVP call outcome: Twilio final CallStatus ('queued' while in flight)
  // and machine-detection verdict (human/machine_*), stamped per call round.
  last_call_status?: string | null;
  last_call_answered_by?: string | null;
  last_call_at?: Date | null;
  // Last WhatsApp send outcome for this guest: null after a successful send,
  // the (Hebrew) error description after a failed send or a delivery-failed
  // webhook. Drives the "resend to failed guests" flow.
  last_send_error?: string | null;
  last_send_error_at?: Date | null;
  /**
   * messageType of the most recent send attempt. Internal marker: the
   * delivery-failed webhook uses it to flag only invitation failures
   * (later-round failures stay in the activity log).
   */
  last_message_type?: string | null;
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
  | "wedding_rsvp_reminder"
  | "custom_thank_you_message"
  | "thank_you_message"
  | "event_reminder";

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

// ==================== Gift types ====================

export type GiftType = "check" | "cash" | "bit" | "paybox" | "bank_transfer" | "buyme" | "other";

export const GIFT_TYPES: GiftType[] = ["check", "cash", "bit", "paybox", "bank_transfer", "buyme", "other"];

/** A monetary wedding gift received from a guest. */
export interface Gift {
  gift_id?: number;
  user_id: string;
  guest_id: number;
  gift_type: GiftType;
  /** Free-text description, required when gift_type is "other", null otherwise. */
  other_description?: string | null;
  amount: number;
  created_at?: Date;
}

// ==================== Seating types ====================

// Allowed values are validated at the app layer (no DB CHECK), like GIFT_TYPES.
export type SeatingItemKind = "table" | "object";
export const SEATING_ITEM_KINDS: SeatingItemKind[] = ["table", "object"];

export type SeatingShape = "circle" | "rect";
export const SEATING_SHAPES: SeatingShape[] = ["circle", "rect"];

/** Room dimensions for an event's floor plan. All geometry is integer cm. */
export interface SeatingLayout {
  id?: number;
  event_id: number;
  room_width_cm: number;
  room_height_cm: number;
  created_at?: Date;
}

/**
 * A table or object placed on the floor plan. width/height are the bounding
 * box; for circles both equal the diameter. table_number/capacity are
 * table-only (null for objects).
 */
export interface SeatingItem {
  id?: number;
  event_id: number;
  kind: SeatingItemKind;
  shape: SeatingShape;
  label?: string | null;
  table_number?: number | null;
  capacity?: number | null;
  x_cm: number;
  y_cm: number;
  width_cm: number;
  height_cm: number;
  rotation_deg: number;
  /** Fill-color override (hex), objects only — tables are colored by occupancy. */
  color?: string | null;
  created_at?: Date;
}

/** Guest-party-to-table assignment; a party sits at exactly one table per event. */
export interface SeatingAssignment {
  id?: number;
  item_id: number;
  event_guest_id: number;
  created_at?: Date;
  // Joined from event_guests/guests at query time (not stored here):
  rsvp_status?: number | null;
  name?: string;
  number_of_guests?: number;
}

/**
 * A user-saved custom table or object (tree, concrete stand, ...), reusable
 * across events (owned by the data owner). capacity is table-only.
 */
export interface CustomTablePreset {
  id?: number;
  user_id: string;
  kind: SeatingItemKind;
  name: string;
  shape: SeatingShape;
  width_cm: number;
  height_cm: number;
  capacity: number | null;
  created_at?: Date;
}
