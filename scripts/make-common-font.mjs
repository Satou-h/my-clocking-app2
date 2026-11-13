// 同梱フォント（public/fonts/NotoSansJP-Regular.ttf）から、ふだん使う字だけを残したフォントを作る。
// PDFを初めて作るときのダウンロードを小さくするため（pdfKit.ts の「フォント」を参照）。
//
// 使い方: node scripts/make-common-font.mjs
// できるもの: public/fonts/NotoSansJP-Regular-common.ttf
//
// 残す字:
//   ・ASCII と Latin-1（é ü など）
//   ・Windows の Shift_JIS（CP932）で書ける字（JIS第1・第2水準の漢字、NEC・IBM拡張文字（髙・﨑・①・㈱など））
//   ・かな・全角英数字・記号のブロック
//   ・アプリのソース（src）に書いてある字（PDFの見出し・欄の名前など）
// 字形・字幅・ヒントは元のフォントのまま残すので、どちらのフォントで作ってもPDFの見た目は変わらない。
// ここにない字（𠮷 など）を書くときは、アプリが元のフォントで作り直す。
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_FONT = path.join(root, 'public/fonts/NotoSansJP-Regular.ttf');
const OUT_FONT = path.join(root, 'public/fonts/NotoSansJP-Regular-common.ttf');
const WASM = path.join(root, 'node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm');

// ── 残す字を集める ───────────────────────────────────────────────────────────
const codePoints = new Set();
const addRange = (from, to) => { for (let c = from; c <= to; c++) codePoints.add(c); };
const addText = (s) => { for (const ch of s) codePoints.add(ch.codePointAt(0)); };

addRange(0x20, 0x7e); // ASCII
addRange(0xa0, 0xff); // Latin-1

// CP932 の1バイト（半角カナ）と2バイトの字
const sjis = new TextDecoder('shift_jis');
for (let b = 0xa1; b <= 0xdf; b++) addText(sjis.decode(Uint8Array.of(b)));
for (let lead = 0x81; lead <= 0xfc; lead++) {
  if (lead > 0x9f && lead < 0xe0) continue;
  for (let trail = 0x40; trail <= 0xfc; trail++) {
    if (trail === 0x7f) continue;
    const s = sjis.decode(Uint8Array.of(lead, trail));
    if (s !== '�') addText(s);
  }
}

// 記号・かななどのブロック（フォントにない字は無視される）
for (const [from, to] of [
  [0x2000, 0x206f], // 一般句読点（‐ – — … ‰ など）
  [0x2100, 0x218f], // 文字様記号・数字の形（℃ № Ⅰ など）
  [0x2190, 0x22ff], // 矢印・数学記号
  [0x2460, 0x24ff], // 囲み英数字
  [0x2500, 0x27bf], // 罫線・図形・その他の記号・装飾記号（✓ など）
  [0x3000, 0x30ff], // CJK の記号と句読点・ひらがな・カタカナ
  [0x31f0, 0x31ff], // 小書きカタカナの拡張
  [0x3200, 0x33ff], // 囲みCJK・CJK互換（㈱ ㍉ など）
  [0xff00, 0xffef], // 半角・全角形
]) addRange(from, to);

// アプリのソースに書いてある字。ただし U+FFFF より後ろの字（コメントに例として書いた 𠮷 など）は入れない
// （1字でも入ると、字の対応表（cmap）を大きい形式でも持つことになり、フォントが 50KB ほど大きくなる）
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(name)) {
      for (const ch of readFileSync(p, 'utf8')) {
        const cp = ch.codePointAt(0);
        if (cp > 0x7f && cp <= 0xffff) codePoints.add(cp);
      }
    }
  }
})(path.join(root, 'src'));

// ── HarfBuzz（hb-subset）で切り出す ──────────────────────────────────────────
const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_FLAGS_NOTDEF_OUTLINE = 0x40; // 字がないときの □ の形を残す（元のフォントと同じ表示にする）

const { instance } = await WebAssembly.instantiate(readFileSync(WASM));
const hb = instance.exports;
const heap = () => new Uint8Array(hb.memory.buffer); // 処理中にメモリが増えると作り直しになるので毎回取る

const src = readFileSync(SRC_FONT);
const srcPtr = hb.malloc(src.byteLength);
heap().set(src, srcPtr);
const face = hb.hb_face_create(hb.hb_blob_create(srcPtr, src.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0), 0);

const input = hb.hb_subset_input_create_or_fail();
if (!input) throw new Error('hb_subset_input_create_or_fail に失敗しました');
hb.hb_subset_input_set_flags(input, hb.hb_subset_input_get_flags(input) | HB_SUBSET_FLAGS_NOTDEF_OUTLINE);
const unicodes = hb.hb_subset_input_unicode_set(input);
for (const cp of codePoints) hb.hb_set_add(unicodes, cp);

const subset = hb.hb_subset_or_fail(face, input);
if (!subset) throw new Error('フォントを切り出せませんでした');
const outBlob = hb.hb_face_reference_blob(subset);
const outPtr = hb.hb_blob_get_data(outBlob, 0);
const out = heap().slice(outPtr, outPtr + hb.hb_blob_get_length(outBlob));
writeFileSync(OUT_FONT, out);

const kb = (n) => `${Math.round(n / 1024).toLocaleString()} KB`;
console.log(`${path.relative(root, OUT_FONT)}: ${kb(out.byteLength)}（元のフォント ${kb(src.byteLength)}・候補の字 ${codePoints.size.toLocaleString()} 字）`);
