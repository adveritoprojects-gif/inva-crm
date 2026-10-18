import ExcelJS from "exceljs";
import { todayInIndia } from "./dates";
import { openRevisionCount, studentBalance, writerBalance } from "./filters";
import type { ApiProject } from "./types";

/**
 * Real .xlsx reporting export (ExcelJS — not a renamed CSV).
 * - Unicode, multiline text and leading-zero phone numbers are preserved.
 * - Payment cells are numeric; text that starts with a formula character is
 *   neutralised so spreadsheet software never evaluates it.
 * - Frozen header row, auto-filters and readable column widths.
 */

const PROJECT_HEADERS = [
  "Project ID",
  "PCT number",
  "Project title",
  "Student",
  "Phone",
  "University",
  "Writer",
  "Word count",
  "Date received",
  "Submission date",
  "Status",
  "Completion %",
  "Student fee (INR)",
  "Student paid (INR)",
  "Student balance (INR)",
  "Writer fee (INR)",
  "Writer paid (INR)",
  "Writer balance (INR)",
  "Pending work",
  "Instructions / notes",
  "Open revisions",
  "Record version",
] as const;

const REVISION_HEADERS = [
  "PCT number",
  "Project ID",
  "Revision ID",
  "Writer",
  "Requested changes",
  "Date requested",
  "Deadline",
  "Status",
  "Notes",
] as const;

/** Prevent CSV/Excel formula injection for arbitrary user text. */
function safeText(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

const TEXT_FORMAT = "@";
const MONEY_FORMAT = "#,##0.00";

function styleHeader(sheet: ExcelJS.Worksheet, columns: number): void {
  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", horizontal: "left" };
  header.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE2E8F0" },
  };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns },
  };
}

export async function buildWorkbook(projects: ApiProject[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PCT Project Desk";
  wb.created = new Date();
  wb.title = `PCT projects ${todayInIndia()}`;

  // --- Projects sheet ---------------------------------------------------------
  const ps = wb.addWorksheet("Projects");
  ps.addRow([...PROJECT_HEADERS]);
  for (const p of projects) {
    const row = ps.addRow([
      p.id,
      p.number,
      safeText(p.title),
      safeText(p.student),
      p.phone,
      safeText(p.university),
      safeText(p.writer),
      p.words,
      p.received,
      p.due,
      p.status,
      p.percent,
      p.total,
      p.paid,
      studentBalance(p),
      p.writerTotal,
      p.writerPaid,
      writerBalance(p),
      safeText(p.pending),
      safeText(p.notes),
      openRevisionCount(p),
      p.revision,
    ]);
    // Text formats keep leading zeros / long ids readable.
    (["A", "B", "E", "I", "J"] as const).forEach((col) => {
      row.getCell(col).numFmt = TEXT_FORMAT;
    });
    (["M", "N", "O", "P", "Q", "R"] as const).forEach((col) => {
      row.getCell(col).numFmt = MONEY_FORMAT;
    });
    ["C", "D", "F", "G", "S", "T"].forEach((col) => {
      row.getCell(col).alignment = { wrapText: true, vertical: "top" };
    });
  }
  styleHeader(ps, PROJECT_HEADERS.length);
  const widths: Record<number, number> = {
    1: 38, 2: 14, 3: 32, 4: 20, 5: 16, 6: 22, 7: 18, 8: 12, 9: 14, 10: 16,
    11: 13, 12: 12, 13: 16, 14: 16, 15: 18, 16: 16, 17: 16, 18: 18, 19: 34,
    20: 40, 21: 14, 22: 15,
  };
  ps.columns.forEach((col, i) => {
    col.width = widths[i + 1] ?? 16;
  });

  // --- Revisions sheet --------------------------------------------------------
  const rs = wb.addWorksheet("Revisions");
  rs.addRow([...REVISION_HEADERS]);
  for (const p of projects) {
    for (const r of p.revisions) {
      const row = rs.addRow([
        p.number,
        p.id,
        r.id,
        safeText(p.writer),
        safeText(r.description),
        r.requested,
        r.due,
        r.status,
        safeText(r.notes),
      ]);
      (["A", "B", "C", "F", "G"] as const).forEach((col) => {
        row.getCell(col).numFmt = TEXT_FORMAT;
      });
      ["D", "E", "I"].forEach((col) => {
        row.getCell(col).alignment = { wrapText: true, vertical: "top" };
      });
    }
  }
  styleHeader(rs, REVISION_HEADERS.length);
  const rWidths: Record<number, number> = {
    1: 14, 2: 38, 3: 38, 4: 18, 5: 44, 6: 14, 7: 14, 8: 13, 9: 34,
  };
  rs.columns.forEach((col, i) => {
    col.width = rWidths[i + 1] ?? 18;
  });

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** Date-stamped filename, e.g. pct-project-desk-projects-2026-10-17.xlsx */
export function excelFilename(): string {
  return `pct-project-desk-projects-${todayInIndia()}.xlsx`;
}
