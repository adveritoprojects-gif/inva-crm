"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProjectDialog, {
  draftFromProject,
  newProjectDraft,
  type ProjectDraft,
} from "@/components/ProjectDialog";
import {
  DeadlineBadge,
  Notice,
  ProgressBar,
  Skeleton,
} from "@/components/ui";
import { todayInIndia } from "@/lib/dates";
import { formatINR } from "@/lib/format";
import {
  FILTER_LABELS,
  filterCounts,
  matchesFilter,
  matchesSearch,
  openRevisionCount,
  revisionNeedsAttention,
  sortProjects,
  studentBalance,
  summarize,
  writerBalance,
} from "@/lib/filters";
import { FILTER_KEYS, type ApiProject, type FilterKey } from "@/lib/types";
import type { ProjectInput } from "@/lib/project";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

interface NoticeState {
  kind: "success" | "error" | "info";
  text: string;
}

interface SaveResult {
  ok: boolean;
  message?: string;
  fatal?: boolean;
}

const STATUS_BADGE: Record<string, string> = {
  "Not started": "bg-slate-200 text-slate-800",
  "In progress": "bg-sky-100 text-sky-900",
  "On hold": "bg-amber-100 text-amber-900",
  Completed: "bg-emerald-100 text-emerald-900",
  Delivered: "bg-slate-300 text-slate-800",
};

