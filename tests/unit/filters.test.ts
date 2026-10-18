import { describe, expect, it } from "vitest";
import {
  filterCounts,
  isDueSoon,
  isOverdue,
  isPaymentPending,
  isPendingWork,
  isWriterPaymentPending,
  matchesFilter,
  matchesSearch,
  openRevisionCount,
  revisionNeedsAttention,
  sortProjects,
  summarize,
} from "@/lib/filters";
import type { ApiProject } from "@/lib/types";

let counter = 0;
function project(overrides: Partial<ApiProject> = {}): ApiProject {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    revision: 1,
    number: `PCT-${1000 + counter}`,
    title: "Essay",
    student: "Student",
    phone: "",
    university: "",
    writer: "",
    words: 1000,
    received: "2026-01-01",
    due: "2026-01-10",
    status: "In progress",
    percent: 50,
    pending: "",
    notes: "",
    total: 0,
    paid: 0,
    writerTotal: 0,
    writerPaid: 0,
    revisions: [],
    ...overrides,
  };
}

const TODAY = "2026-01-10";

describe("due/overdue calendar-day rules", () => {
  it("counts today, +1 and +2 as due soon, +3 not", () => {
    expect(isDueSoon(project({ due: "2026-01-10" }), TODAY)).toBe(true);
    expect(isDueSoon(project({ due: "2026-01-11" }), TODAY)).toBe(true);
    expect(isDueSoon(project({ due: "2026-01-12" }), TODAY)).toBe(true);
    expect(isDueSoon(project({ due: "2026-01-13" }), TODAY)).toBe(false);
  });

  it("marks earlier dates overdue, but not delivered projects", () => {
    expect(isOverdue(project({ due: "2026-01-09" }), TODAY)).toBe(true);
    expect(isOverdue(project({ due: "2026-01-10" }), TODAY)).toBe(false);
    expect(isOverdue(project({ due: "2026-01-01", status: "Delivered", percent: 100 }), TODAY)).toBe(false);
    expect(isDueSoon(project({ due: "2026-01-10", status: "Delivered", percent: 100 }), TODAY)).toBe(false);
  });

  it("completed projects are still active until delivered", () => {
    const completed = project({ status: "Completed", percent: 100, due: "2026-01-09" });
    expect(summarize([completed], TODAY).active).toBe(1);
    expect(isOverdue(completed, TODAY)).toBe(true);
  });
});

describe("pending work rule", () => {
  it("is true for unfinished status even with blank pending text", () => {
    expect(isPendingWork(project({ status: "On hold", pending: "" }))).toBe(true);
  });
  it("is true for delivered projects with open revisions", () => {
    const p = project({
      status: "Delivered",
      percent: 100,
      pending: "",
      revisions: [
        { id: "r1", description: "Fix", requested: "2026-01-02", due: "2026-01-05", status: "Requested", notes: "" },
      ],
    });
    expect(isPendingWork(p)).toBe(true);
    expect(openRevisionCount(p)).toBe(1);
    expect(revisionNeedsAttention(p, TODAY)).toBe(true); // overdue request
  });
  it("is true for completed projects with nonblank pending text", () => {
    expect(isPendingWork(project({ status: "Completed", percent: 100, pending: "waiting" }))).toBe(true);
    expect(isPendingWork(project({ status: "Completed", percent: 100, pending: "   " }))).toBe(false);
    expect(isPendingWork(project({ status: "Delivered", percent: 100, pending: "waiting" }))).toBe(false);
  });
  it("counts open revisions on delivered projects", () => {
    const p = project({
      status: "Delivered",
      percent: 100,
      revisions: [
        { id: "r1", description: "A", requested: "2026-01-02", due: "2026-01-20", status: "Requested", notes: "" },
        { id: "r2", description: "B", requested: "2026-01-02", due: "2026-01-20", status: "Completed", notes: "" },
      ],
    });
    expect(openRevisionCount(p)).toBe(1);
    expect(revisionNeedsAttention(p, TODAY)).toBe(false);
    expect(revisionNeedsAttention(project({
      status: "In progress",
      revisions: [
        { id: "r1", description: "A", requested: "2026-01-02", due: TODAY, status: "Requested", notes: "" },
      ],
    }), TODAY)).toBe(true);
  });
});

