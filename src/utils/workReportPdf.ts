// 作業状況報告書PDF（pdf-lib・A4横）。勤務表・交通費と同じデザインでそろえる
import { PDFDocument, type RGB } from 'pdf-lib';
import type { WeekReportData } from './pdf';
import { C, createPainter, downloadPdf, drawParagraph as para, embedAppFont, hex, withPdfFont } from './pdfKit';

const WEEK_LABELS = ['第一週', '第二週', '第三週', '第四週', '第五週'];

// 記入のしかた（読点の位置で2行に分ける）
const NOTE_LINES = [
  '※記載例を参考に開発言語/ツール/作業工程の欄には主に現場業務を記載するが、',
  'コメント欄には作業内容ではなく主に気持ちの部分を記載して下さい。',
];

// 体調の記号ごとの色（文字色・丸の背景色）
const CONDITIONS: { mark: string; color: RGB; bg: RGB }[] = [
  { mark: '◎', color: C.primary, bg: C.primarySoft },
  { mark: '○', color: C.sub, bg: C.off },
  { mark: '△', color: C.over, bg: hex('#FDEEE2') },
  { mark: '×', color: C.sun, bg: C.alertSoft },
];

export async function buildWorkReportPdf(
  fontBytes: ArrayBuffer | Uint8Array,
  year: number,
  month: number,
  name: string,
  weeks: WeekReportData[],
  summary = '',
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await embedAppFont(doc, fontBytes);
  doc.setTitle(`${year}年${month}月 作業状況報告書 ${name}`);

  const W = 841.89, H = 595.28; // A4 横
  const page = doc.addPage([W, H]);
  const p = createPainter(page, font);
  const M = { l: 28, r: 28, t: 22, b: 18 };
  const right = W - M.r;

  // ── ヘッダー ──────────────────────────────────────────────────────────────
  p.txt('作業状況報告書', M.l, M.t + 18, 17, C.primary);
  let x = M.l;
  const metaY = M.t + 40;
  const meta = (label: string, value: string, size: number) => {
    p.txt(label, x, metaY, 7, C.sub); x += p.width(label, 7) + 5;
    p.txt(value, x, metaY, size, C.ink); x += p.width(value, size) + 22;
  };
  meta('申請月', `${year}年${month}月`, 9);
  meta('氏名', name, 11);
  // 記入のしかた（右寄せ・最終行をメタ情報の行にそろえる）
  NOTE_LINES.forEach((ln, i) => {
    p.txt(ln, right - p.width(ln, 6.5), metaY - (NOTE_LINES.length - 1 - i) * 9.5, 6.5, C.sub);
  });
  p.hline(M.l, right, M.t + 48, C.primary, 1.2);

  // ── 表の列 ────────────────────────────────────────────────────────────────
  const fixed = { week: 38, tools: 148, half: 28, mark: 22, reason: 104 };
  const commentW = (right - M.l - fixed.week - fixed.tools - fixed.half - fixed.mark - fixed.reason) / 3;
  const X = {
    week: M.l,
    tools: M.l + fixed.week,
    half: M.l + fixed.week + fixed.tools,
    mark: M.l + fixed.week + fixed.tools + fixed.half,
    reason: M.l + fixed.week + fixed.tools + fixed.half + fixed.mark,
    good: 0, bad: 0, other: 0,
  };
  X.good = X.reason + fixed.reason;
  X.bad = X.good + commentW;
  X.other = X.bad + commentW;

  const sumH = 58;
  const sumY = H - M.b - sumH;
  const tY = M.t + 60, hH = 20;
  const bodyTop = tY + hH;
  const bodyBottom = sumY - 10;
  const weekH = (bodyBottom - bodyTop) / WEEK_LABELS.length;
  const halfH = weekH / 2;

  // 見出し
  p.rect(M.l, tY, right - M.l, hH, { fill: C.primary });
  const heads: [string, number, number][] = [
    ['週', X.week, fixed.week],
    ['開発言語 / ツール / 作業工程', X.tools, fixed.tools],
    ['体調', X.half, fixed.half + fixed.mark],
    ['理由', X.reason, fixed.reason],
    ['良かった点', X.good, commentW],
    ['悪かった点', X.bad, commentW],
    ['その他（気づいた点等）', X.other, commentW],
  ];
  heads.forEach(([label, hx, hw], i) => {
    p.cell(label, hx, tY, hw, hH, 7.5, C.white, 'center');
    if (i > 0) p.vline(hx, tY + 4, tY + hH - 4, C.white, 0.4, 0.35);
  });

  // 明細の縦線（体調の「前半/後半」と記号の間には引かない）
  for (const vx of [X.tools, X.half, X.reason, X.good, X.bad, X.other]) {
    p.vline(vx, bodyTop, bodyBottom, C.line, 0.5);
  }

  weeks.slice(0, WEEK_LABELS.length).forEach((w, i) => {
    const y = bodyTop + weekH * i;
    // 週ラベル
    p.rect(X.week, y, fixed.week, weekH, { fill: C.primarySoft });
    p.cell(WEEK_LABELS[i], X.week, y, fixed.week, weekH, 8, C.primary, 'center');

    para(p, w.tools, X.tools, y, fixed.tools, weekH);

    // 体調（前半・後半）と理由
    const halves: [string, string, string][] = [
      ['前半', w.conditionFirst, w.reasonFirst],
      ['後半', w.conditionSecond, w.reasonSecond],
    ];
    halves.forEach(([label, mark, reason], j) => {
      const hy = y + halfH * j;
      p.cell(label, X.half, hy, fixed.half, halfH, 6.5, C.sub, 'center');
      const cond = CONDITIONS.find(c => c.mark === mark.trim());
      if (cond) {
        const cx = X.mark + fixed.mark / 2 - 3;
        page.drawCircle({ x: cx, y: H - (hy + halfH / 2), size: 7.5, color: cond.bg });
        p.cell(cond.mark, cx - 6, hy, 12, halfH, 9.5, cond.color, 'center');
      } else if (mark.trim()) {
        p.cell(mark.trim(), X.mark, hy, fixed.mark, halfH, 9, C.ink, 'center');
      }
      para(p, reason, X.reason, hy, fixed.reason, halfH, 7.2, 5);
    });
    p.hline(X.half, X.good, y + halfH, C.line, 0.45);

    para(p, w.goodPoints, X.good, y, commentW, weekH);
    para(p, w.badPoints, X.bad, y, commentW, weekH);
    para(p, w.notes, X.other, y, commentW, weekH);

    if (i > 0) p.hline(M.l, right, y, C.lineStrong, 0.6);
  });
  p.rect(M.l, tY, right - M.l, bodyBottom - tY, { stroke: C.lineStrong, bw: 0.7 });

  // ── 総括 ──────────────────────────────────────────────────────────────────
  p.rect(M.l, sumY, fixed.week, sumH, { fill: C.primarySoft });
  p.cell('総括', M.l, sumY, fixed.week, sumH, 8, C.primary, 'center');
  para(p, summary, M.l + fixed.week, sumY, right - M.l - fixed.week, sumH, 7.8, 8);
  p.rect(M.l, sumY, right - M.l, sumH, { stroke: C.lineStrong, bw: 0.7 });

  return doc.save();
}

export async function printWorkReport(
  year: number,
  month: number,
  name: string,
  weeks: WeekReportData[],
  employeeId = '',
  lastName = '',
  monthlySummary = '',
): Promise<void> {
  const bytes = await withPdfFont((fontBytes) => buildWorkReportPdf(fontBytes, year, month, name, weeks, monthlySummary));
  const userPart = (employeeId || lastName) ? `_${employeeId}${lastName}` : '';
  downloadPdf(bytes, `10_作業状況報告書${year}${String(month).padStart(2, '0')}${userPart}.pdf`);
}
