import type { AttendanceRecord, AttendanceType } from '../types/attendance';
import { generateId } from './storage';

const TYPE_MAP: Record<string, AttendanceType> = {
  '出勤': 'work',
  'work': 'work',
  '有給': 'paid_leave',
  '有給休暇': 'paid_leave',
  'paid_leave': 'paid_leave',
  '休日': 'holiday',
  'holiday': 'holiday',
  '欠勤': 'absence',
  'absence': 'absence',
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
  const dateIdx = header.findIndex((h) => h === '日付' || h === 'date');
  const typeIdx = header.findIndex((h) => h === '種別' || h === 'type');
  const inIdx = header.findIndex((h) => h === '出勤' || h === '出勤時間' || h === 'clock_in');
  const outIdx = header.findIndex((h) => h === '退勤' || h === '退勤時間' || h === 'clock_out');
  const breakIdx = header.findIndex((h) => h === '休憩' || h === '休憩時間' || h === '休憩(分)' || h === 'break_minutes');
  const notesIdx = header.findIndex((h) => h === '備考' || h === 'notes');

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

    const record: AttendanceRecord = {
      id: generateId(),
      date,
      type,
      clockIn: inIdx !== -1 ? cols[inIdx] || undefined : undefined,
      clockOut: outIdx !== -1 ? cols[outIdx] || undefined : undefined,
      breakMinutes: breakIdx !== -1 ? (parseInt(cols[breakIdx]) || 0) : 0,
      notes: notesIdx !== -1 ? cols[notesIdx] || undefined : undefined,
    };

    records.push(record);
  }

  return { records, errors };
}

export function exportCSV(records: AttendanceRecord[]): string {
  const header = '日付,種別,出勤時間,退勤時間,休憩(分),備考';
  const rows = records
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => {
      const typeLabel =
        r.type === 'work' ? '出勤' :
        r.type === 'paid_leave' ? '有給休暇' :
        r.type === 'holiday' ? '休日' : '欠勤';
      return [r.date, typeLabel, r.clockIn ?? '', r.clockOut ?? '', r.breakMinutes ?? 0, r.notes ?? ''].join(',');
    });
  return [header, ...rows].join('\n');
}
