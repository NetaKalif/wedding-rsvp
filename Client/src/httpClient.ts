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

// ==================== Auth token ====================
// Held at module scope (not React Context) since most functions below are
// free functions called from outside the component tree.

let authToken: string | null = localStorage.getItem("authToken");
let onUnauthorized: (() => void) | null = null;

export const setAuthToken = (token: string | null) => {
  authToken = token;
  if (token) localStorage.setItem("authToken", token);
  else localStorage.removeItem("authToken");
};

export const setUnauthorizedHandler = (handler: () => void) => {
  onUnauthorized = handler;
};

const authHeaders = (): Record<string, string> =>
  authToken ? { Authorization: `Bearer ${authToken}` } : {};

const handleUnauthorized = () => {
  setAuthToken(null);
  onUnauthorized?.();
};

// ==================== HTTP Helpers ====================

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface RequestOptions {
  method?: HttpMethod;
  body?: object;
}

const request = async <T>(endpoint: string, options: RequestOptions = {}): Promise<T> => {
  const { method = "GET", body } = options;
  const config: RequestInit = {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders() },
    cache: "no-store",
  };
  if (body) config.body = JSON.stringify(body);
  const response = await fetch(`${url}${endpoint}`, config);
  if (response.status === 401) handleUnauthorized();
  const text = await response.text();
  if (!response.ok) throw new Error(text || `Request failed: ${response.status}`);
  if (!text) return {} as T;
  try { return JSON.parse(text); } catch { return text as T; }
};

const get = <T>(endpoint: string) => request<T>(endpoint);
const post = <T>(endpoint: string, body?: object) => request<T>(endpoint, { method: "POST", body });
const patch = <T>(endpoint: string, body?: object) => request<T>(endpoint, { method: "PATCH", body });
const del = <T>(endpoint: string, body?: object) => request<T>(endpoint, { method: "DELETE", body });

// Raw (non-JSON) requests for multipart/form-data uploads — the browser sets
// the multipart boundary itself, so no Content-Type header is set here.
const rawRequest = async <T>(endpoint: string, method: "POST" | "PATCH", formData: FormData): Promise<T> => {
  const response = await fetch(`${url}${endpoint}`, { method, headers: { ...authHeaders() }, body: formData });
  if (response.status === 401) handleUnauthorized();
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};

// ==================== Auth Methods ====================

type LoginResponse =
  | { status: "pending" }
  | { status: "approved"; token: string; user: User; isAdmin: boolean };

const loginWithGoogle = (credential: string) =>
  post<LoginResponse>("/auth/google", { credential });

const getMe = () => get<{ user: User; isAdmin: boolean }>("/auth/me");

const impersonate = (targetUserID: string) =>
  post<{ token: string; user: User }>("/auth/impersonate", { targetUserID });

const deleteUser = () => del<void>("/deleteUser");

// ==================== Guest Methods ====================

const getGuests = () => post<Guest[]>("/guestsList");

const addGuests = (guestsToAdd: Omit<Guest, "id" | "user_id">[]) =>
  patch<Guest[]>("/addGuests", { guestsToAdd });

const updateGuest = (guestId: number, updates: Omit<Guest, "id" | "user_id">) =>
  patch<Guest>("/updateGuest", { guestId, updates });

const deleteGuest = (guestId: number) =>
  del<Guest[]>("/deleteGuest", { guestId });

const deleteAllGuests = () =>
  del<Guest[]>("/deleteAllGuests");

// ==================== Event Methods ====================

const getPrimaryEvent = async (): Promise<Event | null> => {
  try {
    return await get<Event>("/getWeddingInfo");
  } catch {
    return null;
  }
};

const saveEventInfo = async (eventInfo: Partial<Event>, imageFile?: File): Promise<Event> => {
  const formData = new FormData();
  formData.append("weddingInfo", JSON.stringify(eventInfo));
  if (imageFile) formData.append("imageFile", imageFile);
  return rawRequest<Event>("/saveWeddingInfo", "POST", formData);
};

