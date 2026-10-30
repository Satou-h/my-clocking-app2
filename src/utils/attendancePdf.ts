// 勤務表PDF（会社の様式1-1-26.1 と同じ項目・A4横）
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { AttendanceRecord, AttendanceType, WorkSettings } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS, WORK_LOCATION_LABELS } from '../types/attendance';
import {
  calcWorkMinutes, calcOvertimeMinutes, calcLateNightMinutes, calcPaidLeaveUsed,
  isLateArrival, isEarlyDeparture, getEffectiveBreak, getWorkLocation, timeToMins,
} from './storage';
import { getHolidayName } from './holidays';
import {
  C, DOW_JA, createPainter, drawStatGroups, downloadPdf, hm, loadFont, quarterHours, shortTime, todayString,
  type Stat,
} from './pdfKit';

const FORM_NO = '様式1-1-26.1';
const DAILY_LIMIT = 8 * 60;
const WORK_TYPES = new Set<AttendanceType>(['work', 'am_leave', 'pm_leave', 'scheduled_holiday_work', 'legal_holiday_work', 'transfer_holiday_work']);
const LEAVE_TYPES = new Set<AttendanceType>(['paid_leave', 'planned_paid_leave', 'am_leave', 'pm_leave', 'holiday', 'transfer_holiday']);

interface DayRow {
  day: number;
  dow: number;
  isOff: boolean;          // 土日祝
  holiday: string | null;
  rec?: AttendanceRecord;
  worked: boolean;
  start?: string;
  end?: string;
  brk: number;             // 休憩
  bind: number;            // 勤務時間（出社〜退社）
  actual: number;          // 実働
  normal: number;          // 普通勤務（8hまで）
  overNormal: number;      // 普通残業（8h超）
  overSched: number;       // 所定休日出勤
  overLegal: number;       // 法定休日出勤
  overTotal: number;       // 時間外 計
  night: number;           // 深夜
  lateEarly: number;       // 遅刻早退（分）
}

type MinKey = 'brk' | 'bind' | 'actual' | 'normal' | 'overTotal' | 'overNormal' | 'overSched' | 'overLegal' | 'night' | 'lateEarly';

function calcDay(dateKey: string, day: number, rec: AttendanceRecord | undefined, ws: WorkSettings): DayRow {
  const dow = new Date(dateKey + 'T00:00:00').getDay();
  const holiday = getHolidayName(dateKey);
  const row: DayRow = {
    day, dow, holiday, rec, isOff: dow === 0 || dow === 6 || !!holiday, worked: false,
    brk: 0, bind: 0, actual: 0, normal: 0, overNormal: 0, overSched: 0, overLegal: 0, overTotal: 0, night: 0, lateEarly: 0,
  };
  if (!rec || !WORK_TYPES.has(rec.type) || !rec.clockIn || !rec.clockOut) return row;

  const { clockIn, clockOut, type } = rec;
  row.worked = true;
  row.start = clockIn;
  row.end = clockOut;
  row.brk = getEffectiveBreak(type, clockIn, clockOut, rec.breakMinutes ?? 0);
  row.actual = Math.max(0, calcWorkMinutes(clockIn, clockOut, row.brk));
  row.bind = row.actual + row.brk;
  // アプリの集計と同じく、所定休日出勤は全時間を残業、法定休日出勤は専用で集計する
  if (type === 'scheduled_holiday_work') row.overSched = row.actual;
  else if (type === 'legal_holiday_work') row.overLegal = row.actual;
  else {
    row.normal = Math.min(row.actual, DAILY_LIMIT);
    row.overNormal = calcOvertimeMinutes(row.actual);
  }
  row.overTotal = row.overNormal + row.overSched + row.overLegal;
  row.night = calcLateNightMinutes(clockIn, clockOut);

  // 遅刻早退（午前休・午後休と、土日祝・休日出勤の日は対象外。会社様式と同じく平日の勤務だけ）
  if (!row.isOff && (type === 'work' || type === 'transfer_holiday_work')) {
    const refS = rec.customStartTime ?? ws.standardStartTime;
    const refE = rec.customEndTime ?? ws.standardEndTime;
    if (isLateArrival(clockIn, refS)) row.lateEarly += timeToMins(clockIn) - timeToMins(refS);
    if (isEarlyDeparture(clockOut, refE, clockIn)) {
      const inM = timeToMins(clockIn);
      let outM = timeToMins(clockOut), endM = timeToMins(refE);
      if (outM <= inM) outM += 1440;
      if (endM < inM) endM += 1440;
      row.lateEarly += endM - outM;
    }
  }
  return row;
}

