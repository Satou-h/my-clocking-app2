import type { DocKey } from '../types/document';
import { fmtDateShort } from '../utils/completeness';
import { formatMinutes } from '../utils/storage';
import { docStatusLabel, type MonthDocItem, type WorkTimeCheck } from '../utils/monthDocs';
import { SUBMISSION_LABELS, fmtSubmittedAt, isLockedStatus, type Submission } from '../utils/submissions';

export interface DocChecklistRow extends MonthDocItem {
  // 提出画面だけ: この月のこの書類の提出状況（未提出なら undefined）
  submission?: Submission;
}

interface ChecklistProps {
  rows: DocChecklistRow[];
  selected: Set<DocKey>;
  onToggle: (key: DocKey) => void;
  // 提出画面: 提出状況（未提出・提出済み・承認済み・差し戻し）を出す
  showSubmission?: boolean;
  onWithdraw?: (key: DocKey) => void;
  // 見るだけ（チェックボックスを出さない。上長・管理者が部下の提出状況を見るとき）
  readOnly?: boolean;
  busy?: boolean;
}

// ダウンロード・提出する書類の一覧（チェックを入れて選ぶ。入力状況と不足している日を出す）
export function DocChecklist({ rows, selected, onToggle, showSubmission = false, onWithdraw, readOnly = false, busy = false }: ChecklistProps) {
  return (
    <div className={`bulk-checklist${readOnly ? ' bulk-checklist-readonly' : ''}`}>
      {rows.map(({ key, label, doc, submission }) => {
        // 提出済み・承認済みの書類は、取り下げるまで選べない
        const locked = showSubmission && isLockedStatus(submission?.status);
        const inputStatus = !doc.required ? 'skip' : doc.complete ? 'ok' : 'missing';
        const status = locked ? submission!.status : inputStatus;
        const selectable = doc.required && !locked;
        const checked = selectable && selected.has(key);
        const hasMissing = doc.missingDates.length > 0;
        const hasExtra = doc.extraDates.length > 0;
        const statusLabel = locked ? SUBMISSION_LABELS[submission!.status] : docStatusLabel(doc);
        const icon = locked ? '済' : inputStatus === 'ok' ? '✓' : inputStatus === 'skip' ? '－' : '×';
        const rejected = showSubmission && submission?.status === 'rejected';
        return (
          <div key={key} className={`bulk-check-item bulk-check-${status}${checked || locked || readOnly ? '' : ' bulk-check-unselected'}`}>
            <label className="bulk-check-head">
              <input
                type="checkbox"
                className="bulk-check-select"
                checked={checked}
                disabled={!selectable}
                onChange={() => onToggle(key)}
              />
              <span className="bulk-check-icon">{icon}</span>
              <span className="bulk-check-label">
                {label}
                {showSubmission && !locked && doc.required && (
                  rejected
                    ? <span className="submit-badge submit-badge-rejected">差し戻し</span>
                    : <span className="submit-badge submit-badge-none">未提出</span>
                )}
              </span>
              <span className="bulk-check-status">{statusLabel}</span>
            </label>
            {locked && (
              <div className="bulk-submission-row">
                <span>
                  {fmtSubmittedAt(submission!.submittedAt)}に提出
                  {submission!.status === 'approved' && submission!.reviewedAt && `・${fmtSubmittedAt(submission!.reviewedAt)}に承認`}
                </span>
                {submission!.modifiedAt && (
                  <span className="bulk-modified">
                    {fmtSubmittedAt(submission!.modifiedAt)}に
                    {submission!.modifiedByName ? `${submission!.modifiedByName}さん` : '上長・管理者'}が修正
                  </span>
                )}
                {submission!.status === 'submitted' && onWithdraw && (
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onWithdraw(key)}>
                    取り下げ
                  </button>
                )}
                {submission!.status === 'approved' && <span>（承認済みのため取り下げできません）</span>}
              </div>
            )}
            {rejected && (
              <div className="bulk-missing-dates">
                {submission!.reviewedAt ? `${fmtSubmittedAt(submission!.reviewedAt)}に差し戻し` : '差し戻し'}
                {submission!.reviewComment ? `（理由: ${submission!.reviewComment}）` : ''}。直してから、もう一度提出してください
              </div>
            )}
            {!locked && hasMissing && (
              <div className="bulk-missing-dates">
                未入力: {doc.missingDates.map(fmtDateShort).join('、')}
              </div>
            )}
            {!locked && hasExtra && (
              <div className="bulk-missing-dates bulk-extra-dates">
                不要: {doc.extraDates.map(fmtDateShort).join('、')}（在宅勤務・有給などのため交通費は不要です。削除してください）
              </div>
            )}
            {!locked && doc.issues.map((issue) => (
              <div key={issue} className="bulk-missing-dates">{issue}</div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

interface VerifyProps {
  check: WorkTimeCheck;
  totalWorkMins: number;
  kishaSummary: string;
  // 一致しないときにできなくなる操作（ダウンロード・提出）
  action: string;
}

// 現場（客先）システムの月間総勤務時間との検算
export function WorkTimeVerify({ check, totalWorkMins, kishaSummary, action }: VerifyProps) {
  const { hours, mins, setHours, setMins, filled, passed } = check;
  return (
    <div className={`bulk-check-item bulk-check-verify${!filled ? '' : passed ? ' bulk-check-ok' : ' bulk-check-missing'}`}>
      <div className="bulk-check-head">
        <span className="bulk-check-icon">{filled ? (passed ? '✓' : '×') : '？'}</span>
        <span className="bulk-check-label">現場の総勤務時間（検算）</span>
        <span className="bulk-check-status">
          {!filled ? '未入力（任意）' : passed ? '一致' : '不一致'}
        </span>
      </div>
      <div className="bulk-verify-body">
        <p className="hint mb-8">
          現場（客先）システムで確認した月間総勤務時間を入力してください。
          システムの計算値と一致しない場合は勤務表を{action}できません。未入力の場合はスキップされます。
          ※ 勤務区分が帰社の日は、帰社した時間を計算から除外します（午前/午後帰社は切替時刻で按分）。
        </p>
        <div className="bulk-verify-row">
          <label className="bulk-verify-label">現場の総勤務時間</label>
          <input
            type="number"
            min={0}
            className="bulk-verify-input"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="0"
          />
          <span className="bulk-verify-unit">時間</span>
          <input
            type="number"
            min={0}
            max={59}
            className="bulk-verify-input bulk-verify-input-min"
            value={mins}
            onChange={(e) => setMins(e.target.value)}
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
              setHours(String(Math.floor(totalWorkMins / 60)));
              setMins(String(totalWorkMins % 60));
            }}
          >
            計算値を入力
          </button>
        </div>
        {filled && !passed && (
          <div className="bulk-missing-dates">
            入力値（{parseInt(hours) || 0}時間{parseInt(mins) || 0}分）がシステム計算値（{formatMinutes(totalWorkMins)}）と一致しません
          </div>
        )}
      </div>
    </div>
  );
}
