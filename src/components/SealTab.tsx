import { useEffect, useRef, useState } from 'react';
import { sealImage } from '../utils/seal';
import { stampLeaderSeal } from '../utils/stampPdf';
import { collectPdfs, deliverPdfs, savePdf } from '../utils/pdfOutput';

interface StampLog {
  file: string;
  ok: boolean;
  message: string;
}

interface Props {
  /** 「設定」の苗字。ここから印鑑を作る */
  lastName: string;
}

/**
 * 印鑑の画面。印鑑は「設定」の苗字から自動で作る（登録は不要）。
 * 自分のPDFを出力するときは本人欄に自動で押印する。
 * リーダーはメンバーのPDFを読み込み、確認印・確認・検印の欄に自分の印鑑を押す。
 */
export default function SealTab({ lastName }: Props) {
  const name = lastName.trim();
  const [seal, setSeal] = useState<{ name: string; url: string; error: string } | null>(null);
  const [stamping, setStamping] = useState(false);
  const [logs, setLogs] = useState<StampLog[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!name) return;
    let alive = true;
    sealImage(name).then(
      (url) => { if (alive) setSeal({ name, url, error: '' }); },
      (e: unknown) => { if (alive) setSeal({ name, url: '', error: (e as Error).message }); },
    );
    return () => { alive = false; };
  }, [name]);

  // 苗字を変えた直後は、前の苗字の印鑑を出さない
  const current = seal && seal.name === name ? seal : null;
  const sealUrl = current?.url ?? '';

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

  return (
    <div className="seal-tab">
      <h2>印鑑</h2>
      <p className="hint">「設定」の苗字から印鑑を自動で作ります。登録の必要はありません。</p>

      <div className="seal-card">
        <div className="seal-preview">
          {sealUrl
            ? <img src={sealUrl} alt={`${name}の印鑑`} />
            : <span className="seal-empty">{!name ? '苗字が未設定' : current?.error ? '作成できません' : '作成中…'}</span>}
        </div>
        <div className="seal-card-body">
          <h3>本人の押印</h3>
          <p className="hint">
            PDFを出力するとき、休暇申請書・遅刻早退申請書の「本人」欄と、交通費精算書の「本人印」欄に自動で押印します。
          </p>
          <p className="hint">
            リーダー・管理者が承認した書類は、勤務表の「承認印」、休暇申請書・遅刻早退申請書・交通費精算書の「承認」欄に、承認した人の印鑑も押されます。
          </p>
          {!name && <p className="hint hint-inline">管理者が「ユーザー管理」で苗字を設定すると、印鑑が作られます。</p>}
          {current?.error && <p className="hint hint-inline">{current.error}</p>}
        </div>
      </div>

      <h3>リーダーの検印（メンバーの書類）</h3>
      <div className="stamp-section">
        <p className="hint">
          メンバーがこのアプリで出力したPDFを選ぶと、勤務表の「確認印」、休暇申請書・遅刻早退申請書の「確認」、交通費精算書の「検印」の欄にあなたの印鑑を押して保存します。まとめて選べます。
          提出された書類は、「メンバーの提出」から開いて「確認」すると、出力するPDFのこれらの欄に自動で印鑑が押されます（その場合はここでの検印は不要です）。
        </p>
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
