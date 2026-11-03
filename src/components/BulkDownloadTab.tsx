import { useState } from 'react';
import type { AttendanceRecord, PaidLeaveSettings, WorkSettings } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import { LEAVE_LABELS, calcLeaveDays } from '../types/application';
import {
  loadUserProfile, calcPaidLeaveRemaining,
  loadLeaveApplications, loadLateEarlyApplications,
  loadSkillProfile, loadSkillEntries, loadCertifications, loadWorkHistory,
  calcSiteWorkMinutes, getWorkLocation, formatMinutes,
} from '../utils/storage';
import {
  checkMonthCompleteness, withPaidLeaveCheck, withNameCheck, checkWorkReport, checkSkillSheet, fmtDateShort,
  type DocCompleteness,
} from '../utils/completeness';
import { printMonthlyAttendancePDF } from '../utils/attendancePdf';
import { printWorkReport } from '../utils/pdf';
import { printLeaveApplication, printLateEarlyApplication } from '../utils/applicationPdf';
import { printTransportPDF } from '../utils/transportPdf';
import { printSkillSheet, printWorkHistory } from '../utils/skillPdf';
import { collectPdfs, deliverPdfs } from '../utils/pdfOutput';
import { sortWorkHistory } from '../utils/workHistory';
import { loadAllWeeks, loadSummary, loadName } from '../utils/workReport';

interface Props {
  records: AttendanceRecord[];
  transportRecords: TransportRecord[];
  workSettings: WorkSettings;
  paidLeaveSettings: PaidLeaveSettings[];
}

// 出力する書類の単位（ダウンロードされるPDFの種類）
const DOC_KEYS = ['attendance', 'transport', 'leave', 'lateEarly', 'workReport', 'skillSheet', 'workHistory'] as const;
type DocKey = typeof DOC_KEYS[number];

