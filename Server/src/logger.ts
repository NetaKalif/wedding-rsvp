// Central console logging helpers. Every log line is prefixed with the
// acting user's display name (kept in an in-memory cache refreshed whenever
// a user is added or removed — see dbUtils.ts) so server logs are easy to
// attribute. Logs with no associated user (startup, scheduler ticks, public
// webhook traffic that couldn't be matched to a user) are tagged [SYSTEM].
const userNames = new Map<string, string>();

export const loadUserNames = (users: { userID: string; name: string }[]): void => {
  userNames.clear();
  users.forEach((u) => userNames.set(u.userID, u.name));
};

export const setUserName = (userID: string, name: string): void => {
  userNames.set(userID, name);
};

export const removeUserName = (userID: string): void => {
  userNames.delete(userID);
};

const prefixFor = (userID?: string): string =>
  userID ? `[${userNames.get(userID) ?? userID}]` : "[SYSTEM]";

export const log = (userID: string | undefined, ...args: any[]): void => {
  console.log(prefixFor(userID), ...args);
};

export const logWarn = (userID: string | undefined, ...args: any[]): void => {
  console.warn(prefixFor(userID), ...args);
};

export const logError = (userID: string | undefined, ...args: any[]): void => {
  console.error(prefixFor(userID), ...args);
};
