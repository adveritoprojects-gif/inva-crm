/** Application error types mapped to HTTP responses. */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues?: unknown;
  constructor(status: number, code: string, message: string, issues?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Sign in to continue.") {
    super(401, "unauthorized", message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "This request was rejected (cross-site request).") {
    super(403, "forbidden", message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Project not found.") {
    super(404, "not_found", message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(code: string, message: string) {
    super(409, code, message);
    this.name = "ConflictError";
  }
}

export class DuplicateNumberError extends ConflictError {
  constructor(number: string) {
    super(
      "duplicate_number",
      `PCT / project number “${number}” already exists. PCT numbers must be unique.`
    );
    this.name = "DuplicateNumberError";
  }
}

export class StaleRevisionError extends ConflictError {
  constructor() {
    super(
      "stale_revision",
      "This project was changed in another tab or session. Refresh the register and try again."
    );
    this.name = "StaleRevisionError";
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = "The uploaded file is too large (20 MB limit).") {
    super(413, "too_large", message);
    this.name = "PayloadTooLargeError";
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, "bad_request", message);
    this.name = "BadRequestError";
  }
}

/** PostgreSQL unique-violation detection. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}

/** Name of the violated constraint/index, when available. */
export function uniqueViolationConstraint(err: unknown): string | null {
  if (!isUniqueViolation(err)) return null;
  const e = err as { constraint?: string };
  return e.constraint ?? null;
}
