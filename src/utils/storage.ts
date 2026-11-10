import type { AttendanceRecord, PaidLeaveSettings, WorkSettings, WorkLocation } from '../types/attendance';
import { DEFAULT_WORK_SETTINGS } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import type { SkillEntry, Certification, SkillSheetProfile, WorkHistoryEntry } from '../types/skill';
import { DEFAULT_SKILL_SHEET_PROFILE } from '../types/skill';
import type { LeaveApplicationRecord, LateEarlyApplicationRecord } from '../types/application';
import { trackedWrite, type CollectionId } from './syncHooks';
import { memoryStore } from './memoryStore';

// データはメモリ上（memoryStore）に持ち、データベースとの読み書きは cloudSync.ts が行う。
// キー名は以前の版が localStorage に保存していたときと同じ（端末に残った以前のデータをそのまま読み込めるように）
const RECORDS_KEY = 'clocking_records';
const PAID_LEAVE_KEY = 'clocking_paid_leave';
const WORK_SETTINGS_KEY = 'clocking_work_settings';
const TRANSPORT_KEY = 'clocking_transport';
const USER_PROFILE_KEY = 'clocking_user_profile';
const SKILL_KEY = 'clocking_skill_entries';
const SKILL_PROFILE_KEY = 'clocking_skill_profile';
const CERTIFICATIONS_KEY = 'clocking_certifications';
const WORK_HISTORY_KEY = 'clocking_work_history';
const LEAVE_APPLICATIONS_KEY = 'clocking_leave_applications';
const LATE_EARLY_APPLICATIONS_KEY = 'clocking_late_early_applications';

// 保存した内容をデータベース（Supabase）へ送るよう同期処理に知らせる
function setTracked(collection: CollectionId, key: string, value: unknown): void {
  trackedWrite(collection, () => memoryStore.setItem(key, JSON.stringify(value)));
}

export interface UserProfile {
  employeeId: string;
  lastName: string;
}

export function loadUserProfile(): UserProfile {
  try {
    const raw = memoryStore.getItem(USER_PROFILE_KEY);
    return raw ? JSON.parse(raw) : { employeeId: '', lastName: '' };
  } catch {
    return { employeeId: '', lastName: '' };
  }
}

export function saveUserProfile(profile: UserProfile): void {
  setTracked('profile', USER_PROFILE_KEY, profile);
}

export function loadRecords(): AttendanceRecord[] {
  try {
    const raw = memoryStore.getItem(RECORDS_KEY);
    if (!raw) return [];
    // 旧フィールド名 isRemote（在宅勤務のみを表していた頃の名残）から移行
    const parsed = JSON.parse(raw) as (AttendanceRecord & { isRemote?: boolean })[];
    return parsed.map(({ isRemote, ...r }) => ({ ...r, noTransport: r.noTransport ?? isRemote }));
  } catch {
    return [];
  }
}

export function saveRecords(records: AttendanceRecord[]): void {
  setTracked('attendance', RECORDS_KEY, records);
}

