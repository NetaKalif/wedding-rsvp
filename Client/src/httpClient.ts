import {
  Guest,
  User,
  Event,
  EventGuest,
  ClientLog,
  Task,
  PartnerInfo,
  BudgetOverview,
  BudgetCategory,
  BudgetCategoryName,
  BudgetCategoryWithSpending,
  Vendor,
  VendorWithPayments,
  Payment,
  VendorFile,
} from "./types";

const url = process.env.REACT_APP_SERVER_URL;

// ==================== HTTP Helpers ====================

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface RequestOptions {
  method?: HttpMethod;
  body?: object;
}

const request = async <T>(endpoint: string, options: RequestOptions = {}): Promise<T> => {
  const { method = "GET", body } = options;
  const config: RequestInit = { method, headers: { "Content-Type": "application/json" }, cache: "no-store" };
  if (body) config.body = JSON.stringify(body);
  const response = await fetch(`${url}${endpoint}`, config);
  const text = await response.text();
  if (!response.ok) throw new Error(text || `Request failed: ${response.status}`);
  if (!text) return {} as T;
  try { return JSON.parse(text); } catch { return text as T; }
};

const get = <T>(endpoint: string) => request<T>(endpoint);
const post = <T>(endpoint: string, body: object) => request<T>(endpoint, { method: "POST", body });
const patch = <T>(endpoint: string, body: object) => request<T>(endpoint, { method: "PATCH", body });
const del = <T>(endpoint: string, body?: object) => request<T>(endpoint, { method: "DELETE", body });

// ==================== User Methods ====================

const addUser = (newUser: User) => patch<void>("/addUser", { newUser });
const deleteUser = (userID: User["userID"]) => del<void>("/deleteUser", { userID });

// ==================== Guest Methods ====================

const getGuests = (userID: string) => post<Guest[]>("/guestsList", { userID });

const addGuests = (userID: string, guestsToAdd: Omit<Guest, "id" | "user_id">[]) =>
  patch<Guest[]>("/addGuests", { guestsToAdd, userID });

const deleteGuest = (userID: string, guestId: number) =>
  del<Guest[]>("/deleteGuest", { userID, guestId });

const deleteAllGuests = (userID: string) =>
  del<Guest[]>("/deleteAllGuests", { userID });

// ==================== Event Methods ====================

const getPrimaryEvent = async (userID: string): Promise<Event | null> => {
  try {
    return await get<Event>(`/getWeddingInfo/${userID}`);
  } catch {
    return null;
  }
};

const saveEventInfo = async (userID: string, eventInfo: Partial<Event>, imageFile?: File): Promise<Event> => {
  const formData = new FormData();
  formData.append("userID", userID);
  formData.append("weddingInfo", JSON.stringify(eventInfo));
  if (imageFile) formData.append("imageFile", imageFile);
  const response = await fetch(`${url}/saveWeddingInfo`, { method: "POST", body: formData });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};

const getEvents = (userID: string) => get<Event[]>(`/events/${userID}`);

const createEvent = async (userID: string, event: Omit<Event, "id" | "user_id" | "created_at">, image?: File): Promise<Event> => {
  const formData = new FormData();
  formData.append("userID", userID);
  Object.entries(event).forEach(([k, v]) => { if (v != null) formData.append(k, String(v)); });
  if (image) formData.append("image", image);
  const response = await fetch(`${url}/events`, { method: "POST", body: formData });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};

const deleteEvent = (userID: string, eventId: number) =>
  del<void>(`/events/${eventId}`, { userID });

const getEventImageUrl = (eventId: number): string => `${url}/events/${eventId}/image`;

const getPrimaryImageUrl = (userID: string): string => `${url}/getImage/${userID}`;

// ==================== EventGuest Methods ====================

const getEventGuests = (userID: string, eventId: number) =>
  get<EventGuest[]>(`/events/${eventId}/guests?userID=${encodeURIComponent(userID)}`);

