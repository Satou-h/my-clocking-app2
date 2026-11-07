/**
 * submissions.ts — 書類の提出状況（データベースの monthly_submissions。月×書類ごとに1行）
 *
 * ・提出・取り下げ・読み込みは cloudSync.ts が行い、結果をここに置く（端末には保存しない）
 * ・提出済み・承認済みの書類は、取り下げるまでその月のデータを変更できない
 *   （データベースでも書き込みを拒否する。画面ではこの状況を見て、保存する前に取り消す）
 */
import { useSyncExternalStore } from 'react';
import { DOC_LABELS, isDocKey, type DocKey } from '../types/document';

export type SubmissionStatus = 'submitted' | 'approved' | 'rejected';

export const SUBMISSION_LABELS: Record<SubmissionStatus, string> = {
  submitted: '提出済み',
  approved: '承認済み',
  rejected: '差し戻し',
};

export interface Submission {
  year: number;
  month: number;
  doc: DocKey;
  status: SubmissionStatus;
  submittedAt: string;
  reviewedAt: string | null;
  reviewComment: string;
  // 提出後に上長・管理者が修正した日時と、修正した人の名前（修正していなければ null・空）
  modifiedAt: string | null;
  modifiedByName: string;
}

export interface SubmissionState {
  items: Submission[];
  // データベースから読み込めたか
  loaded: boolean;
  // 読み込めなかったときの説明
  error: string | null;
}

const INITIAL: SubmissionState = { items: [], loaded: false, error: null };
let state: SubmissionState = INITIAL;
const listeners = new Set<() => void>();

function update(next: SubmissionState) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getSubmissionState(): SubmissionState {
  return state;
}

export function useSubmissions(): SubmissionState {
  return useSyncExternalStore(subscribe, getSubmissionState);
}

export function setSubmissions(items: Submission[]): void {
  update({ items, loaded: true, error: null });
}

// 読み込めなかったときは、前に読み込んだ内容を残したまま説明だけを変える
export function setSubmissionsError(error: string): void {
  update({ ...state, error });
}

export function clearSubmissions(): void {
  update(INITIAL);
}

const STATUSES: SubmissionStatus[] = ['submitted', 'approved', 'rejected'];

export function parseSubmission(row: Record<string, unknown>): Submission | null {
  const status = STATUSES.find((s) => s === row.status);
  if (!isDocKey(row.doc) || !status) return null;
  return {
    year: Number(row.year),
    month: Number(row.month),
    doc: row.doc,
    status,
    submittedAt: typeof row.submitted_at === 'string' ? row.submitted_at : '',
    reviewedAt: typeof row.reviewed_at === 'string' ? row.reviewed_at : null,
    reviewComment: typeof row.review_comment === 'string' ? row.review_comment : '',
    modifiedAt: typeof row.modified_at === 'string' ? row.modified_at : null,
    modifiedByName: typeof row.modified_by_name === 'string' ? row.modified_by_name : '',
  };
}

export function findSubmission(items: Submission[], doc: DocKey, year: number, month: number): Submission | undefined {
  return items.find((s) => s.doc === doc && s.year === year && s.month === month);
}

// 提出済み・承認済みの書類は変更できない（差し戻された書類は直して出し直せる）
export function isLockedStatus(status: SubmissionStatus | undefined): boolean {
  return status === 'submitted' || status === 'approved';
}

export function isDocLocked(doc: DocKey, year: number, month: number, items: Submission[] = state.items): boolean {
  return isLockedStatus(findSubmission(items, doc, year, month)?.status);
}

export function periodLabel(doc: DocKey, year: number, month: number): string {
  return `${year}年${month}月の${DOC_LABELS[doc]}`;
}

// 提出・承認の日時の表示（例: 11月30日 18:05）
export function fmtSubmittedAt(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`;
}
