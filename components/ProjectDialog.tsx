"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_MONEY,
  MAX_REVISIONS,
  MAX_WORDS,
  PROJECT_STATUSES,
  REVISION_STATUSES,
  ValidationError,
  autoPercentForStatus,
  validateProject,
  type ProjectInput,
  type ProjectStatus,
  type RevisionStatus,
} from "@/lib/project";
import type { ApiProject } from "@/lib/types";
import { formatINR } from "@/lib/format";
import { Field, ProgressBar, revisionLabel } from "./ui";

/** Editable form state: numeric fields stay strings for pleasant typing. */
export interface ProjectDraft {
  id: string;
  revision: number;
  number: string;
  title: string;
  student: string;
  phone: string;
  university: string;
  writer: string;
  words: string;
  received: string;
  due: string;
  status: ProjectStatus;
  percent: string;
  pending: string;
  notes: string;
  total: string;
  paid: string;
  writerTotal: string;
  writerPaid: string;
  revisions: {
    id: string;
    description: string;
    requested: string;
    due: string;
    status: RevisionStatus;
    notes: string;
  }[];
}

export function newProjectDraft(today: string): ProjectDraft {
  return {
    id: crypto.randomUUID(),
    revision: 1,
    number: "",
    title: "",
    student: "",
    phone: "",
    university: "",
    writer: "",
    words: "0",
    received: today,
    due: today,
    status: "Not started",
    percent: "0",
    pending: "",
    notes: "",
    total: "0",
    paid: "0",
    writerTotal: "0",
    writerPaid: "0",
    revisions: [],
  };
}

export function draftFromProject(p: ApiProject): ProjectDraft {
  return {
    id: p.id,
    revision: p.revision,
    number: p.number,
    title: p.title,
    student: p.student,
    phone: p.phone,
    university: p.university,
    writer: p.writer,
    words: String(p.words ?? 0),
    received: p.received,
    due: p.due,
    status: p.status,
    percent: String(p.percent ?? 0),
    pending: p.pending ?? "",
    notes: p.notes ?? "",
    total: String(p.total ?? 0),
    paid: String(p.paid ?? 0),
    writerTotal: String(p.writerTotal ?? 0),
    writerPaid: String(p.writerPaid ?? 0),
    revisions: (p.revisions ?? []).map((r) => ({ ...r })),
  };
}

/** Converts a draft to the validated payload shape (raw values, strings). */
export function draftToRaw(draft: ProjectDraft): Record<string, unknown> {
  return {
    id: draft.id,
    revision: draft.revision,
    number: draft.number,
    title: draft.title,
    student: draft.student,
    phone: draft.phone,
    university: draft.university,
    writer: draft.writer,
    words: draft.words === "" ? 0 : draft.words,
    received: draft.received,
    due: draft.due,
    status: draft.status,
    percent: draft.percent === "" ? 0 : draft.percent,
    pending: draft.pending,
    notes: draft.notes,
    total: draft.total === "" ? 0 : draft.total,
    paid: draft.paid === "" ? 0 : draft.paid,
    writerTotal: draft.writerTotal === "" ? 0 : draft.writerTotal,
    writerPaid: draft.writerPaid === "" ? 0 : draft.writerPaid,
    revisions: draft.revisions,
  };
}

export interface SaveResult {
  ok: boolean;
  message?: string;
  fatal?: boolean; // stale conflict: the register must be reloaded
}

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:bg-slate-100";

function num(value: string): number {
  const n = Number(value === "" ? 0 : value);
  return Number.isFinite(n) ? n : 0;
}

