export interface Guest extends GuestIdentifier {
  whose: string;
  circle: string;
  numberOfGuests: number;
  RSVP: number | undefined;
  messageGroup?: number; // Group number for message batching (1-N)
  userID: string;
  lastRsvpSentAt?: Date;
}
export interface GuestIdentifier {
  name: string;
  phone: string;
}
export interface User {
  name: string;
  email: string;
  userID: string;
}
export type FilterOptions = "all" | "pending" | "approved" | "declined";

export interface WeddingDetails {
  bride_name: string;
  groom_name: string;
  wedding_date: string;
  hour: string;
  location_name: string;
  additional_information: string;
  waze_link: string;
  gift_link: string;
  thank_you_message?: string;
  fileID?: string;
  reminder_day?: "day_before" | "wedding_day"; // Which day to send reminder
  reminder_time?: string; // Time to send reminder (HH:MM format)
  total_budget?: number; // Total wedding budget
  estimated_guests?: number; // Estimated guest count for budget planning
}

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

export type TaskPriority = 1 | 2 | 3; // 1 = High, 2 = Medium, 3 = Low
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
