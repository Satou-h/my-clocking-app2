import { PDFDocument, rgb, type Color } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { AttendanceRecord, WorkSettings, AttendanceType } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS } from '../types/attendance';
import {
  calcWorkMinutes, calcOvertimeMinutes, calcLateNightMinutes,
  isLateArrival, isEarlyDeparture, formatMinutes, getEffectiveBreak,
} from './storage';
import { getHolidayName } from './holidays';

// ── Shared font cache ─────────────────────────────────────────────────────────
let cachedFontBytes: ArrayBuffer | null = null;
async function loadFont(): Promise<ArrayBuffer> {
  if (cachedFontBytes) return cachedFontBytes;
  const res = await fetch(import.meta.env.BASE_URL + 'fonts/NotoSansJP-Regular.ttf');
  if (!res.ok) throw new Error('フォントの読み込みに失敗しました');
  cachedFontBytes = await res.arrayBuffer();
  return cachedFontBytes;
}

function openPdf(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ── Colors ────────────────────────────────────────────────────────────────────
const TITLE_BLUE = rgb(0.176, 0.424, 0.871); // #2d6cdf
const TH_BG      = rgb(0.945, 0.953, 0.976); // #f1f3f9
const BORDER     = rgb(0.867, 0.882, 0.933); // #dde1ee
const GRAY_TXT   = rgb(0.388, 0.431, 0.447); // #636e72
const DARK_TXT   = rgb(0.102, 0.102, 0.180); // #1a1a2e
const ORANGE_TXT = rgb(0.902, 0.318, 0.000); // #e65100
const PURPLE_TXT = rgb(0.482, 0.122, 0.635); // #7b1fa2
const RED_TXT    = rgb(0.773, 0.157, 0.157); // #c62828
const GREEN_TXT  = rgb(0.000, 0.722, 0.580); // #00b894
const RED_SUN    = rgb(0.898, 0.224, 0.208); // #e53935
const BLU_SAT    = rgb(0.118, 0.533, 0.898); // #1e88e5
const LIGHT_TXT  = rgb(0.700, 0.700, 0.700);
const WHITE      = rgb(1.000, 1.000, 1.000);

// Row backgrounds
const OFF_BG  = rgb(0.949, 0.953, 0.961); // #f2f3f5
const EMPT_BG = rgb(0.980, 0.984, 0.988); // #fafbfc
const EVEN_BG = rgb(0.976, 0.980, 1.000); // #f9faff
const PAID_BG = rgb(1.000, 0.996, 0.894); // #fffde7
const HOL_BG  = rgb(0.945, 0.973, 0.910); // #f1f8e9
const ABS_BG  = rgb(1.000, 0.941, 0.941); // #fff0f0
const SH_BG   = rgb(1.000, 0.973, 0.941); // #fff8f0
const LH_BG   = rgb(1.000, 0.957, 0.949); // #fff4f2

// Badge definitions per attendance type
const BADGE_BG: Record<AttendanceType, Color> = {
  work:                   rgb(0.910, 0.940, 0.996), // #e8f0fe
  paid_leave:             rgb(1.000, 0.976, 0.769), // #fff9c4
  holiday:                rgb(0.910, 0.957, 0.914), // #e8f5e9
  absence:                rgb(0.988, 0.894, 0.925), // #fce4ec
  am_leave:               rgb(0.878, 0.949, 0.996), // #e0f2fe
  pm_leave:               rgb(0.988, 0.894, 0.965), // #fce4ec
  scheduled_holiday_work: rgb(1.000, 0.953, 0.878), // #fff3e0
  legal_holiday_work:     rgb(0.984, 0.914, 0.902), // #fbe9e7
};
const BADGE_TXT: Record<AttendanceType, Color> = {
  work:                   TITLE_BLUE,
  paid_leave:             rgb(0.522, 0.392, 0.016), // #856404
  holiday:                rgb(0.180, 0.490, 0.196), // #2e7d32
  absence:                RED_TXT,
  am_leave:               rgb(0.012, 0.467, 0.741), // #0277bd
  pm_leave:               rgb(0.678, 0.078, 0.341), // #ad1457
  scheduled_holiday_work: ORANGE_TXT,
  legal_holiday_work:     rgb(0.749, 0.212, 0.047), // #bf360c
};

const DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];

