import { useState } from 'react';
import type { AttendanceRecord, PaidLeaveSettings, WorkSettings } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import { LEAVE_LABELS, calcLeaveDays } from '../types/application';
import {
  loadUserProfile, calcPaidLeaveRemaining,
  loadLeaveApplications, loadLateEarlyApplications,
  loadSkillProfile, loadSkillEntries, loadCertifications, loadWorkHistory,
} from '../utils/storage';
import { checkMonthCompleteness, fmtDateShort, type DocCompleteness } from '../utils/completeness';
import { printMonthlyAttendancePDF } from '../utils/attendancePdf';
import { printTransportRecords, printLeaveApplication, printLateEarlyApplication, printWorkReport } from '../utils/pdf';
import { printSkillSheet, printWorkHistory } from '../utils/skillPdf';
import { sortWorkHistory } from '../utils/workHistory';
import { loadAllWeeks, loadSummary, loadName, hasContent } from '../utils/workReport';

interface Props {
  records: AttendanceRecord[];
  transportRecords: TransportRecord[];
  workSettings: WorkSettings;
  paidLeaveSettings: PaidLeaveSettings[];
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function BulkDownloadTab({ records, transportRecords, workSettings, paidLeaveSettings }: Props) {
  const now = new Date();
  const [filterYear, setFilterYear] = useState(now.getFullYear());
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1);
  const [downloading, setDownloading] = useState(false);

  const currentYear = now.getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const leaveApplications = loadLeaveApplications();
  const lateEarlyApplications = loadLateEarlyApplications();

  const completeness = checkMonthCompleteness(
    filterYear, filterMonth, records, transportRecords,
    leaveApplications, lateEarlyApplications, workSettings,
  );

  // 勤務表: 対象月の有給残日数（月初の残日数）が設定されていること
  const plRemaining = calcPaidLeaveRemaining(records, paidLeaveSettings, filterYear, filterMonth);
  const attendanceIssues = plRemaining === null
    ? [...completeness.attendance.issues, `${filterMonth}月の有給残日数が設定されていません（勤怠一覧で月初の有給残日数を設定してください）`]
    : completeness.attendance.issues;
  const attendance: DocCompleteness = {
    ...completeness.attendance,
    complete: completeness.attendance.complete && plRemaining !== null,
    issues: attendanceIssues,
  };

  // 作業報告書: 対象月のいずれかの週が入力済みで、氏名が入力されていること
  const reportWeeks = loadAllWeeks(filterYear, filterMonth);
  const reportName = loadName();
  const workReportIssues = [
    ...(reportWeeks.some(hasContent) ? [] : ['作業報告書が入力されていません']),
    ...(reportName.trim() ? [] : ['作業報告書の氏名が入力されていません']),
  ];
  const workReport: DocCompleteness = {
    required: true, complete: workReportIssues.length === 0, missingDates: [], extraDates: [], issues: workReportIssues,
  };

  // スキル表: 月に依存しない書類。氏名が入力されていること
  const skillProfile = loadSkillProfile();
  const skillName = skillProfile.name || loadUserProfile().lastName;
  const skillIssues = skillName.trim() ? [] : ['スキル表の氏名が入力されていません'];
  const skillSheet: DocCompleteness = {
    required: true, complete: skillIssues.length === 0, missingDates: [], extraDates: [], issues: skillIssues,
  };

  const allComplete = completeness.allComplete && attendance.complete && workReport.complete && skillSheet.complete;

