import type { AttendanceRecord, AttendanceType } from '../types/attendance';
import { ATTENDANCE_TYPE_LABELS } from '../types/attendance';
import type { TransportRecord, TripType } from '../types/transport';
import type { WeekReportData } from './pdf';
import { generateId } from './storage';

// ── 勤怠 ──────────────────────────────────────────────

const TYPE_MAP: Record<string, AttendanceType> = {
  '出勤': 'work',
  'work': 'work',
  '有給': 'paid_leave',
  '有給休暇': 'paid_leave',
  'paid_leave': 'paid_leave',
  '計画有給': 'planned_paid_leave',
  'planned_paid_leave': 'planned_paid_leave',
  '休日': 'holiday',
  'holiday': 'holiday',
  '欠勤': 'absence',
  'absence': 'absence',
  '午前休': 'am_leave',
  'am_leave': 'am_leave',
  '午後休': 'pm_leave',
  'pm_leave': 'pm_leave',
  '所定休日出勤': 'scheduled_holiday_work',
  'scheduled_holiday_work': 'scheduled_holiday_work',
  '法定休日出勤': 'legal_holiday_work',
  'legal_holiday_work': 'legal_holiday_work',
};

export interface CsvParseResult {
  records: AttendanceRecord[];
  errors: string[];
}

export function parseCSV(text: string): CsvParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const errors: string[] = [];
  const records: AttendanceRecord[] = [];

  if (lines.length === 0) return { records, errors: ['ファイルが空です'] };

  const header = lines[0].split(',').map((h) => h.trim());
  const dateIdx  = header.findIndex((h) => h === '日付' || h === 'date');
  const typeIdx  = header.findIndex((h) => h === '種別' || h === 'type');
  const inIdx    = header.findIndex((h) => h === '出勤' || h === '出勤時間' || h === 'clock_in');
  const outIdx   = header.findIndex((h) => h === '退勤' || h === '退勤時間' || h === 'clock_out');
  const breakIdx = header.findIndex((h) => h === '休憩' || h === '休憩時間' || h === '休憩(分)' || h === 'break_minutes');
  const notesIdx = header.findIndex((h) => h === '備考' || h === 'notes');
  const noTransportIdx = header.findIndex((h) => h === '交通費なし' || h === 'no_transport' || h === '在宅' || h === 'is_remote');

  if (dateIdx === -1) return { records, errors: ['ヘッダーに「日付」列が見つかりません'] };

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const date = cols[dateIdx] ?? '';

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`行 ${i + 1}: 日付の形式が不正です (${date || '空'})`);
      continue;
    }

    const rawType = typeIdx !== -1 ? cols[typeIdx] ?? '' : '出勤';
    const type: AttendanceType = TYPE_MAP[rawType] ?? 'work';

    records.push({
      id: generateId(),
      date,
      type,
      clockIn:      inIdx    !== -1 ? cols[inIdx]    || undefined : undefined,
      clockOut:     outIdx   !== -1 ? cols[outIdx]   || undefined : undefined,
      breakMinutes: breakIdx !== -1 ? (parseInt(cols[breakIdx]) || 0) : 0,
      notes:        notesIdx !== -1 ? cols[notesIdx] || undefined : undefined,
      noTransport:  noTransportIdx !== -1 ? ['交通費なし', '在宅', 'true', 'TRUE', '1'].includes(cols[noTransportIdx] ?? '') : undefined,
    });
  }

  return { records, errors };
}

export function exportCSV(records: AttendanceRecord[]): string {
  const header = '日付,種別,出勤時間,退勤時間,休憩(分),備考,交通費なし';
  const rows = records
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => [
      r.date,
      ATTENDANCE_TYPE_LABELS[r.type] ?? r.type,
      r.clockIn ?? '',
      r.clockOut ?? '',
      r.breakMinutes ?? 0,
      r.notes ?? '',
      r.noTransport ? '交通費なし' : '',
    ].join(','));
  return [header, ...rows].join('\n');
}

// ── 交通費 ────────────────────────────────────────────

const TRIP_MAP: Record<string, TripType> = {
  '往復': 'roundtrip',
  'roundtrip': 'roundtrip',
  '片道': 'oneway',
  'oneway': 'oneway',
};

export interface TransportCsvParseResult {
  records: TransportRecord[];
  errors: string[];
}

