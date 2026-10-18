import { withTransaction } from "./db";
import { ensureMigrated } from "./migrate";
import { ConflictError } from "./errors";
import { TIMEZONE, todayInIndia } from "./dates";
import {
  ValidationError,
  normalizeNumber,
  validateProject,
  type ProjectInput,
} from "./project";
import { toNumber } from "./format";
import type { ApiProject } from "./types";

/**
 * JSON backup format (v1) — identical shape to the SQLite edition and the
 * earlier hosted CRM so old backups import unchanged.
 *
 * {
 *   format: "pct-project-desk", version: 1, exportedAt, currency: "INR",
 *   timezone: "Asia/Kolkata", projects: [ /* project records *\/ ]
 * }
 *
 * Session tokens, password hashes, database credentials and login-attempt
 * records are never part of a business-data backup.
 */

export const BACKUP_FORMAT = "pct-project-desk";
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: string;
  version: number;
  exportedAt: string;
  currency: "INR";
  timezone: string;
  projects: ApiProject[];
}

export function buildBackup(projects: ApiProject[]): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    currency: "INR",
    timezone: TIMEZONE,
    projects,
  };
}

export interface ParsedBackup {
  projects: ProjectInput[];
  warnings: string[];
}

function withDefaults(raw: unknown): Record<string, unknown> {
  const o = { ...((raw ?? {}) as Record<string, unknown>) };
  // Older backups miss writer / payment / revision fields: apply the
  // documented empty/zero defaults rather than failing.
  if (o.writer === undefined) o.writer = "";
  if (o.writerTotal === undefined) o.writerTotal = 0;
  if (o.writerPaid === undefined) o.writerPaid = 0;
  if (o.total === undefined) o.total = 0;
  if (o.paid === undefined) o.paid = 0;
  if (o.revisions === undefined || o.revisions === null) o.revisions = [];
  if (o.words === undefined || o.words === null) o.words = 0;
  if (o.percent === undefined || o.percent === null) o.percent = 0;
  if (o.phone === undefined || o.phone === null) o.phone = "";
  if (o.university === undefined || o.university === null) o.university = "";
  if (o.pending === undefined || o.pending === null) o.pending = "";
  if (o.notes === undefined || o.notes === null) o.notes = "";
  if (o.status === undefined || o.status === null) o.status = "Not started";
  if (o.writer === null) o.writer = "";
  // Restored record versions start at 1 (as the current importer does).
  if (o.revision === undefined || o.revision === null || Number(o.revision) < 1) {
    o.revision = 1;
  }
  return o;
}

/**
 * Parses and validates a v1 backup. Accepts the known format marker and
 * tolerates older/other `format` strings as long as `projects` is an array.
 * Rejects duplicate project ids and duplicate PCT numbers.
 */
export function parseBackup(raw: unknown): ParsedBackup {
  const warnings: string[] = [];
  if (typeof raw !== "object" || raw === null) {
    throw new ValidationError([{ path: "backup", message: "Backup must be a JSON object." }]);
  }
  const file = raw as Record<string, unknown>;

  if (!Array.isArray(file.projects)) {
    throw new ValidationError([
      { path: "backup.projects", message: "Backup must contain a projects array." },
    ]);
  }
  if (typeof file.format === "string" && file.format !== BACKUP_FORMAT) {
    warnings.push(
      `Backup format “${file.format}” is not the native “${BACKUP_FORMAT}”; it was imported using the shared v1 field names.`
    );
  }
  if (typeof file.version === "number" && file.version !== BACKUP_VERSION) {
    warnings.push(
      `Backup version ${file.version} differs from the current version ${BACKUP_VERSION}; records were validated against the current rules.`
    );
  }

  const projects: ProjectInput[] = [];
  const seenIds = new Set<string>();
  const seenNumbers = new Set<string>();
  const issues: { path: string; message: string }[] = [];

  file.projects.forEach((entry, index) => {
    try {
      const project = validateProject(withDefaults(entry));
      const id = project.id.toLowerCase();
      if (seenIds.has(id)) {
        issues.push({ path: `projects[${index}].id`, message: `Duplicate project id in backup: ${project.id}` });
        return;
      }
      const number = normalizeNumber(project.number);
      if (seenNumbers.has(number)) {
        issues.push({
          path: `projects[${index}].number`,
          message: `Duplicate PCT / project number in backup: ${number}`,
        });
        return;
      }
      seenIds.add(id);
      seenNumbers.add(number);
      projects.push({ ...project, id, number });
    } catch (err) {
      if (err instanceof ValidationError) {
        for (const issue of err.issues) {
          issues.push({ path: `projects[${index}].${issue.path}`, message: issue.message });
        }
      } else {
        issues.push({
          path: `projects[${index}]`,
          message: (err as Error).message ?? "Invalid record.",
        });
      }
    }
  });

  if (issues.length > 0) throw new ValidationError(issues);
  if (projects.length === 0) {
    throw new ValidationError([{ path: "backup.projects", message: "Backup contains no projects." }]);
  }
  return { projects, warnings };
}

export interface RestoreOutcome {
  imported: number;
  revisions: number;
}

/**
 * Restores projects into an empty register, in a single transaction (all or
 * nothing). An ACCESS EXCLUSIVE table lock makes the empty check and the
 * inserts safe against concurrent creates/imports, and a nonempty target is
 * refused without touching existing records.
 */
export async function restoreProjects(projects: ProjectInput[]): Promise<RestoreOutcome> {
  await ensureMigrated();
  return withTransaction(async (client) => {
    await client.query("LOCK TABLE projects IN ACCESS EXCLUSIVE MODE");

    const count = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM projects"
    );
    if (Number(count.rows[0]?.count ?? "0") > 0) {
      throw new ConflictError(
        "not_empty",
        "The project register is not empty. Import is only allowed into an empty register; no records were changed."
      );
    }

    let revisions = 0;
    for (const p of projects) {
      await client.query(
        `INSERT INTO projects (
           id, revision, number, title, student, phone, university, writer, words,
           received, due, status, percent, pending, notes, total, paid, writer_total, writer_paid
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
         )`,
        [
          p.id,
          Math.max(1, Math.trunc(p.revision)),
          p.number,
          p.title,
          p.student,
          p.phone,
          p.university,
          p.writer,
          p.words,
          p.received,
          p.due,
          p.status,
          p.percent,
          p.pending,
          p.notes,
          toAmount(p.total),
          toAmount(p.paid),
          toAmount(p.writerTotal),
          toAmount(p.writerPaid),
        ]
      );
      for (let i = 0; i < p.revisions.length; i++) {
        const r = p.revisions[i];
        await client.query(
          `INSERT INTO project_revisions
             (id, project_id, position, description, requested, due, status, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [r.id, p.id, i, r.description, r.requested, r.due, r.status, r.notes]
        );
        revisions += 1;
      }
    }
    return { imported: projects.length, revisions };
  });
}

function toAmount(value: number): string {
  return toNumber(value).toFixed(2);
}

/** Date-stamped filename, e.g. pct-project-desk-backup-2026-10-17.json */
export function backupFilename(): string {
  return `pct-project-desk-backup-${todayInIndia()}.json`;
}
