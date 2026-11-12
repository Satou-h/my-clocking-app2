// 勤務表・交通費・申請書PDF（pdf-lib）で共有するフォント読み込み・色・描画ヘルパー
import {
  LineJoinStyle, PDFBool, PDFHexString, PDFName, PDFString, TextRenderingMode, popGraphicsState, pushGraphicsState, rgb,
  setLineJoin, setLineWidth, setStrokingColor, setTextRenderingMode,
  type PDFDocument, type PDFFont, type PDFImage, type PDFPage, type RGB,
} from 'pdf-lib';
import { savePdf } from './pdfOutput';

// ── 押印欄の印鑑を押す範囲 ────────────────────────────────────────────────────
// リーダーがメンバーのPDFを読み込んで検印するとき（stampPdf.ts）に使うため、各欄の範囲をPDFの中に書いておく。
// レイアウトを変えても、そのPDFを作ったときの位置で検印できる。
export interface SignArea { x: number; y: number; w: number; h: number } // PDF の座標（左下が原点）・1ページ目
export type SignAreas = Record<string, SignArea>;

const SIGN_AREAS_KEY = PDFName.of('ClockingSignAreas');

export function writeSignAreas(doc: PDFDocument, areas: SignAreas): void {
  doc.catalog.set(SIGN_AREAS_KEY, PDFHexString.fromText(JSON.stringify(areas)));
}