  async function handleBulkDownload() {
    const p = loadUserProfile();
    if (!p.employeeId || !p.lastName) { alert('画面上部に社員番号と苗字を入力してください。'); return; }
    if (!allComplete) return;

    setDownloading(true);
    try {
      await printMonthlyAttendancePDF(records, workSettings, filterYear, filterMonth, plRemaining, p.employeeId, p.lastName);

      await wait(600);
      printTransportRecords(transportRecords, filterYear, filterMonth, p.employeeId, p.lastName);

      const prefix = `${filterYear}-${String(filterMonth).padStart(2, '0')}`;

      if (completeness.leaveApplication.required) {
        const batches = leaveApplications.filter((b) => b.dateEntries.some((e) => e.date.startsWith(prefix)));
        for (const batch of batches) {
          await wait(600);
          const entriesInMonth = batch.dateEntries.filter((e) => e.date.startsWith(prefix));
          printLeaveApplication({
            applicationDate: batch.applicationDate,
            name: batch.name,
            dateEntries: entriesInMonth.map((e) => ({ date: e.date, leaveLabel: LEAVE_LABELS[e.leaveType] })),
            leaveDays: calcLeaveDays(entriesInMonth),
            reason: batch.reason,
          }, p.employeeId, p.lastName);
        }
      }

      if (completeness.lateEarlyApplication.required) {
        const targets = lateEarlyApplications.filter((r) => r.targetDate.startsWith(prefix));
        for (const rec of targets) {
          await wait(600);
          printLateEarlyApplication({
            applicationDate: rec.applicationDate,
            name: rec.name,
            type: rec.type,
            targetDate: rec.targetDate,
            scheduledTime: rec.scheduledTime,
            actualTime: rec.actualTime,
            reason: rec.reason,
          }, p.employeeId, p.lastName);
        }
      }

      await wait(600);
      printWorkReport(filterYear, filterMonth, reportName, reportWeeks, p.employeeId, p.lastName, loadSummary(filterYear, filterMonth));

      await wait(600);
      await printSkillSheet({ ...skillProfile, name: skillName }, loadSkillEntries(), loadCertifications(), p.employeeId, p.lastName);

      await wait(600);
      await printWorkHistory(skillName, sortWorkHistory(loadWorkHistory()), p.employeeId, p.lastName);
    } catch (err) {
      alert('PDF生成エラー: ' + (err as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  const items: { label: string; doc: DocCompleteness }[] = [
    { label: '勤務表', doc: attendance },
    { label: '交通費', doc: completeness.transport },
    { label: '休暇申請書', doc: completeness.leaveApplication },
    { label: '遅早退申請書', doc: completeness.lateEarlyApplication },
    { label: '作業報告書', doc: workReport },
    { label: 'スキル表（スキルシート・スキル一覧）', doc: skillSheet },
  ];

  return (
    <div className="bulk-tab">
      <h2>書類一括ダウンロード</h2>
      <p className="hint">対象月のすべての書類の入力が完了すると、一括でダウンロードできます。</p>

      <div className="list-filter">
        <select value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={filterMonth} onChange={(e) => setFilterMonth(Number(e.target.value))}>
          {months.map((m) => <option key={m} value={m}>{m}月</option>)}
        </select>
      </div>

      <div className="bulk-checklist">
        {items.map(({ label, doc }) => {
          const status = !doc.required ? 'skip' : doc.complete ? 'ok' : 'missing';
          const hasMissing = doc.missingDates.length > 0;
          const hasExtra = doc.extraDates.length > 0;
          const statusLabel = status === 'ok' ? '入力完了'
            : status === 'skip' ? '対象なし（不要）'
            : hasMissing && hasExtra ? '入力未完了・不要なデータあり'
            : hasExtra ? '不要なデータあり'
            : !hasMissing && doc.issues.length > 0 ? '不備あり'
            : '入力未完了';
          return (
            <div key={label} className={`bulk-check-item bulk-check-${status}`}>
              <div className="bulk-check-head">
                <span className="bulk-check-icon">
                  {status === 'ok' ? '✓' : status === 'skip' ? '－' : '×'}
                </span>
                <span className="bulk-check-label">{label}</span>
                <span className="bulk-check-status">{statusLabel}</span>
              </div>
              {hasMissing && (
                <div className="bulk-missing-dates">
                  未入力: {doc.missingDates.map(fmtDateShort).join('、')}
                </div>
              )}
              {hasExtra && (
                <div className="bulk-missing-dates bulk-extra-dates">
                  不要: {doc.extraDates.map(fmtDateShort).join('、')}（在宅勤務・有給などのため交通費は不要です。削除してください）
                </div>
              )}
              {doc.issues.map((issue) => (
                <div key={issue} className="bulk-missing-dates">{issue}</div>
              ))}
            </div>
          );
        })}
      </div>

      <div className="bulk-download-actions">
        <button
          className="btn btn-primary"
          disabled={!allComplete || downloading}
          onClick={handleBulkDownload}
        >
          {downloading ? 'ダウンロード中…' : 'すべての書類を一括ダウンロード'}
        </button>
        {!allComplete && (
          <span className="bulk-download-hint">未入力または不要なデータがあるためダウンロードできません</span>
        )}
      </div>
    </div>
  );
}
