/** Formatting helpers shared by the server and the UI. */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** ₹ formatting with exactly two decimals, e.g. "₹1,23,456.00". */
export function formatINR(value: number | string): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return inr.format(0);
  return inr.format(n);
}

/** Plain numeric string with two decimals, e.g. "123456.00". */
export function toAmountString(value: number | string): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

/** Numeric value usable in JSON payloads. */
export function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Round to 2 decimals without floating-point drift at these magnitudes. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
