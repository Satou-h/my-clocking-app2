// 休暇申請書・遅刻早退申請書PDF（A4縦）
// レイアウトは以前の HTML を画像にしていた版と同じ。文字は画像にせずそのまま描く
import { PDFDocument, type PDFImage } from 'pdf-lib';
import { sealImage, type SealTexts } from './seal';
import {
  createPainter, downloadPdf, embedAppFont, hex, markLeaderSigned, withPdfFont, writeSignAreas, type Painter,
} from './pdfKit';

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
// 寸法は旧版（HTML を幅 900px で描いて A4 幅に縮めていた）の CSS の px で書き、ここで換算する
const px = (v: number) => v * W / 900;
const cssPt = (v: number) => px(v * 4 / 3); // CSS で pt 指定だった文字サイズ

const LEFT = px(200.5), RIGHT = px(699.5); // 本文の左右端（幅 180mm・左右の余白 24mm を中央寄せ）

const C = {
  ink: hex('#1a1a2e'),
  primary: hex('#2d6cdf'),
  meta: hex('#444444'),
  label: hex('#555555'),
  thBg: hex('#f1f3f9'),
  border: hex('#aaaabb'),
};

// 表
const TABLE_TOP = px(261.75);
const TH_W = (RIGHT - LEFT) * 0.26;
const PAD_X = px(14), PAD_Y = px(10);
const FS = cssPt(11);
const LINE_H = px(22.25); // line-height: normal での行送り
const BASE = px(7.2);     // 行の中央からベースラインまで
const VALUE_X = LEFT + TH_W + PAD_X;
const VALUE_W = RIGHT - VALUE_X - PAD_X;

// "2026-10-23" → "2026年10月23日"
const jpDate = (d: string) => d.replace(/^(\d{4})-0?(\d+)-0?(\d+)$/, '$1年$2月$3日');

// 押印欄に押す印鑑（欄の名前 → 画像）
type Signs = Partial<Record<'承認' | '確認' | '本人', PDFImage>>;

// seal: 本人欄に押す印鑑、approverSeal: 承認欄に押す承認した人の印鑑、confirmerSeal: 確認欄に押す確認した人の印鑑
// （どれも PNG の data URL。空なら押さない）
async function createDoc(
  fontBytes: ArrayBuffer | Uint8Array, title: string, seal: string, approverSeal: string, confirmerSeal: string,
) {
  const doc = await PDFDocument.create();
  const font = await embedAppFont(doc, fontBytes);
  doc.setTitle(title);
  const p = createPainter(doc.addPage([W, H]), font);
  const signs: Signs = {
    本人: seal ? await doc.embedPng(seal) : undefined,
    承認: approverSeal ? await doc.embedPng(approverSeal) : undefined,
    確認: confirmerSeal ? await doc.embedPng(confirmerSeal) : undefined,
  };
  if (signs.確認) markLeaderSigned(doc);
  return { doc, p, signs };
}

// 表題・氏名・押印欄・申請日
// title の全角空白の所は字を置かずに間だけあける（表題を「休暇申請書」で検索できるように）
function drawHeader(p: Painter, title: string, name: string, applicationDate: string, signs: Signs) {
  const size = cssPt(20), pitch = size + px(6); // 字間 6px
  const chars = [...title];
  const x0 = (LEFT + RIGHT - pitch * chars.length) / 2;
  p.bold(() => chars.forEach((ch, i) => {
    if (ch !== '　') p.txt(ch, x0 + pitch * i, px(106.6), size, C.ink);
  }), C.ink, size * 0.04);
  p.hline(LEFT, RIGHT, px(126.25), C.primary, px(2));

  const metaSize = cssPt(10);
  p.txt(`氏名: ${name || '　'.repeat(7)}`, RIGHT, px(162.6), metaSize, C.meta, 'right'); // 未入力なら手書きできるよう空けておく
  // 承認・確認・本人の欄（幅 100px の下線を 20px 間隔で右に寄せる）。本人欄には自分の印鑑、
  // 確認済みなら確認欄に確認した人の印鑑、承認済みなら承認欄に承認した人の印鑑を押す
  const boxW = px(100), gap = px(20);
  (['承認', '確認', '本人'] as const).forEach((label, i) => {
    const x = RIGHT - boxW - (boxW + gap) * (2 - i);
    p.txt(label, x, px(189.8), cssPt(8), C.label, 'center', boxW);
    p.hline(x, x + boxW, px(236.5), C.label, px(1.5));
    p.signArea(label, x + px(4), px(198), boxW - px(8), px(36), signs[label]);
  });
  p.txt(`申請日: ${jpDate(applicationDate)}`, LEFT, px(232.8), metaSize, C.meta);
}

interface Row {
  label: string;
  lines: string[];
  lineH?: number;
}

