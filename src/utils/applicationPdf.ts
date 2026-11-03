// 休暇申請書・遅刻早退申請書PDF（A4縦。ヘッダーは交通費精算書とそろえる）
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { getHolidayName } from './holidays';
import { C, DOW_JA, createPainter, downloadPdf, loadFont, shortTime, type Painter } from './pdfKit';

export interface LeaveApplicationEntry {
  date: string;
  leaveLabel: string;
}

export interface LeaveApplicationData {
  applicationDate: string;
  name: string;
  dateEntries: LeaveApplicationEntry[];
  leaveDays: number;
  reason: string;
}

export interface LateEarlyApplicationData {
  applicationDate: string;
  name: string;
  type: '遅刻' | '早退';
  targetDate: string;
  scheduledTime: string;
  actualTime: string;
  reason: string;
}

const W = 595.28, H = 841.89; // A4 縦
const M = { l: 36, r: 36, t: 30, b: 30 };
const right = W - M.r;
const LABEL_W = 96;
const PAD = 12;
const VALUE_X = M.l + LABEL_W + PAD;
const VALUE_W = right - VALUE_X - PAD;
const FS = 10.5;     // 記入欄の文字
const ROW_H = 36;    // 1行の記入欄の高さ
const LINE_H = 17;   // 2行目以降の行送り

// "2026-11-02" → "2026/11/2"
const slashDate = (d: string) => d.replace(/^(\d{4})-0?(\d+)-0?(\d+)$/, '$1/$2/$3');

async function createDoc(fontBytes: ArrayBuffer | Uint8Array, title: string) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // サブセット化は loadFont() で詰め直したフォントが前提
  const font = await doc.embedFont(fontBytes, { subset: true });
  doc.setTitle(title);
  const p = createPainter(doc.addPage([W, H]), font);
  return { doc, p };
}

// 表題・氏名・申請日・押印欄。記入欄の上端を返す
function drawHeader(p: Painter, title: string, name: string, applicationDate: string): number {
  p.txt(title, M.l, M.t + 26, 18, C.primary);
  let x = M.l;
  const metaY = M.t + 50;
  const meta = (label: string, value: string, size: number) => {
    p.txt(label, x, metaY, 7, C.sub); x += p.width(label, 7) + 5;
    p.txt(value, x, metaY, size, C.ink); x += p.width(value, size) + 18;
  };
  meta('氏名', name || '　'.repeat(7), 11); // 未入力なら手書きできるよう空けておく
  meta('申請日', slashDate(applicationDate), 9);
  const stampX = p.stamps(['承認', '確認', '本人'], right, M.t, 46, 54);
  p.hline(M.l, stampX - 14, M.t + 58, C.primary, 1.2);
  return M.t + 76;
}

// 「2026年11月4日（水）」。土日祝は曜日に色をつける
function drawDate(p: Painter, date: string, x: number, base: number) {
  if (!date) return;
  const d = new Date(date + 'T00:00:00');
  const s = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  const dow = d.getDay();
  const color = getHolidayName(date) || dow === 0 ? C.sun : dow === 6 ? C.sat : C.ink;
  p.txt(s, x, base, FS, C.ink);
  p.txt(`（${DOW_JA[dow]}）`, x + p.width(s, FS), base, FS, color);
}

interface FormRow {
  label: string;
  lines: number;   // 内容の行数
  minH?: number;
  // base(i): i行目のベースライン、lh: 行送り
  draw: (base: (i: number) => number, lh: number) => void;
}

// 左に項目名、右に内容の記入欄。行が多いときは行送りを詰めて1ページに収める
function drawForm(p: Painter, top: number, rows: FormRow[]) {
  const bottom = H - M.b;
  const extra = rows.reduce((a, r) => a + r.lines - 1, 0);
  const lh = extra ? Math.min(LINE_H, (bottom - top - ROW_H * rows.length) / extra) : LINE_H;
  const heights: number[] = [];
  rows.reduce((y, r) => {
    const h = Math.max(ROW_H + (r.lines - 1) * lh, Math.min(r.minH ?? 0, bottom - y));
    heights.push(h);
    return y + h;
  }, top);
  const total = heights.reduce((a, h) => a + h, 0);

  p.rect(M.l, top, LABEL_W, total, { fill: C.primarySoft });
  let y = top;
  rows.forEach((r, i) => {
    if (i > 0) p.hline(M.l, right, y, C.lineStrong, 0.6);
    const rowY = y;
    const base = (n: number) => rowY + ROW_H / 2 + FS * 0.36 + n * lh;
    p.txt(r.label, M.l + PAD, base(0), 8.5, C.primary);
    r.draw(base, lh);
    y += heights[i];
  });
  p.vline(M.l + LABEL_W, top, top + total, C.lineStrong, 0.6);
  p.rect(M.l, top, right - M.l, total, { stroke: C.lineStrong, bw: 0.7 });
}

