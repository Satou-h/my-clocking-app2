import { useEffect, useRef, useState } from 'react';
import { loadSignature, saveSignature } from '../utils/storage';

const INK = '#1d2433';
const LINE_WIDTH = 4; // PDFの小さな欄に縮めても線がかすれない太さ
const MAX_SIDE = 600; // 保存する画像の長辺（px）。PDFが重くならないよう縮める

/**
 * 申請書類・交通費PDFの本人欄に入れるサインの登録欄（設定画面）。
 * 登録済みならプレビュー、「サインを書く」「書き直す」で手書き用の枠を開く。
 */
export default function SignaturePad() {
  const [saved, setSaved] = useState(loadSignature);
  const [drawing, setDrawing] = useState(false);

  function handleSave(dataUrl: string) {
    saveSignature(dataUrl);
    setSaved(dataUrl);
    setDrawing(false);
  }

  function handleDelete() {
    if (!window.confirm('登録したサインを削除しますか？')) return;
    saveSignature('');
    setSaved('');
  }

  if (drawing) return <SignatureCanvas onSave={handleSave} onCancel={() => setDrawing(false)} />;

  return (
    <div className="signature">
      {saved
        ? <img className="signature-preview" src={saved} alt="登録済みのサイン" />
        : <p className="signature-empty">未登録</p>}
      <div className="btn-row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDrawing(true)}>
          {saved ? '書き直す' : 'サインを書く'}
        </button>
        {saved && (
          <button type="button" className="btn btn-danger-outline btn-sm" onClick={handleDelete}>削除</button>
        )}
      </div>
    </div>
  );
}

function SignatureCanvas({ onSave, onCancel }: { onSave: (dataUrl: string) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  // 画面の解像度に合わせて描画用の大きさを決める（ぼやけないように）
  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = ctx.fillStyle = INK;
    ctx.lineWidth = LINE_WIDTH * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const context = () => canvasRef.current!.getContext('2d')!;

  // 画面上の位置を描画用の座標に直す（画面の向きが変わって枠の大きさが変わってもずれないように）
  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height };
  }

  function handleDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pos(e);
    // タップしただけの点も残す
    const ctx = context();
    ctx.beginPath();
    ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    last.current = p;
    setEmpty(false);
  }

  function handleMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!last.current) return;
    const p = pos(e);
    const ctx = context();
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  }

  function handleUp() {
    last.current = null;
  }

  function handleClear() {
    const canvas = canvasRef.current!;
    context().clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
  }

  return (
    <div className="signature">
      <p className="hint">枠の中に指やマウスでサインを書いてください。</p>
      <canvas
        ref={canvasRef}
        className="signature-pad"
        aria-label="サインの記入欄"
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
      />
      <div className="btn-row">
        <button type="button" className="btn btn-primary btn-sm" disabled={empty} onClick={() => onSave(cropToInk(canvasRef.current!))}>
          保存
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={empty} onClick={handleClear}>消す</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onCancel}>キャンセル</button>
      </div>
    </div>
  );
}

// 書いた部分だけを切り出して PNG にする（PDFの欄いっぱいに収まるように）
function cropToInk(canvas: HTMLCanvasElement): string {
  const { width, height } = canvas;
  const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  const w = maxX - minX + 1, h = maxY - minY + 1;
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const out = document.createElement('canvas');
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  out.getContext('2d')!.drawImage(canvas, minX, minY, w, h, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}
