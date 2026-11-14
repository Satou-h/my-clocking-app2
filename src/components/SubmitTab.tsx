import { useCallback, useEffect, useState } from 'react';
import type { AttendanceRecord, PaidLeaveSettings, WorkSettings } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import { DOC_KEYS, DOC_LABELS, type DocKey } from '../types/document';
import { hasSealText, loadUserProfile, PROFILE_MISSING_MESSAGE, SEAL_MISSING_MESSAGE } from '../utils/storage';
import { buildMonthDocs, useWorkTimeCheck } from '../utils/monthDocs';
import { makeMonthPdfs } from '../utils/monthPdfs';
import { preloadFont } from '../utils/pdfKit';
import { preloadPdfViewer } from '../utils/pdfRender';
import { findSubmission, isLockedStatus, useSubmissions } from '../utils/submissions';
import {
  approveDocuments, confirmDocuments, submitDocuments, syncNow, unapproveDocuments, unconfirmDocuments, useCloudState,
  withdrawDocuments,
} from '../utils/cloudSync';
import { DocChecklist, WorkTimeVerify, type DocChecklistRow } from './DocChecklist';
import PdfPreview from './PdfPreview';

// リーダー・管理者の操作（提出済み → 確認済み → 承認済み。取り消すと一つ前に戻る）
type ReviewAction = 'confirm' | 'unconfirm' | 'approve' | 'unapprove';

const REVIEW: Record<ReviewAction, {
  run: (year: number, month: number, docs: DocKey[]) => Promise<string | null>;
  failed: string;
  done: string;
}> = {
  confirm: { run: confirmDocuments, failed: '確認できませんでした', done: 'を確認しました' },
  unconfirm: { run: unconfirmDocuments, failed: '確認を取り消せませんでした', done: 'の確認を取り消しました' },
  approve: { run: approveDocuments, failed: '承認できませんでした', done: 'を承認しました' },
  unapprove: { run: unapproveDocuments, failed: '承認を取り消せませんでした', done: 'の承認を取り消しました' },
};

// 「PDFで確認」で開いている書類（files が null の間はPDFを作成中）
interface Preview {
  title: string;
  subtitle: string;
  files: File[] | null;
  error: string;
}

interface Props {
  records: AttendanceRecord[];
  transportRecords: TransportRecord[];
  workSettings: WorkSettings;
  paidLeaveSettings: PaidLeaveSettings[];
  // 最初に表示する年月（部下の提出画面から開いたときなど）
  initialYear?: number;
  initialMonth?: number;
}

