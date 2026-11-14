import { useEffect, useId, useRef, useState } from 'react';
import { SEAL_TEXT_MAX, normalizeSealText, sealImage } from '../utils/seal';
import { stampLeaderSeal } from '../utils/stampPdf';
import { collectPdfs, deliverPdfs, savePdf } from '../utils/pdfOutput';
import { loadUserProfile, saveUserProfile } from '../utils/storage';

interface StampLog {
  file: string;
  ok: boolean;
  message: string;
}

interface Props {
  /** 管理者が設定した苗字。印鑑の文字を決めていないときは、この苗字の印鑑になる */
  lastName: string;
}

interface SealResult {
  text: string;
  url: string;
  error: string;
}

// text の印鑑の画像を作る。作り終わるまでは、前に作り終えた画像（stale: true）を返す
function useSealImage(text: string): (SealResult & { stale: boolean }) | null {
  const [result, setResult] = useState<SealResult | null>(null);
  useEffect(() => {
    if (!text) return;
    let alive = true;
    sealImage(text).then(
      (url) => { if (alive) setResult({ text, url, error: '' }); },
      (e: unknown) => { if (alive) setResult({ text, url: '', error: (e as Error).message }); },
    );
    return () => { alive = false; };
  }, [text]);
  if (!text || !result) return null;
  return { ...result, stale: result.text !== text };
}

/**
 * 印鑑の画面。印鑑に入れる文字を本人が決めて保存する（苗字のままでもよい）。
 * 保存していない人は提出できず、リーダー・管理者は確認・承認もできない（データベースでも止める）。
 * 自分のPDFを出力するときは本人欄に自動で押印し、リーダーとして確認・承認したときもこの文字の印鑑が押される。
 * リーダーはメンバーのPDFを読み込み、確認印・確認・検印の欄に自分の印鑑を押すこともできる。
 */
