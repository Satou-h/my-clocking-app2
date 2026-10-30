// 小口交通費立替精算書PDF（会社の様式1-3-26.1 と同じ項目・A4縦）
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { TransportRecord } from '../types/transport';
import { TRIP_TYPE_LABELS } from '../types/transport';
import { getHolidayName } from './holidays';
import { C, DOW_JA, createPainter, downloadPdf, loadFont } from './pdfKit';

const FORM_NO = '様式1-3-26.1';
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

export async function buildTransportPdf(
  fontBytes: ArrayBuffer | Uint8Array,
  records: TransportRecord[],
  year: number,
  month: number,
  name: string,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes);
  doc.setTitle(`${year}年${month}月 小口交通費立替精算書 ${name}`);

  const W = 595.28, H = 841.89; // A4 縦
  const page = doc.addPage([W, H]);
  const p = createPainter(page, font);
  const M = { l: 36, r: 36, t: 30, b: 30 };
  const right = W - M.r;

  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const trips = records.filter(r => r.date.startsWith(ym)).sort((a, b) => a.date.localeCompare(b.date));
  const total = trips.reduce((a, t) => a + t.amount, 0);
  const roundTrips = trips.filter(t => t.tripType === 'roundtrip').length;
  const oneWays = trips.length - roundTrips;
  const lastDay = new Date(year, month, 0).getDate();
  const dayOf = (date: string) => Number(date.slice(8, 10));

  // ── ヘッダー ──────────────────────────────────────────────────────────────
  p.txt(FORM_NO, 0, 18, 6.5, C.sub, 'right', right);
  p.txt('小口交通費立替精算書', M.l, M.t + 26, 18, C.primary);
  let x = M.l;
  const metaY = M.t + 50;
  const meta = (label: string, value: string, size: number) => {
    p.txt(label, x, metaY, 7, C.sub); x += p.width(label, 7) + 5;
    p.txt(value, x, metaY, size, C.ink); x += p.width(value, size) + 18;
  };
  meta('対象', `${year}年${month}月分`, 9);
  meta('氏名', name, 11);
  // 申請日は会社様式にならって対象月の末日
  meta('申請日', `${year}/${month}/${lastDay}`, 9);
  const stampX = p.stamps(['承認', '検印', '領収印'], right, M.t, 46, 54);
  p.hline(M.l, stampX - 14, M.t + 58, C.primary, 1.2);

  // ── 集計（合計金額をいちばん大きく） ─────────────────────────────────────
  const sumY = M.t + 70, sumH = 46;
  const period = trips.length
    ? `${month}/${dayOf(trips[0].date)} 〜 ${month}/${dayOf(trips[trips.length - 1].date)}`
    : '—';
  const stats = [
    { label: '精算期間', value: period, unit: '', w: 128 },
    { label: '件数', value: String(trips.length), unit: '件', w: 72 },
    { label: '往復', value: String(roundTrips), unit: '件', w: 72 },
    { label: '片道', value: String(oneWays), unit: '件', w: 72 },
  ];
  const totalW = right - M.l - stats.reduce((a, s) => a + s.w, 0);
  p.rect(M.l, sumY, right - M.l, sumH, { stroke: C.line, bw: 0.7 });
  let sx = M.l;
  stats.forEach((s, i) => {
    if (i > 0) p.vline(sx, sumY + 8, sumY + sumH - 8, C.line, 0.5);
    p.txt(s.label, sx, sumY + 16, 6.8, C.sub, 'center', s.w);
    const zero = s.value === '0';
    const vSize = s.unit ? 13 : 10.5;
    const vw = p.width(s.value, vSize);
    const uw = s.unit ? p.width(s.unit, 7.5) + 1.5 : 0;
    const vx = sx + (s.w - vw - uw) / 2;
    p.txt(s.value, vx, sumY + 35, vSize, zero ? C.faint : C.ink);
    if (s.unit) p.txt(s.unit, vx + vw + 1.5, sumY + 35, 7.5, zero ? C.faint : C.sub);
    sx += s.w;
  });
  p.rect(sx, sumY, totalW, sumH, { fill: C.primarySoft });
  p.txt('合計金額', sx, sumY + 16, 6.8, C.primary, 'center', totalW);
  p.txt(yen(total), sx, sumY + 37, 17, C.primary, 'center', totalW);

  // ── 内訳 ──────────────────────────────────────────────────────────────────
  const cols = [
    { key: 'no', label: 'No', w: 24 },
    { key: 'date', label: '日付', w: 62 },
    { key: 'dest', label: '訪問先', w: 82 },
    { key: 'from', label: '出発地', w: 92 },
    { key: 'to', label: '到着地', w: 92 },
    { key: 'kind', label: '種別', w: 40 },
    { key: 'amount', label: '金額', w: 58 },
    { key: 'note', label: '備考', w: 0 },
  ];
  cols[cols.length - 1].w = right - M.l - cols.reduce((a, c) => a + c.w, 0);
  const colX: number[] = [];
  cols.reduce((acc, c) => (colX.push(acc), acc + c.w), M.l);
  const ci = (k: string) => cols.findIndex(c => c.key === k);

  const tY = sumY + sumH + 16, hH = 20, totalH = 22;
  const bodyTop = tY + hH;
  const rowCount = Math.max(trips.length, 1);
  const rowH = Math.min(18, (H - M.b - totalH - bodyTop) / rowCount);
  const fs = rowH < 14 ? 7.2 : 8;

  p.rect(M.l, tY, right - M.l, hH, { fill: C.primary });
  cols.forEach((c, i) => {
    p.cell(c.label, colX[i], tY, c.w, hH, 7.5, C.white, 'center');
    if (i > 0 && c.key !== 'to') p.vline(colX[i], tY + 4, tY + hH - 4, C.white, 0.4, 0.35);
  });

  if (trips.length === 0) {
    p.cell('データがありません', M.l, bodyTop, right - M.l, rowH, 8, C.faint, 'center');
    p.hline(M.l, right, bodyTop + rowH, C.line, 0.45);
  }
  trips.forEach((t, i) => {
    const y = bodyTop + rowH * i;
    p.hline(M.l, right, y + rowH, C.line, 0.45);
    const day = dayOf(t.date);
    const dow = new Date(t.date + 'T00:00:00').getDay();
    const dayColor = getHolidayName(t.date) || dow === 0 ? C.sun : dow === 6 ? C.sat : C.ink;

    p.cell(String(i + 1), colX[0], y, cols[0].w, rowH, 6.8, C.faint, 'right', 6);
    p.cell(`${month}月${day}日`, colX[1], y, 38, rowH, fs, C.ink, 'right', 0);
    p.cell(DOW_JA[dow], colX[1] + 42, y, 12, rowH, fs, dayColor, 'left', 0);
    const texts: [string, string][] = [['dest', t.destination], ['from', t.from], ['to', t.to]];
    for (const [k, s] of texts) {
      const c = ci(k);
      p.cell(p.fit(s, fs, cols[c].w - 18), colX[c], y, cols[c].w, rowH, fs, C.ink, 'left', k === 'to' ? 12 : 8);
    }
    p.cell('〜', colX[ci('to')] - 4, y, 10, rowH, fs, C.faint, 'center');

    const kc = ci('kind');
    const isRound = t.tripType === 'roundtrip';
    p.badge(TRIP_TYPE_LABELS[t.tripType], colX[kc] + (cols[kc].w - 28) / 2, y, rowH, 6.8,
      isRound ? C.primarySoft : C.off, isRound ? C.primary : C.sub, 28);

    p.cell(yen(t.amount), colX[ci('amount')], y, cols[ci('amount')].w, rowH, fs, C.ink);
    if (t.notes) {
      const nc = ci('note');
      p.cell(p.fit(t.notes, 7, cols[nc].w - 12), colX[nc], y, cols[nc].w, rowH, 7, C.ink, 'left', 6);
    }
  });

  // 合計（明細のすぐ下。ページからはみ出さない）
  const ty = bodyTop + rowH * rowCount;
  p.rect(M.l, ty, right - M.l, totalH, { fill: C.primarySoft });
  p.hline(M.l, right, ty, C.primary, 0.9);
  p.cell('合計', colX[1], ty, 60, totalH, 8.5, C.primary, 'left', 0);
  p.cell(`${trips.length}件`, colX[ci('dest')], ty, 60, totalH, 8, C.sub, 'left', 8);
  p.cell(yen(total), colX[ci('amount')], ty, cols[ci('amount')].w, totalH, 9.5, C.primary);

  return doc.save();
}

export async function printTransportPDF(
  records: TransportRecord[],
  year: number,
  month: number,
  employeeId = '',
  lastName = '',
  name = '',
): Promise<void> {
  const bytes = await buildTransportPdf(await loadFont(), records, year, month, name);
  const userPart = (employeeId || lastName) ? `_${employeeId}${lastName}` : '';
  downloadPdf(bytes, `小口交通費${year}${String(month).padStart(2, '0')}${userPart}.pdf`);
}