const setEventGuests = (userID: string, eventId: number, guestIds: number[]) =>
  post<EventGuest[]>(`/events/${eventId}/guests`, { userID, guestIds });

const removeEventGuests = (userID: string, eventId: number, guestIds: number[]) =>
  del<EventGuest[]>(`/events/${eventId}/guests`, { userID, guestIds });

const setRSVP = (userID: string, eventId: number, guestId: number, rsvpStatus: number | null) =>
  post<EventGuest[]>("/updateRsvp", { userID, eventId, guestId, rsvpStatus });

// ==================== Message Methods ====================

interface MessageResult {
  success: number;
  fail: number;
  failGuestsList: { guestName: string; logMessage: string }[];
}

interface SendMessageOptions {
  eventId?: number;
  messageType?: string;
  guestIds?: number[];
  customText?: string;
}

const sendMessage = (userID: string, options: SendMessageOptions) =>
  post<MessageResult>("/sendMessage", { userID, options });

// ==================== Logs Methods ====================

const getLogs = (userID: string) => get<ClientLog[]>(`/logs/${userID}`);

// ==================== Admin Methods ====================

const checkAdmin = async (userID: string): Promise<boolean> => {
  try {
    const { isAdmin } = await post<{ isAdmin: boolean }>("/checkAdmin", { userID });
    return isAdmin;
  } catch { return false; }
};

const getUsers = (userID: string) => post<User[]>("/getUsers", { userID });

// ==================== Task Methods ====================

type NewTask = Pick<Task, "title" | "timeline_group" | "priority" | "assignee">;
type TaskUpdates = Partial<NewTask>;

const getTasks = (userID: string) => get<Task[]>(`/tasks/${userID}`);
const addTask = (userID: string, task: NewTask) => post<Task>("/tasks", { userID, task });
const updateTaskCompletion = (userID: string, taskId: number, isCompleted: boolean) =>
  patch<Task>(`/tasks/${taskId}/complete`, { userID, isCompleted });
const updateTask = (userID: string, taskId: number, updates: TaskUpdates) =>
  patch<Task>(`/tasks/${taskId}`, { userID, updates });
const deleteTask = (userID: string, taskId: number) => del<void>(`/tasks/${taskId}`, { userID });

// ==================== Partner Methods ====================

const generateInviteCode = async (userID: string): Promise<string> => {
  const { inviteCode } = await post<{ inviteCode: string }>("/partner/generate-invite", { userID });
  return inviteCode;
};

const acceptInvite = async (userID: string, inviteCode: string): Promise<{ success: boolean; error?: string }> => {
  try { return await post<{ success: boolean }>("/partner/accept-invite", { userID, inviteCode }); }
  catch (err) { return { success: false, error: err instanceof Error ? err.message : "Network error" }; }
};

const unlinkPartner = async (userID: string): Promise<boolean> => {
  try { await post<void>("/partner/unlink", { userID }); return true; } catch { return false; }
};

const getPartnerInfo = async (userID: string): Promise<PartnerInfo> => {
  try { return await get<PartnerInfo>(`/partner/info/${userID}`); }
  catch { return { hasPartner: false, isLinkedAccount: false }; }
};

// ==================== Budget Methods ====================

const updateTotalBudget = (userID: string, total_budget: number) =>
  patch<void>("/budget/total", { userID, total_budget });

const updateEstimatedGuests = (userID: string, estimated_guests: number) =>
  patch<void>("/budget/estimated-guests", { userID, estimated_guests });

const getBudgetOverview = (userID: string) => get<BudgetOverview>(`/budget/overview/${userID}`);
const getBudgetCategories = (userID: string) => get<BudgetCategoryWithSpending[]>(`/budget/categories/${userID}`);
const addBudgetCategory = (userID: string, name: BudgetCategoryName) =>
  post<BudgetCategory>("/budget/categories", { userID, name });
