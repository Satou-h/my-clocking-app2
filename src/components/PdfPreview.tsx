import { useEffect, useRef, useState } from 'react';
import { renderPdfPages, type PageImage } from '../utils/pdfRender';
import { ATTENDANCE_CALC_LABEL } from '../types/document';

interface Props {
  // 書類の名前（例: 勤務表）と、その下に出す説明（例: 山田さん・2026年10月）
  title: string;
  subtitle: string;
  // 表示するPDF。null の間は作成中
  files: File[] | null;
  // PDFを作れなかったときの説明
  error: string;
  onClose: () => void;
}

// 拡大の段階（1 = 画面の幅に合わせる）
const ZOOMS = [1, 1.5, 2, 3];

// 描く画像の横幅（拡大しても読めるように、表示する幅の2倍くらいで描く）
function renderWidth(): number {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  return Math.round(Math.min(2400, Math.max(1600, Math.min(window.innerWidth, 1000) * dpr * 2)));
}

// PDFを画面で見るだけのダイアログ（保存はしない）
export default function PdfPreview({ title, subtitle, files, error, onClose }: Props) {
  const [zoom, setZoom] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  // 開いている間は後ろの画面をスクロールさせない
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const scale = ZOOMS[zoom];
  const message = error ? `PDFを作成できませんでした（${error}）`
    : files === null ? 'PDFを作成しています…'
    : files.length === 0 ? 'この月には表示できる書類がありません'
    : '';

  return (
    <div className="pdf-preview-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pdf-preview" role="dialog" aria-modal="true" aria-label={`${title}のPDF`}>
        <div className="pdf-preview-head">
          <div className="pdf-preview-title">
            <strong>{title}</strong>
            <span>{subtitle}</span>
          </div>
          <div className="pdf-preview-zoom" role="group" aria-label="拡大・縮小">
            <button
              type="button" className="btn btn-secondary btn-sm" aria-label="縮小"
              disabled={zoom === 0} onClick={() => setZoom((z) => Math.max(0, z - 1))}
            >－</button>
            <span className="pdf-preview-zoom-value">{Math.round(scale * 100)}%</span>
            <button
              type="button" className="btn btn-secondary btn-sm" aria-label="拡大"
              disabled={zoom === ZOOMS.length - 1} onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
            >＋</button>
          </div>
          <button ref={closeRef} type="button" className="btn btn-primary btn-sm" onClick={onClose}>閉じる</button>
        </div>

        <div className="pdf-preview-body">
          {message || !files
            ? <p className="pdf-preview-message" role="status">{message}</p>
            : <PdfPages files={files} title={title} scale={scale} />}
        </div>
      </div>
    </div>
  );
}

// files の各ページを画像にして縦に並べる（休暇申請書など、1か月に複数あるときは件ごとに分ける）
function PdfPages({ files, title, scale }: { files: File[]; title: string; scale: number }) {
  // files[i] のページの画像
  const [pages, setPages] = useState<PageImage[][]>(() => files.map(() => []));
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    const width = renderWidth();
    (async () => {
      for (const [i, file] of files.entries()) {
        await renderPdfPages(file, width, (page) => {
          urls.push(page.url);
          setPages((prev) => prev.map((list, j) => (j === i ? [...list, page] : list)));
        }, () => cancelled);
      }
    })()
      .catch((e: Error) => { if (!cancelled) setError(e.message || String(e)); })
      .finally(() => { if (!cancelled) setRendering(false); });
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  if (error) return <p className="pdf-preview-message" role="status">PDFを表示できませんでした（{error}）</p>;

  // 勤務表は提出用と計算用の2件（計算用はファイル名で見分ける）。それ以外は件数で分ける
  const isCalc = (f: File) => f.name.includes(ATTENDANCE_CALC_LABEL);
  const hasCalc = files.some(isCalc);
  const labelOf = (i: number) => (isCalc(files[i]) ? ATTENDANCE_CALC_LABEL : hasCalc ? title : `${title}（${i + 1} / ${pages.length}件）`);

  return (
    <div className="pdf-preview-pages" style={{ width: `${scale * 100}%` }}>
      {pages.map((list, i) => (
        <section key={i} className="pdf-preview-file">
          {pages.length > 1 && <p className="pdf-preview-file-label">{labelOf(i)}</p>}
          {list.map((page, n) => (
            <img
              key={page.url}
              className="pdf-preview-page"
              src={page.url}
              alt={`${title} ${n + 1}ページ目`}
              style={{ aspectRatio: `${page.width} / ${page.height}` }}
            />
          ))}
        </section>
      ))}
      {rendering && <p className="pdf-preview-message" role="status">表示しています…</p>}
    </div>
  );
}