const getEvents = () => get<Event[]>("/events");

const createEvent = async (event: Omit<Event, "id" | "user_id" | "created_at">, image?: File): Promise<Event> => {
  const formData = new FormData();
  Object.entries(event).forEach(([k, v]) => { if (v != null) formData.append(k, String(v)); });
  if (image) formData.append("image", image);
  return rawRequest<Event>("/events", "POST", formData);
};

const deleteEvent = (eventId: number) => del<void>(`/events/${eventId}`);

const updateEvent = (eventId: number, updates: Partial<Event>) =>
  patch<Event>(`/events/${eventId}`, updates);

// ==================== Media (image/file) URL Methods ====================
// These mint a short-lived, resource-scoped token before building the URL,
// since <img src>/<a href> can't carry an Authorization header.

type MediaResource = "primaryImage" | "eventImage" | "vendorFile";

const mintMediaToken = (resource: MediaResource, resourceId?: number) =>
  post<{ token: string }>("/media/token", { resource, resourceId });

const getPrimaryImageUrl = async (): Promise<string> => {
  const { token } = await mintMediaToken("primaryImage");
  return `${url}/getImage?mediaToken=${encodeURIComponent(token)}`;
};

const getEventImageUrl = async (eventId: number): Promise<string> => {
  const { token } = await mintMediaToken("eventImage", eventId);
  return `${url}/events/${eventId}/image?mediaToken=${encodeURIComponent(token)}`;
};

// ==================== EventGuest Methods ====================

const getEventGuests = (eventId: number) =>
  get<EventGuest[]>(`/events/${eventId}/guests`);

const setEventGuests = (eventId: number, guestIds: number[]) =>
  post<EventGuest[]>(`/events/${eventId}/guests`, { guestIds });

const removeEventGuests = (eventId: number, guestIds: number[]) =>
  del<EventGuest[]>(`/events/${eventId}/guests`, { guestIds });

const setRSVP = (eventId: number, guestId: number, rsvpStatus: number | null) =>
  post<EventGuest[]>("/updateRsvp", { eventId, guestId, rsvpStatus });

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

const sendMessage = (options: SendMessageOptions) =>
  post<MessageResult>("/sendMessage", { options });

// ==================== Logs Methods ====================

const getLogs = () => get<ClientLog[]>("/logs");

// ==================== Admin Methods ====================

const getUsers = () => post<User[]>("/getUsers");
const getPendingUsers = () => post<User[]>("/admin/getPendingUsers");
const approveUser = (userID: string) => post<void>("/admin/approveUser", { userID });
const declineUser = (userID: string) => post<void>("/admin/declineUser", { userID });

// ==================== Task Methods ====================

type NewTask = Pick<Task, "title" | "timeline_group" | "priority" | "assignee">;
type TaskUpdates = Partial<NewTask>;

const getTasks = () => get<Task[]>("/tasks");
const addTask = (task: NewTask) => post<Task>("/tasks", { task });
const updateTaskCompletion = (taskId: number, isCompleted: boolean) =>
  patch<Task>(`/tasks/${taskId}/complete`, { isCompleted });
const updateTask = (taskId: number, updates: TaskUpdates) =>
  patch<Task>(`/tasks/${taskId}`, { updates });
const deleteTask = (taskId: number) => del<void>(`/tasks/${taskId}`);

// ==================== Partner Methods ====================

const generateInviteCode = async (): Promise<string> => {
  const { inviteCode } = await post<{ inviteCode: string }>("/partner/generate-invite");
  return inviteCode;
};

const acceptInvite = async (inviteCode: string): Promise<{ success: boolean; error?: string }> => {
  try { return await post<{ success: boolean }>("/partner/accept-invite", { inviteCode }); }
  catch (err) { return { success: false, error: err instanceof Error ? err.message : "Network error" }; }
};

const unlinkPartner = async (): Promise<boolean> => {
  try { await post<void>("/partner/unlink"); return true; } catch { return false; }
};

