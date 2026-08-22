import { useState } from 'react';
import type { AttendanceRecord, PaidLeaveSettings, WorkSettings } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import { LEAVE_LABELS } from '../types/application';
import {
  loadUserProfile, calcPaidLeaveRemaining,
  loadLeaveApplications, loadLateEarlyApplications,
} from '../utils/storage';
import { checkMonthCompleteness } from '../utils/completeness';
import { printMonthlyAttendancePDF } from '../utils/attendancePdf';
import { printTransportRecords, printLeaveApplication, printLateEarlyApplication } from '../utils/pdf';

interface Props {
  records: AttendanceRecord[];
  transportRecords: TransportRecord[];
  workSettings: WorkSettings;
  paidLeaveSettings: PaidLeaveSettings[];
}

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

function fmtDateShort(d: string): string {
  const dt = new Date(d + 'T00:00:00');
  return `${dt.getMonth() + 1}/${dt.getDate()}(${DOW[dt.getDay()]})`;
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

  async function handleBulkDownload() {
    const p = loadUserProfile();
    if (!p.employeeId || !p.lastName) { alert('画面上部に社員番号と苗字を入力してください。'); return; }
    if (!completeness.allComplete) return;

    setDownloading(true);
    try {
      const plRemaining = calcPaidLeaveRemaining(records, paidLeaveSettings, filterYear);
      await printMonthlyAttendancePDF(records, workSettings, filterYear, filterMonth, plRemaining, p.employeeId, p.lastName);

      await wait(600);
      printTransportRecords(transportRecords, filterYear, filterMonth, p.employeeId, p.lastName);

      const prefix = `${filterYear}-${String(filterMonth).padStart(2, '0')}`;

      if (completeness.leaveApplication.required) {
        const batches = leaveApplications.filter((b) => b.dateEntries.some((e) => e.date.startsWith(prefix)));
        for (const batch of batches) {
          await wait(600);
          const entriesInMonth = batch.dateEntries.filter((e) => e.date.startsWith(prefix));
          const leaveDays = entriesInMonth.reduce(
            (sum, e) => sum + (e.leaveType === 'paid_leave' ? 1 : 0.5), 0,
          );
          printLeaveApplication({
            applicationDate: batch.applicationDate,
            name: batch.name,
            dateEntries: entriesInMonth.map((e) => ({ date: e.date, leaveLabel: LEAVE_LABELS[e.leaveType] })),
            leaveDays,
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
    } finally {
      setDownloading(false);
    }
  }

  const items: { label: string; doc: typeof completeness.attendance }[] = [
    { label: '勤務表', doc: completeness.attendance },
    { label: '交通費', doc: completeness.transport },
    { label: '休暇申請書', doc: completeness.leaveApplication },
    { label: '遅早退申請書', doc: completeness.lateEarlyApplication },
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
          return (
            <div key={label} className={`bulk-check-item bulk-check-${status}`}>
              <div className="bulk-check-head">
                <span className="bulk-check-icon">
                  {status === 'ok' ? '✓' : status === 'skip' ? '－' : '×'}
                </span>
                <span className="bulk-check-label">{label}</span>
                <span className="bulk-check-status">
                  {status === 'ok' ? '入力完了' : status === 'skip' ? '対象なし（不要）' : '入力未完了'}
                </span>
              </div>
              {status === 'missing' && (
                <div className="bulk-missing-dates">
                  未入力: {doc.missingDates.map(fmtDateShort).join('、')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bulk-download-actions">
        <button
          className="btn btn-primary"
          disabled={!completeness.allComplete || downloading}
          onClick={handleBulkDownload}
        >
          {downloading ? 'ダウンロード中…' : 'すべての書類を一括ダウンロード'}
        </button>
        {!completeness.allComplete && (
          <span className="bulk-download-hint">未入力の項目があるためダウンロードできません</span>
        )}
      </div>
    </div>
  );
}
