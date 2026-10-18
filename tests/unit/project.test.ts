import { describe, expect, it } from "vitest";
import {
  MAX_REVISIONS,
  ValidationError,
  normalizeNumber,
  validateProject,
} from "@/lib/project";
import crypto from "node:crypto";

function base(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    revision: 1,
    number: "PCT-2001",
    title: "Data analysis report",
    student: "Rahul Sharma",
    phone: "+91 9876543210",
    university: "Delhi University",
    writer: "Meera",
    words: 3000,
    received: "2026-01-01",
    due: "2026-01-31",
    status: "In progress",
    percent: 55,
    pending: "Final proofread",
    notes: "Harvard referencing.",
    total: 10000,
    paid: 4000,
    writerTotal: 4000,
    writerPaid: 1500,
    revisions: [],
    ...overrides,
  };
}

function expectIssue(raw: unknown, pattern: RegExp) {
  try {
    validateProject(raw);
    throw new Error("expected validation to fail");
  } catch (err) {
    expect(err).toBeInstanceOf(ValidationError);
    const messages = (err as ValidationError).issues.map((i) => i.message).join(" | ");
    expect(messages).toMatch(pattern);
  }
}

describe("normalizeNumber", () => {
  it("trims and uppercases", () => {
    expect(normalizeNumber("  pct-123  ")).toBe("PCT-123");
    expect(normalizeNumber(undefined)).toBe("");
  });
});

describe("validateProject", () => {
  it("accepts a valid project and normalizes the PCT number", () => {
    const p = validateProject(base({ number: "  pct-2001 " }));
    expect(p.number).toBe("PCT-2001");
    expect(p.total).toBe(10000);
    expect(p.paid).toBe(4000);
  });

  it("requires PCT number, title and student", () => {
    expectIssue(base({ number: "   " }), /PCT \/ project number is required/);
    expectIssue(base({ title: "" }), /Project title is required/);
    expectIssue(base({ student: "  " }), /Student name is required/);
  });

  it("rejects invalid calendar dates", () => {
    expectIssue(base({ received: "2026-02-30" }), /Date received/);
    expectIssue(base({ due: "2026-13-01" }), /Submission date/);
    expectIssue(base({ due: "01/31/2026" }), /Submission date/);
  });

  it("rejects submission before received", () => {
    expectIssue(base({ received: "2026-01-10", due: "2026-01-09" }), /on or after the date received/);
  });

  it("enforces word-count bounds", () => {
    expectIssue(base({ words: -1 }), /Word count/);
    expectIssue(base({ words: 10_000_001 }), /Word count/);
    expectIssue(base({ words: 12.5 }), /Word count/);
    expect(validateProject(base({ words: 0 })).words).toBe(0);
    expect(validateProject(base({ words: 10_000_000 })).words).toBe(10_000_000);
  });

  it("enforces money bounds and paid <= total", () => {
    expectIssue(base({ total: -0.01 }), /Student fee/);
    expectIssue(base({ paid: 100_000_001 }), /Student paid/);
    expectIssue(base({ total: 1000, paid: 1000.001 }), /decimal places/);
    expectIssue(base({ total: 1000, paid: 1000.5 }), /cannot exceed the student fee/);
    expectIssue(base({ writerTotal: 500, writerPaid: 500.01 }), /cannot exceed the writer fee/);
    expect(validateProject(base({ total: 0, paid: 0, writerTotal: 0, writerPaid: 0 }))).toBeTruthy();
  });

  it("enforces percent rules including auto-100 statuses", () => {
    expectIssue(base({ percent: 101 }), /0 to 100/);
    expectIssue(base({ percent: -1 }), /0 to 100/);
    expectIssue(base({ status: "Completed", percent: 99 }), /must be 100% complete/);
    expectIssue(base({ status: "Delivered", percent: 50 }), /must be 100% complete/);
    expect(validateProject(base({ status: "Delivered", percent: 100 })).percent).toBe(100);
  });

  it("validates statuses exactly", () => {
    expectIssue(base({ status: "Done" }), /Status must be one of/);
    for (const s of ["Not started", "In progress", "On hold"] as const) {
      expect(validateProject(base({ status: s })).status).toBe(s);
    }
    for (const s of ["Completed", "Delivered"] as const) {
      expect(validateProject(base({ status: s, percent: 100 })).status).toBe(s);
    }
  });

  it("applies text-length limits", () => {
    expectIssue(base({ title: "x".repeat(301) }), /Project title must be at most 300/);
    expectIssue(base({ phone: "1".repeat(51) }), /Phone must be at most 50/);
    expectIssue(base({ pending: "x".repeat(10_001) }), /Pending work must be at most/);
    expectIssue(base({ notes: "x".repeat(20_001) }), /Instructions \/ notes must be at most/);
  });

  it("validates revision requests and requires descriptions", () => {
    const rid = crypto.randomUUID();
    expectIssue(
      base({
        revisions: [
          { id: rid, description: "", requested: "2026-01-05", due: "2026-01-06", status: "Requested", notes: "" },
        ],
      }),
      /requested changes are required/
    );
  });

  it("rejects revision deadlines before the request date", () => {
    expectIssue(
      base({
        revisions: [
          {
            id: crypto.randomUUID(),
            description: "Add charts",
            requested: "2026-01-10",
            due: "2026-01-09",
            status: "Requested",
            notes: "",
          },
        ],
      }),
      /on or after the date requested/
    );
  });

  it("rejects invalid revision statuses and duplicate revision ids", () => {
    const rid = crypto.randomUUID();
    expectIssue(
      base({
        revisions: [
          { id: rid, description: "Fix", requested: "2026-01-05", due: "2026-01-06", status: "Open", notes: "" },
        ],
      }),
      /status must be Requested, In progress or Completed/
    );
    expectIssue(
      base({
        revisions: [
          { id: rid, description: "Fix A", requested: "2026-01-05", due: "2026-01-06", status: "Requested", notes: "" },
          { id: rid, description: "Fix B", requested: "2026-01-05", due: "2026-01-06", status: "Requested", notes: "" },
        ],
      }),
      /duplicate revision id/
    );
  });

  it("enforces the 200-revision limit", () => {
    const revisions = Array.from({ length: MAX_REVISIONS + 1 }, () => ({
      id: crypto.randomUUID(),
      description: "Change",
      requested: "2026-01-05",
      due: "2026-01-06",
      status: "Requested",
      notes: "",
    }));
    expectIssue(base({ revisions }), /at most 200 revision requests/);
  });

  it("rejects malformed ids", () => {
    expectIssue(base({ id: "not-a-uuid" }), /Project id must be a UUID/);
  });

  it("accepts a full set of revisions up to the limit", () => {
    const revisions = Array.from({ length: 20 }, () => ({
      id: crypto.randomUUID(),
      description: "Change requested by student",
      requested: "2026-01-05",
      due: "2026-01-08",
      status: "Requested" as const,
      notes: "ok",
    }));
    const p = validateProject(base({ revisions }));
    expect(p.revisions).toHaveLength(20);
  });
});