export function loadPaidLeaveSettings(): PaidLeaveSettings[] {
  try {
    const raw = memoryStore.getItem(PAID_LEAVE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePaidLeaveSettings(settings: PaidLeaveSettings[]): void {
  setTracked('paidLeave', PAID_LEAVE_KEY, settings);
}

export function loadWorkSettings(): WorkSettings {
  try {
    const raw = memoryStore.getItem(WORK_SETTINGS_KEY);
    return raw ? { ...DEFAULT_WORK_SETTINGS, ...JSON.parse(raw) } : DEFAULT_WORK_SETTINGS;
  } catch {
    return DEFAULT_WORK_SETTINGS;
  }
}

export function saveWorkSettings(settings: WorkSettings): void {
  setTracked('profile', WORK_SETTINGS_KEY, settings);
}

export function loadTransportRecords(): TransportRecord[] {
  try {
    const raw = memoryStore.getItem(TRANSPORT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTransportRecords(records: TransportRecord[]): void {
  setTracked('transport', TRANSPORT_KEY, records);
}

export function loadSkillEntries(): SkillEntry[] {
  try {
    const raw = memoryStore.getItem(SKILL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveSkillEntries(entries: SkillEntry[]): void {
  setTracked('skill', SKILL_KEY, entries);
}

export function loadSkillProfile(): SkillSheetProfile {
  try {
    const raw = memoryStore.getItem(SKILL_PROFILE_KEY);
    return raw ? { ...DEFAULT_SKILL_SHEET_PROFILE, ...JSON.parse(raw) } : DEFAULT_SKILL_SHEET_PROFILE;
  } catch {
    return DEFAULT_SKILL_SHEET_PROFILE;
  }
}

export function saveSkillProfile(profile: SkillSheetProfile): void {
  setTracked('skill', SKILL_PROFILE_KEY, profile);
}

export function loadCertifications(): Certification[] {
  try {
    const raw = memoryStore.getItem(CERTIFICATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCertifications(certs: Certification[]): void {
  setTracked('skill', CERTIFICATIONS_KEY, certs);
}

export function loadWorkHistory(): WorkHistoryEntry[] {
  try {
    const raw = memoryStore.getItem(WORK_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveWorkHistory(entries: WorkHistoryEntry[]): void {
  setTracked('skill', WORK_HISTORY_KEY, entries);
}

export function loadLeaveApplications(): LeaveApplicationRecord[] {
  try {
    const raw = memoryStore.getItem(LEAVE_APPLICATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLeaveApplications(records: LeaveApplicationRecord[]): void {
  setTracked('leave', LEAVE_APPLICATIONS_KEY, records);
}

// 同じ日付を含む既存の申請（自分自身を除く）は上書きし、新しいバッチで置き換える
export function upsertLeaveApplication(batch: LeaveApplicationRecord): void {
  const newDates = new Set(batch.dateEntries.map((e) => e.date));
  const pruned = loadLeaveApplications()
    .filter((b) => b.id !== batch.id)
    .map((b) => ({ ...b, dateEntries: b.dateEntries.filter((e) => !newDates.has(e.date)) }))
    .filter((b) => b.dateEntries.length > 0);
  saveLeaveApplications([...pruned, batch]);
}

export function deleteLeaveApplication(id: string): void {
  saveLeaveApplications(loadLeaveApplications().filter((b) => b.id !== id));
}

export function loadLateEarlyApplications(): LateEarlyApplicationRecord[] {
  try {
    const raw = memoryStore.getItem(LATE_EARLY_APPLICATIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveLateEarlyApplications(records: LateEarlyApplicationRecord[]): void {
  setTracked('lateEarly', LATE_EARLY_APPLICATIONS_KEY, records);
}

export function upsertLateEarlyApplication(record: LateEarlyApplicationRecord): void {
  const next = loadLateEarlyApplications().filter((r) => r.id !== record.id && r.targetDate !== record.targetDate);
  saveLateEarlyApplications([...next, record]);
}

export function deleteLateEarlyApplication(id: string): void {
  saveLateEarlyApplications(loadLateEarlyApplications().filter((r) => r.id !== id));
}

// QR / カナコードで受け取った対象月の申請書類を取り込む（同じ日付の申請だけ上書きし、他は残す）
export function importApplications(
  data: { leave: LeaveApplicationRecord[]; lateEarly: LateEarlyApplicationRecord[] },
): void {
  for (const b of data.leave) upsertLeaveApplication(b);
  for (const r of data.lateEarly) upsertLateEarlyApplication(r);
}

// 同じ ID の項目は受け取った内容で上書きし、受け取っていない項目は残す（並び順は今のまま、新しい項目は後ろに足す）
function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(incoming.map((x) => [x.id, x]));
  const known = new Set(current.map((x) => x.id));
  return [...current.map((x) => byId.get(x.id) ?? x), ...incoming.filter((x) => !known.has(x.id))];
}

// QR / カナコードで受け取ったスキル表を取り込む
// プロフィールは上書きし、スキル・資格・職務経歴は同じ項目だけ上書きする（既存の項目をまとめて消すことはしない）
export function importSkillSheet(data: {
  profile: SkillSheetProfile; skills: SkillEntry[]; certifications: Certification[]; workHistory: WorkHistoryEntry[];
}): void {
  saveSkillProfile(data.profile);
  saveSkillEntries(mergeById(loadSkillEntries(), data.skills));
  saveCertifications(mergeById(loadCertifications(), data.certifications));
  saveWorkHistory(mergeById(loadWorkHistory(), data.workHistory));
}

// ── 有給残日数（月度ごと）──────────────────────────────────────────────────────

const monthIndex = (year: number, month: number) => year * 12 + (month - 1);
const settingIndex = (s: PaidLeaveSettings) => monthIndex(s.year, s.month ?? 1);

// 指定月に使用した有給日数（有給・計画有給は1日、午前休・午後休は0.5日）
export function calcPaidLeaveUsed(records: AttendanceRecord[], year: number, month: number): number {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return records
    .filter((r) => r.date.startsWith(prefix))
    .reduce((acc, r) => {
      if (r.type === 'paid_leave' || r.type === 'planned_paid_leave') return acc + 1;
      if (r.type === 'am_leave' || r.type === 'pm_leave') return acc + 0.5;
      return acc;
    }, 0);
}

export function findPaidLeaveSetting(
  settings: PaidLeaveSettings[], year: number, month: number,
): PaidLeaveSettings | undefined {
  return settings.find((s) => settingIndex(s) === monthIndex(year, month));
}

export interface PaidLeaveMonthStatus {
  start: number;       // 月初の残日数（当月の設定値）
  used: number;        // 当月の使用日数
  remaining: number;   // 月末の残日数
}

// 月度ごとの有給残日数。月ごとに独立して計算し、翌月へは繰り越さない（当月の設定が無ければ未設定）
export function calcPaidLeaveMonthStatus(
  records: AttendanceRecord[],
  settings: PaidLeaveSettings[],
  year: number,
  month: number,
): PaidLeaveMonthStatus | null {
  const setting = findPaidLeaveSetting(settings, year, month);
  if (!setting) return null;
  const used = calcPaidLeaveUsed(records, year, month);
  return { start: setting.totalDays, used, remaining: setting.totalDays - used };
}

export function calcPaidLeaveRemaining(
  records: AttendanceRecord[],
  paidLeaveSettings: PaidLeaveSettings[],
  year: number,
  month: number,
): number | null {
  return calcPaidLeaveMonthStatus(records, paidLeaveSettings, year, month)?.remaining ?? null;
}

export function timeToMins(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function overlapMins(s1: number, e1: number, s2: number, e2: number): number {
  return Math.max(0, Math.min(e1, e2) - Math.max(s1, s2));
}

export function calcWorkMinutes(clockIn: string, clockOut: string, breakMinutes: number): number {
  let start = timeToMins(clockIn);
  let end = timeToMins(clockOut);
  if (end <= start) end += 24 * 60;
  return end - start - breakMinutes;
}

// 午前休は12:00-13:00が就業時間内に含まれる場合、休憩として自動計上する
export function getEffectiveBreak(type: string, clockIn: string, clockOut: string, breakMinutes: number): number {
  if (type !== 'am_leave') return breakMinutes;
  const start = timeToMins(clockIn);
  let end = timeToMins(clockOut);
  if (end <= start) end += 1440;
  const lunchOverlap = Math.max(0, Math.min(end, 780) - Math.max(start, 720)); // 12:00-13:00
  return lunchOverlap > 0 ? Math.max(breakMinutes, 60) : breakMinutes;
}

export const DEFAULT_KISHA_SWITCH_TIME = '13:00';

export function getWorkLocation(r: Pick<AttendanceRecord, 'workLocation' | 'isKishaDay'>): WorkLocation {
  return r.workLocation ?? (r.isKishaDay ? 'kisha' : 'site');
}

// 勤務区分の定型文。備考の先頭に入れ、勤務表PDFにもこの備考をそのまま出す
const KISHA_NOTES: Record<WorkLocation, string> = { site: '', kisha: '帰社日', am_kisha: '午前帰社', pm_kisha: '午後帰社' };
const KISHA_NOTE_RE = /^(帰社日|終日帰社|午前帰社|午後帰社)\s*/;

// 備考の先頭の定型文を勤務区分に合わせて差し替える（手入力した部分は残し、同じ文言は二重に入れない）
export function withKishaNote(notes: string, loc: WorkLocation): string {
  const rest = notes.replace(KISHA_NOTE_RE, '');
  const label = KISHA_NOTES[loc];
  if (!label || rest.includes(label)) return rest;
  return rest ? label + '　' + rest : label;
}

// 現場（客先）での勤務時間。帰社した時間は含まない。
// 午前帰社は「切替時刻〜退勤」、午後帰社は「出勤〜切替時刻」を現場とし、12:00-13:00 と重なる分は休憩として差し引く
export function calcSiteWorkMinutes(r: AttendanceRecord): number {
  if (!r.clockIn || !r.clockOut) return 0;
  const effBreak = getEffectiveBreak(r.type, r.clockIn, r.clockOut, r.breakMinutes ?? 0);
  const total = calcWorkMinutes(r.clockIn, r.clockOut, effBreak);
  const loc = getWorkLocation(r);
  if (loc === 'site') return total;
  if (loc === 'kisha') return 0;

  const start = timeToMins(r.clockIn);
  let end = timeToMins(r.clockOut);
  if (end <= start) end += 1440;
  let sw = timeToMins(r.kishaSwitchTime || DEFAULT_KISHA_SWITCH_TIME);
  if (sw < start) sw += 1440;
  sw = Math.min(Math.max(sw, start), end);

  const [segStart, segEnd] = loc === 'pm_kisha' ? [start, sw] : [sw, end];
  const segBreak = Math.min(overlapMins(segStart, segEnd, 720, 780), effBreak);
  return Math.max(0, Math.min(total, segEnd - segStart - segBreak));
}

export function calcOvertimeMinutes(workMinutes: number): number {
  return Math.max(0, workMinutes - 8 * 60);
}

// 深夜時間帯（22:00〜翌5:00）と重なる分数。s・e は出勤日の 0:00 からの分（e は翌日にかかってよい）
function lateNightOverlap(s: number, e: number): number {
  // 前日22:00〜当日5:00、当日22:00〜翌5:00、翌日22:00〜翌々日5:00
  return [-2 * 60, 22 * 60, 46 * 60].reduce((a, n) => a + overlapMins(s, e, n, n + 7 * 60), 0);
}

// 深夜時間帯: 22:00〜翌5:00
export function calcLateNightMinutes(clockIn: string, clockOut: string): number {
  const start = timeToMins(clockIn);
  let end = timeToMins(clockOut);
  if (end <= start) end += 24 * 60;
  return lateNightOverlap(start, end);
}

// 深夜残業: 1日8時間を超えた残業のうち 22:00〜翌5:00 に入る分。
// 休憩の時刻は記録が無いので、休憩は残業が始まる前に取ったとみなし、「出勤＋休憩＋8時間」から退勤までを残業の時間帯とする。
// 所定休日出勤・法定休日出勤は全時間が時間外なので、深夜時間がそのまま深夜残業。
// breakMinutes は getEffectiveBreak() を通した休憩
export function calcLateNightOvertimeMinutes(type: string, clockIn: string, clockOut: string, breakMinutes: number): number {
  if (type === 'scheduled_holiday_work' || type === 'legal_holiday_work') return calcLateNightMinutes(clockIn, clockOut);
  const start = timeToMins(clockIn);
  let end = timeToMins(clockOut);
  if (end <= start) end += 24 * 60;
  return lateNightOverlap(start + breakMinutes + 8 * 60, end);
}

export function isLateArrival(clockIn: string, standardStart: string): boolean {
  return timeToMins(clockIn) > timeToMins(standardStart);
}

export function isEarlyDeparture(clockOut: string, standardEnd: string, clockIn?: string): boolean {
  let outMins = timeToMins(clockOut);
  let endMins = timeToMins(standardEnd);
  if (clockIn) {
    const inMins = timeToMins(clockIn);
    if (outMins <= inMins) outMins += 24 * 60; // 日跨ぎ退勤
    if (endMins < inMins) endMins += 24 * 60;  // 日跨ぎ基準退勤
  }
  return outMins < endMins;
}

export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return '0:00';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

// 今日の日付（YYYY-MM-DD）。toISOString() は世界標準時のため、日本時間の 0〜9 時は前日になってしまう
export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// クラウド（Supabase）の id 列と同じ UUID 形式で作る
export function generateId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // randomUUID は https 以外（LAN の IP アドレスで開いた開発サーバーなど）では使えない
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}
