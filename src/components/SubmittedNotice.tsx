import { DOC_LABELS, type DocKey } from '../types/document';
import { findSubmission, isLockedStatus, useSubmissions, type Submission, type SubmissionStatus } from '../utils/submissions';
import { useCloudState } from '../utils/cloudSync';
import Icon from './Icon';

interface Props {
  docs: DocKey[];
  // 月ごとの書類の年月（スキル表のように月ごとでない書類は指定しない）
  year?: number;
  month?: number;
}

// 入力画面に出す案内
// ・自分のデータ: 「この月の○○は提出済みのため変更できません」
// ・上長・管理者として部下のデータを開いているとき: 「○○は提出済みのため修正できます／提出されていないため修正できません」
export default function SubmittedNotice({ docs, year, month }: Props) {
  const { items } = useSubmissions();
  const viewing = useCloudState().viewing;
  const monthly = year !== undefined && month !== undefined;
  const prefix = monthly ? `${year}年${month}月の` : '';

  if (viewing) {
    // 月ごとでない書類は、どこかの月で提出済み（承認前）なら修正できる
    const statusOf = (d: DocKey): SubmissionStatus | undefined => (monthly
      ? findSubmission(items, d, year, month)?.status
      : items.some((s) => s.doc === d && s.status === 'submitted') ? 'submitted' : undefined);
    const names = (pick: (s: SubmissionStatus | undefined) => boolean) =>
      docs.filter((d) => pick(statusOf(d))).map((d) => DOC_LABELS[d]).join('・');
    const sentences = [
      [names((s) => s === 'submitted'), '提出済みのため、修正できます。'],
      [names((s) => s === 'approved'), '承認済みのため、修正できません。'],
      [names((s) => s !== 'submitted' && s !== 'approved'), '提出されていないため、修正できません。'],
    ].filter(([n]) => n).map(([n, text], i) => `${i === 0 ? prefix : ''}${n}は${text}`);
    const editable = docs.some((d) => statusOf(d) === 'submitted');
    return (
      <div className={`notice-banner${editable ? ' notice-submitted' : ''}`} role="status">
        <Icon name={editable ? 'inbox' : 'lock'} />
        <span>{sentences.join('')}</span>
      </div>
    );
  }

  if (!monthly) return null; // 月ごとでない書類（スキル表）は、本人は提出後も変更できる
  const locked = docs
    .map((d) => findSubmission(items, d, year, month))
    .filter((s): s is Submission => !!s && isLockedStatus(s.status));
  if (locked.length === 0) return null;

  const names = (status: Submission['status']) =>
    locked.filter((s) => s.status === status).map((s) => DOC_LABELS[s.doc]).join('・');
  const submitted = names('submitted');
  const approved = names('approved');
  const parts = [
    submitted && `${submitted}は提出済み`,
    approved && `${approved}は承認済み`,
  ].filter(Boolean).join('、');

  return (
    <div className="notice-banner notice-submitted" role="status">
      <Icon name="lock" />
      <span>
        {year}年{month}月の{parts}のため変更できません。
        {submitted && '変更するには「提出」画面で取り下げてください。'}
      </span>
    </div>
  );
}
