/**
 * monthDocs.ts — 月末に出力・提出する書類ごとの入力チェック（ダウンロード画面と提出画面で同じものを使う）
 */
import { useState } from 'react';
import type { AttendanceRecord, PaidLeaveSettings, WorkSettings } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import { DOC_KEYS, DOC_LABELS, type DocKey } from '../types/document';
import {
  loadUserProfile, calcPaidLeaveRemaining, loadLeaveApplications, loadLateEarlyApplications,
  loadSkillProfile, calcSiteWorkMinutes, getWorkLocation,
} from './storage';
import {
  checkMonthCompleteness, withPaidLeaveCheck, withNameCheck, checkWorkReport, checkSkillSheet,
  type DocCompleteness,
} from './completeness';
import { loadAllWeeks, loadName } from './workReport';

export interface MonthDocItem {
  key: DocKey;
  label: string;
  doc: DocCompleteness;
}

// 書類の入力状況の表示
export function docStatusLabel(doc: DocCompleteness): string {
  if (!doc.required) return '対象なし（不要）';
  if (doc.complete) return '入力完了';
  const hasMissing = doc.missingDates.length > 0;
  const hasExtra = doc.extraDates.length > 0;
  if (hasMissing && hasExtra) return '入力未完了・不要なデータあり';
  if (hasExtra) return '不要なデータあり';
  if (!hasMissing && doc.issues.length > 0) return '不備あり';
  return '入力未完了';
}

// 現場の総勤務時間の検算（入力がなければ判定しない）
export function useWorkTimeCheck(totalWorkMins: number) {
  const [hours, setHours] = useState('');
  const [mins, setMins] = useState('');
  const filled = hours !== '' || mins !== '';
  const enteredMins = filled ? (parseInt(hours) || 0) * 60 + (parseInt(mins) || 0) : null;
  const passed = enteredMins === null || enteredMins === totalWorkMins;
  return { hours, mins, setHours, setMins, filled, passed };
}

export type WorkTimeCheck = ReturnType<typeof useWorkTimeCheck>;

const isWorkType = (t: string) =>
  t === 'work' || t === 'am_leave' || t === 'pm_leave'
  || t === 'scheduled_holiday_work' || t === 'legal_holiday_work' || t === 'transfer_holiday_work';

// 書類ごとの入力状況と、PDFの作成・検算に使うデータ
export function buildMonthDocs(
  year: number,
  month: number,
  records: AttendanceRecord[],
  transportRecords: TransportRecord[],
  workSettings: WorkSettings,
  paidLeaveSettings: PaidLeaveSettings[],
) {
  const leaveApplications = loadLeaveApplications();
  const lateEarlyApplications = loadLateEarlyApplications();

  const completeness = checkMonthCompleteness(
    year, month, records, transportRecords,
    leaveApplications, lateEarlyApplications, workSettings,
  );

  const reportName = loadName();

  const plRemaining = calcPaidLeaveRemaining(records, paidLeaveSettings, year, month);
  const attendance = withNameCheck(withPaidLeaveCheck(completeness.attendance, month, plRemaining), reportName);
  const transport = withNameCheck(completeness.transport, reportName);

  const reportWeeks = loadAllWeeks(year, month);
  const workReport = checkWorkReport(reportWeeks, reportName);

  const skillProfile = loadSkillProfile();
  const skillName = skillProfile.name || loadUserProfile().lastName;
  const skillSheet = checkSkillSheet(skillName);

  const docs: Record<DocKey, DocCompleteness> = {
    attendance,
    transport,
    leave: completeness.leaveApplication,
    lateEarly: completeness.lateEarlyApplication,
    workReport,
    skillSheet,
    workHistory: skillSheet,
  };
  const items: MonthDocItem[] = DOC_KEYS.map((key) => ({ key, label: DOC_LABELS[key], doc: docs[key] }));

  // 月次総勤務時間（検算に使用）
  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const monthWorkRecords = records.filter(
    (r) => r.date.startsWith(monthPrefix) && isWorkType(r.type) && r.clockIn && r.clockOut,
  );
  // 帰社した時間は現場勤務時間に含めない
  const totalWorkMins = monthWorkRecords.reduce((acc, r) => acc + calcSiteWorkMinutes(r), 0);

  // 帰社の件数（表示用）
  const kishaDayCount = monthWorkRecords.filter((r) => getWorkLocation(r) === 'kisha').length;
  const halfKishaCount = monthWorkRecords.filter((r) => {
    const loc = getWorkLocation(r);
    return loc === 'am_kisha' || loc === 'pm_kisha';
  }).length;
  const kishaSummary = [
    kishaDayCount > 0 ? `終日帰社 ${kishaDayCount}日` : '',
    halfKishaCount > 0 ? `午前/午後帰社 ${halfKishaCount}日` : '',
  ].filter(Boolean).join('・');

  return {
    items,
    monthPrefix,
    leaveApplications,
    lateEarlyApplications,
    reportName,
    plRemaining,
    reportWeeks,
    skillProfile,
    skillName,
    totalWorkMins,
    kishaSummary,
  };
}
