// ==================== Core entities ====================

export interface Guest {
  id?: number;
  user_id?: string;
  name: string;
  /** Null for guests with no cellphone — they're excluded from all WhatsApp sends. */
  phone: string | null;
  whose: string;
  circle: string;
  number_of_guests: number;
}

/**
 * An event — wedding (is_primary=true) or any other ceremony.
 * Wedding-specific fields are only shown in the UI when is_primary=true.
 */
export interface Event {
  id: number;
  user_id: string;
  is_primary: boolean;
  ceremony_name: string;
  date?: string;
  time?: string;
  location?: string;
  additional_info?: string;
  file_id?: string;
  imageURL?: string; // client-side convenience, not in DB
  // Primary (wedding) fields:
  bride_name?: string;
  groom_name?: string;
  waze_link?: string;
  gift_link?: string;
  thank_you_message?: string;
  send_reminder?: boolean;
  reminder_day?: "day_before" | "wedding_day";
  reminder_time?: string;
  reminder_additional_text?: string;
  send_thank_you?: boolean;
  estimated_guests?: number;
  total_budget?: number;
  created_at?: string;
}

/**
 * A guest's participation in a specific event.
 * Guest fields (name, phone, etc.) are joined at query time.
 */
export interface EventGuest {
  id?: number;
  event_id: number;
  guest_id: number;
  rsvp_status?: number | null;
  last_rsvp_sent_at?: string;
  // Voice-RSVP call outcome: Twilio final CallStatus ('queued' while in flight)
  // and machine-detection verdict (human/machine_*), stamped per call round.
  last_call_status?: string | null;
  last_call_answered_by?: string | null;
  last_call_at?: string | null;
  // Last WhatsApp send outcome: null after a successful send, the error
  // description after a failed send/delivery. Drives the resend-to-failed flow.
  last_send_error?: string | null;
  last_send_error_at?: string | null;
  /** messageType of the most recent send attempt (server-internal marker). */
  last_message_type?: string | null;
  // Joined from guests table:
  name?: string;
  phone?: string | null;
  whose?: string;
  circle?: string;
  number_of_guests?: number;
  user_id?: string;
}

// ==================== Filter / UI types ====================

export type RsvpStatus = "pending" | "confirmed" | "declined";

export interface FilterOptions {
  whose: string[];
  circle: string[];
  rsvpStatus: RsvpStatus[];
  searchTerm: string;
}

export type SetGuestsList = (guests: Guest[] | ((prev: Guest[]) => Guest[])) => void;

// ==================== Auth / User ====================

/**
 * "manual" — the couple sends every message themselves (default).
 * "scheduled" — "send and go": all content is filled up front, each round gets
 * a date/time, and the server sends automatically. Assigned by the admin.
 */
export type MessagingPlan = "manual" | "scheduled";

export interface User {
  userID: string;
  name: string;
  email: string;
  messagingPlan?: MessagingPlan;
}

// ==================== Scheduled message rounds ("send and go") ====================

export type ScheduledRoundType = "rsvp" | "rsvpReminder" | "call";

export interface ScheduledRound {
  id?: number;
  event_id: number;
  round_type: ScheduledRoundType;
  round_number: number;
  scheduled_at: string;
  status: "pending" | "processing" | "sent" | "failed" | "skipped";
  sent_at?: string | null;
  failure_report_sent_at?: string | null;
}

export interface PartnerInfo {
  hasPartner: boolean;
  isLinkedAccount: boolean;
  partner?: User;
  primaryUser?: User;
  inviteCode?: string;
  inviteExpires?: string;
}

// ==================== Logs ====================

export interface ClientLog {
  id: number;
  userID: string;
  message: string;
  createdAt: string;
}

// ==================== Tasks ====================

export type TaskPriority = 1 | 2 | 3;
export type TaskAssignee = "bride" | "groom" | "both";