const deleteBudgetCategory = (userID: string, categoryId: number) =>
  del<void>(`/budget/categories/${categoryId}`, { userID });

const getVendors = (userID: string) => get<VendorWithPayments[]>(`/budget/vendors/${userID}`);

type NewVendor = Omit<Vendor, "vendor_id" | "user_id" | "created_at" | "category_name">;

const addFilesToVendor = (formData: FormData, files: File[]) => {
  files.forEach((file) => { formData.append("files", file); formData.append("fileNames", file.name); });
};

const addVendor = async (userID: string, vendor: NewVendor, files?: File[]): Promise<Vendor> => {
  const formData = new FormData();
  formData.append("userID", userID);
  formData.append("vendor", JSON.stringify(vendor));
  if (files) addFilesToVendor(formData, files);
  const response = await fetch(`${url}/budget/vendors`, { method: "POST", body: formData });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};

type VendorUpdates = Partial<Omit<Vendor, "vendor_id" | "user_id" | "created_at">>;
const updateVendor = async (userID: string, vendorId: number, updates: VendorUpdates, files?: File[]): Promise<Vendor> => {
  const formData = new FormData();
  formData.append("userID", userID);
  formData.append("updates", JSON.stringify(updates));
  if (files) addFilesToVendor(formData, files);
  const response = await fetch(`${url}/budget/vendors/${vendorId}`, { method: "PATCH", body: formData });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};

const deleteVendor = (userID: string, vendorId: number) => del<void>(`/budget/vendors/${vendorId}`, { userID });
const toggleVendorFavorite = (userID: string, vendorId: number) => patch<Vendor>(`/budget/vendors/${vendorId}/favorite`, { userID });
const addPayment = (userID: string, vendor_id: number, amount: number, payment_date: string, notes?: string) =>
  post<Payment>("/budget/payments", { userID, vendor_id, amount, payment_date, notes });
const deletePayment = (userID: string, paymentId: number) => del<void>(`/budget/payments/${paymentId}`, { userID });

// ==================== Vendor File Methods ====================

const uploadVendorFile = async (userID: string, vendorId: number, file: File): Promise<VendorFile> => {
  const formData = new FormData();
  formData.append("userID", userID);
  formData.append("fileName", file.name);
  formData.append("file", file);
  const response = await fetch(`${url}/budget/vendors/${vendorId}/files`, { method: "POST", body: formData });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};

const getVendorFileDownloadUrl = (userID: string, fileId: number) =>
  `${url}/budget/files/${fileId}/download?userID=${encodeURIComponent(userID)}`;

const deleteVendorFile = (userID: string, fileId: number) => del<void>(`/budget/files/${fileId}`, { userID });

// ==================== Exports ====================

export const httpRequests = {
  // User
  addUser, deleteUser,
  // Guests
  getGuests, addGuests, deleteGuest, deleteAllGuests,
  // Events
  getPrimaryEvent, saveEventInfo, getEvents, createEvent, deleteEvent,
  getEventImageUrl, getPrimaryImageUrl,
  // Event guests + RSVP
  getEventGuests, setEventGuests, removeEventGuests, setRSVP,
  // Messages
  sendMessage,
  // Logs
  getLogs,
  // Admin
  checkAdmin, getUsers,
  // Tasks
  getTasks, addTask, updateTaskCompletion, updateTask, deleteTask,
  // Partner
  generateInviteCode, acceptInvite, unlinkPartner, getPartnerInfo,
  // Budget
  updateTotalBudget, updateEstimatedGuests, getBudgetOverview,
  getBudgetCategories, addBudgetCategory, deleteBudgetCategory,
  getVendors, addVendor, updateVendor, deleteVendor, toggleVendorFavorite,
  addPayment, deletePayment,
  // Vendor files
  uploadVendorFile, getVendorFileDownloadUrl, deleteVendorFile,
};
