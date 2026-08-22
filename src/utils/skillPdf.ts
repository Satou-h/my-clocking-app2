import { PDFDocument, rgb, type Color, type PDFPage, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { SkillEntry, Certification, SkillSheetProfile, WorkHistoryEntry } from '../types/skill';
import { fmtYearMonth } from './workHistory';

// ── Colors ────────────────────────────────────────────────────────────────────
const BLACK  = rgb(0.1,  0.1,  0.1);
const MID    = rgb(0.33, 0.33, 0.33);
const BORDER = rgb(0.53, 0.53, 0.53); // #888
const GREEN  = rgb(0.776, 0.851, 0.627); // #c6d9a0
const BLUE   = rgb(0.863, 0.902, 0.941); // #dce6f0

// ── Font loading ──────────────────────────────────────────────────────────────
let cachedFontBytes: ArrayBuffer | null = null;

async function loadFont(): Promise<ArrayBuffer> {
  if (cachedFontBytes) return cachedFontBytes;
  const res = await fetch(import.meta.env.BASE_URL + 'fonts/NotoSansJP-Regular.ttf');
  if (!res.ok) throw new Error('フォントの読み込みに失敗しました');
  cachedFontBytes = await res.arrayBuffer();
  return cachedFontBytes;
}

// ── Text helpers ──────────────────────────────────────────────────────────────

function wrapText(text: string, font: PDFFont, maxWidth: number, size: number): string[] {
  if (!text) return [];
  const result: string[] = [];
  for (const para of text.split('\n')) {
    if (!para) { result.push(''); continue; }
    let line = '';
    for (const ch of para) {
      const test = line + ch;
      if (line && font.widthOfTextAtSize(test, size) > maxWidth) {
        result.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) result.push(line);
  }
  return result.length ? result : [];
}

// ── Cell drawing ──────────────────────────────────────────────────────────────

interface CellOpts {
  size?: number;
  bgColor?: Color;
  textColor?: Color;
  align?: 'left' | 'center' | 'right';
  paddingH?: number;
  paddingTop?: number;
  lines?: string[]; // pre-wrapped lines, top-aligned
}

// y is the TOP of the cell in pdf-lib coords (Y increases upward)
function drawCell(
  page: PDFPage,
  x: number, y: number, w: number, h: number,
  text: string,
  font: PDFFont,
  opts: CellOpts = {},
) {
  const { size = 10, bgColor, textColor = BLACK, align = 'left', paddingH = 5, paddingTop, lines } = opts;
  const bottom = y - h;

  if (bgColor) {
    page.drawRectangle({ x, y: bottom, width: w, height: h, color: bgColor });
  }
  page.drawRectangle({ x, y: bottom, width: w, height: h, borderColor: BORDER, borderWidth: 0.5 });

  if (lines && lines.length) {
    // Top-aligned multi-line text
    const lineH = size * 1.45;
    const pTop = paddingTop ?? 5;
    lines.forEach((ln, i) => {
      if (!ln) return;
      const lineY = y - pTop - size - i * lineH;
      if (lineY < bottom + 2) return; // clip
      page.drawText(ln, { x: x + paddingH, y: lineY, font, size, color: textColor });
    });
  } else if (text) {
    let tx = x + paddingH;
    const tw = font.widthOfTextAtSize(text, size);
    if (align === 'center') tx = x + (w - tw) / 2;
    else if (align === 'right') tx = x + w - tw - paddingH;
    // Vertically center: baseline ≈ mid of cell - 0.25*size
    const ty = bottom + h / 2 - size * 0.25;
    page.drawText(text, { x: tx, y: ty, font, size, color: textColor });
  }
}

// ── Download helper ───────────────────────────────────────────────────────────

function buildFilename(prefix: string, employeeId: string, lastName: string): string {
  const user = (employeeId || lastName) ? `_${employeeId}${lastName}` : '';
  return `${prefix}${user}.pdf`;
}

function openPdf(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ══════════════════════════════════════════════════════════════════════════════
// printSkillSheet  ── A4 landscape, 10mm margin
// ══════════════════════════════════════════════════════════════════════════════

export async function printSkillSheet(
  profile: SkillSheetProfile,
  entries: SkillEntry[],
  certifications: Certification[],
  employeeId = '',
  lastName = '',
): Promise<void> {
  const fontBytes = await loadFont();
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes);

  const PW = 841.89; const PH = 595.28;
  const page = pdfDoc.addPage([PW, PH]);

  const M  = 28.35;       // 10mm margin
  const cX = M;
  const cW = PW - 2 * M;
  let Y = PH - M;          // current top Y (decreases as we go down)

  // ── Title ────────────────────────────────────────────
  const titleTxt = '情報処理技術者　経歴書';
  const titleSz  = 18;
  const titleW   = font.widthOfTextAtSize(titleTxt, titleSz);
  page.drawText(titleTxt, { x: cX + (cW - titleW) / 2, y: Y - titleSz - 2, font, size: titleSz, color: BLACK });
  Y -= 27;

  // ── Note ─────────────────────────────────────────────
  const noteTxt = '※同プロジェクトで複数の言語等を扱った場合は期間の重複があります';
  const noteSz  = 8;
  const noteW   = font.widthOfTextAtSize(noteTxt, noteSz);
  page.drawText(noteTxt, { x: cX + cW - noteW, y: Y - noteSz, font, size: noteSz, color: MID });
  Y -= 15;

  // ── Profile table (2 rows × 6 cols) ──────────────────
  const PR_H = 24; // row height
  const lW   = 58;   // label col width
  const d1W  = 195;
  const l2W  = 58;
  const d2W  = 170;
  const l3W  = 58;
  const d3W  = cW - lW - d1W - l2W - d2W - l3W;

  // row 1
  const pRow1: [number, number, string, Color | undefined, 'left' | 'center'][] = [
    [cX,                           lW,  '氏　名', GREEN,     'center'],
    [cX + lW,                      d1W, profile.name || '',                    undefined, 'left'],
    [cX + lW + d1W,                l2W, '年　齢', GREEN,     'center'],
    [cX + lW + d1W + l2W,          d2W, profile.age ? profile.age + '才' : '', undefined, 'left'],
    [cX + lW + d1W + l2W + d2W,    l3W, '住　所', GREEN,     'center'],
    [cX + lW + d1W + l2W + d2W + l3W, d3W, profile.address || '',             undefined, 'left'],
  ];
  for (const [x, w, txt, bg, al] of pRow1) {
    drawCell(page, x, Y, w, PR_H, txt, font, { size: 11, bgColor: bg, align: al });
  }
  Y -= PR_H;

  // row 2
  const pRow2: [number, number, string, Color | undefined, 'left' | 'center'][] = [
    [cX,                           lW,  '所属会社', GREEN,     'center'],
    [cX + lW,                      d1W, profile.company || '',                    undefined, 'left'],
    [cX + lW + d1W,                l2W, '経験年数', GREEN,     'center'],
    [cX + lW + d1W + l2W,          d2W, profile.totalExperience || '',            undefined, 'left'],
    [cX + lW + d1W + l2W + d2W,    l3W, '最寄駅',  GREEN,     'center'],
    [cX + lW + d1W + l2W + d2W + l3W, d3W, profile.nearestStation || '',         undefined, 'left'],
  ];
  for (const [x, w, txt, bg, al] of pRow2) {
    drawCell(page, x, Y, w, PR_H, txt, font, { size: 11, bgColor: bg, align: al });
  }
  Y -= PR_H + 4;

  // ── Certification table ───────────────────────────────
  const certRowCount = Math.max(Math.ceil(certifications.length / 2), 3);
  const CHR = 22; // cert header row height
  const CRH = 22; // cert data row height
  const certTotalH = CHR + certRowCount * CRH;

  // col widths
  const cc0 = cW * 0.07;
  const cc1 = cW * 0.38;
  const cc2 = cW * 0.08;
  const cc3 = cW * 0.38;
  const cc4 = cW - cc0 - cc1 - cc2 - cc3;
  const ccX = [cX, cX + cc0, cX + cc0 + cc1, cX + cc0 + cc1 + cc2, cX + cc0 + cc1 + cc2 + cc3];

  // "保有資格" spanning cell
  drawCell(page, ccX[0], Y, cc0, certTotalH, '保有資格', font, { size: 11, bgColor: GREEN, align: 'center' });

  // header
  const certHdrs = ['IT関係資格名称', '取得年月', 'IT関係資格名称', '取得年月'];
  const certWs   = [cc1, cc2, cc3, cc4];
  for (let i = 0; i < 4; i++) {
    drawCell(page, ccX[i + 1], Y, certWs[i], CHR, certHdrs[i], font, { size: 10, bgColor: GREEN, align: 'center' });
  }
  Y -= CHR;

  // data rows
  for (let i = 0; i < certRowCount; i++) {
    const c1 = certifications[i * 2];
    const c2 = certifications[i * 2 + 1];
    drawCell(page, ccX[1], Y, cc1, CRH, c1?.name ?? '',         font, { size: 10 });
    drawCell(page, ccX[2], Y, cc2, CRH, c1?.acquiredDate ?? '',  font, { size: 10, align: 'center' });
    drawCell(page, ccX[3], Y, cc3, CRH, c2?.name ?? '',         font, { size: 10 });
    drawCell(page, ccX[4], Y, cc4, CRH, c2?.acquiredDate ?? '',  font, { size: 10, align: 'center' });
    Y -= CRH;
  }
  Y -= 4;

  // ── Skills table ──────────────────────────────────────
  const DB_CAT = 'データベース';
  const nonDB  = entries.filter(e => e.category !== DB_CAT);
  const dbSkills = entries.filter(e => e.category === DB_CAT);
  const colSize = Math.ceil(nonDB.length / 3) || 1;
  const sCol1 = nonDB.slice(0, colSize);
  const sCol2 = nonDB.slice(colSize, 2 * colSize);
  const sCol3 = nonDB.slice(2 * colSize);
  const skillRows = Math.max(sCol1.length, sCol2.length, sCol3.length, dbSkills.length, 1);

  const SHR = 22;
  const SRH = 22;
  const skillTotalH = SHR + skillRows * SRH;

  // col widths: 7% | 13% | 8% | 13% | 8% | 13% | 8% | 14% | remaining
  const sw = [
    cW * 0.07, cW * 0.13, cW * 0.08, cW * 0.13,
    cW * 0.08, cW * 0.13, cW * 0.08, cW * 0.14, 0,
  ];
  sw[8] = cW - sw.slice(0, 8).reduce((a, b) => a + b, 0);
  const swX: number[] = [cX];
  for (let i = 1; i < 9; i++) swX.push(swX[i - 1] + sw[i - 1]);

  // "開発経験" spanning cell
  drawCell(page, swX[0], Y, sw[0], skillTotalH, '開発経験', font, { size: 11, bgColor: GREEN, align: 'center' });

  // header
  const skillHdrs = ['言　語', '経験年数', '言　語', '経験年数', '言　語', '経験年数', 'D　B', '経験年数'];
  for (let i = 0; i < 8; i++) {
    drawCell(page, swX[i + 1], Y, sw[i + 1], SHR, skillHdrs[i], font, { size: 10, bgColor: GREEN, align: 'center' });
  }
  Y -= SHR;

  // data rows
  for (let i = 0; i < skillRows; i++) {
    drawCell(page, swX[1], Y, sw[1], SRH, sCol1[i]?.skillName ?? '',       font, { size: 10 });
    drawCell(page, swX[2], Y, sw[2], SRH, sCol1[i]?.experienceYears ?? '', font, { size: 10, align: 'center' });
    drawCell(page, swX[3], Y, sw[3], SRH, sCol2[i]?.skillName ?? '',       font, { size: 10 });
    drawCell(page, swX[4], Y, sw[4], SRH, sCol2[i]?.experienceYears ?? '', font, { size: 10, align: 'center' });
    drawCell(page, swX[5], Y, sw[5], SRH, sCol3[i]?.skillName ?? '',       font, { size: 10 });
    drawCell(page, swX[6], Y, sw[6], SRH, sCol3[i]?.experienceYears ?? '', font, { size: 10, align: 'center' });
    drawCell(page, swX[7], Y, sw[7], SRH, dbSkills[i]?.skillName ?? '',    font, { size: 10 });
    drawCell(page, swX[8], Y, sw[8], SRH, dbSkills[i]?.experienceYears ?? '', font, { size: 10, align: 'center' });
    Y -= SRH;
  }
  Y -= 4;

  // ── Self-PR table ─────────────────────────────────────
  const prH = Math.max(72, Y - M); // use remaining space
  const prSecW = cc0;               // same width as 保有資格 col
  const prContW = cW - prSecW;

  drawCell(page, cX, Y, prSecW, prH, '自己PR', font, { size: 11, bgColor: GREEN, align: 'center' });

  // PR content - wrapped
  const prLines = wrapText(profile.selfPR || '', font, prContW - 14, 11);
  drawCell(page, cX + prSecW, Y, prContW, prH, '', font, {
    lines: prLines.length ? prLines : undefined,
    size: 11, paddingH: 7, paddingTop: 6,
  });

  openPdf(await pdfDoc.save(), buildFilename('スキルシート', employeeId, lastName));
}

// ══════════════════════════════════════════════════════════════════════════════
// printWorkHistory  ── A4 landscape, 8mm margin
// ══════════════════════════════════════════════════════════════════════════════

export async function printWorkHistory(
  name: string,
  entries: WorkHistoryEntry[],
  employeeId = '',
  lastName = '',
): Promise<void> {
  const fontBytes = await loadFont();
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes);

  const PW = 841.89; const PH = 595.28;
  const page = pdfDoc.addPage([PW, PH]);

  const M  = 22.68;       // 8mm margin
  const cX = M;
  const cW = PW - 2 * M;
  let Y  = PH - M;

  // ── Page header ──────────────────────────────────────
  const hTitle = 'スキル一覧';
  const hTSz   = 16;
  page.drawText(hTitle, { x: cX, y: Y - hTSz - 1, font, size: hTSz, color: BLACK });
  const hTW = font.widthOfTextAtSize(hTitle, hTSz);
  page.drawLine({ start: { x: cX, y: Y - hTSz - 3 }, end: { x: cX + hTW + 18, y: Y - hTSz - 3 }, thickness: 1.5, color: BLACK });

  const nameTxt = `氏名 ： ${name || ''}`;
  const nameSz  = 10.5;
  const nameTW  = font.widthOfTextAtSize(nameTxt, nameSz);
  page.drawText(nameTxt, { x: cX + cW - nameTW, y: Y - nameSz - 3, font, size: nameSz, color: BLACK });

  Y -= 34;

  // ── Work history table ────────────────────────────────
  // Column widths: 10|18|4|6|9|9|8|11|4|21 (%)
  const wPct = [0.10, 0.18, 0.04, 0.06, 0.09, 0.09, 0.08, 0.11, 0.04, 0];
  const wc   = wPct.map(p => p * cW);
  wc[9] = cW - wc.slice(0, 9).reduce((a, b) => a + b, 0);
  const wcX: number[] = [cX];
  for (let i = 1; i < 10; i++) wcX.push(wcX[i - 1] + wc[i - 1]);

  const HDR_H = 22;
  const ROW_H = 20; // height of each half-row

  // header row
  const hdrTxt = ['作業期間', '業務内容', '機種', 'OS', '言語', '言語', 'DB', '主要ツール', '役割', '作業工程'];
  for (let i = 0; i < 10; i++) {
    drawCell(page, wcX[i], Y, wc[i], HDR_H, hdrTxt[i], font, { size: 9.5, bgColor: BLUE, align: 'center' });
  }
  Y -= HDR_H;

  // pad to minimum 3 entries
  const allEntries: WorkHistoryEntry[] = [...entries];
  while (allEntries.length < 3) {
    allEntries.push({ id: '', startDate: '', endDate: '', duration: '', clientType: '', systemName: '', machine: '', os: '', languages: '', db: '', tools: '', role: '', workProcess: '' });
  }

  for (const e of allEntries) {
    const langs    = e.languages ? e.languages.split('\n').filter(Boolean) : [];
    const toolLines = e.tools    ? e.tools.split('\n').filter(Boolean)     : [];
    const osLines  = e.os       ? e.os.split('\n').filter(Boolean)         : [];
    const dbLines  = e.db       ? e.db.split('\n').filter(Boolean)         : [];
    const entryH   = ROW_H * 2;
    const period   = e.endDate   ? `${fmtYearMonth(e.startDate)} ～ ${fmtYearMonth(e.endDate)}`
                   : e.startDate ? `${fmtYearMonth(e.startDate)} ～` : '';
    const r1Y = Y;
    const r2Y = Y - ROW_H;

    // ── Rowspan=2 cells ──
    drawCell(page, wcX[0], r1Y, wc[0], entryH, period,   font, { size: 8.5, align: 'center' });
    drawCell(page, wcX[2], r1Y, wc[2], entryH, e.machine || '', font, { size: 8.5, align: 'center' });
    drawCell(page, wcX[8], r1Y, wc[8], entryH, e.role || '',    font, { size: 8.5, align: 'center' });

    // workProcess (rowspan=2) with wrapping
    const procLines = wrapText(e.workProcess || '', font, wc[9] - 10, 8.5);
    drawCell(page, wcX[9], r1Y, wc[9], entryH, '', font, {
      size: 8.5, lines: procLines.length ? procLines : undefined, paddingH: 4, paddingTop: 4,
    });

    // ── Row 1 cells ──
    drawCell(page, wcX[1], r1Y, wc[1], ROW_H, e.clientType || '',   font, { size: 9 });
    drawCell(page, wcX[3], r1Y, wc[3], ROW_H, osLines[0] ?? '',    font, { size: 8.5, align: 'center' });
    drawCell(page, wcX[4], r1Y, wc[4], ROW_H, langs[0] ?? '',      font, { size: 8.5 });
    drawCell(page, wcX[5], r1Y, wc[5], ROW_H, langs[1] ?? '',      font, { size: 8.5 });
    drawCell(page, wcX[6], r1Y, wc[6], ROW_H, dbLines[0] ?? '',    font, { size: 8.5, align: 'center' });
    drawCell(page, wcX[7], r1Y, wc[7], ROW_H, toolLines[0] ?? '',  font, { size: 8.5 });

    // ── Row 2 cells ──
    const systemTxt = (e.duration ? e.duration + '　' : '') + (e.systemName || '');
    drawCell(page, wcX[1], r2Y, wc[1], ROW_H, systemTxt,           font, { size: 8, textColor: MID });
    drawCell(page, wcX[3], r2Y, wc[3], ROW_H, osLines[1] ?? '',    font, { size: 8.5, align: 'center' });
    drawCell(page, wcX[4], r2Y, wc[4], ROW_H, langs[2] ?? '',      font, { size: 8.5 });
    drawCell(page, wcX[5], r2Y, wc[5], ROW_H, langs[3] ?? '',      font, { size: 8.5 });
    drawCell(page, wcX[6], r2Y, wc[6], ROW_H, dbLines[1] ?? '',    font, { size: 8.5, align: 'center' });
    drawCell(page, wcX[7], r2Y, wc[7], ROW_H, toolLines[1] ?? '',  font, { size: 8.5 });

    Y -= entryH;
  }

  // ── Footer ───────────────────────────────────────────
  const footTxt = '作業工程例：要件定義・調査・分析・基本設計・プログラミング・単体テスト・結合テスト・システムテスト・リリース・運用・研修';
  const footSz  = 8;
  const footW   = font.widthOfTextAtSize(footTxt, footSz);
  const footY   = Math.max(M + 2, Y - 10);
  page.drawText(footTxt, { x: cX + (cW - footW) / 2, y: footY, font, size: footSz, color: MID });

  openPdf(await pdfDoc.save(), buildFilename('スキル一覧', employeeId, lastName));
}
