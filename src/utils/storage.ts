import type { AttendanceRecord, PaidLeaveSettings, WorkSettings } from '../types/attendance';
import { DEFAULT_WORK_SETTINGS } from '../types/attendance';
import type { TransportRecord } from '../types/transport';

const RECORDS_KEY = 'clocking_records';
const PAID_LEAVE_KEY = 'clocking_paid_leave';
const WORK_SETTINGS_KEY = 'clocking_work_settings';
const TRANSPORT_KEY = 'clocking_transport';
const USER_PROFILE_KEY = 'clocking_user_profile';

export interface UserProfile {
  employeeId: string;
  lastName: string;
}

export function loadUserProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(USER_PROFILE_KEY);
    return raw ? JSON.parse(raw) : { employeeId: '', lastName: '' };
  } catch {
    return { employeeId: '', lastName: '' };
  }
}

export function saveUserProfile(profile: UserProfile): void {
  localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
}

export function loadRecords(): AttendanceRecord[] {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveRecords(records: AttendanceRecord[]): void {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
}

export function loadPaidLeaveSettings(): PaidLeaveSettings[] {
  try {
    const raw = localStorage.getItem(PAID_LEAVE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function savePaidLeaveSettings(settings: PaidLeaveSettings[]): void {
  localStorage.setItem(PAID_LEAVE_KEY, JSON.stringify(settings));
}

export function loadWorkSettings(): WorkSettings {
  try {
    const raw = localStorage.getItem(WORK_SETTINGS_KEY);
    return raw ? { ...DEFAULT_WORK_SETTINGS, ...JSON.parse(raw) } : DEFAULT_WORK_SETTINGS;
  } catch {
    return DEFAULT_WORK_SETTINGS;
  }
}

export function saveWorkSettings(settings: WorkSettings): void {
  localStorage.setItem(WORK_SETTINGS_KEY, JSON.stringify(settings));
}

export function loadTransportRecords(): TransportRecord[] {
  try {
    const raw = localStorage.getItem(TRANSPORT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveTransportRecords(records: TransportRecord[]): void {
  localStorage.setItem(TRANSPORT_KEY, JSON.stringify(records));
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

export function calcOvertimeMinutes(workMinutes: number): number {
  return Math.max(0, workMinutes - 8 * 60);
}

// 深夜時間帯: 22:00〜翌5:00
export function calcLateNightMinutes(clockIn: string, clockOut: string): number {
  const start = timeToMins(clockIn);
  let end = timeToMins(clockOut);
  if (end <= start) end += 24 * 60;

  // [22:00, 29:00] = [1320, 1740] で翌5:00まで
  const lateNight = overlapMins(start, end, 22 * 60, 29 * 60);

  // 深夜跨ぎなし & 早朝帯 [0:00, 5:00] の重複
  const earlyMorning = !( end > 24 * 60 ) && start < 5 * 60
    ? overlapMins(start, end, 0, 5 * 60)
    : 0;

  return lateNight + earlyMorning;
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

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
