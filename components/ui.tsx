"use client";

import React from "react";
import { daysBetween, isValidDate, deadlineLabel } from "@/lib/dates";

export function ProgressBar({ percent }: { percent: number }) {
  const value = Math.max(0, Math.min(100, Math.round(percent || 0)));
  return (
    <div
      className="pct-progress"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Completion ${value}%`}
    >
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

export function Notice({
  kind,
  text,
  onDismiss,
}: {
  kind: "success" | "error" | "info";
  text: string;
  onDismiss?: () => void;
}) {
  const styles: Record<string, string> = {
    success: "border-emerald-300 bg-emerald-50 text-emerald-900",
    error: "border-red-300 bg-red-50 text-red-900",
    info: "border-sky-300 bg-sky-50 text-sky-900",
  };
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`mb-3 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${styles[kind]}`}
    >
      <span className="whitespace-pre-line">{text}</span>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="rounded px-1 text-xs font-semibold opacity-70 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          aria-label="Dismiss notification"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="animate-pulse space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 rounded bg-slate-200" />
      ))}
    </div>
  );
}

/** Deadline badge classes by urgency. */
export function deadlineClasses(label: string | null): string {
  if (!label) return "bg-slate-100 text-slate-700";
  if (label === "Delivered") return "bg-slate-200 text-slate-700";
  if (label === "Due today" || label === "Due tomorrow") return "bg-amber-100 text-amber-900";
  if (label.includes("overdue")) return "bg-red-100 text-red-800";
  return "bg-sky-100 text-sky-900";
}

export function DeadlineBadge({
  due,
  status,
  today,
}: {
  due: string;
  status: string;
  today: string;
}) {
  const label = deadlineLabel(due, status, today);
  if (!label) return null;
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${deadlineClasses(label)}`}>
      {label}
    </span>
  );
}

/** Label for a revision request relative to today. */
export function revisionLabel(
  status: string,
  due: string,
  today: string
): { label: string; className: string } {
  if (status === "Completed") {
    return { label: "Completed", className: "bg-emerald-100 text-emerald-900" };
  }
  if (!isValidDate(due) || !isValidDate(today)) {
    return { label: "No deadline", className: "bg-slate-100 text-slate-700" };
  }
  const diff = daysBetween(today, due);
  if (diff < 0) {
    return {
      label: diff === -1 ? "Overdue by 1 day" : `Overdue by ${Math.abs(diff)} days`,
      className: "bg-red-100 text-red-800",
    };
  }
  if (diff === 0) return { label: "Due today", className: "bg-amber-100 text-amber-900" };
  if (diff === 1) return { label: "Due tomorrow", className: "bg-amber-100 text-amber-900" };
  return { label: `Due in ${diff} days`, className: "bg-sky-100 text-sky-900" };
}

export function Field({
  label,
  htmlFor,
  error,
  children,
  hint,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