const getPartnerInfo = async (): Promise<PartnerInfo> => {
  try { return await get<PartnerInfo>("/partner/info"); }
  catch { return { hasPartner: false, isLinkedAccount: false }; }
};

// ==================== Budget Methods ====================

const updateTotalBudget = (total_budget: number) =>
  patch<void>("/budget/total", { total_budget });

const updateEstimatedGuests = (estimated_guests: number) =>
  patch<void>("/budget/estimated-guests", { estimated_guests });

const getBudgetOverview = () => get<BudgetOverview>("/budget/overview");
const getBudgetCategories = () => get<BudgetCategoryWithSpending[]>("/budget/categories");
const addBudgetCategory = (name: BudgetCategoryName) =>
  post<BudgetCategory>("/budget/categories", { name });
const deleteBudgetCategory = (categoryId: number) =>
  del<void>(`/budget/categories/${categoryId}`);

const getVendors = () => get<VendorWithPayments[]>("/budget/vendors");

type NewVendor = Omit<Vendor, "vendor_id" | "user_id" | "created_at" | "category_name">;

const addFilesToVendor = (formData: FormData, files: File[]) => {
  files.forEach((file) => { formData.append("files", file); formData.append("fileNames", file.name); });
};

const addVendor = async (vendor: NewVendor, files?: File[]): Promise<Vendor> => {
  const formData = new FormData();
  formData.append("vendor", JSON.stringify(vendor));
  if (files) addFilesToVendor(formData, files);
  return rawRequest<Vendor>("/budget/vendors", "POST", formData);
};

type VendorUpdates = Partial<Omit<Vendor, "vendor_id" | "user_id" | "created_at">>;
const updateVendor = async (vendorId: number, updates: VendorUpdates, files?: File[]): Promise<Vendor> => {
  const formData = new FormData();
  formData.append("updates", JSON.stringify(updates));
  if (files) addFilesToVendor(formData, files);
  return rawRequest<Vendor>(`/budget/vendors/${vendorId}`, "PATCH", formData);
};

const deleteVendor = (vendorId: number) => del<void>(`/budget/vendors/${vendorId}`);
const toggleVendorFavorite = (vendorId: number) => patch<Vendor>(`/budget/vendors/${vendorId}/favorite`);
const addPayment = (vendor_id: number, amount: number, payment_date: string, notes?: string) =>
  post<Payment>("/budget/payments", { vendor_id, amount, payment_date, notes });
const deletePayment = (paymentId: number) => del<void>(`/budget/payments/${paymentId}`);

// ==================== Vendor File Methods ====================

const uploadVendorFile = async (vendorId: number, file: File): Promise<VendorFile> => {
  const formData = new FormData();
  formData.append("fileName", file.name);
  formData.append("file", file);
  return rawRequest<VendorFile>(`/budget/vendors/${vendorId}/files`, "POST", formData);
};

const getVendorFileDownloadUrl = async (fileId: number): Promise<string> => {
  const { token } = await mintMediaToken("vendorFile", fileId);
  return `${url}/budget/files/${fileId}/download?mediaToken=${encodeURIComponent(token)}`;
};

const deleteVendorFile = (fileId: number) => del<void>(`/budget/files/${fileId}`);

// ==================== Exports ====================

export const httpRequests = {
  // Auth
  loginWithGoogle, getMe, impersonate, deleteUser,
  // Guests
  getGuests, addGuests, updateGuest, deleteGuest, deleteAllGuests,
  // Events
  getPrimaryEvent, saveEventInfo, getEvents, createEvent, deleteEvent, updateEvent,
  getEventImageUrl, getPrimaryImageUrl,
  // Event guests + RSVP
  getEventGuests, setEventGuests, removeEventGuests, setRSVP,
  // Messages
  sendMessage,
  // Logs
  getLogs,
  // Admin
  getUsers, getPendingUsers, approveUser, declineUser,
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