export interface Task {
  task_id: number;
  user_id: string;
  title: string;
  timeline_group: TimelineGroup;
  is_completed: boolean;
  priority?: TaskPriority;
  assignee?: TaskAssignee;
  sort_order?: number;
  created_at?: string;
}

export interface TaskStats {
  total: number;
  completed: number;
}

export type TimelineGroup =
  | "Just Engaged"
  | "12 Months Before"
  | "9 Months Before"
  | "6 Months Before"
  | "3 Months Before"
  | "1 Month Before"
  | "1 Week Before"
  | "Wedding Day Bride"
  | "Wedding Day Groom"
  | "Wedding Day";

// ==================== Budget ====================

export type BudgetCategoryName =
  | "אולם"
  | "קייטרינג"
  | "צילום"
  | "מוזיקה"
  | "עיצוב"
  | "לבוש"
  | "טיפוח"
  | "תחבורה"
  | "מלון"
  | "אחר";

export interface BudgetCategory {
  category_id: number;
  user_id: string;
  name: BudgetCategoryName;
  created_at?: string;
}

export type VendorStatus = "יצרנו קשר" | "הוזמן" | "שולם חלקית" | "שולם";

export interface VendorFile {
  file_id: number;
  vendor_id: number;
  file_name: string;
  file_type: string;
  file_size: number;
  uploaded_at: string;
}

export interface Vendor {
  vendor_id: number;
  user_id: string;
  name: string;
  job_title?: string;
  category_id: number;
  category_name?: BudgetCategoryName;
  agreed_cost: number;
  status: VendorStatus;
  phone?: string;
  email?: string;
  notes?: string;
  is_favorite: boolean;
  created_at?: string;
  files?: VendorFile[];
}

export interface Payment {
  payment_id: number;
  vendor_id: number;
  amount: number;
  payment_date: string;
  notes?: string;
  created_at?: string;
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

// ==================== Gifts ====================

export type GiftType = "check" | "cash" | "bit" | "paybox" | "bank_transfer" | "buyme" | "other";

/** A monetary wedding gift received from a guest. */
export interface Gift {
  gift_id: number;
  user_id?: string;
  guest_id: number;
  gift_type: GiftType;
  /** Free-text description, set only when gift_type is "other". */
  other_description?: string | null;
  amount: number;
  created_at?: string;
}

// ==================== Seating ====================

export type SeatingItemKind = "table" | "object";
export type SeatingShape = "circle" | "rect";

/** Room dimensions for an event's floor plan. All geometry is integer cm. */
export interface SeatingLayout {
  id?: number;
  event_id: number;
  room_width_cm: number;
  room_height_cm: number;
}

/**
 * A table or object on the floor plan. width/height are the bounding box;
 * for circles both equal the diameter. table_number/capacity are table-only.
 */
export interface SeatingItem {
  id: number;
  event_id: number;
  kind: SeatingItemKind;
  shape: SeatingShape;
  label: string | null;
  table_number: number | null;
  capacity: number | null;
  x_cm: number;
  y_cm: number;
  width_cm: number;
  height_cm: number;
  rotation_deg: number;
  /** Fill-color override (hex), objects only — tables are colored by occupancy. */
  color?: string | null;
}

/** Guest-party-to-table assignment, joined with live guest/RSVP data. */
export interface SeatingAssignment {
  id: number;
  item_id: number;
  event_guest_id: number;
  // Joined server-side:
  rsvp_status?: number | null;
  name?: string;
  number_of_guests?: number;
}

/** A user-saved custom table or object (tree, concrete stand, ...); capacity is table-only. */
export interface CustomTablePreset {
  id: number;
  user_id?: string;
  kind: SeatingItemKind;
  name: string;
  shape: SeatingShape;
  width_cm: number;
  height_cm: number;
  capacity: number | null;
}

export interface SeatingData {
  layout: SeatingLayout | null;
  items: SeatingItem[];
  assignments: SeatingAssignment[];
}
