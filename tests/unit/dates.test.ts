import { describe, expect, it } from "vitest";
import { daysBetween, deadlineLabel, isValidDate, todayInIndia } from "@/lib/dates";

describe("isValidDate", () => {
  it("accepts real calendar dates", () => {
    expect(isValidDate("2026-01-31")).toBe(true);
    expect(isValidDate("2024-02-29")).toBe(true); // leap year
  });
  it("rejects impossible dates and wrong formats", () => {
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2025-02-29")).toBe(false); // not a leap year
    expect(isValidDate("2026-13-01")).toBe(false);
    expect(isValidDate("31/01/2026")).toBe(false);
    expect(isValidDate("")).toBe(false);
    expect(isValidDate(20260101)).toBe(false);
  });
});

describe("daysBetween", () => {
  it("counts calendar days, not hours", () => {
    expect(daysBetween("2026-01-01", "2026-01-01")).toBe(0);
    expect(daysBetween("2026-01-01", "2026-01-02")).toBe(1);
    expect(daysBetween("2026-01-31", "2026-02-03")).toBe(3);
    expect(daysBetween("2026-02-01", "2026-01-30")).toBe(-2);
    // DST transitions in other zones must not affect calendar math.
    expect(daysBetween("2026-03-07", "2026-03-10")).toBe(3);
  });
});

describe("todayInIndia", () => {
  it("returns IST calendar day (not UTC)", () => {
    // 20:30 UTC on Jan 1st is already 02:00 on Jan 2nd in IST.
    expect(todayInIndia(new Date("2026-01-01T20:30:00Z"))).toBe("2026-01-02");
    expect(todayInIndia(new Date("2026-01-01T18:30:00Z"))).toBe("2026-01-02");
    expect(todayInIndia(new Date("2026-01-01T18:29:59Z"))).toBe("2026-01-01");
    expect(todayInIndia(new Date("2026-01-01T18:00:00Z"))).toBe("2026-01-01");
  });
});

describe("deadlineLabel", () => {
  const today = "2026-01-10";
  it("labels due today / tomorrow / future / overdue / delivered", () => {
    expect(deadlineLabel("2026-01-10", "In progress", today)).toBe("Due today");
    expect(deadlineLabel("2026-01-11", "In progress", today)).toBe("Due tomorrow");
    expect(deadlineLabel("2026-01-13", "In progress", today)).toBe("Due in 3 days");
    expect(deadlineLabel("2026-01-09", "In progress", today)).toBe("1 day overdue");
    expect(deadlineLabel("2026-01-07", "In progress", today)).toBe("3 days overdue");
    expect(deadlineLabel("2026-01-01", "Delivered", today)).toBe("Delivered");
  });
});
