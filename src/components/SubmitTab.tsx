import { useState } from 'react';
import type { AttendanceRecord, PaidLeaveSettings, WorkSettings } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import { DOC_KEYS, DOC_LABELS, type DocKey } from '../types/document';
import { loadUserProfile } from '../utils/storage';
import { buildMonthDocs, useWorkTimeCheck } from '../utils/monthDocs';
import { findSubmission, isLockedStatus, useSubmissions } from '../utils/submissions';
import { submitDocuments, syncNow, withdrawDocuments } from '../utils/cloudSync';
import { DocChecklist, WorkTimeVerify, type DocChecklistRow } from './DocChecklist';

interface Props {
  records: AttendanceRecord[];
  transportRecords: TransportRecord[];
  workSettings: WorkSettings;
  paidLeaveSettings: PaidLeaveSettings[];
}

// 書類を選んで提出する画面。入力チェックはダウンロード画面と同じ
export default function SubmitTab({ records, transportRecords, workSettings, paidLeaveSettings }: Props) {
  const now = new Date();
  const [filterYear, setFilterYear] = useState(now.getFullYear());
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1);
  const [selected, setSelected] = useState<Set<DocKey>>(() => new Set(DOC_KEYS));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const currentYear = now.getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  const submissions = useSubmissions();
  const { items, totalWorkMins, kishaSummary } = buildMonthDocs(
    filterYear, filterMonth, records, transportRecords, workSettings, paidLeaveSettings,
  );
  const verify = useWorkTimeCheck(totalWorkMins);

  const rows: DocChecklistRow[] = items.map((i) => ({
    ...i, submission: findSubmission(submissions.items, i.key, filterYear, filterMonth),
  }));
  const isLocked = (r: DocChecklistRow) => isLockedStatus(r.submission?.status);

  // 対象なしの書類と、提出済み・承認済みの書類は選べない
  const selectableRows = rows.filter((r) => r.doc.required && !isLocked(r));
  const selectedRows = selectableRows.filter((r) => selected.has(r.key));
  const allSelected = selectableRows.every((r) => selected.has(r.key));
  const submittedCount = rows.filter(isLocked).length;
  const targetCount = rows.filter((r) => r.doc.required || isLocked(r)).length;

  // 検算は勤務表の確認なので、勤務表を提出するときだけ判定する
  const verifyBlocks = selectedRows.some((r) => r.key === 'attendance') && !verify.passed;
  const statusUnavailable = !submissions.loaded || !!submissions.error;
  const blockReason = statusUnavailable ? '提出状況を読み込めないため提出できません'
    : selectableRows.length === 0 ? 'この月に提出できる書類はありません'
    : selectedRows.length === 0 ? '提出する書類を選んでください'
    : selectedRows.some((r) => !r.doc.complete) ? '選んだ書類に未入力または不要なデータがあるため提出できません'
    : verifyBlocks ? '現場の総勤務時間がシステム計算値と一致しないため、勤務表を提出できません'
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

  function changeMonth(y: number, m: number) {
    setFilterYear(y);
    setFilterMonth(m);
    setMessage('');
  }

  async function handleSubmit() {
    const p = loadUserProfile();
    if (!p.employeeId || !p.lastName) { alert('「設定」で社員番号と苗字を入力してください。'); return; }
    if (blockReason) return;

    const docs = selectedRows.map((r) => r.key);
    const names = docs.map((d) => `・${DOC_LABELS[d]}`).join('\n');
    if (!window.confirm(
      `${filterYear}年${filterMonth}月の次の書類を提出します。\n\n${names}\n\n提出した書類は、取り下げるまで変更できません。`,
    )) return;

    setBusy(true);
    setMessage('');
    const error = await submitDocuments(filterYear, filterMonth, docs);
    setBusy(false);
    if (error) {
      alert(`提出できませんでした。\n\n${error}`);
      return;
    }
    setMessage(`${filterYear}年${filterMonth}月の${docs.map((d) => DOC_LABELS[d]).join('・')}を提出しました`);
  }

  async function handleWithdraw(key: DocKey) {
    if (!window.confirm(
      `${filterYear}年${filterMonth}月の${DOC_LABELS[key]}の提出を取り下げますか？\n\n取り下げると、また変更できるようになります。`,
    )) return;

    setBusy(true);
    setMessage('');
    const error = await withdrawDocuments(filterYear, filterMonth, [key]);
    setBusy(false);
    if (error) {
      alert(`取り下げできませんでした。\n\n${error}`);
      return;
    }
    setMessage(`${filterYear}年${filterMonth}月の${DOC_LABELS[key]}の提出を取り下げました`);
  }

  return (
    <div className="bulk-tab">
      <h2>提出</h2>
      <p className="hint">
        提出する書類にチェックを入れてください。選んだ書類の入力がすべて完了すると提出できます（入力のチェックはダウンロードと同じです）。
        提出した書類は、取り下げるまで変更できません。
      </p>

      <div className="list-filter">
        <select value={filterYear} onChange={(e) => changeMonth(Number(e.target.value), filterMonth)}>
          {years.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={filterMonth} onChange={(e) => changeMonth(filterYear, Number(e.target.value))}>
          {months.map((m) => <option key={m} value={m}>{m}月</option>)}
        </select>
        {!statusUnavailable && (
          <span className="submit-summary">
            提出済み <strong>{submittedCount}</strong> / {targetCount}件
          </span>
        )}
      </div>

      {statusUnavailable && (
        <div className="notice-banner" role="status">
          <span>
            提出状況を読み込めないため、提出できません{submissions.error ? `（${submissions.error}）` : ''}。
          </span>
          <button type="button" className="btn-link" disabled={busy} onClick={() => { void syncNow(); }}>読み込み直す</button>
        </div>
      )}

      <div className="bulk-select-bar">
        <span className="bulk-select-count">{selectedRows.length}件を選択中</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={toggleAll} disabled={selectableRows.length === 0}>
          {allSelected && selectableRows.length > 0 ? 'すべて解除' : 'すべて選択'}
        </button>
      </div>

      <DocChecklist
        rows={rows}
        selected={selected}
        onToggle={toggle}
        showSubmission={!statusUnavailable}
        onWithdraw={handleWithdraw}
        busy={busy}
      />

      {/* ── 検算 ── */}
      <WorkTimeVerify check={verify} totalWorkMins={totalWorkMins} kishaSummary={kishaSummary} action="提出" />

      <div className="bulk-download-actions">
        <button
          className="btn btn-primary"
          disabled={!!blockReason || busy}
          onClick={handleSubmit}
        >
          {busy ? '処理中…' : '選んだ書類を提出'}
        </button>
        {blockReason && (
          <span className="bulk-download-hint">{blockReason}</span>
        )}
      </div>
      {message && <p className="submit-message" role="status">{message}</p>}
    </div>
  );
}