export default function SealTab({ lastName }: Props) {
  const name = normalizeSealText(lastName);
  const inputId = useId();
  // 保存してある印鑑の文字（空なら未設定）と、入力中の文字。
  // 未設定のときは苗字を入れた状態から始める（そのまま保存すれば苗字の印鑑になる）
  const [saved, setSaved] = useState(() => normalizeSealText(loadUserProfile().sealText ?? ''));
  const [draft, setDraft] = useState(() => saved || name);
  const [notice, setNotice] = useState('');
  const [stamping, setStamping] = useState(false);
  const [logs, setLogs] = useState<StampLog[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const draftText = normalizeSealText(draft);
  const tooLong = [...draftText].length > SEAL_TEXT_MAX;
  const changed = draftText !== saved;
  const canSave = changed && draftText !== '' && !tooLong;
  // 見本は入力中の文字の印鑑、検印に使うのは保存してある文字の印鑑
  const preview = useSealImage(tooLong ? '' : draftText);
  const current = useSealImage(saved);
  const sealUrl = current && !current.stale ? current.url : '';

  function store(text: string) {
    saveUserProfile({ ...loadUserProfile(), sealText: text });
    setSaved(text);
    setDraft(text);
    setNotice('印鑑の文字を保存しました');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    store(draftText);
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = ''; // 同じファイルをもう一度選べるように
    if (files.length === 0 || !sealUrl) return;
    setStamping(true);
    const next: StampLog[] = [];
    try {
      // ファイル名はメンバーが出力したときのまま（番号・社員番号つき）で保存する
      const stamped = await collectPdfs(async () => {
        for (const f of files) {
          try {
            const r = await stampLeaderSeal(await f.arrayBuffer(), sealUrl);
            if (r.ok) savePdf(r.bytes, f.name);
            next.push(r.ok
              ? { file: f.name, ok: true, message: `${r.labels.join('・')}の欄に押印しました` }
              : { file: f.name, ok: false, message: r.reason });
          } catch {
            next.push({ file: f.name, ok: false, message: '押印できませんでした' });
          }
        }
      });
      setLogs(next);
      await deliverPdfs(stamped);
    } finally {
      setStamping(false);
    }
  }

  let previewEmpty = '作成中…';
  if (tooLong) previewEmpty = `${SEAL_TEXT_MAX}文字までです`;
  else if (!draftText) previewEmpty = '文字を入力してください';
  else if (preview?.error) previewEmpty = '作成できません';

  return (
    <div className="seal-tab">
      <h2>印鑑</h2>
      <p className="hint">
        PDFに押す印鑑です。印鑑に入れる文字を決めて保存してください（苗字のままでもかまいません）。
      </p>
      {!saved && (
        <div className="notice-banner" role="status">
          <span>
            印鑑の文字がまだ保存されていません。保存するまで、書類の提出（リーダー・管理者は確認・承認）はできません。
            {name && draftText === name && '苗字のままでよければ、そのまま「保存」を押してください。'}
          </span>
        </div>
      )}

      <div className="seal-card">
        <div className={`seal-preview${preview?.stale ? ' is-stale' : ''}`}>
          {preview?.url && !tooLong
            ? <img src={preview.url} alt={`${draftText || name}の印鑑`} />
            : <span className="seal-empty">{previewEmpty}</span>}
        </div>
        <form className="seal-card-body seal-text-form" onSubmit={handleSubmit}>
          <h3><label htmlFor={inputId}>印鑑の文字</label></h3>
          <input
            id={inputId}
            type="text"
            value={draft}
            maxLength={SEAL_TEXT_MAX * 2}
            autoComplete="off"
            spellCheck={false}
            placeholder={name || '例: 佐藤'}
            aria-invalid={tooLong || undefined}
            aria-describedby={`${inputId}-hint`}
            onChange={(e) => { setDraft(e.target.value); setNotice(''); }}
          />
          <p id={`${inputId}-hint`} className="hint hint-inline">
            {SEAL_TEXT_MAX}文字まで。3文字までは縦に1列、4文字からは右から読む2列、英字だけなら横書きになります。
          </p>
          {tooLong && <p className="cloud-message cloud-message-error" role="alert">印鑑の文字は{SEAL_TEXT_MAX}文字までです</p>}
          {!draftText && <p className="cloud-message cloud-message-error" role="alert">印鑑の文字を入力してください</p>}
          {preview?.error && !tooLong && <p className="cloud-message cloud-message-error" role="alert">{preview.error}</p>}
          <div className="cloud-actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={!canSave}>保存</button>
            {draftText !== (saved || name) && (saved || name) && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setDraft(saved || name); setNotice(''); }}>
                入力を戻す
              </button>
            )}
            {!changed && saved && name && saved !== name && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => store(name)}>苗字（{name}）にする</button>
            )}
          </div>
          {canSave && saved && <p className="hint hint-inline">まだ保存していません。保存するとPDFの印鑑が変わります。</p>}
          {!changed && notice && <p className="hint hint-inline" role="status">{notice}</p>}
        </form>
      </div>

      <h3>押される欄</h3>
      <p className="hint">
        PDFを出力するとき、休暇申請書・遅刻早退申請書の「本人」欄と、交通費精算書の「本人印」欄にこの印鑑を自動で押印します。
      </p>
      <p className="hint">
        リーダー・管理者として確認・承認すると、勤務表の「確認印」「承認印」、休暇申請書・遅刻早退申請書の「確認」「承認」、交通費精算書の「検印」「承認」の欄に、確認・承認した人の印鑑が押されます。
        押されるのは確認・承認した時点の印鑑で、あとで文字を変えても、確認・承認済みの書類の印鑑は変わりません。
      </p>
      {!name && <p className="hint">管理者が「ユーザー管理」で苗字を設定すると、PDFを出力できるようになります。</p>}

      <h3>リーダーの検印（メンバーの書類）</h3>
      <div className="stamp-section">
        <p className="hint">
          メンバーがこのアプリで出力したPDFを選ぶと、勤務表の「確認印」、休暇申請書・遅刻早退申請書の「確認」、交通費精算書の「検印」の欄にあなたの印鑑（保存してある文字）を押して保存します。まとめて選べます。
          提出された書類は、「メンバーの提出」から開いて「確認」すると、出力するPDFのこれらの欄に自動で印鑑が押されます（その場合はここでの検印は不要です）。
        </p>
        {!saved && <p className="hint">印鑑の文字を保存すると使えます。</p>}
        {current?.error && <p className="cloud-message cloud-message-error" role="alert">{current.error}</p>}
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="is-hidden" onChange={handleFiles} />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!sealUrl || stamping}
          onClick={() => fileRef.current?.click()}
        >
          {stamping ? '押印しています…' : 'PDFを選んで検印する'}
        </button>
        {logs.length > 0 && (
          <ul className="stamp-log">
            {logs.map((l, i) => (
              <li key={i} className={l.ok ? 'is-ok' : 'is-error'}>
                <span className="stamp-log-file">{l.file}</span>
                <span>{l.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