// 書類を選んで提出する画面。入力チェックはダウンロード画面と同じ
// リーダー・管理者がメンバーのデータを開いているときは、メンバーの提出状況を見て、提出済みの書類を確認し、
// 確認済みの書類を承認する（提出・取り下げは本人だけ）
export default function SubmitTab({ records, transportRecords, workSettings, paidLeaveSettings, initialYear, initialMonth }: Props) {
  const now = new Date();
  const [filterYear, setFilterYear] = useState(initialYear ?? now.getFullYear());
  const [filterMonth, setFilterMonth] = useState(initialMonth ?? now.getMonth() + 1);
  const viewing = useCloudState().viewing;
  const [selected, setSelected] = useState<Set<DocKey>>(() => new Set(DOC_KEYS));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const closePreview = useCallback(() => setPreview(null), []);

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

  // 対象なしの書類と、提出済み・確認済み・承認済みの書類は選べない
  const selectableRows = rows.filter((r) => r.doc.required && !isLocked(r));
  const selectedRows = selectableRows.filter((r) => selected.has(r.key));
  const allSelected = selectableRows.every((r) => selected.has(r.key));
  const submittedCount = rows.filter(isLocked).length;
  const targetCount = rows.filter((r) => r.doc.required || isLocked(r)).length;

  // 「PDFで確認」を押せる書類（提出済み・確認済み・承認済みの書類と、入力が完了した書類）があれば、押される前に、
  // 手が空いたところでPDFに使うフォントと、PDFを表示する部品を読み込んでおく（初めて開くときの待ち時間を減らす）
  const canPreview = rows.some((r) => isLocked(r) || (r.doc.required && r.doc.complete));
  useEffect(() => {
    if (!canPreview) return;
    const preload = () => { preloadFont(); preloadPdfViewer(); };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(preload, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(preload, 1500); // requestIdleCallback がない iPhone など
    return () => window.clearTimeout(id);
  }, [canPreview]);

  // 確認できる書類（提出済み・確認前）と、承認できる書類（確認済み・承認前）
  const confirmableKeys = rows.filter((r) => r.submission?.status === 'submitted').map((r) => r.key);
  const approvableKeys = rows.filter((r) => r.submission?.status === 'confirmed').map((r) => r.key);

  // 検算は勤務表の確認なので、勤務表を提出するときだけ判定する
  const verifyBlocks = selectedRows.some((r) => r.key === 'attendance') && !verify.passed;
  const statusUnavailable = !submissions.loaded || !!submissions.error;
  // 印鑑の文字を保存していない人は提出できない（メンバーのデータを開いているときは提出しないので見ない）
  const sealMissing = !viewing && !hasSealText(loadUserProfile());
  const blockReason = statusUnavailable ? '提出状況を読み込めないため提出できません'
    : sealMissing ? SEAL_MISSING_MESSAGE
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

  // 書類を、ダウンロードせずに画面で見る（ダウンロード画面と同じPDF。提出前の書類も見られる。
  // 確認済み・承認済みなら確認した人・承認者の印鑑も押す）
  async function handlePreview(key: DocKey) {
    const year = filterYear, month = filterMonth;
    setPreview({
      title: DOC_LABELS[key],
      subtitle: `${viewing ? `${viewing.name}さん・` : ''}${year}年${month}月`,
      files: null,
      error: '',
    });
    setBusy(true);
    // PDFを作っている間に、表示する部品の読み込みを進めておく（作り終わってから読み込むと、その分待つ）
    preloadPdfViewer();
    try {
      const files = await makeMonthPdfs(year, month, [key], { records, transportRecords, workSettings, paidLeaveSettings });
      // 作成中に閉じていたら開き直さない
      setPreview((p) => p && { ...p, files });
    } catch (err) {
      setPreview((p) => p && { ...p, error: (err as Error).message || String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit() {
    const p = loadUserProfile();
    if (!p.employeeId || !p.lastName) { alert(PROFILE_MISSING_MESSAGE); return; }
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

  // リーダー・管理者がメンバーの書類を確認・承認する、またはそれを取り消す
  async function handleReview(action: ReviewAction, docs: DocKey[]) {
    if (!viewing || docs.length === 0) return;
    const who = `${viewing.name}さんの${filterYear}年${filterMonth}月の`;
    const names = docs.map((d) => `・${DOC_LABELS[d]}`).join('\n');
    const docNames = docs.map((d) => DOC_LABELS[d]).join('・');
    // この変更の前に承認された書類は確認の記録がないため、承認を取り消すと提出済みに戻る
    const backToSubmitted = action === 'unapprove'
      && rows.some((r) => docs.includes(r.key) && !r.submission?.confirmedAt);
    const question = {
      confirm: `${who}次の書類を確認します。\n\n${names}\n\n`
        + '確認した書類は、確認を取り消すまで本人もリーダー・管理者も変更・取り下げできなくなります。\n'
        + '勤務表の確認印、休暇申請書・遅早退申請書の確認、交通費精算書の検印の欄に、あなたの印鑑が押されます。',
      unconfirm: `${who}${docNames}の確認を取り消しますか？\n\n`
        + '取り消すと提出済み（確認前）に戻り、本人の取り下げや、リーダー・管理者の修正・確認ができるようになります。\n'
        + 'これから出力するPDFには確認した人の印鑑が押されなくなります（すでにダウンロードしたPDFはそのままです）。',
      approve: `${who}次の書類を承認します。\n\n${names}\n\n`
        + '承認した書類は、承認を取り消すまで確認も取り消せません。\n'
        + '勤務表・交通費・休暇申請書・遅早退申請書のPDFには、承認欄にあなたの印鑑が押されます。',
      unapprove: `${who}${docNames}の承認を取り消しますか？\n\n`
        + (backToSubmitted
          ? '取り消すと提出済み（確認前）に戻ります。\n'
          : '取り消すと確認済み（承認前）に戻ります。内容を直すときは、続けて「確認を取り消す」を押してください。\n')
        + 'これから出力するPDFには承認者の印鑑が押されなくなります（すでにダウンロードしたPDFはそのままです）。',
    }[action];
    if (!window.confirm(question)) return;

    const { run, failed, done } = REVIEW[action];
    setBusy(true);
    setMessage('');
    const error = await run(filterYear, filterMonth, docs);
    setBusy(false);
    if (error) {
      alert(`${failed}。\n\n${error}`);
      return;
    }
    setMessage(`${who}${docNames}${done}`);
  }

  return (
    <div className="bulk-tab">
      <h2>{viewing ? `提出（${viewing.name}さん）` : '提出'}</h2>
      {viewing ? (
        <p className="hint">
          {viewing.name}さんの提出状況です。提出済みの書類は、「PDFで確認」で内容を確かめてから「確認」を押し、
          確認済みの書類を「承認」してください。確認と承認は同じ人がしてもかまいません。
          確認前の書類は、勤怠一覧・交通費・申請書類・作業報告・スキル表の画面で修正できます。
          確認済み・承認済みの書類を直すときは、「承認を取り消す」「確認を取り消す」で確認前に戻してください。
          確認・承認するには、自分の「印鑑」の画面で印鑑の文字を保存しておく必要があります。
          提出・取り下げは本人だけができます。
        </p>
      ) : (
        <p className="hint">
          提出する書類にチェックを入れてください。選んだ書類の入力がすべて完了すると提出できます（入力のチェックはダウンロードと同じです）。
          提出するには、「印鑑」の画面で印鑑の文字を保存しておく必要があります。
          提出した書類は、取り下げるまで変更できません。
          「PDFで確認」で、入力が完了した書類は提出する前にPDFで見られます（提出した書類も見られます）。
        </p>
      )}

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

      {!viewing && (
        <div className="bulk-select-bar">
          <span className="bulk-select-count">{selectedRows.length}件を選択中</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={toggleAll} disabled={selectableRows.length === 0}>
            {allSelected && selectableRows.length > 0 ? 'すべて解除' : 'すべて選択'}
          </button>
        </div>
      )}

      <DocChecklist
        rows={rows}
        selected={selected}
        onToggle={toggle}
        showSubmission={!statusUnavailable}
        onWithdraw={viewing ? undefined : handleWithdraw}
        onConfirm={viewing && !statusUnavailable ? (key) => { void handleReview('confirm', [key]); } : undefined}
        onUnconfirm={viewing && !statusUnavailable ? (key) => { void handleReview('unconfirm', [key]); } : undefined}
        onApprove={viewing && !statusUnavailable ? (key) => { void handleReview('approve', [key]); } : undefined}
        onUnapprove={viewing && !statusUnavailable ? (key) => { void handleReview('unapprove', [key]); } : undefined}
        onPreview={(key) => { void handlePreview(key); }}
        readOnly={!!viewing}
        busy={busy}
      />

      {viewing && !statusUnavailable && (confirmableKeys.length > 1 || approvableKeys.length > 1) && (
        <div className="bulk-download-actions">
          {confirmableKeys.length > 1 && (
            <button className="btn btn-primary" disabled={busy} onClick={() => { void handleReview('confirm', confirmableKeys); }}>
              {busy ? '処理中…' : `提出済みの書類をすべて確認（${confirmableKeys.length}件）`}
            </button>
          )}
          {approvableKeys.length > 1 && (
            <button className="btn btn-primary" disabled={busy} onClick={() => { void handleReview('approve', approvableKeys); }}>
              {busy ? '処理中…' : `確認済みの書類をすべて承認（${approvableKeys.length}件）`}
            </button>
          )}
        </div>
      )}

      {!viewing && (
        <>
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
        </>
      )}
      {message && <p className="submit-message" role="status">{message}</p>}

      {preview && (
        <PdfPreview
          title={preview.title}
          subtitle={preview.subtitle}
          files={preview.files}
          error={preview.error}
          onClose={closePreview}
        />
      )}
    </div>
  );
}