const text = (p: Painter, s: string) => (base: (i: number) => number) => p.txt(s, VALUE_X, base(0), FS, C.ink);
const paragraph = (p: Painter, lines: string[]) => (base: (i: number) => number) =>
  lines.forEach((l, i) => p.txt(l, VALUE_X, base(i), FS, C.ink));

export async function buildLeaveApplicationPdf(
  fontBytes: ArrayBuffer | Uint8Array,
  data: LeaveApplicationData,
): Promise<Uint8Array> {
  const { applicationDate, name, dateEntries, leaveDays, reason } = data;
  const { doc, p } = await createDoc(fontBytes, `休暇申請書 ${slashDate(applicationDate)} ${name}`);
  const top = drawHeader(p, '休暇申請書', name, applicationDate);

  const entries = [...dateEntries].sort((a, b) => a.date.localeCompare(b.date));
  const reasonLines = p.wrap(reason, FS, VALUE_W);
  drawForm(p, top, [
    { label: '休暇日程', lines: Math.max(entries.length, 1), draw: (base, lh) => {
      if (entries.length === 0) p.txt('-', VALUE_X, base(0), FS, C.faint);
      entries.forEach((e, i) => {
        drawDate(p, e.date, VALUE_X, base(i));
        // 休暇の種類は日付の右にそろえてバッジで出す（文字の中心を日付に合わせる）
        p.badge(e.leaveLabel, VALUE_X + 128, base(i) - FS * 0.36 - lh / 2, lh, 7.5, C.leaveSoft, C.leave, 44);
      });
    } },
    { label: '取得日数', lines: 1, draw: text(p, `${leaveDays}日`) },
    { label: '取得理由', lines: reasonLines.length, minH: 120, draw: paragraph(p, reasonLines) },
  ]);
  return doc.save();
}

export async function buildLateEarlyApplicationPdf(
  fontBytes: ArrayBuffer | Uint8Array,
  data: LateEarlyApplicationData,
): Promise<Uint8Array> {
  const { applicationDate, name, type, targetDate, scheduledTime, actualTime, reason } = data;
  const { doc, p } = await createDoc(fontBytes, `遅刻・早退申請書 ${slashDate(applicationDate)} ${name}`);
  const top = drawHeader(p, '遅刻・早退申請書', name, applicationDate);

  const reasonLines = p.wrap(reason, FS, VALUE_W);
  drawForm(p, top, [
    { label: '種別', lines: 1, draw: text(p, type) },
    { label: '対象日', lines: 1, draw: (base) => drawDate(p, targetDate, VALUE_X, base(0)) },
    { label: '本来の時刻', lines: 1, draw: text(p, shortTime(scheduledTime)) },
    { label: '実際の時刻', lines: 1, draw: text(p, shortTime(actualTime)) },
    { label: '理由', lines: reasonLines.length, minH: 120, draw: paragraph(p, reasonLines) },
  ]);
  return doc.save();
}

// 申請日の yymmdd と社員番号・苗字でファイル名をつける（例: 休暇申請書261102_1234山田.pdf）
function fileName(prefix: string, applicationDate: string, employeeId: string, lastName: string): string {
  const yymmdd = applicationDate.replace(/-/g, '').slice(2);
  const userPart = (employeeId || lastName) ? `_${employeeId}${lastName}` : '';
  return `${prefix}${yymmdd}${userPart}.pdf`;
}

export async function printLeaveApplication(data: LeaveApplicationData, employeeId = '', lastName = ''): Promise<void> {
  const bytes = await buildLeaveApplicationPdf(await loadFont(), data);
  downloadPdf(bytes, fileName('休暇申請書', data.applicationDate, employeeId, lastName));
}

export async function printLateEarlyApplication(data: LateEarlyApplicationData, employeeId = '', lastName = ''): Promise<void> {
  const bytes = await buildLateEarlyApplicationPdf(await loadFont(), data);
  downloadPdf(bytes, fileName('遅早退申請書', data.applicationDate, employeeId, lastName));
}
