import type { ProjectStatus, RevisionStatus } from "./project";

/** Revision shape returned by the API (dates are 'YYYY-MM-DD' strings). */
export interface ApiRevision {
  id: string;
  description: string;
  requested: string;
  due: string;
  status: RevisionStatus;
  notes: string;
}

/** Project shape returned by the API. */
export interface ApiProject {
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
  status: ProjectStatus;
  percent: number;
  pending: string;
  notes: string;
  total: number;
  paid: number;
  writerTotal: number;
  writerPaid: number;
  revisions: ApiRevision[];
}

export const FILTER_KEYS = [
  "all",
  "due2",
  "overdue",
  "pending",
  "completed",
  "payment",
  "writer",
  "revisions",
] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export interface RestoreResult {
  imported: number;
  projects: number;
  revisions: number;
}