// 区分欄に出すラベル。平日の通常出勤は空欄、休日の通常出勤は会社様式と同じ「普通勤務」
function kubunOf(r: DayRow): { label: string; tone: 'work' | 'leave' | 'alert' } | null {
  if (!r.rec) return null;
  const t = r.rec.type;
  if (t === 'work') return r.isOff ? { label: '普通勤務', tone: 'work' } : null;
  if (t === 'holiday' && r.isOff) return null;
  if (t === 'absence') return { label: ATTENDANCE_TYPE_LABELS[t], tone: 'alert' };
  return { label: ATTENDANCE_TYPE_LABELS[t], tone: LEAVE_TYPES.has(t) ? 'leave' : 'work' };
}

export async function buildMonthlyAttendancePdf(
  fontBytes: ArrayBuffer | Uint8Array,
  records: AttendanceRecord[],
  workSettings: WorkSettings,
  year: number,
  month: number,
  plRemaining: number | null,
  name: string,
  issuedOn = todayString(),
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes);
  doc.setTitle(`${year}年${month}月 勤務表 ${name}`);

  const W = 841.89, H = 595.28; // A4 横
  const page = doc.addPage([W, H]);
  const p = createPainter(page, font);
  const M = { l: 28, r: 28, t: 22, b: 18 };
  const right = W - M.r;

  // ── データ ────────────────────────────────────────────────────────────────
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const byDate = new Map(records.filter(r => r.date.startsWith(ym)).map(r => [r.date, r]));
  const daysInMonth = new Date(year, month, 0).getDate();
  const rows = Array.from({ length: daysInMonth }, (_, i) => {
    const key = `${ym}-${String(i + 1).padStart(2, '0')}`;
    return calcDay(key, i + 1, byDate.get(key), workSettings);
  });
  const sum = (k: MinKey) => rows.reduce((a, r) => a + r[k], 0);
  const total = {
    brk: sum('brk'), bind: sum('bind'), actual: sum('actual'), normal: sum('normal'),
    overTotal: sum('overTotal'), overNormal: sum('overNormal'), overSched: sum('overSched'),
    overLegal: sum('overLegal'), night: sum('night'), lateEarly: sum('lateEarly'),
  };
  const workDays = rows.filter(r => r.worked).length;
  const absentDays = rows.filter(r => r.rec?.type === 'absence').length;
  const lateEarlyDays = rows.filter(r => r.lateEarly > 0).length;
  const plUsed = calcPaidLeaveUsed(records, year, month);
  const plStart = plRemaining !== null ? plRemaining + plUsed : null;

  // ── ヘッダー ──────────────────────────────────────────────────────────────
  p.txt(FORM_NO, 0, 14, 6.5, C.sub, 'right', right);
  p.txt(`${year}年${month}月 勤務表`, M.l, M.t + 18, 17, C.primary);
  let x = M.l;
  const metaY = M.t + 40;
  const meta = (label: string, value: string, size: number) => {
    p.txt(label, x, metaY, 7, C.sub); x += p.width(label, 7) + 5;
    p.txt(value, x, metaY, size, C.ink); x += p.width(value, size) + 22;
  };
  meta('氏名', name, 11);
  meta('基準時間', `${shortTime(workSettings.standardStartTime)} 〜 ${shortTime(workSettings.standardEndTime)}`, 8.5);
  meta('出力日', issuedOn, 8.5);
  const stampX = p.stamps(['承認印', '確認印'], right, M.t - 2, 54, 54);
  p.hline(M.l, stampX - 16, M.t + 48, C.primary, 1.2);

  // ── 集計 ──────────────────────────────────────────────────────────────────
  const tone = (v: number, alert = false): Stat['tone'] => (v === 0 ? 'zero' : alert ? 'alert' : 'normal');
  const hours = (min: number, alert = false): Stat => ({ label: '', value: quarterHours(min), unit: 'h', tone: tone(min, alert) });
  const plStat = (label: string, v: number | null, zeroFaint = false): Stat =>
    v === null
      ? { label, value: '未設定', unit: '', tone: 'zero' }
      : { label, value: v.toFixed(1), unit: '日', tone: zeroFaint ? tone(v) : 'normal' };
  const sumY = M.t + 60, sumH = 44;
  drawStatGroups(p, [
    { title: '日数', stats: [
      { label: '出勤日数', value: String(workDays), unit: '日', tone: tone(workDays) },
      { label: '欠勤日数', value: String(absentDays), unit: '日', tone: tone(absentDays, true) },
      { label: '遅早退日数', value: lateEarlyDays.toFixed(1), unit: '日', tone: tone(lateEarlyDays, true) },
    ] },
    { title: '有給休暇', stats: [
      plStat('前月残', plStart),
      { label: '取得', value: plUsed.toFixed(1), unit: '日', tone: tone(plUsed) },
      plStat('当月残', plRemaining),
    ] },
    { title: '時間（0.25h単位）', stats: [
      { ...hours(total.bind), label: '勤務時間' },
      { ...hours(total.brk), label: '休憩時間' },
      { ...hours(total.actual), label: '実働時間' },
      { ...hours(total.normal), label: '普通勤務' },
      { ...hours(total.overNormal + total.overSched, true), label: '普残/所休' },
      { ...hours(total.overLegal, true), label: '法定休日' },
      { ...hours(total.night, true), label: '深夜勤務' },
      { ...hours(total.lateEarly, true), label: '遅刻早退' },
    ] },
  ], M.l, right, sumY, sumH);

  // ── 明細 ──────────────────────────────────────────────────────────────────
  type Col = { key: 'date' | 'kubun' | 'start' | 'end' | 'daikyu' | 'note' | MinKey; label: string; w: number; group?: string };
  const cols: Col[] = [
    { key: 'date', label: '日付', w: 42 },
    { key: 'kubun', label: '祝日・区分', w: 66 },
    { key: 'start', label: '出社', w: 38, group: '打刻' },
    { key: 'end', label: '退社', w: 38, group: '打刻' },
    { key: 'brk', label: '休憩', w: 36, group: '打刻' },
    { key: 'bind', label: '勤務', w: 40, group: '時間' },
    { key: 'actual', label: '実働', w: 40, group: '時間' },
    { key: 'normal', label: '普通勤務', w: 44, group: '時間' },
    { key: 'overTotal', label: '計', w: 38, group: '時間外' },
    { key: 'overNormal', label: '普通残業', w: 44, group: '時間外' },
    { key: 'overSched', label: '所定休日', w: 44, group: '時間外' },
    { key: 'overLegal', label: '法定休日', w: 44, group: '時間外' },
    { key: 'night', label: '深夜', w: 38, group: 'その他' },
    { key: 'lateEarly', label: '遅刻早退', w: 44, group: 'その他' },
    { key: 'daikyu', label: '代休', w: 36, group: 'その他' },
    { key: 'note', label: '備考', w: 0 },
  ];
  cols[cols.length - 1].w = right - M.l - cols.reduce((a, c) => a + c.w, 0);
  const colX: number[] = [];
  cols.reduce((acc, c) => (colX.push(acc), acc + c.w), M.l);
  const isGroupStart = (i: number) => i > 0 && (!cols[i].group || cols[i - 1].group !== cols[i].group);
  const OVER_KEYS = new Set(['overTotal', 'overNormal', 'overSched', 'overLegal', 'night']);
  const colorOf = (key: string) => (OVER_KEYS.has(key) ? C.over : key === 'lateEarly' ? C.sun : C.ink);

  const tY = sumY + sumH + 12, gH = 12, cH = 13, hH = gH + cH, totalH = 16, footH = 12;
  const bodyTop = tY + hH;
  // 月による変動を避けるため常に31行分で割る
  const rowH = Math.min(13.5, Math.floor(((H - M.b - footH - totalH - bodyTop) / 31) * 10) / 10);

  // 見出し（2段）
  p.rect(M.l, tY, right - M.l, hH, { fill: C.primary });
  const spans = new Map<string, { x1: number; x2: number }>();
  cols.forEach((c, i) => {
    if (!c.group) return;
    const s = spans.get(c.group);
    spans.set(c.group, { x1: s ? s.x1 : colX[i], x2: colX[i] + c.w });
  });
  for (const [g, s] of spans) {
    p.cell(g, s.x1, tY, s.x2 - s.x1, gH + 1, 7, C.headerSub, 'center');
    p.hline(s.x1 + 4, s.x2 - 4, tY + gH + 0.5, C.headerSub, 0.4);
  }
  cols.forEach((c, i) => {
    const y = c.group ? tY + gH : tY, h = c.group ? cH : hH;
    p.cell(c.label, colX[i], y, c.w, h, 7.3, C.white, 'center');
    if (isGroupStart(i)) p.vline(colX[i], tY + 3, tY + hH - 3, C.white, 0.4, 0.35);
  });

  // 行
  const fs = rowH < 12 ? 7.2 : 7.6;
  rows.forEach((r, ri) => {
    const y = bodyTop + rowH * ri;
    const restDay = !r.worked && (r.isOff || r.rec?.type === 'holiday' || r.rec?.type === 'transfer_holiday');
    if (restDay) p.rect(M.l, y, right - M.l, rowH, { fill: C.off });
    p.hline(M.l, right, y + rowH, C.line, 0.45);

    // 日付
    const dayColor = r.holiday || r.dow === 0 ? C.sun : r.dow === 6 ? C.sat : C.ink;
    p.cell(String(r.day), colX[0], y, 17, rowH, fs, C.ink, 'right', 0);
    p.cell(DOW_JA[r.dow], colX[0] + 21, y, 12, rowH, fs, dayColor, 'left', 0);

    // 祝日・区分（両方あるときは祝日名を備考へ）
    const kubun = kubunOf(r);
    const notes: string[] = [];
    if (kubun) {
      const bg = kubun.tone === 'leave' ? C.leaveSoft : kubun.tone === 'alert' ? C.alertSoft : C.primarySoft;
      const fg = kubun.tone === 'leave' ? C.leave : kubun.tone === 'alert' ? C.sun : C.primary;
      p.badge(kubun.label, colX[1] + 4, y, rowH, 6.5, bg, fg);
      if (r.holiday) notes.push(r.holiday);
    } else if (r.holiday) {
      p.cell(r.holiday, colX[1], y, cols[1].w, rowH, 6.8, C.sun, 'left', 4);
    }

    if (r.worked) {
      p.cell(shortTime(r.start!), colX[2], y, cols[2].w, rowH, fs, C.ink);
      p.cell(shortTime(r.end!), colX[3], y, cols[3].w, rowH, fs, C.ink);
      cols.forEach((c, i) => {
        if (i < 4 || c.key === 'note' || c.key === 'daikyu') return;
        const v = r[c.key as MinKey];
        if (v) p.cell(hm(v), colX[i], y, c.w, rowH, fs, colorOf(c.key));
      });
      const loc = getWorkLocation(r.rec!);
      if (loc !== 'site') notes.push(WORK_LOCATION_LABELS[loc]);
    }
    if (r.rec?.notes) notes.push(r.rec.notes);
    if (notes.length) {
      const ni = cols.length - 1;
      p.cell(p.fit(notes.join('　'), 7, cols[ni].w - 12), colX[ni], y, cols[ni].w, rowH, 7, C.ink, 'left', 6);
    }
  });
  const bodyBottom = bodyTop + rowH * rows.length;
  cols.forEach((_, i) => { if (isGroupStart(i)) p.vline(colX[i], bodyTop, bodyBottom, C.lineStrong, 0.45); });

  // 合計
  p.rect(M.l, bodyBottom, right - M.l, totalH, { fill: C.primarySoft });
  p.hline(M.l, right, bodyBottom, C.primary, 0.9);
  p.cell('合計', colX[0], bodyBottom, cols[0].w + cols[1].w, totalH, 7.8, C.primary, 'left', 4);
  cols.forEach((c, i) => {
    if (i < 4 || c.key === 'note') return;
    const v = c.key === 'daikyu' ? 0 : total[c.key as MinKey];
    p.cell(hm(v), colX[i], bodyBottom, c.w, totalH, 7.8, v === 0 ? C.faint : colorOf(c.key));
  });

  p.txt('上部の時間は15分単位で集計（明細・合計は 時:分）。空欄は 0:00。', M.l, bodyBottom + totalH + 10, 6.3, C.sub);

  return doc.save();
}

export async function printMonthlyAttendancePDF(
  records: AttendanceRecord[],
  workSettings: WorkSettings,
  year: number,
  month: number,
  plRemaining: number | null = null,
  employeeId = '',
  lastName = '',
  name = '',
): Promise<void> {
  const bytes = await buildMonthlyAttendancePdf(await loadFont(), records, workSettings, year, month, plRemaining, name);
  const userPart = (employeeId || lastName) ? `_${employeeId}${lastName}` : '';
  downloadPdf(bytes, `勤務表${year}${String(month).padStart(2, '0')}${userPart}.pdf`);
}