export function parseTransportCSV(text: string): TransportCsvParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const errors: string[] = [];
  const records: TransportRecord[] = [];

  if (lines.length === 0) return { records, errors: ['ファイルが空です'] };

  const header = lines[0].split(',').map((h) => h.trim());
  const dateIdx  = header.findIndex((h) => ['日付', 'date'].includes(h));
  const destIdx  = header.findIndex((h) => ['行先', '行き先', 'destination'].includes(h));
  const fromIdx  = header.findIndex((h) => ['出発地点', '出発', 'from'].includes(h));
  const toIdx    = header.findIndex((h) => ['到着地点', '到着', 'to'].includes(h));
  const tripIdx  = header.findIndex((h) => ['往復片道', '往復/片道', 'trip_type'].includes(h));
  const amtIdx   = header.findIndex((h) => ['金額', 'amount'].includes(h));
  const notesIdx = header.findIndex((h) => ['備考', 'notes'].includes(h));

  if (dateIdx === -1) return { records, errors: ['ヘッダーに「日付」列が見つかりません'] };
  if (destIdx === -1) return { records, errors: ['ヘッダーに「行先」列が見つかりません'] };
  if (amtIdx  === -1) return { records, errors: ['ヘッダーに「金額」列が見つかりません'] };

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim());
    const date = cols[dateIdx] ?? '';

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push(`行 ${i + 1}: 日付の形式が不正です (${date || '空'})`);
      continue;
    }

    const rawAmt = cols[amtIdx] ?? '';
    const amount = parseInt(rawAmt.replace(/[¥,￥]/g, ''));
    if (isNaN(amount) || amount < 0) {
      errors.push(`行 ${i + 1}: 金額の値が不正です (${rawAmt})`);
      continue;
    }

    const rawTrip = tripIdx !== -1 ? cols[tripIdx] ?? '' : '往復';
    const tripType: TripType = TRIP_MAP[rawTrip] ?? 'roundtrip';

    records.push({
      id: generateId(),
      date,
      destination: destIdx  !== -1 ? cols[destIdx]  || '' : '',
      from:        fromIdx  !== -1 ? cols[fromIdx]  || '' : '',
      to:          toIdx    !== -1 ? cols[toIdx]    || '' : '',
      tripType,
      amount,
      notes:       notesIdx !== -1 ? cols[notesIdx] || '' : '',
    });
  }

  return { records, errors };
}

export function exportTransportCSV(records: TransportRecord[]): string {
  const header = '日付,行先,出発地点,到着地点,往復片道,金額,備考';
  const rows = records
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => [
      r.date,
      r.destination,
      r.from,
      r.to,
      r.tripType === 'roundtrip' ? '往復' : '片道',
      r.amount,
      r.notes ?? '',
    ].join(','));
  return [header, ...rows].join('\n');
}

// ── 作業報告 ───────────────────────────────────────────

const WORK_REPORT_WEEK_LABELS = ['第一週', '第二週', '第三週', '第四週', '第五週'];

function csvQuote(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

// RFC4180準拠の1行パーサー（複数フィールド対応）
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') { inQ = false; }
      else { cur += ch; }
    } else {
      if (ch === '"') { inQ = true; }
      else if (ch === ',') { fields.push(cur); cur = ''; }
      else { cur += ch; }
    }
  }
  fields.push(cur);
  return fields;
}

export interface WorkReportCsvParseResult {
  weeks: WeekReportData[];
  errors: string[];
}

export function exportWorkReportCSV(weeks: WeekReportData[]): string {
  const header = '週,開発言語・ツール・作業工程,前半体調,前半理由,後半体調,後半理由,良かった点,悪かった点,その他(気づいた点)';
  const rows = weeks.map((w, i) => [
    WORK_REPORT_WEEK_LABELS[i],
    csvQuote(w.tools),
    csvQuote(w.conditionFirst),
    csvQuote(w.reasonFirst),
    csvQuote(w.conditionSecond),
    csvQuote(w.reasonSecond),
    csvQuote(w.goodPoints),
    csvQuote(w.badPoints),
    csvQuote(w.notes),
  ].join(','));
  return [header, ...rows].join('\n');
}

function emptyWeeks(): WeekReportData[] {
  return WORK_REPORT_WEEK_LABELS.map(() => ({
    tools: '', conditionFirst: '○', reasonFirst: '', conditionSecond: '○', reasonSecond: '',
    goodPoints: '', badPoints: '', notes: '',
  }));
}

export function parseWorkReportCSV(text: string): WorkReportCsvParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { weeks: emptyWeeks(), errors: ['ファイルが空です'] };

  const errors: string[] = [];
  const weeks = emptyWeeks();
  const dataLines = lines.slice(1); // ヘッダー行をスキップ

  if (dataLines.length === 0) return { weeks, errors: ['データ行がありません'] };
  if (dataLines.length !== 5) errors.push(`週の行数が ${dataLines.length} 件です（期待値: 5）`);

  for (let i = 0; i < Math.min(dataLines.length, 5); i++) {
    const cols = parseCSVLine(dataLines[i]);
    if (cols.length < 9) {
      errors.push(`行 ${i + 2}: 列数が不足しています`);
      continue;
    }
    weeks[i] = {
      tools:           cols[1] ?? '',
      conditionFirst:  cols[2] ?? '',
      reasonFirst:     cols[3] ?? '',
      conditionSecond: cols[4] ?? '',
      reasonSecond:    cols[5] ?? '',
      goodPoints:      cols[6] ?? '',
      badPoints:       cols[7] ?? '',
      notes:           cols[8] ?? '',
    };
  }

  return { weeks, errors };
}
