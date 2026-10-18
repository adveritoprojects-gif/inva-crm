/**
 * Calendar-day helpers. All business-day logic uses Asia/Kolkata (IST),
 * regardless of server timezone. Dates cross the API as 'YYYY-MM-DD'.
 */

export const TIMEZONE = "Asia/Kolkata";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's calendar date in Asia/Kolkata as 'YYYY-MM-DD'. */
export function todayInIndia(now: Date = new Date()): string {
  return dayFormatter.format(now);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in 'YYYY-MM-DD' form. */
export function isValidDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

/** Signed calendar-day difference b - a (both 'YYYY-MM-DD'). */
export function daysBetween(a: string, b: string): number {
  const ma = DATE_RE.exec(a);
  const mb = DATE_RE.exec(b);
  if (!ma || !mb) return Number.NaN;
  const ta = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]));
  const tb = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]));
  return Math.round((tb - ta) / 86_400_000);
}

/**
 * Deadline label for a submission date relative to `today` (IST).
 * Returns null for delivered projects (caller decides) or invalid dates.
 */
export function deadlineLabel(
  due: string,
  status: string,
  today: string
): string | null {
  if (status === "Delivered") return "Delivered";
  if (!isValidDate(due) || !isValidDate(today)) return null;
  const diff = daysBetween(today, due);
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  if (diff > 1) return `Due in ${diff} days`;
  const over = Math.abs(diff);
  return over === 1 ? "1 day overdue" : `${over} days overdue`;
}
