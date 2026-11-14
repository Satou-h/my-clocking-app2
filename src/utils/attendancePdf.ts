// 勤務表PDF（A4横）。同じ集計から2種類を作る
// ・勤務表: 提出用。祝祭日・休の欄と、時間の主な内訳（実働・普通勤務・時間外・深夜勤務・遅刻早退）を載せる
// ・勤務表(計算用): 時間の内訳を確かめる用（以前からの勤務表）。勤務時間・時間外の計・深夜残業・代休の欄と合計の行も載せる
import { PDFDocument, type RGB } from 'pdf-lib';
import type { AttendanceRecord, AttendanceType, WorkSettings } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS } from '../types/attendance';
import { ATTENDANCE_CALC_LABEL } from '../types/document';
import {
  calcWorkMinutes, calcOvertimeMinutes, calcLateNightMinutes, calcLateNightOvertimeMinutes, calcPaidLeaveUsed,
  isLateArrival, isEarlyDeparture, getEffectiveBreak, getWorkLocation, timeToMins, withFixedNotes,
} from './storage';
import { getHolidayName } from './holidays';
import { sealImage, type SealTexts } from './seal';
import {
  C, DOW_JA, createPainter, drawStatGroups, downloadPdf, embedAppFont, hm, hm10, markLeaderSigned, shortTime, withPdfFont,
  writeSignAreas,
  type Painter, type Stat,
} from './pdfKit';

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
  nightOver: number;       // 深夜残業（時間外のうち 22:00〜翌5:00 の分）
  lateEarly: number;       // 遅刻早退（分）
}

const MIN_KEYS = ['brk', 'bind', 'actual', 'normal', 'overTotal', 'overNormal', 'overSched', 'overLegal', 'night', 'nightOver', 'lateEarly'] as const;
type MinKey = typeof MIN_KEYS[number];
const isMinKey = (k: string): k is MinKey => (MIN_KEYS as readonly string[]).includes(k);

