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

// ── 別の月・週への転記 ─────────────────────────────────────────────────────────

export interface WeekRef {
  year: number;
  month: number;
  week: number; // 0 始まり（第一週 = 0）
}

// 1週分を別の月・週へ転記する。move のときは転記元の週を空にする
export function transferWeek(src: WeekRef, dst: WeekRef, move: boolean) {
  const srcWeeks = loadAllWeeks(src.year, src.month);
  const data = { ...srcWeeks[src.week] };
  if (move) {
    saveAllWeeks(src.year, src.month, srcWeeks.map((w, i) => (i === src.week ? { ...EMPTY_WEEK } : w)));
  }
  // 転記元と同じ月の場合は、上で保存した内容を読み直してから転記先を書き換える
  const dstWeeks = loadAllWeeks(dst.year, dst.month);
  saveAllWeeks(dst.year, dst.month, dstWeeks.map((w, i) => (i === dst.week ? data : w)));
}

// 月全体（全週＋総括）を別の月へ転記する。move のときは転記元を空にする
export function transferMonth(
  src: { year: number; month: number }, dst: { year: number; month: number }, move: boolean,
) {
  const weeks = loadAllWeeks(src.year, src.month);
  const summary = loadSummary(src.year, src.month);
  saveAllWeeks(dst.year, dst.month, weeks.map((w) => ({ ...w })));
  saveSummary(dst.year, dst.month, summary);
  if (move) {
    saveAllWeeks(src.year, src.month, WEEK_LABELS.map(() => ({ ...EMPTY_WEEK })));
    saveSummary(src.year, src.month, '');
  }
}

// 転記先に上書きされる内容があるか
export function weekHasData(ref: WeekRef): boolean {
  const w = loadAllWeeks(ref.year, ref.month)[ref.week];
  return !!w && hasContent(w);
}

// QR / カナコードで受け取った作業報告書を取り込む
// merge: 受け取った週（と空でない総括）だけ上書きし、他の週は残す / replace: 対象月の内容をすべて置き換える
export function importWorkReport(
  year: number, month: number,
  data: { weeks: (WeekReportData | null)[]; summary: string },
  mode: 'merge' | 'replace',
) {
  const current = loadAllWeeks(year, month);
  const weeks = WEEK_LABELS.map((_, i) => {
    const w = data.weeks[i];
    if (w) return { ...w };
    return mode === 'replace' ? { ...EMPTY_WEEK } : (current[i] ?? { ...EMPTY_WEEK });
  });
  saveAllWeeks(year, month, weeks);
  if (mode === 'replace' || data.summary.trim() !== '') saveSummary(year, month, data.summary);
}

export function monthHasData(year: number, month: number): boolean {
  return loadAllWeeks(year, month).some(hasContent) || loadSummary(year, month).trim() !== '';
}
