import { useState } from 'react';
import type { AttendanceRecord, PaidLeaveSettings, WorkSettings } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import { DOC_KEYS, type DocKey } from '../types/document';
import { loadUserProfile, PROFILE_MISSING_MESSAGE } from '../utils/storage';
import { buildMonthDocs, useWorkTimeCheck } from '../utils/monthDocs';
import { makeMonthPdfs } from '../utils/monthPdfs';
import { deliverPdfs } from '../utils/pdfOutput';
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

  const { items, totalWorkMins, kishaSummary } = buildMonthDocs(
    filterYear, filterMonth, records, transportRecords, workSettings, paidLeaveSettings,
  );

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
    if (!p.employeeId || !p.lastName) { alert(PROFILE_MISSING_MESSAGE); return; }
    if (blockReason) return;

    setDownloading(true);
    try {
      // 選んだPDFを作り終えてから、まとめてダウンロード（iPhone・iPad は共有シート）する
      // 確認済み・承認済みの書類は、確認の欄・承認欄に確認した人・承認した人の印鑑が押される（確認前・未提出なら空）
      const files = await makeMonthPdfs(filterYear, filterMonth, targets, {
        records, transportRecords, workSettings, paidLeaveSettings,
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
      <p className="hint">
        出力する書類にチェックを入れてください。選んだ書類の入力がすべて完了すると、まとめてダウンロードできます。
        確認された書類は確認の欄（交通費精算書は検印の欄）に確認した人の印鑑が、承認された書類は承認欄に承認した人の印鑑が押されます。
      </p>

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