// このアプリで出力したPDFでなければ null
export function readSignAreas(doc: PDFDocument): SignAreas | null {
  const raw = doc.catalog.lookupMaybe(SIGN_AREAS_KEY, PDFString, PDFHexString);
  if (!raw) return null;
  try {
    return JSON.parse(raw.decodeText()) as SignAreas;
  } catch {
    return null;
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

// リーダーの印鑑を確認の欄（確認印・確認・検印）に押したことをPDFに書いておく。
// 確認済みの書類を出力したときと、印鑑の画面で手で検印したとき（stampPdf.ts）に書き、手で二重に押さないようにする
const LEADER_SIGNED_KEY = PDFName.of('ClockingManagerSigned');

export function markLeaderSigned(doc: PDFDocument): void {
  doc.catalog.set(LEADER_SIGNED_KEY, PDFBool.True);
}

export function isLeaderSigned(doc: PDFDocument): boolean {
  return !!doc.catalog.get(LEADER_SIGNED_KEY);
}

// 画像を範囲の中に縦横比を保って中央に収める
export function drawImageFit(page: PDFPage, img: PDFImage, { x, y, w, h }: SignArea): void {
  const s = Math.min(w / img.width, h / img.height);
  const iw = img.width * s, ih = img.height * s;
  page.drawImage(img, { x: x + (w - iw) / 2, y: y + (h - ih) / 2, width: iw, height: ih });
}

// ── フォント（public/fonts の NotoSansJP-Regular を共有） ─────────────────────
// スキルシート・職務経歴書PDF（skillPdf.ts）もここから読み込む。
// PDFには使う文字だけを埋め込む（embedFont の subset:true）。
// NotoSansJP はバイト長が奇数のグリフを含み、fontkit は小さなサブセットを短い形式の loca
// （オフセット÷2）で書き出すため、そのままだとグリフの位置がずれて文字が化ける。
// 読み込み時に各グリフを偶数バイトに詰め直しておく（字形は変わらない）。
let rawFont: Promise<ArrayBuffer> | null = null;
// 同梱フォントのファイルそのまま（印鑑の画像を描くとき（seal.ts）にも使う。読み込みは1回だけ）
export function loadRawFont(): Promise<ArrayBuffer> {
  rawFont ??= fetch(import.meta.env.BASE_URL + 'fonts/NotoSansJP-Regular.ttf')
    .then((res) => {
      if (!res.ok) throw new Error('フォントの読み込みに失敗しました');
      return res.arrayBuffer();
    })
    .catch((e: unknown) => {
      rawFont = null; // 次に出力するときに読み込み直す
      throw e;
    });
  return rawFont;
}

let cachedFontBytes: Uint8Array | null = null;
export async function loadFont(): Promise<Uint8Array> {
  if (cachedFontBytes) return cachedFontBytes;
  cachedFontBytes = padGlyphs(new Uint8Array(await loadRawFont()));
  return cachedFontBytes;
}

// TrueType の glyf の各グリフを偶数バイトに詰め直し、loca を書き直したフォントを返す
function padGlyphs(src: Uint8Array): Uint8Array {
  const dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const tables = Array.from({ length: dv.getUint16(4) }, (_, i) => {
    const rec = 12 + i * 16;
    return { rec, tag: String.fromCharCode(...src.subarray(rec, rec + 4)), offset: dv.getUint32(rec + 8), length: dv.getUint32(rec + 12) };
  });
  const table = (tag: string) => tables.find(t => t.tag === tag);
  const head = table('head'), maxp = table('maxp'), loca = table('loca'), glyf = table('glyf');
  // 短い形式の loca のフォントは元から偶数バイト
  if (!head || !maxp || !loca || !glyf || dv.getInt16(head.offset + 50) !== 1) return src;

  const numGlyphs = dv.getUint16(maxp.offset + 4);
  const at = (i: number) => dv.getUint32(loca.offset + i * 4);
  const offsets = [0];
  for (let i = 0; i < numGlyphs; i++) offsets.push(offsets[i] + ((at(i + 1) - at(i) + 1) & ~1));
  const glyfLen = offsets[numGlyphs];

  // テーブルを元の並び順のまま 4バイト境界で詰めて書き直す（glyf だけ差し替え）
  const align4 = (v: number) => (v + 3) & ~3;
  const headerLen = 12 + tables.length * 16;
  const out = new Uint8Array(tables.reduce((a, t) => a + align4(t === glyf ? glyfLen : t.length), headerLen));
  const ov = new DataView(out.buffer);
  out.set(src.subarray(0, headerLen));
  let pos = headerLen;
  for (const t of [...tables].sort((a, b) => a.offset - b.offset)) {
    ov.setUint32(t.rec + 8, pos);
    if (t === glyf) {
      ov.setUint32(t.rec + 12, glyfLen);
      for (let i = 0; i < numGlyphs; i++) out.set(src.subarray(glyf.offset + at(i), glyf.offset + at(i + 1)), pos + offsets[i]);
      pos += align4(glyfLen);
    } else {
      out.set(src.subarray(t.offset, t.offset + t.length), pos);
      if (t === loca) offsets.forEach((o, i) => ov.setUint32(pos + i * 4, o));
      pos += align4(t.length);
    }
  }
  return out;
}

export function downloadPdf(bytes: Uint8Array, filename: string): void {
  savePdf(bytes, filename);
}

// ── 色 ────────────────────────────────────────────────────────────────────────
export const hex = (h: string) =>
  rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

export const C = {
  ink: hex('#1F2633'),
  sub: hex('#6B7280'),
  faint: hex('#B9BFC9'),
  line: hex('#E4E7ED'),
  lineStrong: hex('#C9D0DB'),
  primary: hex('#2B63D9'),
  primarySoft: hex('#EDF2FC'),
  headerSub: hex('#C8D7F6'),
  sat: hex('#2B63D9'),
  sun: hex('#D14343'),
  over: hex('#DD6210'),
  off: hex('#F4F5F7'),
  leaveSoft: hex('#FFF4D6'),
  leave: hex('#8A6200'),
  alertSoft: hex('#FDE8E8'),
  white: rgb(1, 1, 1),
};

export const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

// 分 → "8:20"
export const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
// "08:40" → "8:40"
export const shortTime = (t: string) => t.replace(/^0(\d):/, '$1:');
// 上部の集計は明細と同じ 10分単位（切り上げ）の 時:分。178:35 → "178:40"
export const hm10 = (min: number) => hm(Math.ceil(min / 10) * 10);

export type Align = 'left' | 'center' | 'right';

// ── 描画ヘルパー（y は上端からの距離で扱う） ─────────────────────────────────
export function createPainter(page: PDFPage, font: PDFFont) {
  const H = page.getHeight();
  const width = (s: string, size: number) => font.widthOfTextAtSize(s, size);

  // yBase: 上端からベースラインまでの距離
  function txt(s: string, x: number, yBase: number, size: number, color: RGB, align: Align = 'left', w = 0) {
    const tw = width(s, size);
    const dx = align === 'center' ? x + (w - tw) / 2 : align === 'right' ? x + w - tw : x;
    page.drawText(s, { x: dx, y: H - yBase, size, font, color });
  }
  // draw() の中で描く文字を太字にする。同梱フォントは Regular だけなので、輪郭を太さ w の線でなぞって太らせる
  function bold(draw: () => void, color: RGB, w: number) {
    page.pushOperators(
      pushGraphicsState(), setTextRenderingMode(TextRenderingMode.FillAndOutline),
      setStrokingColor(color), setLineWidth(w), setLineJoin(LineJoinStyle.Round),
    );
    draw();
    page.pushOperators(popGraphicsState());
  }
  // 枠 (x, y, w, h) の中で縦中央にそろえる
  function cell(s: string, x: number, y: number, w: number, h: number, size: number, color: RGB, align: Align = 'right', pad = 8) {
    if (!s) return;
    const base = y + h / 2 + size * 0.36;
    if (align === 'right') txt(s, x, base, size, color, 'right', w - pad);
    else if (align === 'left') txt(s, x + pad, base, size, color);
    else txt(s, x, base, size, color, 'center', w);
  }
  function rect(x: number, y: number, w: number, h: number, o: { fill?: RGB; stroke?: RGB; bw?: number }) {
    page.drawRectangle({
      x, y: H - y - h, width: w, height: h,
      color: o.fill, borderColor: o.stroke, borderWidth: o.stroke ? (o.bw ?? 0.6) : 0,
    });
  }
  function hline(x1: number, x2: number, y: number, color: RGB, t = 0.5) {
    page.drawLine({ start: { x: x1, y: H - y }, end: { x: x2, y: H - y }, thickness: t, color });
  }
  function vline(x: number, y1: number, y2: number, color: RGB, t = 0.5, opacity = 1) {
    page.drawLine({ start: { x, y: H - y1 }, end: { x, y: H - y2 }, thickness: t, color, opacity });
  }
  // 角丸のバッジ（文字は中央）
  function badge(label: string, x: number, y: number, rowH: number, size: number, bg: RGB, color: RGB, minW = 0) {
    const w = Math.max(minW, width(label, size) + 8);
    const h = Math.min(size + 4, rowH - 2.5);
    const top = y + (rowH - h) / 2;
    const r = h / 2;
    page.drawSvgPath(
      `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`,
      { x, y: H - top, color: bg },
    );
    cell(label, x, y, w, rowH, size, color, 'center');
    return w;
  }
  // 幅に収まらない文字列は … で切る
  function fit(s: string, size: number, max: number) {
    if (width(s, size) <= max) return s;
    while (s.length && width(s + '…', size) > max) s = s.slice(0, -1);
    return s + '…';
  }
  // 幅で折り返す（改行は保つ。句読点・閉じかっこは行頭に送らず前の行に残す）
  function wrap(s: string, size: number, max: number) {
    const lines: string[] = [];
    for (const para of s.split(/\r?\n/)) {
      let line = '';
      for (const ch of para) {
        if (line && width(line + ch, size) > max && !'、。，．）」』】'.includes(ch)) {
          lines.push(line);
          line = '';
        }
        line += ch;
      }
      lines.push(line);
    }
    return lines;
  }
  // 押印欄の印鑑を押す範囲 (x, y, w, h) を覚えておく（writeSignAreas でPDFに書く）。sign（印鑑の画像）があればそこに押す
  const signAreas: SignAreas = {};
  function signArea(label: string, x: number, y: number, w: number, h: number, sign?: PDFImage) {
    const area = { x: round2(x), y: round2(H - y - h), w: round2(w), h: round2(h) };
    signAreas[label] = area;
    if (sign) drawImageFit(page, sign, area);
  }
  // 押印欄（ラベル付きの枠を横に並べる）。signs にラベルの印鑑があればその枠に押す
  function stamps(labels: string[], right: number, y: number, w: number, h: number, signs: Record<string, PDFImage | undefined> = {}) {
    const x0 = right - w * labels.length;
    labels.forEach((label, i) => {
      const x = x0 + w * i;
      rect(x, y, w, 13, { fill: C.primarySoft });
      rect(x, y, w, h, { stroke: C.lineStrong, bw: 0.6 });
      hline(x, x + w, y + 13, C.lineStrong, 0.6);
      cell(label, x, y, w, 13, 7, C.sub, 'center');
      signArea(label, x + 3, y + 13 + 3, w - 6, h - 13 - 6, signs[label]);
    });
    return x0;
  }

  return { width, txt, bold, cell, rect, hline, vline, badge, fit, wrap, signArea, stamps, signAreas };
}

export type Painter = ReturnType<typeof createPainter>;

// 枠 (x, y, w, h) の中に上詰めで折り返して書く。入りきらなければ文字を小さくし、それでも余れば … で切る
// （作業状況報告書・スキルシートなど、自由記入の欄で使う）
export function drawParagraph(p: Painter, s: string, x: number, y: number, w: number, h: number, size = 7.5, pad = 6, color: RGB = C.ink) {
  const text = s.replace(/\s+$/, '');
  if (!text) return;
  const maxW = w - pad * 2;
  const maxH = h - pad * 2 + 2;
  const sizes = [size, size - 0.7, size - 1.3];
  for (const sz of sizes) {
    const lineH = sz * 1.5;
    const lines = p.wrap(text, sz, maxW);
    const cap = Math.max(1, Math.floor((maxH - sz) / lineH) + 1);
    if (lines.length <= cap || sz === sizes[sizes.length - 1]) {
      const shown = lines.slice(0, cap);
      if (lines.length > cap) shown[cap - 1] = p.fit(shown[cap - 1] + '…', sz, maxW);
      shown.forEach((ln, i) => p.txt(ln, x + pad, y + pad + sz + i * lineH, sz, color));
      return;
    }
  }
}

// 集計欄の1項目
export interface Stat {
  label: string;
  value: string;
  unit: string;
  tone?: 'zero' | 'alert' | 'normal';
}

// 見出し付きの集計グループ（日数・有給・時間など）を横に並べる
export function drawStatGroups(p: Painter, groups: { title: string; stats: Stat[] }[], x: number, right: number, y: number, h: number) {
  const gap = 8;
  const n = groups.reduce((a, g) => a + g.stats.length, 0);
  const statW = (right - x - gap * (groups.length - 1)) / n;
  let gx = x;
  for (const g of groups) {
    const gw = statW * g.stats.length;
    p.rect(gx, y, gw, h, { stroke: C.line, bw: 0.7 });
    p.txt(g.title, gx + 7, y + 10.5, 6.5, C.primary);
    g.stats.forEach((s, i) => {
      const cx = gx + statW * i;
      if (i > 0) p.vline(cx, y + 16, y + h - 6, C.line, 0.5);
      p.txt(s.label, cx, y + 22, 6.5, C.sub, 'center', statW);
      const vc = s.tone === 'zero' ? C.faint : s.tone === 'alert' ? C.over : C.ink;
      // 数値は大きく、「未設定」などの文言は小さく
      const vSize = /\d/.test(s.value) ? 11.5 : 9;
      const vw = p.width(s.value, vSize);
      const uw = s.unit ? p.width(s.unit, 7) + 1.5 : 0;
      const vx = cx + (statW - vw - uw) / 2;
      p.txt(s.value, vx, y + 37, vSize, vc);
      if (s.unit) p.txt(s.unit, vx + vw + 1.5, y + 37, 7, s.tone === 'zero' ? C.faint : C.sub);
    });
    gx += gw + gap;
  }
}
