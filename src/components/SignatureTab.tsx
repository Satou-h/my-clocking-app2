import { useRef, useState } from 'react';
import SignaturePad from './SignaturePad';
import { loadSignature, saveSignature, type SignatureKind } from '../utils/storage';
import { stampManagerSignature } from '../utils/stampPdf';
import { collectPdfs, deliverPdfs, savePdf } from '../utils/pdfOutput';

interface StampLog {
  file: string;
  ok: boolean;
  message: string;
}

/**
 * サインの登録画面。
 * 本人のサインは自分のPDFの本人欄に自動で入る。
 * 上長のサインは自分のPDFには入れず、部下のPDFを読み込んで確認印・確認・検印の欄に入れる。
 */
export default function SignatureTab() {
  const [signs, setSigns] = useState(() => ({ self: loadSignature('self'), manager: loadSignature('manager') }));
  const [stamping, setStamping] = useState(false);
  const [logs, setLogs] = useState<StampLog[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleChange(kind: SignatureKind, dataUrl: string) {
    saveSignature(kind, dataUrl);
    setSigns((s) => ({ ...s, [kind]: dataUrl }));
  }

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = ''; // 同じファイルをもう一度選べるように
    if (files.length === 0) return;
    setStamping(true);
    const next: StampLog[] = [];
    try {
      // ファイル名は部下が出力したときのまま（番号・社員番号つき）で保存する
      const signed = await collectPdfs(async () => {
        for (const f of files) {
          try {
            const r = await stampManagerSignature(await f.arrayBuffer(), signs.manager);
            if (r.ok) savePdf(r.bytes, f.name);
            next.push(r.ok
              ? { file: f.name, ok: true, message: `${r.labels.join('・')}の欄にサインしました` }
              : { file: f.name, ok: false, message: r.reason });
          } catch {
            next.push({ file: f.name, ok: false, message: 'サインを入れられませんでした' });
          }
        }
      });
      setLogs(next);
      await deliverPdfs(signed);
    } finally {
      setStamping(false);
    }
  }

  return (
    <div className="signature-tab">
      <h2>サイン</h2>
      <p className="hint">
        サインはこの端末に保存されます。ログイン中はクラウドにも保存され、同じアカウントでログインした端末で使えます（QR・カナコードでは移りません）。
      </p>

      <h3>本人のサイン</h3>
      <p className="hint">自分のPDFを出力するとき、休暇申請書・遅刻早退申請書の「本人」欄と、交通費精算書の「本人印」欄に自動で入ります。</p>
      <SignaturePad label="本人のサイン" value={signs.self} onChange={(v) => handleChange('self', v)} />

      <h3>上長の検印（部下の書類）</h3>
      <p className="hint">上長が部下の書類にサインするときに使います。上長のサインは自分のPDFには入りません。</p>
      <SignaturePad label="上長のサイン" value={signs.manager} onChange={(v) => handleChange('manager', v)} />

      <div className="stamp-section">
        <p className="hint">
          部下がこのアプリで出力したPDFを選ぶと、勤務表の「確認印」、休暇申請書・遅刻早退申請書の「確認」、交通費精算書の「検印」の欄に上長のサインを入れて保存します。まとめて選べます。
        </p>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple className="is-hidden" onChange={handleFiles} />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!signs.manager || stamping}
          onClick={() => fileRef.current?.click()}
        >
          {stamping ? 'サインを入れています…' : 'PDFを選んで検印する'}
        </button>
        {!signs.manager && <p className="hint hint-inline mt-8">先に上長のサインを登録してください。</p>}
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
