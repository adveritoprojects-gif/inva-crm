import type { ApiProject } from "./types";
import { daysBetween, isValidDate } from "./dates";
import type { ProjectStatus } from "./project";

/**
 * Pure dashboard / register helpers shared by the UI and tests.
 * All "today" comparisons take an explicit IST date string ('YYYY-MM-DD').
 */

export function isActive(p: ApiProject): boolean {
  return p.status !== "Delivered";
}

export function studentBalance(p: ApiProject): number {
  return round2((p.total ?? 0) - (p.paid ?? 0));
}

export function writerBalance(p: ApiProject): number {
  return round2((p.writerTotal ?? 0) - (p.writerPaid ?? 0));
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Number of revision requests whose status is not Completed. */
export function openRevisionCount(p: ApiProject): number {
  return p.revisions.filter((r) => r.status !== "Completed").length;
}

export function hasOpenRevisions(p: ApiProject): boolean {
  return openRevisionCount(p) > 0;
}

/** True when any open revision is overdue or due today. */
export function revisionNeedsAttention(p: ApiProject, today: string): boolean {
  return p.revisions.some(
    (r) =>
      r.status !== "Completed" &&
      isValidDate(r.due) &&
      daysBetween(today, r.due) <= 0
  );
}

/** Active project due today, tomorrow or the following calendar day. */
export function isDueSoon(p: ApiProject, today: string): boolean {
  if (!isActive(p)) return false;
  if (!isValidDate(p.due)) return false;
  const diff = daysBetween(today, p.due);
  return diff >= 0 && diff <= 2;
}

export function isOverdue(p: ApiProject, today: string): boolean {
  if (!isActive(p)) return false;
  if (!isValidDate(p.due)) return false;
  return daysBetween(today, p.due) < 0;
}

/**
 * Pending work rule:
 *  - status is neither Completed nor Delivered; OR
 *  - not Delivered and has nonblank pending-work text; OR
 *  - has any open revision request.
 */
export function isPendingWork(p: ApiProject): boolean {
  if (p.status !== "Completed" && p.status !== "Delivered") return true;
  if (p.status !== "Delivered" && (p.pending ?? "").trim() !== "") return true;
  return hasOpenRevisions(p);
}

/** Student balance > 0, including delivered projects. */
export function isPaymentPending(p: ApiProject): boolean {
  return studentBalance(p) > 0;
}

/** Writer balance > 0, including delivered projects. */
export function isWriterPaymentPending(p: ApiProject): boolean {
  return writerBalance(p) > 0;
}

export function matchesFilter(
  p: ApiProject,
  filter: string,
  today: string
): boolean {
  switch (filter) {
    case "due2":
      return isDueSoon(p, today);
    case "overdue":
      return isOverdue(p, today);
    case "pending":
      return isPendingWork(p);
    case "completed":
      return p.status === "Completed" || p.status === "Delivered";
    case "payment":
      return isPaymentPending(p);
    case "writer":
      return isWriterPaymentPending(p);
    case "revisions":
      return hasOpenRevisions(p);
    case "all":
    default:
      return true;
  }
}

/** Partial, case-insensitive search across the supported fields. */
export function matchesSearch(p: ApiProject, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  const haystack = [p.number, p.student, p.writer, p.phone, p.university, p.title]
    .join("\n")
    .toLowerCase();
  return haystack.includes(q);
}

export interface DashboardSummary {
  active: number;
  dueSoon: number;
  overdue: number;
  paymentPendingTotal: number;
  paymentPendingCount: number;
  writerPendingTotal: number;
  writerPendingCount: number;
  openRevisions: number;
  /** Projects (not requests) that have at least one open revision. */
  projectsWithOpenRevisions: number;
}

export function summarize(projects: ApiProject[], today: string): DashboardSummary {
  const s: DashboardSummary = {
    active: 0,
    dueSoon: 0,
    overdue: 0,
    paymentPendingTotal: 0,
    paymentPendingCount: 0,
    writerPendingTotal: 0,
    writerPendingCount: 0,
    openRevisions: 0,
    projectsWithOpenRevisions: 0,
  };
  for (const p of projects) {
    if (isActive(p)) s.active += 1;
    if (isDueSoon(p, today)) s.dueSoon += 1;
    if (isOverdue(p, today)) s.overdue += 1;
    const sb = studentBalance(p);
    if (sb > 0) {
      s.paymentPendingTotal = round2(s.paymentPendingTotal + sb);
      s.paymentPendingCount += 1;
    }
    const wb = writerBalance(p);
    if (wb > 0) {
      s.writerPendingTotal = round2(s.writerPendingTotal + wb);
      s.writerPendingCount += 1;
    }
    const open = openRevisionCount(p);
    if (open > 0) {
      s.openRevisions += open;
      s.projectsWithOpenRevisions += 1;
    }
  }
  return s;
}

export interface FilterCounts {
  all: number;
  due2: number;
  overdue: number;
  pending: number;
  completed: number;
  payment: number;
  writer: number;
  revisions: number;
}

/** Counts over the whole register, independent of the search term. */
export function filterCounts(projects: ApiProject[], today: string): FilterCounts {
  const counts: FilterCounts = {
    all: 0, due2: 0, overdue: 0, pending: 0, completed: 0, payment: 0, writer: 0, revisions: 0,
  };
  for (const p of projects) {
    counts.all += 1;
    if (isDueSoon(p, today)) counts.due2 += 1;
    if (isOverdue(p, today)) counts.overdue += 1;
    if (isPendingWork(p)) counts.pending += 1;
    if (p.status === "Completed" || p.status === "Delivered") counts.completed += 1;
    if (isPaymentPending(p)) counts.payment += 1;
    if (isWriterPaymentPending(p)) counts.writer += 1;
    if (hasOpenRevisions(p)) counts.revisions += 1;
  }
  return counts;
}

/** Register order: earliest submission date, then PCT number. */
export function sortProjects(projects: ApiProject[]): ApiProject[] {
  return [...projects].sort((a, b) => {
    if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    return a.number.localeCompare(b.number);
  });
}

export const FILTER_LABELS: Record<string, string> = {
  all: "All projects",
  due2: "Due in 2 days",
  overdue: "Overdue",
  pending: "Pending work",
  completed: "Completed",
  payment: "Payment pending",
  writer: "Writer payment pending",
  revisions: "Open revisions",
};

export type { ProjectStatus };
