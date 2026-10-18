import type { PoolClient } from "pg";
import { getPool, withTransaction } from "./db";
import { ensureMigrated } from "./migrate";
import {
  ConflictError,
  DuplicateNumberError,
  NotFoundError,
  StaleRevisionError,
  isUniqueViolation,
  uniqueViolationConstraint,
} from "./errors";
import type { ApiProject, ApiRevision } from "./types";
import type { ProjectInput, RevisionInput } from "./project";
import { toNumber } from "./format";

/**
 * Project persistence. Every statement is parameterized and runs in the
 * Node.js runtime through the shared pg pool. Project fields and their
 * revision requests are written atomically in one transaction, and updates
 * use the `revision` column as an optimistic-lock counter.
 */

const PROJECT_COLUMNS = `
  id, revision, number, title, student, phone, university, writer, words,
  received, due, status, percent, pending, notes,
  total, paid, writer_total, writer_paid
`;

const REVISIONS_JSON = `
    COALESCE((
      SELECT json_agg(json_build_object(
        'id', r.id,
        'description', r.description,
        'requested', r.requested,
        'due', r.due,
        'status', r.status,
        'notes', r.notes
      ) ORDER BY r.position)
      FROM project_revisions r WHERE r.project_id = p.id
    ), '[]'::json) AS revisions`;

const LIST_SQL = `
  SELECT ${PROJECT_COLUMNS}, ${REVISIONS_JSON}
  FROM projects p
  ORDER BY p.due ASC, p.number COLLATE "C" ASC
`;

const SINGLE_SQL = `
  SELECT ${PROJECT_COLUMNS}, ${REVISIONS_JSON}
  FROM projects p
  WHERE p.id = $1
`;

interface ProjectRow {
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
  status: ApiProject["status"];
  percent: number;
  pending: string;
  notes: string;
  total: string;
  paid: string;
  writer_total: string;
  writer_paid: string;
  revisions: ApiRevision[] | null;
}

function fromRow(row: ProjectRow): ApiProject {
  return {
    id: row.id,
    revision: row.revision,
    number: row.number,
    title: row.title,
    student: row.student,
    phone: row.phone,
    university: row.university,
    writer: row.writer,
    words: row.words,
    received: row.received,
    due: row.due,
    status: row.status,
    percent: row.percent,
    pending: row.pending,
    notes: row.notes,
    total: toNumber(row.total),
    paid: toNumber(row.paid),
    writerTotal: toNumber(row.writer_total),
    writerPaid: toNumber(row.writer_paid),
    revisions: (row.revisions ?? []).map((r) => ({
      id: r.id,
      description: r.description,
      requested: r.requested,
      due: r.due,
      status: r.status,
      notes: r.notes,
    })),
  };
}

export async function listProjects(): Promise<ApiProject[]> {
  await ensureMigrated();
  const res = await getPool().query<ProjectRow>(LIST_SQL);
  return res.rows.map(fromRow);
}

export async function getProject(id: string): Promise<ApiProject | null> {
  await ensureMigrated();
  return getProjectWithClient(null, id);
}

async function getProjectWithClient(
  client: PoolClient | null,
  id: string
): Promise<ApiProject | null> {
  const runner = client ?? getPool();
  const res = await runner.query<ProjectRow>(SINGLE_SQL, [id]);
  return res.rows[0] ? fromRow(res.rows[0]) : null;
}

const INSERT_PROJECT_SQL = `
  INSERT INTO projects (
    id, revision, number, title, student, phone, university, writer, words,
    received, due, status, percent, pending, notes, total, paid, writer_total, writer_paid
  ) VALUES (
    $1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
  )
`;

function projectParams(input: ProjectInput): unknown[] {
  return [
    input.id,
    input.number,
    input.title,
    input.student,
    input.phone,
    input.university,
    input.writer,
    input.words,
    input.received,
    input.due,
    input.status,
    input.percent,
    input.pending,
    input.notes,
    input.total.toFixed(2),
    input.paid.toFixed(2),
    input.writerTotal.toFixed(2),
    input.writerPaid.toFixed(2),
  ];
}

async function insertRevisions(
  client: PoolClient,
  projectId: string,
  revisions: RevisionInput[]
): Promise<void> {
  for (let i = 0; i < revisions.length; i++) {
    const r = revisions[i];
    await client.query(
      `INSERT INTO project_revisions
        (id, project_id, position, description, requested, due, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [r.id, projectId, i, r.description, r.requested, r.due, r.status, r.notes]
    );
  }
}

function mapWriteError(err: unknown, number: string): never {
  const constraint = uniqueViolationConstraint(err);
  if (constraint) {
    if (constraint.includes("number")) throw new DuplicateNumberError(number);
    if (constraint.includes("project_revisions")) {
      throw new ConflictError(
        "duplicate_revision_id",
        "A revision request id is already in use. Reload the register and try again."
      );
    }
    throw new ConflictError("duplicate", "A conflicting record already exists.");
  }
  if (isUniqueViolation(err)) throw new DuplicateNumberError(number);
  const code = (err as { code?: string }).code;
  if (code === "23514") {
    throw new ConflictError(
      "constraint",
      "The project data violates a database constraint. Check the values and try again."
    );
  }
  throw err;
}

/** Creates a project with its revisions in one transaction. */
export async function createProject(input: ProjectInput): Promise<ApiProject> {
  await ensureMigrated();
  try {
    return await withTransaction(async (client) => {
      await client.query(INSERT_PROJECT_SQL, projectParams(input));
      await insertRevisions(client, input.id, input.revisions);
      const created = await getProjectWithClient(client, input.id);
      if (!created) throw new Error("Project was inserted but could not be read back.");
      return created;
    });
  } catch (err) {
    if (err instanceof DuplicateNumberError || err instanceof ConflictError) throw err;
    mapWriteError(err, input.number);
  }
}

/**
 * Updates a project and replaces its revision requests atomically.
 * Requires the submitted record version to match (optimistic locking);
 * the version is incremented exactly once and the fresh record is returned.
 */
export async function updateProject(
  id: string,
  input: ProjectInput
): Promise<ApiProject> {
  await ensureMigrated();
  try {
    return await withTransaction(async (client) => {
      const res = await client.query(
        `UPDATE projects SET
           number = $2, title = $3, student = $4, phone = $5, university = $6,
           writer = $7, words = $8, received = $9, due = $10, status = $11,
           percent = $12, pending = $13, notes = $14, total = $15, paid = $16,
           writer_total = $17, writer_paid = $18,
           revision = revision + 1, updated_at = now()
         WHERE id = $1 AND revision = $19
         RETURNING id`,
        [...projectParams(input), input.revision]
      );

      if (res.rowCount === 0) {
        const exists = await client.query("SELECT 1 FROM projects WHERE id = $1", [id]);
        if (exists.rowCount === 0) throw new NotFoundError();
        throw new StaleRevisionError();
      }

      await client.query("DELETE FROM project_revisions WHERE project_id = $1", [id]);
      await insertRevisions(client, id, input.revisions);

      const updated = await getProjectWithClient(client, id);
      if (!updated) throw new Error("Project was updated but could not be read back.");
      return updated;
    });
  } catch (err) {
    if (
      err instanceof StaleRevisionError ||
      err instanceof NotFoundError ||
      err instanceof DuplicateNumberError ||
      err instanceof ConflictError
    ) {
      throw err;
    }
    mapWriteError(err, input.number);
  }
}
