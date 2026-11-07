import type { AttendanceRecord, WorkSettings } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import type { DocKey } from '../types/document';
import { loadLeaveApplications, loadLateEarlyApplications } from './storage';
import { checkMonthCompleteness, type DocCompleteness } from './completeness';
import { loadAllWeeks, hasContent } from './workReport';
import { SUBMISSION_LABELS, findSubmission, isLockedStatus, type Submission } from './submissions';

export interface SubmitItem {
  label: string;
  done: boolean;
  detail: string;
}

// 月末に提出する書類ごとの入力状況（画面の「月末の提出まで」とメニューの未対応件数に使う）。
// 月の途中でも使うため、勤務表・交通費の未入力日は今日までの日付だけを数える。
// 提出済み・承認済みの書類は対応済みとして数える。
export function getSubmitStatus(
  year: number,
  month: number,
  records: AttendanceRecord[],
  transportRecords: TransportRecord[],
  workSettings: WorkSettings,
  today: string,
  submissions: Submission[] = [],
): SubmitItem[] {
  const c = checkMonthCompleteness(
    year, month, records, transportRecords,
    loadLeaveApplications(), loadLateEarlyApplications(), workSettings,
  );

  const submitted = (doc: DocKey, label: string): SubmitItem | null => {
    const s = findSubmission(submissions, doc, year, month);
    return s && isLockedStatus(s.status) ? { label, done: true, detail: SUBMISSION_LABELS[s.status] } : null;
  };

  const datedItem = (doc: DocKey, label: string, d: DocCompleteness): SubmitItem => {
    const sent = submitted(doc, label);
    if (sent) return sent;
    const missing = d.missingDates.filter((date) => date <= today).length;
    if (missing > 0) return { label, done: false, detail: `${missing}日未入力` };
    if (d.issues.length > 0 || d.extraDates.length > 0) return { label, done: false, detail: '要確認' };
    return { label, done: true, detail: 'OK' };
  };

  const applicationItem = (doc: DocKey, label: string, d: DocCompleteness): SubmitItem | null => {
    const sent = submitted(doc, label);
    if (sent) return sent;
    if (!d.required) return null;
    if (d.complete) return { label, done: true, detail: 'OK' };
    const missing = d.missingDates.length;
    return { label, done: false, detail: missing > 0 ? `${missing}日分 未作成` : '要確認' };
  };

  const reportItem = (): SubmitItem => {
    const sent = submitted('workReport', '作業報告');
    if (sent) return sent;
    const reportDone = loadAllWeeks(year, month).some(hasContent);
    return { label: '作業報告', done: reportDone, detail: reportDone ? 'OK' : '未入力' };
  };

  return [
    datedItem('attendance', '勤務表', c.attendance),
    datedItem('transport', '交通費', c.transport),
    applicationItem('leave', '休暇申請書', c.leaveApplication),
    applicationItem('lateEarly', '遅刻早退申請書', c.lateEarlyApplication),
    reportItem(),
  ].filter((item): item is SubmitItem => item !== null);
}
