export const formatLocalTime = new Intl.DateTimeFormat("en-AU", {
  hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Australia/Perth",
});
export const formatDate = new Intl.DateTimeFormat("en-AU", {
  weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Perth",
});
export const formatHour = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", hourCycle: "h23", timeZone: "Australia/Perth",
});
const formatShortDay = new Intl.DateTimeFormat("en-AU", {
  weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
});

export function minuteCount(date: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(date) - now) / 60_000));
}
export function countdownLabel(date: string, now: number): string {
  const minutes = minuteCount(date, now);
  return minutes < 1 ? "Due now" : minutes + " min";
}
export function updateAge(fetchedAt: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(fetchedAt)) / 1000));
  if (seconds < 60) return "Updated just now";
  const minutes = Math.floor(seconds / 60);
  return "Updated " + minutes + " min ago";
}
export function ageLabel(seconds: number): string {
  if (seconds < 60) return "just now";
  return Math.floor(seconds / 60) + " min ago";
}
/** "2026-11-14" → "Sat 14 Nov". */
export function shortDay(iso: string): string {
  return formatShortDay.format(new Date(iso + "T00:00:00Z"));
}