export default function BulkDownloadTab({ records, transportRecords, workSettings, paidLeaveSettings }: Props) {
  const now = new Date();
  const [filterYear, setFilterYear] = useState(now.getFullYear());
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1);
  const [downloading, setDownloading] = useState(false);
  const [checkHours, setCheckHours] = useState('');
  const [checkMins,  setCheckMins]  = useState('');
  const [selected, setSelected] = useState<Set<DocKey>>(() => new Set(DOC_KEYS));

  const currentYear = now.getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const leaveApplications = loadLeaveApplications();
  const lateEarlyApplications = loadLateEarlyApplications();

  const completeness = checkMonthCompleteness(
    filterYear, filterMonth, records, transportRecords,
    leaveApplications, lateEarlyApplications, workSettings,
  );

  const reportName = loadName();

  const plRemaining = calcPaidLeaveRemaining(records, paidLeaveSettings, filterYear, filterMonth);
  const attendance = withNameCheck(withPaidLeaveCheck(completeness.attendance, filterMonth, plRemaining), reportName);
  const transport = withNameCheck(completeness.transport, reportName);

  const reportWeeks = loadAllWeeks(filterYear, filterMonth);
  const workReport = checkWorkReport(reportWeeks, reportName);

  const skillProfile = loadSkillProfile();
  const skillName = skillProfile.name || loadUserProfile().lastName;
  const skillSheet = checkSkillSheet(skillName);

  // 月次総勤務時間を計算（検算に使用）
  const isWorkType = (t: string) =>
    t === 'work' || t === 'am_leave' || t === 'pm_leave'
    || t === 'scheduled_holiday_work' || t === 'legal_holiday_work' || t === 'transfer_holiday_work';
  const monthPrefix = `${filterYear}-${String(filterMonth).padStart(2, '0')}`;
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

  // 検算チェック（入力値がある場合のみ照合）
  const checkFilled = checkHours !== '' || checkMins !== '';
  const checkEnteredMins = checkFilled
    ? (parseInt(checkHours) || 0) * 60 + (parseInt(checkMins) || 0)
    : null;
  const checkPassed = checkEnteredMins === null || checkEnteredMins === totalWorkMins;

  const items: { key: DocKey; label: string; doc: DocCompleteness }[] = [
    { key: 'attendance', label: '勤務表', doc: attendance },
    { key: 'transport', label: '交通費', doc: transport },
    { key: 'leave', label: '休暇申請書', doc: completeness.leaveApplication },
    { key: 'lateEarly', label: '遅早退申請書', doc: completeness.lateEarlyApplication },
    { key: 'workReport', label: '作業報告書', doc: workReport },
    { key: 'skillSheet', label: 'スキルシート', doc: skillSheet },
    { key: 'workHistory', label: 'スキル一覧', doc: skillSheet },
  ];

  // 対象なし（その月に申請が不要）の書類は選べない
  const selectableItems = items.filter((i) => i.doc.required);
  const selectedItems = selectableItems.filter((i) => selected.has(i.key));
  const allSelected = selectableItems.every((i) => selected.has(i.key));
  const targets = new Set(selectedItems.map((i) => i.key));

  // 検算は勤務表の確認なので、勤務表を出力するときだけ判定する
  const verifyBlocks = targets.has('attendance') && !checkPassed;
  const blockReason = selectedItems.length === 0 ? '出力する書類を選んでください'
    : selectedItems.some((i) => !i.doc.complete) ? '選んだ書類に未入力または不要なデータがあるためダウンロードできません'
    : verifyBlocks ? '現場の総勤務時間がシステム計算値と一致しないため、勤務表をダウンロードできません'
    : '';

  function toggle(key: DocKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(DOC_KEYS));
  }

  async function handleDownload() {
    const p = loadUserProfile();
    if (!p.employeeId || !p.lastName) { alert('「設定」で社員番号と苗字を入力してください。'); return; }
    if (blockReason) return;

    setDownloading(true);
    try {
      // 選んだPDFを作り終えてから、まとめてダウンロード（iPhone・iPad は共有シート）する
      const files = await collectPdfs(async () => {
        if (targets.has('attendance')) {
          await printMonthlyAttendancePDF(records, workSettings, filterYear, filterMonth, plRemaining, p.employeeId, p.lastName, reportName);
        }

        if (targets.has('transport')) {
          await printTransportPDF(transportRecords, filterYear, filterMonth, p.employeeId, p.lastName, reportName);
        }

        if (targets.has('leave')) {
          const batches = leaveApplications.filter((b) => b.dateEntries.some((e) => e.date.startsWith(monthPrefix)));
          for (const batch of batches) {
            const entriesInMonth = batch.dateEntries.filter((e) => e.date.startsWith(monthPrefix));
            await printLeaveApplication({
              applicationDate: batch.applicationDate,
              name: batch.name,
              dateEntries: entriesInMonth.map((e) => ({ date: e.date, leaveLabel: LEAVE_LABELS[e.leaveType] })),
              leaveDays: calcLeaveDays(entriesInMonth),
              reason: batch.reason,
            }, p.employeeId, p.lastName);
          }
        }

        if (targets.has('lateEarly')) {
          const apps = lateEarlyApplications.filter((r) => r.targetDate.startsWith(monthPrefix));
          for (const rec of apps) {
            await printLateEarlyApplication({
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

        if (targets.has('workReport')) {
          await printWorkReport(filterYear, filterMonth, reportName, reportWeeks, p.employeeId, p.lastName, loadSummary(filterYear, filterMonth));
        }

        if (targets.has('skillSheet')) {
          await printSkillSheet({ ...skillProfile, name: skillName }, loadSkillEntries(), loadCertifications(), p.employeeId, p.lastName);
        }

        if (targets.has('workHistory')) {
          await printWorkHistory(skillName, sortWorkHistory(loadWorkHistory()), p.employeeId, p.lastName);
        }
      });
      await deliverPdfs(files);
    } catch (err) {
      alert('PDF生成エラー: ' + (err as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="bulk-tab">
      <h2>書類一括ダウンロード</h2>
      <p className="hint">出力する書類にチェックを入れてください。選んだ書類の入力がすべて完了すると、まとめてダウンロードできます。</p>

      <div className="list-filter">
        <select value={filterYear} onChange={(e) => setFilterYear(Number(e.target.value))}>
          {years.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={filterMonth} onChange={(e) => setFilterMonth(Number(e.target.value))}>
          {months.map((m) => <option key={m} value={m}>{m}月</option>)}
        </select>
      </div>

      <div className="bulk-select-bar">
        <span className="bulk-select-count">{selectedItems.length}件を選択中</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={toggleAll}>
          {allSelected ? 'すべて解除' : 'すべて選択'}
        </button>
      </div>

      <div className="bulk-checklist">
        {items.map(({ key, label, doc }) => {
          const status = !doc.required ? 'skip' : doc.complete ? 'ok' : 'missing';
          const checked = doc.required && selected.has(key);
          const hasMissing = doc.missingDates.length > 0;
          const hasExtra = doc.extraDates.length > 0;
          const statusLabel = status === 'ok' ? '入力完了'
            : status === 'skip' ? '対象なし（不要）'
            : hasMissing && hasExtra ? '入力未完了・不要なデータあり'
            : hasExtra ? '不要なデータあり'
            : !hasMissing && doc.issues.length > 0 ? '不備あり'
            : '入力未完了';
          return (
            <div key={key} className={`bulk-check-item bulk-check-${status}${checked ? '' : ' bulk-check-unselected'}`}>
              <label className="bulk-check-head">
                <input
                  type="checkbox"
                  className="bulk-check-select"
                  checked={checked}
                  disabled={!doc.required}
                  onChange={() => toggle(key)}
                />
                <span className="bulk-check-icon">
                  {status === 'ok' ? '✓' : status === 'skip' ? '－' : '×'}
                </span>
                <span className="bulk-check-label">{label}</span>
                <span className="bulk-check-status">{statusLabel}</span>
              </label>
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

      {/* ── 検算 ── */}
      <div className={`bulk-check-item bulk-check-verify${!checkFilled ? '' : checkPassed ? ' bulk-check-ok' : ' bulk-check-missing'}`}>
        <div className="bulk-check-head">
          <span className="bulk-check-icon">{checkFilled ? (checkPassed ? '✓' : '×') : '？'}</span>
          <span className="bulk-check-label">現場の総勤務時間（検算）</span>
          <span className="bulk-check-status">
            {!checkFilled ? '未入力（任意）' : checkPassed ? '一致' : '不一致'}
          </span>
        </div>
        <div className="bulk-verify-body">
          <p className="hint mb-8">
            現場（客先）システムで確認した月間総勤務時間を入力してください。
            システムの計算値と一致しない場合は勤務表をダウンロードできません。未入力の場合はスキップされます。
            ※ 勤務区分が帰社の日は、帰社した時間を計算から除外します（午前/午後帰社は切替時刻で按分）。
          </p>
          <div className="bulk-verify-row">
            <label className="bulk-verify-label">現場の総勤務時間</label>
            <input
              type="number"
              min={0}
              className="bulk-verify-input"
              value={checkHours}
              onChange={(e) => setCheckHours(e.target.value)}
              placeholder="0"
            />
            <span className="bulk-verify-unit">時間</span>
            <input
              type="number"
              min={0}
              max={59}
              className="bulk-verify-input bulk-verify-input-min"
              value={checkMins}
              onChange={(e) => setCheckMins(e.target.value)}
              placeholder="0"
            />
            <span className="bulk-verify-unit">分</span>
          </div>
          <div className="bulk-verify-row">
            <label className="bulk-verify-label">システム計算値</label>
            <span className="bulk-verify-computed">{formatMinutes(totalWorkMins)}</span>
            {kishaSummary && (
              <span className="hint hint-inline">（{kishaSummary} 除外済み）</span>
            )}
            <button
              type="button"
              className="btn btn-secondary bulk-verify-fill"
              onClick={() => {
                setCheckHours(String(Math.floor(totalWorkMins / 60)));
                setCheckMins(String(totalWorkMins % 60));
              }}
            >
              計算値を入力
            </button>
          </div>
          {checkFilled && !checkPassed && (
            <div className="bulk-missing-dates">
              入力値（{parseInt(checkHours) || 0}時間{parseInt(checkMins) || 0}分）がシステム計算値（{formatMinutes(totalWorkMins)}）と一致しません
            </div>
          )}
        </div>
      </div>

      <div className="bulk-download-actions">
        <button
          className="btn btn-primary"
          disabled={!!blockReason || downloading}
          onClick={handleDownload}
        >
          {downloading ? 'ダウンロード中…' : '選んだ書類をダウンロード'}
        </button>
        {blockReason && (
          <span className="bulk-download-hint">{blockReason}</span>
        )}
      </div>
    </div>
  );
}
