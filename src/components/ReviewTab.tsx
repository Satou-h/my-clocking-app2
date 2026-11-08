import { useEffect, useState } from 'react';
import { DOC_KEYS, DOC_LABELS } from '../types/document';
import { SUBMISSION_LABELS, findSubmission, isLockedStatus } from '../utils/submissions';
import { listReviewMembers, memberName, type ReviewMember } from '../utils/review';
import { openMemberData } from '../utils/cloudSync';

interface Props {
  // 部下のデータを開いたあと（開いた月の提出画面を出す）
  onOpened: (year: number, month: number) => void;
}

// リーダー・管理者が、メンバーの提出状況を確かめ、メンバーのデータを開いて提出済みの書類を承認・修正する画面
export default function ReviewTab({ onOpened }: Props) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [members, setMembers] = useState<ReviewMember[] | null>(null);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const currentYear = now.getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  useEffect(() => {
    let alive = true;
    listReviewMembers()
      .then((list) => { if (alive) { setMembers(list); setError(''); } })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [reloadKey]);

  async function open(m: ReviewMember) {
    setOpening(m.userId);
    const err = await openMemberData({ userId: m.userId, name: memberName(m) });
    setOpening(null);
    if (err) {
      alert(`${memberName(m)}さんのデータを開けませんでした。\n\n${err}`);
      return;
    }
    onOpened(year, month);
  }

  return (
    <div className="bulk-tab review-tab">
      <h2>メンバーの提出</h2>
      <p className="hint">
        自分以外の全員の提出状況です。「開いて確認」を押すとその人のデータを開きます。
        提出画面で提出済みの書類を承認でき、承認前の書類はいつもの画面で修正できます。修正した日時と名前は、本人の提出画面に表示されます。
        承認した書類のPDFには、承認欄にあなたの印鑑が押されます。
      </p>

      <div className="list-filter">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="年">
          {years.map((y) => <option key={y} value={y}>{y}年</option>)}
        </select>
        <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="月">
          {months.map((m) => <option key={m} value={m}>{m}月</option>)}
        </select>
        <button type="button" className="btn btn-secondary btn-sm review-reload" onClick={() => setReloadKey((k) => k + 1)}>
          読み込み直す
        </button>
      </div>

      {error && (
        <div className="notice-banner" role="status"><span>メンバーの一覧を読み込めませんでした（{error}）</span></div>
      )}
      {!error && members === null && <p className="hint">読み込んでいます…</p>}
      {members?.length === 0 && (
        <p className="hint">表示できるメンバーがいません。「ユーザー管理」でアカウントを作ると、ここに表示されます。</p>
      )}

      <div className="review-list">
        {members?.map((m) => {
          const rows = DOC_KEYS.map((doc) => ({ doc, s: findSubmission(m.submissions, doc, year, month) }));
          const editable = rows.filter((r) => r.s?.status === 'submitted').length;
          const submitted = rows.filter((r) => isLockedStatus(r.s?.status)).length;
          return (
            <div key={m.userId} className="review-member">
              <div className="review-member-head">
                <span className="review-member-name">{memberName(m)}</span>
                {m.employeeId && <span className="review-member-id">{m.employeeId}</span>}
                <span className="review-member-count">提出済み {submitted} / {DOC_KEYS.length}件</span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={opening !== null}
                  onClick={() => { void open(m); }}
                >
                  {opening === m.userId ? '開いています…' : '開いて確認'}
                </button>
              </div>
              <div className="review-doc-list">
                {rows.map(({ doc, s }) => (
                  <span key={doc} className={`review-doc review-doc-${s?.status ?? 'none'}`}>
                    {DOC_LABELS[doc]}<b>{s ? SUBMISSION_LABELS[s.status] : '未提出'}</b>
                  </span>
                ))}
              </div>
              {editable === 0 && (
                <p className="review-member-note">この月に承認・修正できる書類（提出済み・承認前）はありません</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
