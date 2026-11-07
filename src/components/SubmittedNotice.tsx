import { DOC_LABELS, type DocKey } from '../types/document';
import { findSubmission, isLockedStatus, useSubmissions, type Submission } from '../utils/submissions';
import Icon from './Icon';

interface Props {
  docs: DocKey[];
  year: number;
  month: number;
}

// 入力画面に出す「この月の○○は提出済みのため変更できません」
export default function SubmittedNotice({ docs, year, month }: Props) {
  const { items } = useSubmissions();
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
