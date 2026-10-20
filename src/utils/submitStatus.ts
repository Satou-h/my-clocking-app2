import type { AttendanceRecord, WorkSettings } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import { loadLeaveApplications, loadLateEarlyApplications } from './storage';
import { checkMonthCompleteness, type DocCompleteness } from './completeness';
import { loadAllWeeks, hasContent } from './workReport';

export interface SubmitItem {
  label: string;
  done: boolean;
  detail: string;
}

// 月末に提出する書類ごとの入力状況（画面の「月末の提出まで」とメニューの未対応件数に使う）。
// 月の途中でも使うため、勤務表・交通費の未入力日は今日までの日付だけを数える。
export function getSubmitStatus(
  year: number,
  month: number,
  records: AttendanceRecord[],
  transportRecords: TransportRecord[],
  workSettings: WorkSettings,
  today: string,
): SubmitItem[] {
  const c = checkMonthCompleteness(
    year, month, records, transportRecords,
    loadLeaveApplications(), loadLateEarlyApplications(), workSettings,
  );

  const datedItem = (label: string, doc: DocCompleteness): SubmitItem => {
    const missing = doc.missingDates.filter((d) => d <= today).length;
    if (missing > 0) return { label, done: false, detail: `${missing}日未入力` };
    if (doc.issues.length > 0 || doc.extraDates.length > 0) return { label, done: false, detail: '要確認' };
    return { label, done: true, detail: 'OK' };
  };

  const applicationItem = (label: string, doc: DocCompleteness): SubmitItem | null => {
    if (!doc.required) return null;
    if (doc.complete) return { label, done: true, detail: 'OK' };
    const missing = doc.missingDates.length;
    return { label, done: false, detail: missing > 0 ? `${missing}日分 未作成` : '要確認' };
  };

  const reportDone = loadAllWeeks(year, month).some(hasContent);

  return [
    datedItem('勤務表', c.attendance),
    datedItem('交通費', c.transport),
    applicationItem('休暇申請書', c.leaveApplication),
    applicationItem('遅刻早退申請書', c.lateEarlyApplication),
    { label: '作業報告', done: reportDone, detail: reportDone ? 'OK' : '未入力' },
  ].filter((item): item is SubmitItem => item !== null);
}
