import { useState } from 'react';
import type { AttendanceRecord, PaidLeaveSettings, WorkSettings } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import { LEAVE_LABELS, calcLeaveDays } from '../types/application';
import { DOC_KEYS, type DocKey } from '../types/document';
import {
  loadUserProfile, loadSkillEntries, loadCertifications, loadWorkHistory,
} from '../utils/storage';
import { buildMonthDocs, useWorkTimeCheck } from '../utils/monthDocs';
import { printMonthlyAttendancePDF } from '../utils/attendancePdf';
import { printWorkReport } from '../utils/pdf';
import { printLeaveApplication, printLateEarlyApplication } from '../utils/applicationPdf';
import { printTransportPDF } from '../utils/transportPdf';
import { printSkillSheet, printWorkHistory } from '../utils/skillPdf';
import { collectPdfs, deliverPdfs } from '../utils/pdfOutput';
import { sortWorkHistory } from '../utils/workHistory';
import { loadSummary } from '../utils/workReport';
import { DocChecklist, WorkTimeVerify } from './DocChecklist';

interface Props {
  records: AttendanceRecord[];
  transportRecords: TransportRecord[];
  workSettings: WorkSettings;
  paidLeaveSettings: PaidLeaveSettings[];
}

export default function BulkDownloadTab({ records, transportRecords, workSettings, paidLeaveSettings }: Props) {
  const now = new Date();
  const [filterYear, setFilterYear] = useState(now.getFullYear());
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1);
  const [downloading, setDownloading] = useState(false);
  const [selected, setSelected] = useState<Set<DocKey>>(() => new Set(DOC_KEYS));

  const currentYear = now.getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const {
    items, monthPrefix, leaveApplications, lateEarlyApplications, reportName, plRemaining, reportWeeks,
    skillProfile, skillName, totalWorkMins, kishaSummary,
  } = buildMonthDocs(filterYear, filterMonth, records, transportRecords, workSettings, paidLeaveSettings);

  // 検算チェック（入力値がある場合のみ照合）
  const verify = useWorkTimeCheck(totalWorkMins);

  // 対象なし（その月に申請が不要）の書類は選べない
  const selectableItems = items.filter((i) => i.doc.required);
  const selectedItems = selectableItems.filter((i) => selected.has(i.key));
  const allSelected = selectableItems.every((i) => selected.has(i.key));
  const targets = new Set(selectedItems.map((i) => i.key));

  // 検算は勤務表の確認なので、勤務表を出力するときだけ判定する
  const verifyBlocks = targets.has('attendance') && !verify.passed;
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
      <h2>ダウンロード</h2>
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

      <DocChecklist rows={items} selected={selected} onToggle={toggle} />

      {/* ── 検算 ── */}
      <WorkTimeVerify check={verify} totalWorkMins={totalWorkMins} kishaSummary={kishaSummary} action="ダウンロード" />

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