function calcDay(dateKey: string, day: number, rec: AttendanceRecord | undefined, ws: WorkSettings): DayRow {
  const dow = new Date(dateKey + 'T00:00:00').getDay();
  const holiday = getHolidayName(dateKey);
  const row: DayRow = {
    day, dow, holiday, rec, isOff: dow === 0 || dow === 6 || !!holiday, worked: false,
    brk: 0, bind: 0, actual: 0, normal: 0, overNormal: 0, overSched: 0, overLegal: 0, overTotal: 0, night: 0, nightOver: 0, lateEarly: 0,
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
  row.nightOver = calcLateNightOvertimeMinutes(type, clockIn, clockOut, row.brk);

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

type Tone = 'work' | 'leave' | 'alert';
const BADGE_COLORS: Record<Tone, { bg: RGB; fg: RGB }> = {
  work: { bg: C.primarySoft, fg: C.primary },
  leave: { bg: C.leaveSoft, fg: C.leave },
  alert: { bg: C.alertSoft, fg: C.sun },
};

// 区分欄（計算用）に出すラベル。平日の通常出勤は空欄、休日の通常出勤は会社様式と同じ「普通勤務」
function kubunOf(r: DayRow): { label: string; tone: Tone } | null {
  if (!r.rec) return null;
  const t = r.rec.type;
  if (t === 'work') return r.isOff ? { label: '普通勤務', tone: 'work' } : null;
  if (t === 'holiday' && r.isOff) return null;
  if (t === 'absence') return { label: ATTENDANCE_TYPE_LABELS[t], tone: 'alert' };
  return { label: ATTENDANCE_TYPE_LABELS[t], tone: LEAVE_TYPES.has(t) ? 'leave' : 'work' };
}

// 休の欄（提出用）に出す略号。空欄にする日は区分欄と同じ。使った略号は欄外に「休欄：普＝休日の普通勤務」と凡例を出す
const KYU_CODES: Record<AttendanceType, string> = {
  work: '普', // 土日祝の通常出勤（平日は空欄）
  paid_leave: '有',
  planned_paid_leave: '計',
  am_leave: '午前',
  pm_leave: '午後',
  absence: '欠',
  holiday: '休',
  transfer_holiday: '振休',
  scheduled_holiday_work: '所',
  legal_holiday_work: '法',
  transfer_holiday_work: '振出',
};

function kyuOf(r: DayRow): { code: string; desc: string; tone: Tone } | null {
  const kubun = kubunOf(r);
  if (!kubun || !r.rec) return null;
  const t = r.rec.type;
  return { code: KYU_CODES[t], desc: t === 'work' ? '休日の普通勤務' : kubun.label, tone: kubun.tone };
}

// 備考。帰社・在宅の定型文は入力画面で備考に入る。備考に無い古いデータだけ補い、二重には出さない
function noteOf(r: DayRow): string {
  const loc = r.worked ? getWorkLocation(r.rec!) : 'site';
  const remote = r.worked && !!r.rec!.workFromHome;
  return (loc !== 'site' || remote ? withFixedNotes(r.rec!.notes ?? '', loc, remote || undefined) : r.rec?.notes) ?? '';
}

// ── 月の集計（提出用・計算用で共通） ─────────────────────────────────────────
export interface AttendanceSheetArgs {
  fontBytes: ArrayBuffer | Uint8Array;
  records: AttendanceRecord[];
  workSettings: WorkSettings;
  year: number;
  month: number;
  plRemaining: number | null;
  name: string;
  approverSeal?: string; // 承認済みなら、承認印欄に押す承認した人の印鑑（PNG の data URL）
  confirmerSeal?: string; // 確認済み・承認済みなら、確認印欄に押す確認した人の印鑑（PNG の data URL）
}

interface MonthCalc {
  rows: DayRow[];
  total: Record<MinKey, number>;
  workDays: number;
  absentDays: number;
  lateEarlyDays: number;
  plUsed: number;
  plStart: number | null;
}

function calcMonth({ records, workSettings, year, month, plRemaining }: AttendanceSheetArgs): MonthCalc {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  const byDate = new Map(records.filter(r => r.date.startsWith(ym)).map(r => [r.date, r]));
  const daysInMonth = new Date(year, month, 0).getDate();
  const rows = Array.from({ length: daysInMonth }, (_, i) => {
    const key = `${ym}-${String(i + 1).padStart(2, '0')}`;
    return calcDay(key, i + 1, byDate.get(key), workSettings);
  });
  const total = Object.fromEntries(MIN_KEYS.map(k => [k, rows.reduce((a, r) => a + r[k], 0)])) as Record<MinKey, number>;
  const plUsed = calcPaidLeaveUsed(records, year, month);
  return {
    rows,
    total,
    workDays: rows.filter(r => r.worked).length,
    absentDays: rows.filter(r => r.rec?.type === 'absence').length,
    lateEarlyDays: rows.filter(r => r.lateEarly > 0).length,
    plUsed,
    plStart: plRemaining !== null ? plRemaining + plUsed : null,
  };
}

// ── ページの共通部分 ────────────────────────────────────────────────────────
const W = 841.89, H = 595.28; // A4 横
const M = { l: 28, r: 28, t: 22, b: 18 };
const RIGHT = W - M.r;
const SUM_Y = M.t + 60, SUM_H = 44;
const TABLE_Y = SUM_Y + SUM_H + 12;
const GROUP_H = 12, LABEL_H = 13, HEAD_H = GROUP_H + LABEL_H;
const BODY_TOP = TABLE_Y + HEAD_H;
const TOTAL_H = 16, FOOT_H = 12;
// 月による変動を避けるため常に31行分で割る（提出用は合計の行を置かないが、行の高さは計算用とそろえる）
const ROW_H = Math.min(13.5, Math.floor(((H - M.b - FOOT_H - TOTAL_H - BODY_TOP) / 31) * 10) / 10);
const FS = ROW_H < 12 ? 7.2 : 7.6;

const statTone = (v: number, alert = false): Stat['tone'] => (v === 0 ? 'zero' : alert ? 'alert' : 'normal');
// 上部の集計の時間（10分単位）
const hours = (label: string, min: number, alert = false): Stat => ({ label, value: hm10(min), unit: '', tone: statTone(min, alert) });

// 見出し（年月・氏名・基準時間・押印欄）と上部の集計（日数・有給休暇・時間）を描いたページを作る
async function startSheet(a: AttendanceSheetArgs, docName: string, m: MonthCalc, timeStats: Stat[]) {
  const { year, month, name, workSettings, plRemaining } = a;
  const doc = await PDFDocument.create();
  const font = await embedAppFont(doc, a.fontBytes);
  doc.setTitle(`${year}年${month}月 ${docName} ${name}`);
  const p = createPainter(doc.addPage([W, H]), font);

  // ── ヘッダー ──────────────────────────────────────────────────────────────
  p.txt(`${year}年${month}月 勤務表`, M.l, M.t + 18, 17, C.primary);
  let x = M.l;
  const metaY = M.t + 40;
  const meta = (label: string, value: string, size: number) => {
    p.txt(label, x, metaY, 7, C.sub); x += p.width(label, 7) + 5;
    p.txt(value, x, metaY, size, C.ink); x += p.width(value, size) + 22;
  };
  meta('氏名', name, 11);
  meta('基準時間', `${shortTime(workSettings.standardStartTime)} 〜 ${shortTime(workSettings.standardEndTime)}`, 8.5);
  const approverSign = a.approverSeal ? await doc.embedPng(a.approverSeal) : undefined;
  const confirmerSign = a.confirmerSeal ? await doc.embedPng(a.confirmerSeal) : undefined;
  if (confirmerSign) markLeaderSigned(doc);
  const stampX = p.stamps(['承認印', '確認印'], RIGHT, M.t - 2, 54, 54, { 承認印: approverSign, 確認印: confirmerSign });
  p.hline(M.l, stampX - 16, M.t + 48, C.primary, 1.2);

  // ── 集計 ──────────────────────────────────────────────────────────────────
  const plStat = (label: string, v: number | null, zeroFaint = false): Stat =>
    v === null
      ? { label, value: '未設定', unit: '', tone: 'zero' }
      : { label, value: v.toFixed(1), unit: '日', tone: zeroFaint ? statTone(v) : 'normal' };
  drawStatGroups(p, [
    { title: '日数', stats: [
      { label: '出勤日数', value: String(m.workDays), unit: '日', tone: statTone(m.workDays) },
      { label: '欠勤日数', value: String(m.absentDays), unit: '日', tone: statTone(m.absentDays, true) },
      { label: '遅早退日数', value: m.lateEarlyDays.toFixed(1), unit: '日', tone: statTone(m.lateEarlyDays, true) },
    ] },
    { title: '有給休暇', stats: [
      plStat('前月残', m.plStart),
      { label: '取得', value: m.plUsed.toFixed(1), unit: '日', tone: statTone(m.plUsed) },
      plStat('当月残', plRemaining),
    ] },
    { title: '時間（10分単位）', stats: timeStats },
  ], M.l, RIGHT, SUM_Y, SUM_H);

  return { doc, p };
}

type ColKey = MinKey | 'date' | 'kubun' | 'holiday' | 'kyu' | 'start' | 'end' | 'daikyu' | 'note';
interface Col { key: ColKey; label: string; w: number; group?: string }

const OVER_KEYS = new Set<ColKey>(['overTotal', 'overNormal', 'overSched', 'overLegal', 'night', 'nightOver']);
const colorOf = (key: ColKey) => (OVER_KEYS.has(key) ? C.over : key === 'lateEarly' ? C.sun : C.ink);

// 明細の表。最後の列（備考）は残りの幅にする
function createTable(p: Painter, cols: Col[]) {
  cols[cols.length - 1].w = RIGHT - M.l - cols.reduce((a, c) => a + c.w, 0);
  const colX: number[] = [];
  cols.reduce((acc, c) => (colX.push(acc), acc + c.w), M.l);
  const isGroupStart = (i: number) => i > 0 && (!cols[i].group || cols[i - 1].group !== cols[i].group);
  const at = (key: ColKey) => {
    const i = cols.findIndex(c => c.key === key);
    return { x: colX[i], w: cols[i].w };
  };

  // 見出し（2段）
  function drawHead() {
    p.rect(M.l, TABLE_Y, RIGHT - M.l, HEAD_H, { fill: C.primary });
    const spans = new Map<string, { x1: number; x2: number }>();
    cols.forEach((c, i) => {
      if (!c.group) return;
      const s = spans.get(c.group);
      spans.set(c.group, { x1: s ? s.x1 : colX[i], x2: colX[i] + c.w });
    });
    for (const [g, s] of spans) {
      p.cell(g, s.x1, TABLE_Y, s.x2 - s.x1, GROUP_H + 1, 7, C.headerSub, 'center');
      p.hline(s.x1 + 4, s.x2 - 4, TABLE_Y + GROUP_H + 0.5, C.headerSub, 0.4);
    }
    cols.forEach((c, i) => {
      const y = c.group ? TABLE_Y + GROUP_H : TABLE_Y, h = c.group ? LABEL_H : HEAD_H;
      p.cell(c.label, colX[i], y, c.w, h, 7.3, C.white, 'center');
      if (isGroupStart(i)) p.vline(colX[i], TABLE_Y + 3, TABLE_Y + HEAD_H - 3, C.white, 0.4, 0.35);
    });
  }

  // 行の地（休んだ土日祝・休日は灰色）と下線、日付・曜日、出勤した日の打刻と時間、備考
  function drawRow(r: DayRow, y: number, note: string) {
    const restDay = !r.worked && (r.isOff || r.rec?.type === 'holiday' || r.rec?.type === 'transfer_holiday');
    if (restDay) p.rect(M.l, y, RIGHT - M.l, ROW_H, { fill: C.off });
    p.hline(M.l, RIGHT, y + ROW_H, C.line, 0.45);

    const dayColor = r.holiday || r.dow === 0 ? C.sun : r.dow === 6 ? C.sat : C.ink;
    p.cell(String(r.day), colX[0], y, 17, ROW_H, FS, C.ink, 'right', 0);
    p.cell(DOW_JA[r.dow], colX[0] + 21, y, 12, ROW_H, FS, dayColor, 'left', 0);

    if (r.worked) {
      cols.forEach((c, i) => {
        if (c.key === 'start' || c.key === 'end') p.cell(shortTime(r[c.key]!), colX[i], y, c.w, ROW_H, FS, C.ink);
        else if (isMinKey(c.key) && r[c.key]) p.cell(hm(r[c.key]), colX[i], y, c.w, ROW_H, FS, colorOf(c.key));
      });
    }
    if (note) {
      const { x, w } = at('note');
      p.cell(p.fit(note, 7, w - 12), x, y, w, ROW_H, 7, C.ink, 'left', 6);
    }
  }

  // 欄の区切りの縦線を引き、表の下端を返す
  function drawColumnLines(rowCount: number) {
    const bottom = BODY_TOP + ROW_H * rowCount;
    cols.forEach((_, i) => { if (isGroupStart(i)) p.vline(colX[i], BODY_TOP, bottom, C.lineStrong, 0.45); });
    return bottom;
  }

  return { colX, at, drawHead, drawRow, drawColumnLines };
}

const rowTop = (i: number) => BODY_TOP + ROW_H * i;
const FOOT_NOTE = '時間は 時:分（上部の集計は10分単位で切り上げ）。空欄は 0:00。';

// ── 勤務表（提出用） ────────────────────────────────────────────────────────
export async function buildMonthlyAttendancePdf(a: AttendanceSheetArgs): Promise<Uint8Array> {
  const m = calcMonth(a);
  const { total } = m;
  const { doc, p } = await startSheet(a, '勤務表', m, [
    hours('実働時間', total.actual),
    hours('普通勤務', total.normal),
    hours('普残/所休', total.overNormal + total.overSched, true),
    hours('法定休日', total.overLegal, true),
    hours('深夜勤務', total.night, true),
    hours('遅早退時間', total.lateEarly, true),
  ]);

  const t = createTable(p, [
    { key: 'date', label: '日付', w: 42 },
    { key: 'holiday', label: '祝祭日', w: 66 },
    { key: 'kyu', label: '休', w: 30 },
    { key: 'start', label: '出社', w: 40, group: '打刻' },
    { key: 'end', label: '退社', w: 40, group: '打刻' },
    { key: 'brk', label: '休憩', w: 38, group: '打刻' },
    { key: 'actual', label: '実働', w: 44, group: '時間' },
    { key: 'normal', label: '普通勤務', w: 48, group: '時間' },
    { key: 'overNormal', label: '普通残業', w: 48, group: '時間外' },
    { key: 'overSched', label: '所定休日', w: 48, group: '時間外' },
    { key: 'overLegal', label: '法定休日', w: 48, group: '時間外' },
    { key: 'night', label: '深夜勤務', w: 48, group: 'その他' },
    { key: 'lateEarly', label: '遅刻早退', w: 48, group: 'その他' },
    { key: 'note', label: '備考', w: 0 },
  ]);
  t.drawHead();
  const holidayCol = t.at('holiday'), kyuCol = t.at('kyu');
  const legend = new Map<string, string>(); // 休の欄で使った略号 → 説明
  m.rows.forEach((r, ri) => {
    const y = rowTop(ri);
    t.drawRow(r, y, noteOf(r));
    if (r.holiday) p.cell(p.fit(r.holiday, 6.8, holidayCol.w - 8), holidayCol.x, y, holidayCol.w, ROW_H, 6.8, C.sun, 'left', 4);
    const kyu = kyuOf(r);
    if (kyu) {
      const { bg, fg } = BADGE_COLORS[kyu.tone];
      const w = p.width(kyu.code, 6.5) + 8; // badge() と同じ幅で、欄の中央に置く
      p.badge(kyu.code, kyuCol.x + (kyuCol.w - w) / 2, y, ROW_H, 6.5, bg, fg);
      legend.set(kyu.code, kyu.desc);
    }
  });
  const bottom = t.drawColumnLines(m.rows.length);
  p.hline(M.l, RIGHT, bottom, C.primary, 0.9);

  const legendText = legend.size ? `休欄：${[...legend].map(([code, desc]) => `${code}＝${desc}`).join('、')}` : '';
  p.txt(p.fit(FOOT_NOTE + legendText, 6.3, RIGHT - M.l), M.l, bottom + 10, 6.3, C.sub);

  writeSignAreas(doc, p.signAreas);
  return doc.save();
}

// ── 勤務表(計算用) ──────────────────────────────────────────────────────────
export async function buildAttendanceCalcPdf(a: AttendanceSheetArgs): Promise<Uint8Array> {
  const m = calcMonth(a);
  const { total } = m;
  const { doc, p } = await startSheet(a, ATTENDANCE_CALC_LABEL, m, [
    hours('勤務時間', total.bind),
    hours('休憩時間', total.brk),
    hours('実働時間', total.actual),
    hours('普通勤務', total.normal),
    hours('普残/所休', total.overNormal + total.overSched, true),
    hours('法定休日', total.overLegal, true),
    hours('深夜勤務', total.night, true),
    hours('深夜残業', total.nightOver, true),
    hours('遅刻早退', total.lateEarly, true),
  ]);

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
    { key: 'nightOver', label: '深夜残業', w: 44, group: '時間外' },
    { key: 'overSched', label: '所定休日', w: 44, group: '時間外' },
    { key: 'overLegal', label: '法定休日', w: 44, group: '時間外' },
    { key: 'night', label: '深夜', w: 38, group: 'その他' },
    { key: 'lateEarly', label: '遅刻早退', w: 44, group: 'その他' },
    { key: 'daikyu', label: '代休', w: 36, group: 'その他' },
    { key: 'note', label: '備考', w: 0 },
  ];
  const t = createTable(p, cols);
  t.drawHead();
  const kubunCol = t.at('kubun');
  m.rows.forEach((r, ri) => {
    const y = rowTop(ri);
    // 祝日・区分（両方あるときは祝日名を備考へ）
    const kubun = kubunOf(r);
    const notes: string[] = [];
    if (kubun && r.holiday) notes.push(r.holiday);
    const note = noteOf(r);
    if (note) notes.push(note);
    t.drawRow(r, y, notes.join('　'));
    if (kubun) {
      const { bg, fg } = BADGE_COLORS[kubun.tone];
      p.badge(kubun.label, kubunCol.x + 4, y, ROW_H, 6.5, bg, fg);
    } else if (r.holiday) {
      p.cell(r.holiday, kubunCol.x, y, kubunCol.w, ROW_H, 6.8, C.sun, 'left', 4);
    }
  });
  const bottom = t.drawColumnLines(m.rows.length);

  // 合計
  p.rect(M.l, bottom, RIGHT - M.l, TOTAL_H, { fill: C.primarySoft });
  p.hline(M.l, RIGHT, bottom, C.primary, 0.9);
  p.cell('合計', t.colX[0], bottom, cols[0].w + cols[1].w, TOTAL_H, 7.8, C.primary, 'left', 4);
  cols.forEach((c, i) => {
    if (!isMinKey(c.key) && c.key !== 'daikyu') return;
    const v = isMinKey(c.key) ? total[c.key] : 0;
    p.cell(hm(v), t.colX[i], bottom, c.w, TOTAL_H, 7.8, v === 0 ? C.faint : colorOf(c.key));
  });

  p.txt(FOOT_NOTE + '深夜残業は時間外のうち 22:00〜翌5:00 の時間。', M.l, bottom + TOTAL_H + 10, 6.3, C.sub);

  writeSignAreas(doc, p.signAreas);
  return doc.save();
}

// 勤務表（提出用）と勤務表(計算用)の2件を保存する
export async function printMonthlyAttendancePDF(
  records: AttendanceRecord[],
  workSettings: WorkSettings,
  year: number,
  month: number,
  plRemaining: number | null = null,
  employeeId = '',
  lastName = '',
  name = '',
  seals: SealTexts = {}, // 承認印・確認印の欄に押す印鑑の文字（勤務表に本人欄はない）
): Promise<void> {
  const args: Omit<AttendanceSheetArgs, 'fontBytes'> = {
    records, workSettings, year, month, plRemaining, name,
    approverSeal: await sealImage(seals.approver ?? ''), confirmerSeal: await sealImage(seals.confirmer ?? ''),
  };
  const ym = `${year}${String(month).padStart(2, '0')}`;
  const userPart = (employeeId || lastName) ? `_${employeeId}${lastName}` : '';
  const submit = await withPdfFont((fontBytes) => buildMonthlyAttendancePdf({ ...args, fontBytes }));
  downloadPdf(submit, `01_勤務表${ym}${userPart}.pdf`);
  const calc = await withPdfFont((fontBytes) => buildAttendanceCalcPdf({ ...args, fontBytes }));
  downloadPdf(calc, `01_${ATTENDANCE_CALC_LABEL}${ym}${userPart}.pdf`);
}
