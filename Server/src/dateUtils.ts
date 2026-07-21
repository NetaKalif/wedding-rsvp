export const getDateStrings = (): {
  today: string;
  tomorrow: string;
  yesterday: string;
} => {
  const today = new Date();
  const todayStr = getDateFormat(today);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = getDateFormat(tomorrow);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = getDateFormat(yesterday);
  return { today: todayStr, tomorrow: tomorrowStr, yesterday: yesterdayStr };
};

export const getWeddingDateStrings = (
  weddingDateStr: string
): {
  weddingDateStr: string;
  dayBeforeWeddingStr: string;
  dayAfterWeddingStr: string;
} => {
  const weddingDate = new Date(weddingDateStr);

  const dayBeforeWedding = new Date(weddingDate);
  dayBeforeWedding.setDate(dayBeforeWedding.getDate() - 1);
  const dayBeforeWeddingStr = getDateFormat(dayBeforeWedding);

  const dayAfterWedding = new Date(weddingDate);
  dayAfterWedding.setDate(dayAfterWedding.getDate() + 1);
  const dayAfterWeddingStr = getDateFormat(dayAfterWedding);
  return { weddingDateStr, dayBeforeWeddingStr, dayAfterWeddingStr };
};

export const getDateFormat = (date: Date): string => {
  return date.toISOString().split("T")[0];
};

/** Whole days elapsed from `fromDateStr` to `now` (midnight-to-midnight, ignoring time-of-day). */
export const daysBetween = (now: Date, fromDateStr: string): number => {
  const msPerDay = 24 * 60 * 60 * 1000;
  const nowMidnight = new Date(getDateFormat(now));
  const fromMidnight = new Date(getDateFormat(new Date(fromDateStr)));
  return Math.round((nowMidnight.getTime() - fromMidnight.getTime()) / msPerDay);
};

export const addDays = (dateStr: string, days: number): string => {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return getDateFormat(date);
};