const chipClass = (active: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm font-medium transition ${
    active
      ? "border-slate-900 bg-slate-900 text-white"
      : "border-slate-300 bg-white text-slate-700 hover:border-slate-500"
  }`;

export default function Crm() {
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [today, setToday] = useState<string>(() => todayInIndia());
  const [filter, setFilter] = useState<FilterKey>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ draft: ProjectDraft; isNew: boolean } | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [excelState, setExcelState] = useState<"idle" | "preparing">("idle");
  const [backupState, setBackupState] = useState<"idle" | "preparing">("idle");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refresh the current business day (Asia/Kolkata) while the page is open.
  useEffect(() => {
    const t = setInterval(() => setToday(todayInIndia()), 30_000);
    const onFocus = () => setToday(todayInIndia());
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const notify = useCallback((kind: NoticeState["kind"], text: string) => {
    setNotice({ kind, text });
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), kind === "success" ? 5000 : 12_000);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.message ?? `Could not load projects (HTTP ${res.status}).`);
      }
      setProjects(Array.isArray(body?.projects) ? body.projects : []);
    } catch (err) {
      setLoadError(
        (err as Error).message ||
          "Could not load projects. Check that the database is running and try again."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => summarize(projects, today), [projects, today]);
  const counts = useMemo(() => filterCounts(projects, today), [projects, today]);
  const visible = useMemo(
    () =>
      sortProjects(
        projects.filter(
          (p) => matchesFilter(p, filter, today) && matchesSearch(p, search)
        )
      ),
    [projects, filter, search, today]
  );
  const filtersActive = filter !== "all" || search.trim() !== "";

  function clearFilters() {
    setFilter("all");
    setSearch("");
  }

  // --- Dialog ---------------------------------------------------------------

  function openProject(p: ApiProject) {
    setEditing({ draft: draftFromProject(p), isNew: false });
  }

  async function handleSubmit(input: ProjectInput): Promise<SaveResult> {
    const isNew = editing?.isNew ?? false;
    try {
      const res = await fetch(isNew ? "/api/projects" : `/api/projects/${input.id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (res.status === 401) {
        window.location.assign("/login");
        return { ok: false, message: "Your session expired. Sign in again.", fatal: true };
      }

      const body = await res.json().catch(() => null);

      if (res.ok && body?.project) {
        const project = body.project as ApiProject;
        setProjects((prev) =>
          isNew ? [...prev, project] : prev.map((p) => (p.id === project.id ? project : p))
        );
        setEditing(null);
        notify(
          "success",
          isNew
            ? `Project ${project.number} saved.`
            : `Project ${project.number} updated (version ${project.revision}).`
        );
        return { ok: true };
      }

      if (res.status === 409) {
        void load();
        return {
          ok: false,
          fatal: true,
          message:
            body?.message ??
            "This project was changed in another tab. The register has been reloaded with the latest data.",
        };
      }

      return { ok: false, message: body?.message ?? `Save failed (HTTP ${res.status}).` };
    } catch {
      return {
        ok: false,
        message: "Network error while saving. Your entered values are kept — try again.",
      };
    }
  }

  // --- Export / import --------------------------------------------------------

  async function downloadFile(url: string, fallbackName: string) {
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 401) {
      window.location.assign("/login");
      throw new Error("Your session expired. Sign in again.");
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.message ?? `Export failed (HTTP ${res.status}).`);
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const match = /filename="([^"]+)"/.exec(disposition);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = match?.[1] ?? fallbackName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  async function exportExcel() {
    setExcelState("preparing");
    try {
      await downloadFile("/api/export?format=xlsx", "pct-project-desk.xlsx");
      notify("success", "Excel export downloaded.");
    } catch (err) {
      notify("error", (err as Error).message || "Excel export failed.");
    } finally {
      setExcelState("idle");
    }
  }

  async function downloadBackup() {
    setBackupState("preparing");
    try {
      await downloadFile("/api/export?format=json", "pct-project-desk-backup.json");
      notify("success", "Full JSON backup downloaded. Keep it somewhere safe.");
    } catch (err) {
      notify("error", (err as Error).message || "Backup download failed.");
    } finally {
      setBackupState("idle");
    }
  }

  function openImportPicker() {
    fileInputRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      notify("error", "The selected file is larger than the 20 MB backup limit.");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      notify("error", "The selected file is not valid JSON.");
      return;
    }
    const projectList = (parsed as { projects?: unknown })?.projects;
    if (!Array.isArray(projectList)) {
      notify("error", "This file does not look like a PCT Project Desk backup (missing projects array).");
      return;
    }
    const confirmed = window.confirm(
      `Import ${projectList.length} project record(s) from “${file.name}”?\n\n` +
        "The import replaces nothing: it is only allowed into an EMPTY project register, " +
        "and all records are imported in one transaction or none."
    );
    if (!confirmed) return;
    try {
      const res = await fetch("/api/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      if (res.status === 401) {
        window.location.assign("/login");
        return;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        const details =
          Array.isArray(body?.issues) && body.issues.length > 0
            ? `\n${body.issues
                .slice(0, 6)
                .map((i: { message: string }) => `• ${i.message}`)
                .join("\n")}${body.issues.length > 6 ? "\n…" : ""}`
            : "";
        notify("error", (body?.message ?? `Import failed (HTTP ${res.status}).`) + details);
        return;
      }
      notify(
        "success",
        `Imported ${body?.projects ?? body?.imported} project(s) and ${body?.revisions ?? 0} revision request(s).`
      );
      await load();
    } catch {
      notify("error", "Network error while importing. Nothing was changed.");
    }
  }

  async function signOut() {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } finally {
      window.location.assign("/login");
    }
  }

  // --- Register rendering -----------------------------------------------------

  const registerEmpty = projects.length === 0;

  const tableHeader = (
    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
      <tr>
        <th scope="col" className="px-2 py-2">PCT no.</th>
        <th scope="col" className="px-2 py-2">Title</th>
        <th scope="col" className="px-2 py-2">Student</th>
        <th scope="col" className="px-2 py-2">University</th>
        <th scope="col" className="px-2 py-2">Writer</th>
        <th scope="col" className="px-2 py-2">Submission</th>
        <th scope="col" className="px-2 py-2">Status</th>
        <th scope="col" className="px-2 py-2">Progress</th>
        <th scope="col" className="px-2 py-2">Pending work</th>
        <th scope="col" className="px-2 py-2">Revisions</th>
        <th scope="col" className="px-2 py-2">Student (bal / fee)</th>
        <th scope="col" className="px-2 py-2">Writer (bal / fee)</th>
        <th scope="col" className="px-2 py-2"><span className="sr-only">Actions</span></th>
      </tr>
    </thead>
  );

  function revisionCell(p: ApiProject) {
    const open = openRevisionCount(p);
    if (open === 0 && p.revisions.length === 0) return <span className="text-slate-400">—</span>;
    const attention = revisionNeedsAttention(p, today);
    return (
      <div className="flex flex-col gap-0.5">
        <span
          className={`inline-block w-fit rounded px-1.5 py-0.5 text-xs font-semibold ${
            open > 0 ? "bg-indigo-100 text-indigo-900" : "bg-emerald-100 text-emerald-900"
          }`}
        >
          {open} open
        </span>
        {attention ? (
          <span className="text-xs font-medium text-red-700">Overdue / due today</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-3 py-4 sm:px-6 sm:py-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">PCT Project Desk</h1>
          <p className="text-sm text-slate-500">
            Today in India: <strong>{today}</strong> · {summary.active} active project
            {summary.active === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => void exportExcel()}
            disabled={excelState === "preparing" || registerEmpty}
            title={registerEmpty ? "Nothing to export yet" : "Export every saved project to Excel"}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {excelState === "preparing" ? "Preparing Excel…" : "Export Excel"}
          </button>
          <button
            type="button"
            onClick={() => void downloadBackup()}
            disabled={backupState === "preparing" || registerEmpty}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {backupState === "preparing" ? "Preparing backup…" : "Download full backup"}
          </button>
          <button
            type="button"
            onClick={openImportPicker}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Import JSON backup
          </button>
          <button
            type="button"
            onClick={() => void signOut()}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Sign out
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => void handleImportFile(e)}
            aria-label="Select a JSON backup file to import"
          />
        </div>
      </header>

      {notice ? (
        <Notice kind={notice.kind} text={notice.text} onDismiss={() => setNotice(null)} />
      ) : null}

      {/* Dashboard summary cards */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryCard
          label="Active projects"
          value={String(summary.active)}
          hint="Not yet delivered"
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <SummaryCard
          label="Due in 2 days"
          value={String(summary.dueSoon)}
          hint="Today, tomorrow or next day"
          active={filter === "due2"}
          onClick={() => setFilter("due2")}
        />
        <SummaryCard
          label="Overdue"
          value={String(summary.overdue)}
          hint="Past submission date"
          active={filter === "overdue"}
          onClick={() => setFilter("overdue")}
          tone={summary.overdue > 0 ? "danger" : "normal"}
        />
        <SummaryCard
          label="Payment pending"
          value={formatINR(summary.paymentPendingTotal)}
          sub={`${summary.paymentPendingCount} project${summary.paymentPendingCount === 1 ? "" : "s"} owing`}
          active={filter === "payment"}
          onClick={() => setFilter("payment")}
        />
        <SummaryCard
          label="Writer payments pending"
          value={formatINR(summary.writerPendingTotal)}
          sub={`${summary.writerPendingCount} project${summary.writerPendingCount === 1 ? "" : "s"}`}
          active={filter === "writer"}
          onClick={() => setFilter("writer")}
        />
        <SummaryCard
          label="Open revisions"
          value={String(summary.openRevisions)}
          sub={`${summary.projectsWithOpenRevisions} project${summary.projectsWithOpenRevisions === 1 ? "" : "s"}`}
          active={filter === "revisions"}
          onClick={() => setFilter("revisions")}
        />
      </div>

      {/* Filters + search */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTER_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={chipClass(filter === key)}
          >
            {FILTER_LABELS[key]}{" "}
            <span className={filter === key ? "text-white/80" : "text-slate-500"}>
              {counts[key]}
            </span>
          </button>
        ))}
        {filtersActive ? (
          <button
            type="button"
            onClick={clearFilters}
            className="rounded-full border border-transparent px-3 py-1.5 text-sm font-medium text-slate-600 underline hover:text-slate-900"
          >
            Clear filters
          </button>
        ) : null}
        <div className="ml-auto w-full sm:w-72">
          <label htmlFor="register-search" className="sr-only">
            Search projects
          </label>
          <input
            id="register-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search PCT no., student, writer, phone, university, title…"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          />
        </div>
      </div>

      {/* Register */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <Skeleton rows={6} />
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-red-200 bg-white p-6 text-center">
          <p role="alert" className="mb-3 text-sm font-medium text-red-800">
            {loadError}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Try again
          </button>
        </div>
      ) : registerEmpty ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <h2 className="text-lg font-semibold text-slate-900">No projects yet</h2>
          <p className="mx-auto mt-1 max-w-prose text-sm text-slate-600">
            Click <strong>New project</strong> to add your first PCT record, or restore a previous
            register from a JSON backup.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => setEditing({ draft: newProjectDraft(today), isNew: true })}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              New project
            </button>
            <button
              type="button"
              onClick={openImportPicker}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Import JSON backup
            </button>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-700">
            No projects match the current search and filters.
          </p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-3 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          {/* Desktop register */}
          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
            <table className="w-full text-sm">
              {tableHeader}
              <tbody className="divide-y divide-slate-100">
                {visible.map((p) => {
                  const sb = studentBalance(p);
                  const wb = writerBalance(p);
                  return (
                    <tr key={p.id} className="align-top hover:bg-slate-50">
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => openProject(p)}
                          className="font-semibold text-slate-900 underline decoration-slate-300 underline-offset-2 hover:decoration-slate-700"
                        >
                          {p.number}
                        </button>
                      </td>
                      <td className="max-w-[16rem] px-2 py-2 text-slate-800">
                        <div className="line-clamp-2" title={p.title}>
                          {p.title}
                        </div>
                        <div className="text-xs text-slate-500">
                          {p.words.toLocaleString("en-IN")} words
                        </div>
                      </td>
                      <td className="px-2 py-2 text-slate-800">
                        {p.student}
                        {p.phone ? (
                          <div className="text-xs text-slate-500" title="Phone">
                            {p.phone}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-slate-800">{p.university || "—"}</td>
                      <td className="px-2 py-2 text-slate-800">{p.writer || "—"}</td>
                      <td className="whitespace-nowrap px-2 py-2">
                        <div className="text-slate-800">{p.due}</div>
                        <DeadlineBadge due={p.due} status={p.status} today={today} />
                      </td>
                      <td className="px-2 py-2">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                            STATUS_BADGE[p.status] ?? "bg-slate-100 text-slate-800"
                          }`}
                        >
                          {p.status}
                        </span>
                      </td>
                      <td className="min-w-[7rem] px-2 py-2">
                        <ProgressBar percent={p.percent} />
                        <div className="text-xs font-semibold text-slate-700">{p.percent}%</div>
                      </td>
                      <td className="max-w-[14rem] px-2 py-2 text-slate-700">
                        {p.pending.trim() ? (
                          <div className="line-clamp-2 whitespace-pre-line" title={p.pending}>
                            {p.pending}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2">{revisionCell(p)}</td>
                      <td className="whitespace-nowrap px-2 py-2">
                        <div
                          className={`font-semibold ${
                            sb > 0 ? "text-amber-800" : "text-emerald-700"
                          }`}
                        >
                          {formatINR(sb)}
                        </div>
                        <div className="text-xs text-slate-500">of {formatINR(p.total)}</div>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2">
                        {p.writer || p.writerTotal > 0 ? (
                          <>
                            <div
                              className={`font-semibold ${
                                wb > 0 ? "text-amber-800" : "text-emerald-700"
                              }`}
                            >
                              {formatINR(wb)}
                            </div>
                            <div className="text-xs text-slate-500">of {formatINR(p.writerTotal)}</div>
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => openProject(p)}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          Open record
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile register */}
          <ul className="space-y-3 md:hidden">
            {visible.map((p) => {
              const sb = studentBalance(p);
              const wb = writerBalance(p);
              const attention = revisionNeedsAttention(p, today);
              return (
                <li key={p.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <button
                        type="button"
                        onClick={() => openProject(p)}
                        className="text-base font-bold text-slate-900 underline decoration-slate-300 underline-offset-2"
                      >
                        {p.number}
                      </button>
                      <div className="text-sm text-slate-800">{p.title}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openProject(p)}
                      className="shrink-0 rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Open
                    </button>
                  </div>
                  <div className="mt-1 text-sm text-slate-700">
                    {p.student}
                    {p.phone ? <span className="text-slate-500"> · {p.phone}</span> : null}
                  </div>
                  {p.university || p.writer ? (
                    <div className="text-xs text-slate-500">
                      {[p.university, p.writer].filter(Boolean).join(" · ")}
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded px-1.5 py-0.5 font-medium ${STATUS_BADGE[p.status] ?? ""}`}>
                      {p.status}
                    </span>
                    <DeadlineBadge due={p.due} status={p.status} today={today} />
                    <span className="text-slate-500">Due {p.due}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-semibold ${
                        openRevisionCount(p) > 0
                          ? "bg-indigo-100 text-indigo-900"
                          : "bg-emerald-100 text-emerald-900"
                      }`}
                    >
                      {openRevisionCount(p)} open revisions
                    </span>
                    {attention ? (
                      <span className="font-medium text-red-700">Overdue / due today</span>
                    ) : null}
                  </div>
                  <div className="mt-2">
                    <ProgressBar percent={p.percent} />
                    <div className="text-xs font-semibold text-slate-700">{p.percent}%</div>
                  </div>
                  {p.pending.trim() ? (
                    <div className="mt-2 whitespace-pre-line text-sm text-slate-700">
                      <span className="text-xs font-semibold uppercase text-slate-500">
                        Pending work
                      </span>
                      <div className="line-clamp-3">{p.pending}</div>
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-3 text-sm">
                    <span>
                      Student:{" "}
                      <strong className={sb > 0 ? "text-amber-800" : "text-emerald-700"}>
                        {formatINR(sb)}
                      </strong>{" "}
                      <span className="text-xs text-slate-500">of {formatINR(p.total)}</span>
                    </span>
                    {p.writer || p.writerTotal > 0 ? (
                      <span>
                        Writer:{" "}
                        <strong className={wb > 0 ? "text-amber-800" : "text-emerald-700"}>
                          {formatINR(wb)}
                        </strong>{" "}
                        <span className="text-xs text-slate-500">of {formatINR(p.writerTotal)}</span>
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>
              Showing {visible.length} of {projects.length} project
              {projects.length === 1 ? "" : "s"}
              {filter !== "all" ? ` · filter: ${FILTER_LABELS[filter]}` : ""}
            </span>
            <button
              type="button"
              onClick={() => setEditing({ draft: newProjectDraft(today), isNew: true })}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 md:hidden"
            >
              New project
            </button>
          </div>
        </>
      )}

      {/* Floating New project button on desktop */}
      {!registerEmpty && !editing ? (
        <button
          type="button"
          onClick={() => setEditing({ draft: newProjectDraft(today), isNew: true })}
          className="fixed bottom-6 right-6 hidden rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg hover:bg-emerald-700 md:block"
        >
          + New project
        </button>
      ) : null}

      {editing ? (
        <ProjectDialog
          draft={editing.draft}
          isNew={editing.isNew}
          today={today}
          onCancel={() => setEditing(null)}
          onSubmit={handleSubmit}
        />
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  hint,
  active,
  onClick,
  tone = "normal",
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
  tone?: "normal" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border p-3 text-left transition hover:border-slate-400 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
        active ? "border-slate-900 bg-white ring-1 ring-slate-900" : "border-slate-200 bg-white"
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={`mt-0.5 text-xl font-bold ${
          tone === "danger" && value !== "0" ? "text-red-700" : "text-slate-900"
        }`}
      >
        {value}
      </div>
      {sub ? <div className="text-xs text-slate-500">{sub}</div> : null}
      {hint ? <div className="text-xs text-slate-400">{hint}</div> : null}
    </button>
  );
}