describe("payment filters", () => {
  it("includes delivered projects with positive balances", () => {
    const p = project({ status: "Delivered", percent: 100, total: 5000, paid: 4000 });
    expect(isPaymentPending(p)).toBe(true);
    expect(summarize([p], TODAY).paymentPendingTotal).toBe(1000);
    expect(summarize([p], TODAY).paymentPendingCount).toBe(1);
  });
  it("handles writer balances", () => {
    const p = project({ writerTotal: 2000, writerPaid: 1500.25 });
    expect(isWriterPaymentPending(p)).toBe(true);
    expect(summarize([p], TODAY).writerPendingTotal).toBeCloseTo(499.75, 2);
  });
  it("treats fully settled projects as not pending", () => {
    expect(isPaymentPending(project({ total: 100, paid: 100 }))).toBe(false);
    expect(isWriterPaymentPending(project({ writerTotal: 0, writerPaid: 0 }))).toBe(false);
  });
});

describe("search", () => {
  const p = project({
    number: "PCT-4321",
    student: "Asha Patel",
    writer: "Ravi Kumar",
    phone: "00441234567890",
    university: "Oxford College",
    title: "Renewable Energy Thesis",
  });
  it("matches each supported field partially and case-insensitively", () => {
    expect(matchesSearch(p, "pct-43")).toBe(true);
    expect(matchesSearch(p, "4321")).toBe(true);
    expect(matchesSearch(p, "asha")).toBe(true);
    expect(matchesSearch(p, "PATEL")).toBe(true);
    expect(matchesSearch(p, "ravi")).toBe(true);
    expect(matchesSearch(p, "004412")).toBe(true);
    expect(matchesSearch(p, "oxford")).toBe(true);
    expect(matchesSearch(p, "energy the")).toBe(true);
    expect(matchesSearch(p, "nomatch")).toBe(false);
    expect(matchesSearch(p, "   ")).toBe(true);
  });
});

describe("filters, counts and sorting", () => {
  const projects = [
    project({ number: "PCT-3", due: "2026-01-09", total: 100, paid: 50 }), // overdue + payment
    project({ number: "PCT-1", due: "2026-01-10", status: "Completed", percent: 100 }),
    project({ number: "PCT-2", due: "2026-01-12", status: "Delivered", percent: 100 }),
    project({
      number: "PCT-4",
      due: "2026-02-01",
      revisions: [
        { id: "x1", description: "D", requested: "2026-01-08", due: "2026-01-20", status: "In progress", notes: "" },
      ],
    }),
  ];

  it("counts every filter over the whole register", () => {
    const c = filterCounts(projects, TODAY);
    expect(c.all).toBe(4);
    // PCT-3 is overdue (not due-soon), PCT-1 is due today, PCT-2 is delivered,
    // PCT-4 is due far in the future.
    expect(c.due2).toBe(1);
    expect(c.overdue).toBe(1);
    expect(c.completed).toBe(2); // Completed + Delivered
    expect(c.payment).toBe(1);
    expect(c.writer).toBe(0);
    expect(c.revisions).toBe(1);
    expect(c.pending).toBe(2); // PCT-3 (in progress), PCT-4 (open revision)
  });

  it("applies the selected filter with search combined", () => {
    const overdue = projects.filter((p) => matchesFilter(p, "overdue", TODAY));
    expect(overdue.map((p) => p.number)).toEqual(["PCT-3"]);
    const searched = overdue.filter((p) => matchesSearch(p, "pct-3"));
    expect(searched).toHaveLength(1);
    expect(overdue.filter((p) => matchesSearch(p, "nope"))).toHaveLength(0);
  });

  it("sorts by earliest submission date then PCT number", () => {
    const sorted = sortProjects(projects).map((p) => p.number);
    expect(sorted).toEqual(["PCT-3", "PCT-1", "PCT-2", "PCT-4"]);
    const sameDay = sortProjects([
      project({ number: "PCT-20", due: "2026-01-10" }),
      project({ number: "PCT-4", due: "2026-01-10" }),
    ]).map((p) => p.number);
    // Plain lexicographic PCT order within the same submission date.
    expect(sameDay).toEqual(["PCT-20", "PCT-4"]);
  });

  it("summarizes dashboard numbers", () => {
    const s = summarize(projects, TODAY);
    // Active = everything not Delivered: PCT-1 (Completed), PCT-3, PCT-4.
    expect(s.active).toBe(3);
    expect(s.overdue).toBe(1);
    expect(s.dueSoon).toBe(1);
    expect(s.openRevisions).toBe(1);
    expect(s.projectsWithOpenRevisions).toBe(1);
  });
});
