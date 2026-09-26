import type { WeekReportData } from './pdf';

export const WEEK_LABELS = ['第一週', '第二週', '第三週', '第四週', '第五週'];

export const EMPTY_WEEK: WeekReportData = {
  tools: '',
  conditionFirst: '○',
  reasonFirst: '',
  conditionSecond: '○',
  reasonSecond: '',
  goodPoints: '',
  badPoints: '',
  notes: '',
};

function workReportKey(year: number, month: number) {
  return `clocking_work_report_${year}_${String(month).padStart(2, '0')}`;
}

function summaryKey(year: number, month: number) {
  return `clocking_work_report_summary_${year}_${String(month).padStart(2, '0')}`;
}

function migrateWeek(w: Record<string, string>): WeekReportData {
  return {
    tools:           w.tools           ?? '',
    conditionFirst:  w.conditionFirst  ?? (w.condition ? '○' : '○'),
    reasonFirst:     w.reasonFirst     ?? (w.condition ?? ''),
    conditionSecond: w.conditionSecond ?? '○',
    reasonSecond:    w.reasonSecond    ?? '',
    goodPoints:      w.goodPoints      ?? '',
    badPoints:       w.badPoints       ?? '',
    notes:           w.notes           ?? '',
  };
}

export function loadAllWeeks(year: number, month: number): WeekReportData[] {
  try {
    const raw = localStorage.getItem(workReportKey(year, month));
    if (!raw) return WEEK_LABELS.map(() => ({ ...EMPTY_WEEK }));
    const parsed = JSON.parse(raw);
    return (parsed as Record<string, string>[]).map(migrateWeek);
  } catch {
    return WEEK_LABELS.map(() => ({ ...EMPTY_WEEK }));
  }
}

export function saveAllWeeks(year: number, month: number, weeks: WeekReportData[]) {
  localStorage.setItem(workReportKey(year, month), JSON.stringify(weeks));
}

export function loadSummary(year: number, month: number): string {
  return localStorage.getItem(summaryKey(year, month)) ?? '';
}

export function saveSummary(year: number, month: number, text: string) {
  localStorage.setItem(summaryKey(year, month), text);
}

export function loadName(): string {
  try {
    const raw = localStorage.getItem('clocking_leave_app_settings');
    return raw ? (JSON.parse(raw).name ?? '') : '';
  } catch { return ''; }
}

export function saveName(name: string) {
  try {
    const raw = localStorage.getItem('clocking_leave_app_settings');
    const settings = raw ? JSON.parse(raw) : {};
    localStorage.setItem('clocking_leave_app_settings', JSON.stringify({ ...settings, name }));
  } catch { /* 保存に失敗しても入力は継続できるようにする */ }
}

export function hasContent(w: WeekReportData) {
  return w.tools.trim() !== '' || w.goodPoints.trim() !== '' || w.badPoints.trim() !== '' ||
    w.notes.trim() !== '' || w.reasonFirst.trim() !== '' || w.reasonSecond.trim() !== '';
}
