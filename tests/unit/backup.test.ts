import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { BACKUP_FORMAT, BACKUP_VERSION, buildBackup, parseBackup } from "@/lib/backup";
import { ValidationError } from "@/lib/project";
import type { ApiProject } from "@/lib/types";

function backupProject(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    revision: 3,
    number: "pct-1234",
    title: "Legacy record",
    student: "Old Student",
    phone: "00441122334455",
    university: "Old University",
    received: "2025-06-01",
    due: "2025-06-30",
    status: "In progress",
    percent: 30,
    pending: "Chapter 1",
    notes: "",
    ...overrides,
  };
}

function envelope(projects: unknown[], extra: Record<string, unknown> = {}) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: "2026-01-01T00:00:00.000Z",
    currency: "INR",
    timezone: "Asia/Kolkata",
    projects,
    ...extra,
  };
}

describe("buildBackup", () => {
  it("writes the v1 envelope with only business data", () => {
    const project = {
      id: crypto.randomUUID(),
      revision: 1,
      number: "PCT-1",
      title: "T",
      student: "S",
      phone: "0077",
      university: "",
      writer: "W",
      words: 10,
      received: "2026-01-01",
      due: "2026-01-02",
      status: "Not started",
      percent: 0,
      pending: "",
      notes: "",
      total: 100,
      paid: 0,
      writerTotal: 50,
      writerPaid: 0,
      revisions: [],
    } as ApiProject;
    const backup = buildBackup([project]);
    expect(backup.format).toBe("pct-project-desk");
    expect(backup.version).toBe(1);
    expect(backup.currency).toBe("INR");
    expect(backup.timezone).toBe("Asia/Kolkata");
    expect(typeof backup.exportedAt).toBe("string");
    const serialized = JSON.stringify(backup);
    for (const forbidden of ["scrypt$", "token_hash", "password", "DATABASE_URL", "login_attempts"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("parseBackup", () => {
  it("accepts a SQLite-era v1 record missing writer/payment/revision fields and applies defaults", () => {
    const { projects } = parseBackup(envelope([backupProject()]));
    expect(projects).toHaveLength(1);
    const p = projects[0];
    expect(p.writer).toBe("");
    expect(p.total).toBe(0);
    expect(p.paid).toBe(0);
    expect(p.writerTotal).toBe(0);
    expect(p.writerPaid).toBe(0);
    expect(p.revisions).toEqual([]);
    expect(p.number).toBe("PCT-1234"); // trimmed + uppercased
    expect(p.phone).toBe("00441122334455"); // leading zeros preserved
    expect(p.revision).toBe(3);
  });

  it("restores missing or invalid record versions to at least 1", () => {
    const { projects } = parseBackup(
      envelope([
        backupProject({ number: "PCT-A", revision: undefined }),
        backupProject({ number: "PCT-B", revision: 0 }),
        backupProject({ number: "PCT-C", revision: -5 }),
      ])
    );
    expect(projects.map((p) => p.revision)).toEqual([1, 1, 1]);
  });

  it("keeps ids and revision requests intact", () => {
    const rid = crypto.randomUUID();
    const id = crypto.randomUUID();
    const { projects } = parseBackup(
      envelope([
        backupProject({
          id,
          revisions: [
            {
              id: rid,
              description: "Add appendix",
              requested: "2026-01-02",
              due: "2026-01-05",
              status: "In progress",
              notes: "n",
            },
          ],
        }),
      ])
    );
    expect(projects[0].id).toBe(id);
    expect(projects[0].revisions[0].id).toBe(rid);
    expect(projects[0].revisions[0].status).toBe("In progress");
  });

  it("rejects duplicate project ids and duplicate PCT numbers", () => {
    const id = crypto.randomUUID();
    expect(() =>
      parseBackup(envelope([backupProject({ id }), backupProject({ id, number: "PCT-OTHER" })]))
    ).toThrow(ValidationError);
    expect(() =>
      parseBackup(envelope([backupProject({ number: "PCT-1" }), backupProject({ number: " pct-1 " })]))
    ).toThrow(/Duplicate PCT/);
  });

  it("rejects invalid records with an indexed message and imports nothing", () => {
    try {
      parseBackup(envelope([backupProject({ number: "PCT-OK" }), backupProject({ title: "" })]));
      throw new Error("expected failure");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const issues = (err as ValidationError).issues;
      expect(issues.some((i) => i.path === "projects[1].title")).toBe(true);
    }
  });

  it("rejects money that cannot be represented exactly with two decimals", () => {
    expect(() => parseBackup(envelope([backupProject({ total: 1234.567 })]))).toThrow(
      /decimal places/
    );
  });

  it("rejects payloads without a projects array", () => {
    expect(() => parseBackup({ format: BACKUP_FORMAT, version: 1 })).toThrow(/projects array/);
    expect(() => parseBackup(envelope([]))).toThrow(/no projects/);
  });

  it("warns but imports backups with a foreign format marker", () => {
    const { warnings } = parseBackup(
      envelope([backupProject()], { format: "some-earlier-crm", version: 1 })
    );
    expect(warnings.length).toBeGreaterThan(0);
  });
});
