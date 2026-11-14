// 印鑑（朱色の丸印）の画像を作る。文字は本人が「印鑑」の画面で決めたもの（決めていなければ苗字）
// 自分のPDFの本人欄・リーダーの検印（stampPdf.ts）に押し、印鑑の画面でも同じ画像を見せる。
// 文字はPDFと同じ同梱フォント（NotoSansJP）で描くので、端末によって形が変わらない。
// ふだんは常用字のフォント（common）で描き、common にない字があるときだけ元のフォント（full）を読み込む（pdfKit.ts）
import { commonFontCovers, loadRawFont, type FontKind } from './pdfKit';

/** 印鑑に入れられる文字数（データベースの profiles.seal_text も同じ上限） */
export const SEAL_TEXT_MAX = 6;

/** 印鑑の文字から空白を除く（印鑑には空白を入れない） */
export function normalizeSealText(text: string): string {
  return text.replace(/\s/g, '');
}

/** PDF に押す印鑑の文字。空の欄には押さない */
export interface SealTexts {
  self?: string;      // 本人欄（休暇・遅刻早退申請書: 本人 / 交通費精算書: 本人印）
  approver?: string;  // 承認した人（承認済みの書類。勤務表: 承認印 / ほか: 承認）
  confirmer?: string; // 確認した人（確認済み・承認済みの書類。勤務表: 確認印 / 申請書: 確認 / 交通費精算書: 検印）
}

const SIZE = 480;        // 画像の一辺（px）。PDFの欄（直径 1cm ほど）に縮めても十分な細かさ
const RED = '#D6332B';   // 朱肉の色
const RING = 0.045;      // 外枠の太さ（直径に対する割合）
const GAP = 0.035;       // 外枠と文字のすき間（直径に対する割合）
const WEIGHT = 0.04;     // 文字の輪郭をなぞる線の太さ（文字の大きさに対する割合）。印鑑らしく太くする
const FILL = 1.08;       // 文字のまとまりを円いっぱいに広げる割合（字の角は枠まで届かないため少しはみ出させる）
const EM_CENTER = 0.38;  // 漢字の字面の中心（ベースラインからの高さ。NotoSansJP の仮想ボディは -0.12〜0.88）
const FAMILY = 'ClockingSeal';

// kind のフォントを読み込み、canvas で使う font-family の名前を返す（読み込みはフォントごとに1回だけ）
const fontReady = new Map<FontKind, Promise<string>>();
function loadSealFont(kind: FontKind): Promise<string> {
  let ready = fontReady.get(kind);
  if (!ready) {
    const family = `${FAMILY}-${kind}`;
    ready = (async () => {
      const face = new FontFace(family, (await loadRawFont(kind)).slice(0));
      await face.load();
      document.fonts.add(face);
      return family;
    })();
    ready.catch(() => fontReady.delete(kind));
    fontReady.set(kind, ready);
  }
  return ready;
}

const cache = new Map<string, Promise<string>>();

/** text の印鑑の画像（PNG の data URL）。text が空なら空文字 */
export function sealImage(text: string): Promise<string> {
  const name = normalizeSealText(text);
  if (!name) return Promise.resolve('');
  let image = cache.get(name);
  if (!image) {
    image = commonFontCovers(name)
      .then((covered) => loadSealFont(covered ? 'common' : 'full'))
      .then((family) => drawSeal(name, family))
      .catch(() => {
        cache.delete(name);
        throw new Error('印鑑の画像を作れませんでした。通信状態を確認してから、もう一度お試しください');
      });
    cache.set(name, image);
  }
  return image;
}

// family: loadSealFont で読み込んだフォントの名前
function drawSeal(name: string, family: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas を使えません');
  const c = SIZE / 2;
  const ring = SIZE * RING;
  ctx.strokeStyle = ctx.fillStyle = RED;
  ctx.lineJoin = 'round';

  // 外枠
  ctx.lineWidth = ring;
  ctx.beginPath();
  ctx.arc(c, c, c - ring / 2 - 1, 0, Math.PI * 2);
  ctx.stroke();

  const r = c - ring - SIZE * GAP; // 文字を置ける円の半径
  const chars = [...name];

  // 英字の苗字は横書きで1行に収める
  if (/^[\x21-\x7e]+$/.test(name)) {
    ctx.font = `100px ${family}`;
    const size = Math.min(r * 0.8, (r * 2 * 0.9 * 100) / ctx.measureText(name).width);
    ctx.font = `${size}px ${family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = size * WEIGHT;
    ctx.fillText(name, c, c);
    ctx.strokeText(name, c, c);
    return canvas.toDataURL('image/png');
  }

  // 縦書き。3文字までは1列（字を平たくして円に収める）、4文字からは右の列から読む複数列
  const n = chars.length;
  const cols = n <= 3 ? 1 : Math.ceil(n / 3);
  const rows = Math.ceil(n / cols);
  const aspect = cols === 1 ? [1, 1.6, 1.9][n - 1] : rows / cols; // 文字のまとまりの 高さ÷幅
  // まとまり（長方形）の対角線を円の直径に合わせる
  const blockW = (r * 2 * FILL) / Math.hypot(1, aspect);
  const blockH = blockW * aspect;
  const cellW = blockW / cols;
  const cellH = blockH / rows;
  const size = cellW;

  ctx.font = `${size}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = size * WEIGHT;
  chars.forEach((ch, i) => {
    const col = cols - 1 - Math.floor(i / rows);
    const row = i % rows;
    ctx.save();
    ctx.translate(c - blockW / 2 + cellW * (col + 0.5), c - blockH / 2 + cellH * (row + 0.5));
    ctx.scale(1, cellH / cellW);
    ctx.fillText(ch, 0, size * EM_CENTER);
    ctx.strokeText(ch, 0, size * EM_CENTER);
    ctx.restore();
  });
  return canvas.toDataURL('image/png');
}
