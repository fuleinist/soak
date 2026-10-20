/**
 * Shared helpers for soak.
 */

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function isoNow(date: Date = new Date()): string {
  return date.toISOString();
}

export function todayISO(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Local calendar date (YYYY-MM-DD) for an IANA time zone.
 * Falls back to the system time zone when the zone is unknown or missing.
 */
export function localDateISO(date: Date = new Date(), timeZone?: string): string {
  let fmt = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  if (timeZone) {
    try {
      fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    } catch {
      // Keep the system time zone.
    }
  }
  const parts = fmt.formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Round to one decimal place, as a number. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Format millimetres for display, e.g. "3.2 mm". */
export function formatMm(n: number): string {
  return `${round1(n)} mm`;
}