export default function ProjectDialog({
  draft: initialDraft,
  today,
  isNew,
  onCancel,
  onSubmit,
  onDirtyChange,
}: {
  draft: ProjectDraft;
  today: string;
  isNew: boolean;
  onCancel: () => void;
  onSubmit: (input: ProjectInput) => Promise<SaveResult>;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<ProjectDraft>(initialDraft);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  function update(patch: Partial<ProjectDraft>) {
    dirtyRef.current = true;
    onDirtyChange?.(true);
    setDraft((d) => ({ ...d, ...patch }));
    // Clear errors for the touched fields.
    setFieldErrors((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(patch)) delete next[key];
      return next;
    });
  }

  function updateRevision(index: number, patch: Partial<ProjectDraft["revisions"][number]>) {
    setDraft((d) => {
      const revisions = d.revisions.map((r, i) => (i === index ? { ...r, ...patch } : r));
      return { ...d, revisions };
    });
    dirtyRef.current = true;
    onDirtyChange?.(true);
  }

  function addRevision() {
    if (draft.revisions.length >= MAX_REVISIONS) return;
    update({
      revisions: [
        ...draft.revisions,
        {
          id: crypto.randomUUID(),
          description: "",
          requested: today,
          due: today,
          status: "Requested",
          notes: "",
        },
      ],
    });
  }

  function removeRevision(index: number) {
    update({ revisions: draft.revisions.filter((_, i) => i !== index) });
  }

  function changeStatus(status: ProjectStatus) {
    update({ status, percent: String(autoPercentForStatus(status, num(draft.percent))) });
  }

  const balances = useMemo(() => {
    const student = num(draft.total) - num(draft.paid);
    const writer = num(draft.writerTotal) - num(draft.writerPaid);
    return { student, writer };
  }, [draft.total, draft.paid, draft.writerTotal, draft.writerPaid]);

  async function handleSave() {
    setErrorMsg(null);
    setFieldErrors({});
    let input: ProjectInput;
    try {
      input = validateProject(draftToRaw(draft));
    } catch (err) {
      if (err instanceof ValidationError) {
        const errors: Record<string, string> = {};
        for (const issue of err.issues) {
          if (!errors[issue.path]) errors[issue.path] = issue.message;
        }
        setFieldErrors(errors);
        setErrorMsg(
          `Please correct ${err.issues.length} field${err.issues.length === 1 ? "" : "s"} before saving.`
        );
      } else {
        setErrorMsg((err as Error).message);
      }
      return;
    }

    setSaving(true);
    try {
      const result = await onSubmit(input);
      if (!result.ok) {
        if (result.fatal) {
          setErrorMsg(result.message ?? "The project was changed elsewhere. Reload the register.");
        } else if (result.message) {
          setErrorMsg(result.message);
        }
        if ((result as { issues?: unknown }).issues) {
          setErrorMsg(result.message ?? "The server rejected the project data.");
        }
      }
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, saving]);

  const err = (key: string) => fieldErrors[key];

  const quarter = "grid gap-3 sm:grid-cols-2 lg:grid-cols-4";

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-2 sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-dialog-title"
        className="my-4 w-full max-w-5xl rounded-xl bg-white shadow-2xl"
      >
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 id="project-dialog-title" className="text-lg font-semibold text-slate-900">
              {isNew ? "New project" : `Project ${draft.number || ""}`}
            </h2>
            <p className="text-xs text-slate-500">
              {isNew
                ? "Enter the PCT / project number you received in the WhatsApp group."
                : `Record version ${draft.revision} · editing increments it on save`}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Close
          </button>
        </header>

        <div className="space-y-6 px-4 py-4">
          {errorMsg ? (
            <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {errorMsg}
            </p>
          ) : null}

          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              PCT details
            </h3>
            <div className={quarter}>
              <Field label="PCT / project number *" htmlFor="f-number" error={err("number")}>
                <input
                  ref={firstFieldRef}
                  id="f-number"
                  className={inputClass}
                  value={draft.number}
                  onChange={(e) => update({ number: e.target.value })}
                  maxLength={50}
                  aria-invalid={Boolean(err("number"))}
                  placeholder="e.g. PCT-1024"
                />
              </Field>
              <Field label="Project title *" htmlFor="f-title" error={err("title")}>
                <input
                  id="f-title"
                  className={inputClass}
                  value={draft.title}
                  onChange={(e) => update({ title: e.target.value })}
                  maxLength={300}
                  aria-invalid={Boolean(err("title"))}
                />
              </Field>
              <Field label="Student name *" htmlFor="f-student" error={err("student")}>
                <input
                  id="f-student"
                  className={inputClass}
                  value={draft.student}
                  onChange={(e) => update({ student: e.target.value })}
                  maxLength={200}
                  aria-invalid={Boolean(err("student"))}
                />
              </Field>
              <Field label="Student phone" htmlFor="f-phone" error={err("phone")} hint="Kept as text (leading zeros and country codes are preserved)">
                <input
                  id="f-phone"
                  className={inputClass}
                  value={draft.phone}
                  onChange={(e) => update({ phone: e.target.value })}
                  maxLength={50}
                  inputMode="tel"
                />
              </Field>
              <Field label="University" htmlFor="f-university" error={err("university")}>
                <input
                  id="f-university"
                  className={inputClass}
                  value={draft.university}
                  onChange={(e) => update({ university: e.target.value })}
                  maxLength={200}
                />
              </Field>
              <Field label="Writer" htmlFor="f-writer" error={err("writer")} hint="Assigned writer (editable)">
                <input
                  id="f-writer"
                  className={inputClass}
                  value={draft.writer}
                  onChange={(e) => update({ writer: e.target.value })}
                  maxLength={200}
                />
              </Field>
              <Field label="Word count" htmlFor="f-words" error={err("words")}>
                <input
                  id="f-words"
                  className={inputClass}
                  type="number"
                  min={0}
                  max={MAX_WORDS}
                  step={1}
                  value={draft.words}
                  onChange={(e) => update({ words: e.target.value })}
                  aria-invalid={Boolean(err("words"))}
                />
              </Field>
              <Field label="Status" htmlFor="f-status" error={err("status")}>
                <select
                  id="f-status"
                  className={inputClass}
                  value={draft.status}
                  onChange={(e) => changeStatus(e.target.value as ProjectStatus)}
                >
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Date received" htmlFor="f-received" error={err("received")}>
                <input
                  id="f-received"
                  className={inputClass}
                  type="date"
                  value={draft.received}
                  onChange={(e) => update({ received: e.target.value })}
                  aria-invalid={Boolean(err("received"))}
                />
              </Field>
              <Field label="Submission date" htmlFor="f-due" error={err("due")}>
                <input
                  id="f-due"
                  className={inputClass}
                  type="date"
                  value={draft.due}
                  onChange={(e) => update({ due: e.target.value })}
                  aria-invalid={Boolean(err("due"))}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field
                  label="Completion %"
                  htmlFor="f-percent"
                  error={err("percent")}
                  hint="Completed and Delivered are automatically set to 100%."
                >
                  <div className="flex items-center gap-3">
                    <input
                      id="f-percent"
                      className={`${inputClass} max-w-[8rem]`}
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={draft.percent}
                      onChange={(e) => update({ percent: e.target.value })}
                      aria-invalid={Boolean(err("percent"))}
                    />
                    <div className="flex-1">
                      <ProgressBar percent={num(draft.percent)} />
                    </div>
                    <span className="w-12 text-right text-sm font-semibold text-slate-700">
                      {Math.max(0, Math.min(100, Math.round(num(draft.percent))))}%
                    </span>
                  </div>
                </Field>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Pending work" htmlFor="f-pending" error={err("pending")} hint="Multiline — one item per line is fine">
                <textarea
                  id="f-pending"
                  className={`${inputClass} min-h-[90px]`}
                  value={draft.pending}
                  onChange={(e) => update({ pending: e.target.value })}
                  maxLength={10000}
                />
              </Field>
              <Field
                label="Instructions / notes"
                htmlFor="f-notes"
                error={err("notes")}
                hint="Brief, requirements and other project details"
              >
                <textarea
                  id="f-notes"
                  className={`${inputClass} min-h-[90px]`}
                  value={draft.notes}
                  onChange={(e) => update({ notes: e.target.value })}
                  maxLength={20000}
                />
              </Field>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 p-3">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Student payment
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Student fee (INR)" htmlFor="f-total" error={err("total")}>
                  <input
                    id="f-total"
                    className={inputClass}
                    type="number"
                    min={0}
                    max={MAX_MONEY}
                    step="0.01"
                    value={draft.total}
                    onChange={(e) => update({ total: e.target.value })}
                    aria-invalid={Boolean(err("total"))}
                  />
                </Field>
                <Field label="Student paid (INR)" htmlFor="f-paid" error={err("paid")}>
                  <input
                    id="f-paid"
                    className={inputClass}
                    type="number"
                    min={0}
                    max={MAX_MONEY}
                    step="0.01"
                    value={draft.paid}
                    onChange={(e) => update({ paid: e.target.value })}
                    aria-invalid={Boolean(err("paid"))}
                  />
                </Field>
              </div>
              <p className="mt-2 text-sm text-slate-700">
                Remaining student payment:{" "}
                <strong className={balances.student > 0 ? "text-amber-800" : "text-emerald-700"}>
                  {formatINR(balances.student)}
                </strong>
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 p-3">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Writer payment
              </h3>
              <p className="mb-2 text-xs text-slate-500">
                Writer: <strong className="text-slate-700">{draft.writer.trim() || "not assigned"}</strong>
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Writer fee (INR)" htmlFor="f-writerTotal" error={err("writerTotal")}>
                  <input
                    id="f-writerTotal"
                    className={inputClass}
                    type="number"
                    min={0}
                    max={MAX_MONEY}
                    step="0.01"
                    value={draft.writerTotal}
                    onChange={(e) => update({ writerTotal: e.target.value })}
                    aria-invalid={Boolean(err("writerTotal"))}
                  />
                </Field>
                <Field label="Writer paid (INR)" htmlFor="f-writerPaid" error={err("writerPaid")}>
                  <input
                    id="f-writerPaid"
                    className={inputClass}
                    type="number"
                    min={0}
                    max={MAX_MONEY}
                    step="0.01"
                    value={draft.writerPaid}
                    onChange={(e) => update({ writerPaid: e.target.value })}
                    aria-invalid={Boolean(err("writerPaid"))}
                  />
                </Field>
              </div>
              <p className="mt-2 text-sm text-slate-700">
                Remaining writer payment:{" "}
                <strong className={balances.writer > 0 ? "text-amber-800" : "text-emerald-700"}>
                  {formatINR(balances.writer)}
                </strong>
              </p>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Revision requests ({draft.revisions.length}/{MAX_REVISIONS})
              </h3>
              <button
                type="button"
                onClick={addRevision}
                disabled={draft.revisions.length >= MAX_REVISIONS}
                className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add revision request
              </button>
            </div>

            {draft.revisions.length === 0 ? (
              <p className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
                No revision requests. Completed project work is not automatically completed here —
                close each request explicitly.
              </p>
            ) : (
              <ol className="space-y-3">
                {draft.revisions.map((r, i) => {
                  const label = revisionLabel(r.status, r.due, today);
                  return (
                    <li key={r.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-800">
                            Revision {i + 1}
                          </span>
                          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${label.className}`}>
                            {label.label}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeRevision(i)}
                          className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Remove revision
                        </button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field
                          label="Date requested"
                          htmlFor={`r-${i}-requested`}
                          error={err(`revisions.${i}.requested`)}
                        >
                          <input
                            id={`r-${i}-requested`}
                            className={inputClass}
                            type="date"
                            value={r.requested}
                            onChange={(e) => updateRevision(i, { requested: e.target.value })}
                          />
                        </Field>
                        <Field label="Deadline" htmlFor={`r-${i}-due`} error={err(`revisions.${i}.due`)}>
                          <input
                            id={`r-${i}-due`}
                            className={inputClass}
                            type="date"
                            value={r.due}
                            onChange={(e) => updateRevision(i, { due: e.target.value })}
                          />
                        </Field>
                        <Field label="Status" htmlFor={`r-${i}-status`} error={err(`revisions.${i}.status`)}>
                          <select
                            id={`r-${i}-status`}
                            className={inputClass}
                            value={r.status}
                            onChange={(e) =>
                              updateRevision(i, { status: e.target.value as RevisionStatus })
                            }
                          >
                            {REVISION_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <Field
                          label="Requested changes *"
                          htmlFor={`r-${i}-description`}
                          error={err(`revisions.${i}.description`)}
                        >
                          <textarea
                            id={`r-${i}-description`}
                            className={`${inputClass} min-h-[70px]`}
                            value={r.description}
                            onChange={(e) => updateRevision(i, { description: e.target.value })}
                            maxLength={5000}
                            aria-invalid={Boolean(err(`revisions.${i}.description`))}
                          />
                        </Field>
                        <Field label="Revision notes" htmlFor={`r-${i}-notes`} error={err(`revisions.${i}.notes`)}>
                          <textarea
                            id={`r-${i}-notes`}
                            className={`${inputClass} min-h-[70px]`}
                            value={r.notes}
                            onChange={(e) => updateRevision(i, { notes: e.target.value })}
                            maxLength={10000}
                          />
                        </Field>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save project"}
          </button>
        </footer>
      </div>
    </div>
  );
}