const IS_WORK = new Set(['work', 'am_leave', 'pm_leave', 'scheduled_holiday_work', 'legal_holiday_work']);

// ══════════════════════════════════════════════════════════════════════════════
// printMonthlyAttendancePDF  ── A4 portrait, 8mm margin
// ══════════════════════════════════════════════════════════════════════════════
export async function printMonthlyAttendancePDF(
  records: AttendanceRecord[],
  workSettings: WorkSettings,
  year: number,
  month: number,
  plRemaining: number | null = null,
  employeeId = '',
  lastName = '',
): Promise<void> {
  const fontBytes = await loadFont();
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const font = await pdfDoc.embedFont(fontBytes);

  // ── Data aggregation ──────────────────────────────────────────────────────
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const filtered = records
    .filter(r => r.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));

  let workDays = 0, shdDays = 0, lhdDays = 0, paidDays = 0;
  let workMins = 0, otMins = 0, lhMins = 0, lnMins = 0, lateN = 0, earlyN = 0;
  for (const r of filtered) {
    if (r.type === 'paid_leave') { paidDays++; continue; }
    if (r.type === 'am_leave' || r.type === 'pm_leave') paidDays += 0.5;
    if (!IS_WORK.has(r.type) || !r.clockIn || !r.clockOut) continue;
    if (r.type === 'work') workDays++;
    if (r.type === 'scheduled_holiday_work') shdDays++;
    if (r.type === 'legal_holiday_work') lhdDays++;
    const effBreak = getEffectiveBreak(r.type, r.clockIn, r.clockOut, r.breakMinutes ?? 0);
    const w = calcWorkMinutes(r.clockIn, r.clockOut, effBreak);
    workMins += w;
    if (r.type === 'scheduled_holiday_work') otMins += w;
    else if (r.type === 'legal_holiday_work') lhMins += w;
    else otMins += calcOvertimeMinutes(w);
    lnMins += calcLateNightMinutes(r.clockIn, r.clockOut);
    const refS = r.customStartTime ?? workSettings.standardStartTime;
    const refE = r.customEndTime   ?? workSettings.standardEndTime;
    const isHalf = r.type === 'am_leave' || r.type === 'pm_leave';
    if (!isHalf && isLateArrival(r.clockIn, refS)) lateN++;
    if (!isHalf && isEarlyDeparture(r.clockOut, refE, r.clockIn)) earlyN++;
  }
  const daysInMonth = new Date(year, month, 0).getDate();
  const byDate = new Map(filtered.map(r => [r.date, r]));

  // ── Page setup ────────────────────────────────────────────────────────────
  const PW = 595.28; const PH = 841.89;
  const M  = 22.68;  // 8mm margin
  const cW = PW - 2 * M; // ≈549.92 pt

  const page = pdfDoc.addPage([PW, PH]);
  let Y = PH - M; // top of content (decreases as we go down)

  // ── Drawing helpers ───────────────────────────────────────────────────────
  // Center text horizontally within a column, baseline at midY
  function drawCentered(text: string, colLeft: number, colW: number, midY: number, sz: number, color: Color) {
    if (!text) return;
    const tw = font.widthOfTextAtSize(text, sz);
    const tx = colLeft + (colW - tw) / 2;
    page.drawText(text, { x: tx < colLeft ? colLeft + 1 : tx, y: midY, size: sz, font, color });
  }

  // Draw a table cell (bg rect + border + centered text)
  function cell(
    x: number, top: number, w: number, h: number,
    text: string, sz: number,
    color: Color, bg?: Color,
    align: 'center' | 'left' = 'center',
    leftPad = 2,
  ) {
    const bottom = top - h;
    if (bg) page.drawRectangle({ x, y: bottom, width: w, height: h, color: bg });
    page.drawRectangle({ x, y: bottom, width: w, height: h, borderColor: BORDER, borderWidth: 0.3 });
    if (!text) return;
    const tw = font.widthOfTextAtSize(text, sz);
    let tx: number;
    if (align === 'center') {
      tx = x + (w - tw) / 2;
      if (tx < x + 1) tx = x + 1;
    } else {
      tx = x + leftPad;
    }
    page.drawText(text, { x: tx, y: bottom + h / 2 - sz * 0.3, size: sz, font, color });
  }

  // Draw a small badge (colored bg rect + text) centered in a cell
  function badge(colLeft: number, top: number, colW: number, rowH: number, label: string, bg: Color, textColor: Color, sz = 7) {
    const lw = font.widthOfTextAtSize(label, sz);
    const bPad = 2.5;
    const bW = lw + bPad * 2; const bH = sz + bPad * 1.2;
    const bx = colLeft + (colW - bW) / 2;
    const by = (top - rowH) + (rowH - bH) / 2;
    page.drawRectangle({ x: bx, y: by, width: bW, height: bH, color: bg });
    page.drawText(label, { x: bx + bPad, y: by + bPad * 0.4, size: sz, font, color: textColor });
  }

  // ── 1. Header ─────────────────────────────────────────────────────────────
  const TITLE_SZ = 13; const META_SZ = 7;
  page.drawText(`${year}年${month}月　勤怠一覧`, { x: M, y: Y - TITLE_SZ, size: TITLE_SZ, font, color: TITLE_BLUE });
  page.drawText(
    `基準: ${workSettings.standardStartTime}〜${workSettings.standardEndTime}　残業: 8h超過分　深夜: 22:00〜翌5:00`,
    { x: M, y: Y - TITLE_SZ - 3 - META_SZ, size: META_SZ, font, color: GRAY_TXT },
  );
  const dateLabel = `出力日: ${new Date().toLocaleDateString('ja-JP')}`;
  const dateLW = font.widthOfTextAtSize(dateLabel, META_SZ);
  page.drawText(dateLabel, { x: M + cW - dateLW, y: Y - META_SZ, size: META_SZ, font, color: GRAY_TXT });
  Y -= TITLE_SZ + META_SZ + 7;
  page.drawLine({ start: { x: M, y: Y }, end: { x: M + cW, y: Y }, color: TITLE_BLUE, thickness: 1 });
  Y -= 5;

  // ── 2. Summary table ──────────────────────────────────────────────────────
  const SUM_H = 14;
  const sumLabels = ['出勤日数', '所定休日出勤', '法定休日出勤', '総労働時間', '残業時間', '法定休日時間', '深夜時間', '遅刻', '早退'];
  const sumValues = [
    `${workDays}日`, `${shdDays}日`, `${lhdDays}日`,
    formatMinutes(workMins), formatMinutes(otMins), formatMinutes(lhMins), formatMinutes(lnMins),
    `${lateN}回`, `${earlyN}回`,
  ];
  const sumColors: Color[] = [DARK_TXT, ORANGE_TXT, RED_TXT, DARK_TXT, ORANGE_TXT, RED_TXT, PURPLE_TXT, RED_TXT, RED_TXT];
  const sumW = cW / 9;
  const sumColW = Array.from({ length: 9 }, (_, i) => i < 8 ? sumW : cW - sumW * 8);

  let sx = M;
  for (let i = 0; i < 9; i++) { cell(sx, Y, sumColW[i], SUM_H, sumLabels[i], 7, GRAY_TXT, TH_BG); sx += sumColW[i]; }
  Y -= SUM_H;
  sx = M;
  for (let i = 0; i < 9; i++) { cell(sx, Y, sumColW[i], SUM_H, sumValues[i], 8, sumColors[i]); sx += sumColW[i]; }
  Y -= SUM_H + 4;

  // ── 3. Paid-leave table ───────────────────────────────────────────────────
  const PL_COL = 100;
  cell(M, Y, PL_COL, SUM_H, '有給日数', 7, GRAY_TXT, TH_BG);
  cell(M + PL_COL, Y, PL_COL, SUM_H, '有給残日数', 7, GRAY_TXT, TH_BG);
  Y -= SUM_H;
  cell(M, Y, PL_COL, SUM_H, `${paidDays}日`, 8, DARK_TXT);
  const plStr = plRemaining !== null ? `${plRemaining}日` : '未設定';
  const plClr = plRemaining !== null ? (plRemaining <= 5 ? RED_TXT : GREEN_TXT) : GRAY_TXT;
  cell(M + PL_COL, Y, PL_COL, SUM_H, plStr, 8, plClr);
  Y -= SUM_H + 5;

  // ── 4. Detail table ───────────────────────────────────────────────────────
  const DET_H = 13; const TH_H = 15; const SZ = 7;

  // Column widths: cols[0..9] fixed, cols[10] = remaining width
  const fixedCols = [60, 55, 42, 42, 42, 47, 47, 47, 42, 36];
  const fixedSum  = fixedCols.reduce((s, v) => s + v, 0);
  const detCols   = [...fixedCols, Math.round((cW - fixedSum) * 10) / 10];
  const colX: number[] = [M];
  for (let i = 0; i < detCols.length - 1; i++) colX.push(colX[i] + detCols[i]);

  // Table header (blue background)
  const detHeaders = ['日付', '種別', '出勤', '退勤', '休憩(分)', '労働時間', '残業', '法定休日', '深夜', '状態', '備考'];
  for (let i = 0; i < detCols.length; i++) {
    cell(colX[i], Y, detCols[i], TH_H, detHeaders[i], SZ, WHITE, TITLE_BLUE);
  }
  Y -= TH_H;

  // Detail rows
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const r   = byDate.get(dateKey);
    const dow = new Date(dateKey + 'T00:00:00').getDay();
    const hName = getHolidayName(dateKey);
    const isOff = dow === 0 || dow === 6 || !!hName;
    const isOdd = d % 2 === 1;

    // Row background
    let rowBg: Color;
    if (r) {
      if      (r.type === 'holiday')                rowBg = HOL_BG;
      else if (['paid_leave','am_leave','pm_leave'].includes(r.type)) rowBg = PAID_BG;
      else if (r.type === 'absence')                rowBg = ABS_BG;
      else if (r.type === 'scheduled_holiday_work') rowBg = SH_BG;
      else if (r.type === 'legal_holiday_work')     rowBg = LH_BG;
      else rowBg = isOdd ? WHITE : EVEN_BG;
    } else if (isOff) {
      rowBg = OFF_BG;
    } else {
      rowBg = EMPT_BG;
    }

    // Draw all cell backgrounds + borders first
    for (let i = 0; i < detCols.length; i++) {
      const bottom = Y - DET_H;
      page.drawRectangle({ x: colX[i], y: bottom, width: detCols[i], height: DET_H, color: rowBg });
      page.drawRectangle({ x: colX[i], y: bottom, width: detCols[i], height: DET_H, borderColor: BORDER, borderWidth: 0.3 });
    }

    const midY = (Y - DET_H) + DET_H / 2 - SZ * 0.3;

    // Col 0: 日付
    {
      const dayPart = `${d}日`;
      const dowPart = `(${DOW_JA[dow]})`;
      const dpW = font.widthOfTextAtSize(dayPart, SZ);
      const dwW = font.widthOfTextAtSize(dowPart, SZ);
      const startX = colX[0] + (detCols[0] - dpW - 2 - dwW) / 2;
      const dowClr = dow === 0 ? RED_SUN : dow === 6 ? BLU_SAT : DARK_TXT;
      page.drawText(dayPart, { x: startX,           y: midY, size: SZ, font, color: DARK_TXT });
      page.drawText(dowPart, { x: startX + dpW + 2, y: midY, size: SZ, font, color: dowClr });
    }

    if (r) {
      // Col 1: 種別 badge
      const typeKey = r.type as AttendanceType;
      badge(colX[1], Y, detCols[1], DET_H, ATTENDANCE_TYPE_LABELS[typeKey], BADGE_BG[typeKey], BADGE_TXT[typeKey]);

      const hasTime = IS_WORK.has(r.type) && !!r.clockIn && !!r.clockOut;
      const rowEffBreak = hasTime ? getEffectiveBreak(r.type, r.clockIn!, r.clockOut!, r.breakMinutes ?? 0) : 0;
      const wMin = hasTime ? calcWorkMinutes(r.clockIn!, r.clockOut!, rowEffBreak) : null;
      const ot = wMin !== null
        ? r.type === 'scheduled_holiday_work' ? wMin
          : r.type === 'legal_holiday_work'   ? null
          : calcOvertimeMinutes(wMin)
        : null;
      const lhMin = r.type === 'legal_holiday_work' && wMin !== null ? wMin : null;
      const ln    = hasTime ? calcLateNightMinutes(r.clockIn!, r.clockOut!) : null;

      const ct = (ci: number, txt: string, clr: Color = DARK_TXT) =>
        drawCentered(txt, colX[ci], detCols[ci], midY, SZ, clr);

      ct(2, hasTime ? r.clockIn!  : '-', hasTime ? DARK_TXT : LIGHT_TXT);
      ct(3, hasTime ? r.clockOut! : '-', hasTime ? DARK_TXT : LIGHT_TXT);
      ct(4, IS_WORK.has(r.type) ? String(rowEffBreak) : '-',
            IS_WORK.has(r.type) ? DARK_TXT : LIGHT_TXT);
      ct(5, wMin !== null ? formatMinutes(wMin) : '-');
      ct(6, ot  !== null ? (ot  > 0 ? formatMinutes(ot)  : '-') : '-', ot  && ot  > 0 ? ORANGE_TXT : DARK_TXT);
      ct(7, lhMin !== null ? formatMinutes(lhMin) : '-', lhMin && lhMin > 0 ? rgb(0.749, 0.212, 0.047) : DARK_TXT);
      ct(8, ln  !== null ? (ln  > 0 ? formatMinutes(ln)  : '-') : '-', ln  && ln  > 0 ? PURPLE_TXT : DARK_TXT);

      // Col 9: 状態 (late/early)
      const refS   = r.customStartTime ?? workSettings.standardStartTime;
      const refE   = r.customEndTime   ?? workSettings.standardEndTime;
      const isHalf = r.type === 'am_leave' || r.type === 'pm_leave';
      const late  = hasTime && !isHalf && isLateArrival(r.clockIn!, refS);
      const early = hasTime && !isHalf && isEarlyDeparture(r.clockOut!, refE, r.clockIn);
      if (late || early) {
        const stTxt = late && early ? '遅/早' : late ? '遅刻' : '早退';
        drawCentered(stTxt, colX[9], detCols[9], midY, 6, RED_TXT);
      }

      // Col 10: 備考
      if (r.notes) {
        const noteTrunc = r.notes.length > 14 ? r.notes.slice(0, 13) + '…' : r.notes;
        page.drawText(noteTrunc, { x: colX[10] + 2, y: midY, size: 6.5, font, color: GRAY_TXT });
      }
    } else {
      // No record: holiday badge for off days, dashes otherwise
      if (isOff) {
        badge(colX[1], Y, detCols[1], DET_H, '休日', rgb(0.910, 0.957, 0.914), rgb(0.180, 0.490, 0.196));
      } else {
        drawCentered('-', colX[1], detCols[1], midY, SZ, LIGHT_TXT);
      }
      for (let ci = 2; ci <= 8; ci++) {
        drawCentered('-', colX[ci], detCols[ci], midY, SZ, LIGHT_TXT);
      }
      if (hName) {
        page.drawText(hName, { x: colX[10] + 2, y: midY, size: 6.5, font, color: GRAY_TXT });
      }
    }

    Y -= DET_H;
  }

  // ── Save & download ───────────────────────────────────────────────────────
  const userPart = (employeeId || lastName) ? `_${employeeId}${lastName}` : '';
  const filename  = `勤務表${year}${String(month).padStart(2, '0')}${userPart}.pdf`;
  openPdf(await pdfDoc.save(), filename);
}
