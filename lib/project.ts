import { isValidDate } from "./dates";
import { AppError } from "./errors";

/**
 * PCT project domain model, validation rules and normalization.
 * Server-side validation mirrors the UI; the server always re-validates.
 */

export const PROJECT_STATUSES = [
  "Not started",
  "In progress",
  "On hold",
  "Completed",
  "Delivered",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const REVISION_STATUSES = [
  "Requested",
  "In progress",
  "Completed",
] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const MAX_REVISIONS = 200;

// Text-length limits.
export const LIMITS = {
  number: 50,
  title: 300,
  student: 200,
  phone: 50,
  university: 200,
  writer: 200,
  pending: 10_000,
  notes: 20_000,
  revisionDescription: 5_000,
  revisionNotes: 10_000,
} as const;

export const MAX_WORDS = 10_000_000;
export const MAX_MONEY = 100_000_000;
export const MAX_MONEY_DECIMALS = 2;

export interface RevisionInput {
  id: string;
  description: string;
  requested: string;
  due: string;
  status: RevisionStatus;
  notes: string;
}

export interface ProjectInput {
  id: string;
  revision: number;
  number: string;
  title: string;
  student: string;
  phone: string;
  university: string;
  writer: string;
  words: number;
  received: string;
  due: string;
  status: ProjectStatus;
  percent: number;
  pending: string;
  notes: string;
  total: number;
  paid: number;
  writerTotal: number;
  writerPaid: number;
  revisions: RevisionInput[];
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Trim + uppercase, the canonical form for PCT/project numbers. */
export function normalizeNumber(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function checkMoney(errors: string[], label: string, value: unknown): number {
  const n = parseMoney(value);
  if (n === null) {
    errors.push(`${label} must be a number.`);
    return 0;
  }
  if (n < 0 || n > MAX_MONEY) {
    errors.push(`${label} must be between 0 and ${MAX_MONEY.toLocaleString("en-IN")}.`);
  }
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) {
    errors.push(`${label} may have at most ${MAX_MONEY_DECIMALS} decimal places.`);
  }
  return n;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ValidationError extends AppError {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super(
      400,
      "validation",
      issues.map((i) => i.message).join(" ") || "Invalid project data."
    );
    this.name = "ValidationError";
    this.issues = issues;
  }
}

function isProjectStatus(v: unknown): v is ProjectStatus {
  return typeof v === "string" && (PROJECT_STATUSES as readonly string[]).includes(v);
}
function isRevisionStatus(v: unknown): v is RevisionStatus {
  return typeof v === "string" && (REVISION_STATUSES as readonly string[]).includes(v);
}

/**
 * Validates raw input and returns a normalized, fully-typed project.
 * Applies the product rules: required PCT/title/student, unique revision IDs,
 * calendar dates, due >= received, words 0..10M, money 0..100M with paid <=
 * total, percent 0..100 and 100% when Completed/Delivered.
 */
export function validateProject(raw: unknown): ProjectInput {
  const issues: ValidationIssue[] = [];
  const push = (message: string, path = "project") => issues.push({ path, message });
  const o = (raw ?? {}) as Record<string, unknown>;

  const number = normalizeNumber(o.number);
  if (!number) push("PCT / project number is required.", "number");
  else if (number.length > LIMITS.number)
    push(`PCT / project number must be at most ${LIMITS.number} characters.`, "number");

  const title = asText(o.title);
  const student = asText(o.student);
  if (title.trim() === "") push("Project title is required.", "title");
  else if (title.length > LIMITS.title)
    push(`Project title must be at most ${LIMITS.title} characters.`, "title");
  if (student.trim() === "") push("Student name is required.", "student");
  else if (student.length > LIMITS.student)
    push(`Student name must be at most ${LIMITS.student} characters.`, "student");

  const phone = asText(o.phone);
  if (phone.length > LIMITS.phone)
    push(`Phone must be at most ${LIMITS.phone} characters.`, "phone");
  const university = asText(o.university);
  if (university.length > LIMITS.university)
    push(`University must be at most ${LIMITS.university} characters.`, "university");
  const writer = asText(o.writer);
  if (writer.length > LIMITS.writer)
    push(`Writer must be at most ${LIMITS.writer} characters.`, "writer");

  const wordsRaw = typeof o.words === "number" ? o.words : Number(o.words);
  let words = 0;
  if (!Number.isFinite(wordsRaw) || Math.floor(wordsRaw) !== wordsRaw) {
    push("Word count must be a whole number.", "words");
  } else if (wordsRaw < 0 || wordsRaw > MAX_WORDS) {
    push(`Word count must be between 0 and ${MAX_WORDS.toLocaleString("en-IN")}.`, "words");
    words = wordsRaw;
  } else {
    words = wordsRaw;
  }

  const received = asText(o.received);
  const due = asText(o.due);
  if (!isValidDate(received)) push("Date received must be a valid calendar date.", "received");
  if (!isValidDate(due)) push("Submission date must be a valid calendar date.", "due");
  if (isValidDate(received) && isValidDate(due) && due < received) {
    push("Submission date must be on or after the date received.", "due");
  }

  const status = o.status;
  if (!isProjectStatus(status)) {
    push("Status must be one of: Not started, In progress, On hold, Completed, Delivered.", "status");
  }

  let percent = Number(o.percent);
  if (!Number.isFinite(percent) || Math.floor(percent) !== percent) {
    push("Completion must be a whole number from 0 to 100.", "percent");
    percent = 0;
  } else if (percent < 0 || percent > 100) {
    push("Completion must be a whole number from 0 to 100.", "percent");
  }
  if (
    (status === "Completed" || status === "Delivered") &&
    Number.isFinite(percent) &&
    percent < 100
  ) {
    push("Completed and Delivered projects must be 100% complete.", "percent");
  }

  const pending = asText(o.pending);
  if (pending.length > LIMITS.pending)
    push(`Pending work must be at most ${LIMITS.pending} characters.`, "pending");
  const notes = asText(o.notes);
  if (notes.length > LIMITS.notes)
    push(`Instructions / notes must be at most ${LIMITS.notes} characters.`, "notes");

  const total = checkMoneySafe(issues, "Student fee", o.total);
  const paid = checkMoneySafe(issues, "Student paid", o.paid);
  const writerTotal = checkMoneySafe(issues, "Writer fee", o.writerTotal);
  const writerPaid = checkMoneySafe(issues, "Writer paid", o.writerPaid);
  if (total !== null && paid !== null && paid > total) {
    push("Student paid cannot exceed the student fee.", "paid");
  }
  if (writerTotal !== null && writerPaid !== null && writerPaid > writerTotal) {
    push("Writer paid cannot exceed the writer fee.", "writerPaid");
  }

  const id = asText(o.id);
  if (!UUID_RE.test(id)) push("Project id must be a UUID.", "id");

  let revision = Number(o.revision ?? 1);
  if (!Number.isFinite(revision) || Math.floor(revision) !== revision || revision < 1) {
    revision = 1;
  }

  // Revisions.
  const rawRevisions = Array.isArray(o.revisions) ? o.revisions : [];
  if (rawRevisions.length > MAX_REVISIONS) {
    push(`A project can have at most ${MAX_REVISIONS} revision requests.`, "revisions");
  }
  const revisions: RevisionInput[] = [];
  const seenRevisionIds = new Set<string>();
  rawRevisions.forEach((rv, i) => {
    const r = (rv ?? {}) as Record<string, unknown>;
    const label = `Revision ${i + 1}`;
    const rid = asText(r.id);
    if (!UUID_RE.test(rid)) push(`${label}: invalid revision id.`, `revisions.${i}.id`);
    else if (seenRevisionIds.has(rid.toLowerCase()))
      push(`${label}: duplicate revision id.`, `revisions.${i}.id`);
    else seenRevisionIds.add(rid.toLowerCase());

    const description = asText(r.description);
    if (description.trim() === "")
      push(`${label}: requested changes are required.`, `revisions.${i}.description`);
    else if (description.length > LIMITS.revisionDescription)
      push(`${label}: requested changes must be at most ${LIMITS.revisionDescription} characters.`, `revisions.${i}.description`);

    const rRequested = asText(r.requested);
    const rDue = asText(r.due);
    if (!isValidDate(rRequested))
      push(`${label}: date requested must be a valid calendar date.`, `revisions.${i}.requested`);
    if (!isValidDate(rDue))
      push(`${label}: deadline must be a valid calendar date.`, `revisions.${i}.due`);
    if (isValidDate(rRequested) && isValidDate(rDue) && rDue < rRequested)
      push(`${label}: deadline must be on or after the date requested.`, `revisions.${i}.due`);

    const rStatus = r.status;
    if (!isRevisionStatus(rStatus))
      push(`${label}: status must be Requested, In progress or Completed.`, `revisions.${i}.status`);

    const rNotes = asText(r.notes);
    if (rNotes.length > LIMITS.revisionNotes)
      push(`${label}: notes must be at most ${LIMITS.revisionNotes} characters.`, `revisions.${i}.notes`);

    revisions.push({
      id: rid,
      description,
      requested: rRequested,
      due: rDue,
      status: rStatus as RevisionStatus,
      notes: rNotes,
    });
  });

  if (issues.length > 0) throw new ValidationError(issues);

  return {
    id: id.toLowerCase(),
    revision,
    number,
    title,
    student,
    phone,
    university,
    writer,
    words: typeof words === "number" && Number.isFinite(words) ? words : 0,
    received,
    due,
    status: status as ProjectStatus,
    percent,
    pending,
    notes,
    total: total ?? 0,
    paid: paid ?? 0,
    writerTotal: writerTotal ?? 0,
    writerPaid: writerPaid ?? 0,
    revisions,
  };
}

function checkMoneySafe(issues: ValidationIssue[], label: string, value: unknown): number | null {
  const n = parseMoney(value);
  if (n === null) {
    issues.push({ path: label, message: `${label} must be a number.` });
    return null;
  }
  if (n < 0 || n > MAX_MONEY) {
    issues.push({
      path: label,
      message: `${label} must be between 0 and ${MAX_MONEY.toLocaleString("en-IN")}.`,
    });
  }
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) {
    issues.push({
      path: label,
      message: `${label} may have at most ${MAX_MONEY_DECIMALS} decimal places.`,
    });
  }
  return n;
}

/** Applies the auto-100% rule when a status changes (used by the UI too). */
export function autoPercentForStatus(
  status: ProjectStatus,
  percent: number
): number {
  return status === "Completed" || status === "Delivered" ? 100 : percent;
}

/** True when the project has at least one open (not Completed) revision. */
export function hasOpenRevisions(revisions: RevisionInput[]): boolean {
  return revisions.some((r) => r.status !== "Completed");
}