// 左に項目名（上下中央）、右に内容（上詰め）の表
function drawTable(p: Painter, rows: Row[]) {
  const divider = LEFT + TH_W;
  let y = TABLE_TOP;
  rows.forEach((r, i) => {
    const lh = r.lineH ?? LINE_H;
    const h = PAD_Y * 2 + lh * r.lines.length;
    p.rect(LEFT, y, TH_W, h, { fill: C.thBg });
    if (i > 0) p.hline(LEFT, RIGHT, y, C.border, px(1));
    p.bold(() => p.txt(r.label, LEFT + PAD_X, y + h / 2 + BASE, FS, C.meta), C.meta, FS * 0.025);
    r.lines.forEach((l, n) => p.txt(l, VALUE_X, y + PAD_Y + lh * (n + 0.5) + BASE, FS, C.ink));
    y += h;
  });
  p.vline(divider, TABLE_TOP, y, C.border, px(1));
  p.rect(LEFT, TABLE_TOP, RIGHT - LEFT, y - TABLE_TOP, { stroke: C.border, bw: px(1) });
}

export async function buildLeaveApplicationPdf(
  fontBytes: ArrayBuffer | Uint8Array,
  data: LeaveApplicationData,
  seal = '',
  approverSeal = '',
  confirmerSeal = '',
): Promise<Uint8Array> {
  const { applicationDate, name, dateEntries, leaveDays, reason } = data;
  const { doc, p, signs } = await createDoc(
    fontBytes, `休暇申請書 ${jpDate(applicationDate)} ${name}`, seal, approverSeal, confirmerSeal,
  );
  drawHeader(p, '休　暇　申　請　書', name, applicationDate, signs);

  const schedule = [...dateEntries]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => jpDate(e.date) + '　' + e.leaveLabel);
  drawTable(p, [
    { label: '休暇日程', lines: schedule.length ? schedule : ['-'], lineH: FS * 1.8 },
    { label: '取得日数', lines: [`${leaveDays}日`] },
    { label: '取得理由', lines: p.wrap(reason, FS, VALUE_W) },
  ]);
  writeSignAreas(doc, p.signAreas);
  return doc.save();
}

export async function buildLateEarlyApplicationPdf(
  fontBytes: ArrayBuffer | Uint8Array,
  data: LateEarlyApplicationData,
  seal = '',
  approverSeal = '',
  confirmerSeal = '',
): Promise<Uint8Array> {
  const { applicationDate, name, type, targetDate, scheduledTime, actualTime, reason } = data;
  const { doc, p, signs } = await createDoc(
    fontBytes, `遅刻・早退申請書 ${jpDate(applicationDate)} ${name}`, seal, approverSeal, confirmerSeal,
  );
  drawHeader(p, '遅刻・早退申請書', name, applicationDate, signs);

  drawTable(p, [
    { label: '種別', lines: [type] },
    { label: '対象日', lines: [jpDate(targetDate)] },
    { label: '本来の時刻', lines: [scheduledTime] },
    { label: '実際の時刻', lines: [actualTime] },
    { label: '理由', lines: p.wrap(reason, FS, VALUE_W) },
  ]);
  writeSignAreas(doc, p.signAreas);
  return doc.save();
}

// 申請日の yymmdd と社員番号・苗字でファイル名をつける（例: 03_休暇申請書261102_1234山田.pdf）
function fileName(prefix: string, applicationDate: string, employeeId: string, lastName: string): string {
  const yymmdd = applicationDate.replace(/-/g, '').slice(2);
  const userPart = (employeeId || lastName) ? `_${employeeId}${lastName}` : '';
  return `${prefix}${yymmdd}${userPart}.pdf`;
}

// seals: 本人・承認・確認の欄に押す印鑑の文字（承認・確認は、承認済み・確認済みのときだけ）
export async function printLeaveApplication(
  data: LeaveApplicationData, employeeId = '', lastName = '', seals: SealTexts = {},
): Promise<void> {
  const seal = await sealImage(seals.self ?? '');
  const approverSeal = await sealImage(seals.approver ?? '');
  const confirmerSeal = await sealImage(seals.confirmer ?? '');
  const bytes = await withPdfFont((fontBytes) => buildLeaveApplicationPdf(fontBytes, data, seal, approverSeal, confirmerSeal));
  downloadPdf(bytes, fileName('03_休暇申請書', data.applicationDate, employeeId, lastName));
}

export async function printLateEarlyApplication(
  data: LateEarlyApplicationData, employeeId = '', lastName = '', seals: SealTexts = {},
): Promise<void> {
  const seal = await sealImage(seals.self ?? '');
  const approverSeal = await sealImage(seals.approver ?? '');
  const confirmerSeal = await sealImage(seals.confirmer ?? '');
  const bytes = await withPdfFont((fontBytes) => buildLateEarlyApplicationPdf(fontBytes, data, seal, approverSeal, confirmerSeal));
  downloadPdf(bytes, fileName('04_遅早退申請書', data.applicationDate, employeeId, lastName));
}
