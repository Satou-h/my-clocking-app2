/**
 * cloudSync.ts — データベース（Supabase）とのデータの読み書き
 *
 * ・データの正はデータベース。端末（ブラウザ）にはデータを保存しない
 * ・ログインしたら、そのユーザーのデータをすべてデータベースから読み込み、メモリ上（memoryStore）に置く。
 *   読み込み終えるまではいつもの画面を出さない（通信できないときは使えない）
 * ・画面はメモリ上のデータを読み書きする。保存のたびに変わった行を「送信待ち」に積み、すぐにデータベースへ送る
 *   （送信待ちもメモリ上だけ。送れていない変更があるうちにページを閉じようとしたら確認する）
 * ・画面に戻ったとき・通信が回復したときは、送信待ちを送ってからほかの端末の変更を読み込む
 *   （送れなかった行はメモリ上の内容を残す）
 * ・以前の版はデータを端末（localStorage）に保存していた。端末に残っているデータは、ログインしたときに
 *   データベースへ移してから端末から消す
 */
import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { memoryStore } from './memoryStore';
import { setWriteTracker, withoutTracking, type CollectionId } from './syncHooks';
import {
  loadRecords, saveRecords, loadTransportRecords, saveTransportRecords,
  loadPaidLeaveSettings, savePaidLeaveSettings, loadLeaveApplications, saveLeaveApplications,
  loadLateEarlyApplications, saveLateEarlyApplications,
  loadSkillProfile, saveSkillProfile, loadSkillEntries, saveSkillEntries,
  loadCertifications, saveCertifications, loadWorkHistory, saveWorkHistory,
  loadUserProfile, saveUserProfile, loadWorkSettings, saveWorkSettings, loadSignature, saveSignature,
  getWorkLocation, generateId, isUuid,
} from './storage';
import {
  EMPTY_WEEK, WEEK_LABELS, hasContent, listWorkReportMonths, loadAllWeeks, loadSummary,
  saveAllWeeks, saveSummary, removeWorkReport, loadName, saveName,
} from './workReport';
import type { WeekReportData } from './pdf';
import type { AttendanceRecord, AttendanceType, PaidLeaveSettings, WorkLocation } from '../types/attendance';
import { DEFAULT_WORK_SETTINGS } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import type { LeaveApplicationRecord, LateEarlyApplicationRecord, LeaveType } from '../types/application';
import type { SkillEntry, Certification, SkillSheetProfile, WorkHistoryEntry } from '../types/skill';
import { DEFAULT_SKILL_SHEET_PROFILE } from '../types/skill';

// ── 同期の状態（画面表示用）────────────────────────────────────────────────────

export type CloudPhase =
  | 'signed-out'    // ログインしていない
  | 'checking'      // ログイン直後、データベースのデータを読み込み中
  | 'needs-choice'  // データベースと、端末に残っている以前のデータの両方があり、どちらを使うか選ぶ必要がある
  | 'syncing'       // データベースへ送信中・読み込み中
  | 'synced'
  | 'offline'
  | 'error';

export interface DataCounts {
  attendance: number;
  transport: number;
  applications: number;
  workReports: number;
  // 社員情報・サイン・基準時間・スキル表・有給残日数のどれかが入っているか
  others: boolean;
  any: boolean;
}

export interface CloudState {
  phase: CloudPhase;
  email: string | null;
  // 起動後、ログインしているかどうかを確かめ終えたか
  authReady: boolean;
  // ログイン中のユーザーのデータをデータベースから読み込み終えたか（終えるまではいつもの画面を出さない）
  loaded: boolean;
  // パスワード再設定メールのリンクから開いた（新しいパスワードを決めてもらう）
  passwordRecovery: boolean;
  // 確認メール・再設定メールのリンクが期限切れなどで使えなかったときの説明
  linkError: string | null;
  // データベースにまだ送れていない変更の件数（メモリ上にしかないため、ページを閉じると失われる）
  pending: number;
  lastSyncedAt: number | null;
  error: string | null;
  choice: { local: DataCounts; cloud: DataCounts } | null;
  // データベースから読み込んでメモリ上のデータが変わるたびに増える（画面の読み直しに使う）
  dataVersion: number;
}

let state: CloudState = {
  phase: 'signed-out',
  email: null,
  authReady: false,
  loaded: false,
  passwordRecovery: false,
  linkError: null,
  pending: 0,
  lastSyncedAt: null,
  error: null,
  choice: null,
  dataVersion: 0,
};
const listeners = new Set<() => void>();

function setState(patch: Partial<CloudState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getCloudState(): CloudState {
  return state;
}

export function useCloudState(): CloudState {
  return useSyncExternalStore(subscribe, getCloudState);
}

// 起動時に出す画面
// loading: ログイン状態を確認中 / login: ログイン画面 / reset: 新しいパスワードの設定
// setup: ログイン直後、データベースからの読み込み・どちらのデータを使うかの選択 / app: いつもの画面
export type AppGate = 'loading' | 'login' | 'reset' | 'setup' | 'app';

export function appGate(s: CloudState): AppGate {
  if (s.passwordRecovery && s.email) return 'reset';
  if (!s.authReady) return 'loading';
  if (s.phase === 'signed-out') return 'login';
  // データは端末に保存していないため、データベースから読み込み終えるまではいつもの画面を出さない
  return s.loaded ? 'app' : 'setup';
}

export type CloudTone = 'ok' | 'busy' | 'warn' | 'error';

// 同期の状態の表示（ヘッダーの短い表示と、設定画面の説明）
export function cloudStatus(s: CloudState): { tone: CloudTone; short: string; label: string } {
  switch (s.phase) {
    case 'signed-out':
      return { tone: 'warn', short: '未ログイン', label: 'ログインしていません' };
    case 'checking':
      return { tone: 'busy', short: '読み込み中', label: 'クラウドのデータを読み込んでいます…' };
    case 'needs-choice':
      return { tone: 'warn', short: '要確認', label: 'どちらのデータを使うか選んでください' };
    case 'syncing':
      return { tone: 'busy', short: '保存中', label: 'クラウドと通信しています…' };
    case 'offline':
      return {
        tone: 'warn', short: 'オフライン',
        label: s.pending > 0
          ? `オフラインです（未保存 ${s.pending}件。つながったら保存します）`
          : 'オフラインです',
      };
    case 'error':
      return { tone: 'error', short: '保存エラー', label: s.error ?? 'クラウドに保存できませんでした' };
    case 'synced':
      return s.pending > 0
        ? { tone: 'busy', short: `保存待ち${s.pending}件`, label: `クラウドへの保存待ちが ${s.pending}件あります` }
        : { tone: 'ok', short: '保存済み', label: 'クラウドに保存済みです' };
  }
}

// ── テーブルとの対応 ──────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

interface CollectionDef<T> {
  id: CollectionId;
  table: string;
  label: string;
  columns: string[];
  // 取得するときの並び順。新しく取り込んだ行もこの順で後ろに並べる
  order: string[];
  // 行を特定する列。1人1行のテーブル（プロフィール・スキル表）は空
  keyCols: string[];
  conflict: string;
  items(): T[];
  setItems(items: T[]): void;
  // この端末の形 → テーブルの列の形
  to(item: T): Row;
  from(row: Row): T;
  // 1人1行のテーブルで、何も入力していない状態
  empty?: T;
  // 「データがある」と数えるか（空の月の作業報告書などは数えない）
  hasContent?(item: T): boolean;
}

interface Collection {
  id: CollectionId;
  table: string;
  label: string;
  columns: string[];
  order: string[];
  keyCols: string[];
  conflict: string;
  read(): Row[];
  write(rows: Row[]): void;
  canon(row: Row): Row;
  empty: Row | null;
  hasContent(row: Row): boolean;
}

function define<T>(def: CollectionDef<T>): Collection {
  const empty = def.empty ? def.to(def.empty) : null;
  return {
    id: def.id, table: def.table, label: def.label, columns: def.columns, order: def.order,
    keyCols: def.keyCols, conflict: def.conflict,
    read: () => def.items().map((item) => def.to(item)),
    write: (rows) => def.setItems(rows.map((row) => def.from(row))),
    canon: (row) => def.to(def.from(row)),
    empty,
    hasContent: (row) => (empty ? stableStringify(row) !== stableStringify(empty) : (def.hasContent?.(def.from(row)) ?? true)),
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const textOrNull = (v: string | undefined): string | null => (v ? v : null);
const dateOrNull = (v: string | undefined): string | null => (v && DATE_RE.test(v) ? v : null);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const clampInt = (v: unknown, min: number, max: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(Math.round(n), min), max) : min;
};

const attendance = define<AttendanceRecord>({
  id: 'attendance', table: 'attendance_records', label: '勤怠',
  columns: [
    'id', 'work_date', 'type', 'clock_in', 'clock_out', 'break_minutes', 'notes', 'custom_start_time',
    'custom_end_time', 'no_transport', 'work_location', 'kisha_switch_time', 'transfer_date',
  ],
  order: ['work_date', 'id'], keyCols: ['id'], conflict: 'id',
  items: loadRecords, setItems: saveRecords,
  to: (r) => ({
    id: r.id,
    work_date: r.date,
    type: r.type,
    clock_in: textOrNull(r.clockIn),
    clock_out: textOrNull(r.clockOut),
    break_minutes: r.breakMinutes == null || r.breakMinutes === ('' as unknown) ? null : clampInt(r.breakMinutes, 0, 1440),
    notes: r.notes ?? '',
    custom_start_time: textOrNull(r.customStartTime),
    custom_end_time: textOrNull(r.customEndTime),
    no_transport: !!r.noTransport,
    work_location: getWorkLocation(r),
    kisha_switch_time: textOrNull(r.kishaSwitchTime),
    transfer_date: dateOrNull(r.transferDate),
  }),
  from: (row) => ({
    id: str(row.id),
    date: str(row.work_date),
    type: str(row.type) as AttendanceType,
    clockIn: optStr(row.clock_in),
    clockOut: optStr(row.clock_out),
    breakMinutes: typeof row.break_minutes === 'number' ? row.break_minutes : undefined,
    notes: str(row.notes),
    customStartTime: optStr(row.custom_start_time),
    customEndTime: optStr(row.custom_end_time),
    noTransport: row.no_transport === true ? true : undefined,
    workLocation: (optStr(row.work_location) ?? 'site') as WorkLocation,
    kishaSwitchTime: optStr(row.kisha_switch_time),
    transferDate: optStr(row.transfer_date),
  }),
});

const transport = define<TransportRecord>({
  id: 'transport', table: 'transport_records', label: '交通費',
  columns: ['id', 'trip_date', 'destination', 'from_place', 'to_place', 'trip_type', 'amount', 'notes'],
  order: ['trip_date', 'id'], keyCols: ['id'], conflict: 'id',
  items: loadTransportRecords, setItems: saveTransportRecords,
  to: (r) => ({
    id: r.id,
    trip_date: r.date,
    destination: r.destination ?? '',
    from_place: r.from ?? '',
    to_place: r.to ?? '',
    trip_type: r.tripType === 'oneway' ? 'oneway' : 'roundtrip',
    amount: clampInt(r.amount, 0, 2147483647),
    notes: r.notes ?? '',
  }),
  from: (row) => ({
    id: str(row.id),
    date: str(row.trip_date),
    destination: str(row.destination),
    from: str(row.from_place),
    to: str(row.to_place),
    tripType: row.trip_type === 'oneway' ? 'oneway' : 'roundtrip',
    amount: Number(row.amount) || 0,
    notes: str(row.notes),
  }),
});

const paidLeave = define<PaidLeaveSettings>({
  id: 'paidLeave', table: 'paid_leave_settings', label: '有給残日数',
  columns: ['year', 'month', 'total_days'],
  order: ['year', 'month'], keyCols: ['year', 'month'], conflict: 'user_id,year,month',
  items: loadPaidLeaveSettings, setItems: savePaidLeaveSettings,
  to: (s) => ({ year: s.year, month: s.month ?? 1, total_days: Math.max(Number(s.totalDays) || 0, 0) }),
  from: (row) => ({ year: Number(row.year), month: Number(row.month), totalDays: Number(row.total_days) || 0 }),
});

const leave = define<LeaveApplicationRecord>({
  id: 'leave', table: 'leave_applications', label: '休暇申請書',
  columns: ['id', 'application_date', 'name', 'date_entries', 'reason'],
  order: ['application_date', 'id'], keyCols: ['id'], conflict: 'id',
  items: loadLeaveApplications, setItems: saveLeaveApplications,
  to: (b) => {
    const entries = arr<{ date: string; leaveType: LeaveType }>(b.dateEntries)
      .map((e) => ({ date: e.date, leaveType: e.leaveType }));
    return {
      id: b.id,
      // 申請日は保存時に必須。空なのは古い形式で取り込んだデータだけなので、最初の取得日を申請日にする
      application_date: dateOrNull(b.applicationDate) ?? dateOrNull(entries[0]?.date),
      name: b.name ?? '',
      date_entries: entries,
      reason: b.reason ?? '',
    };
  },
  from: (row) => ({
    id: str(row.id),
    applicationDate: str(row.application_date),
    name: str(row.name),
    dateEntries: arr<{ date: string; leaveType: LeaveType }>(row.date_entries),
    reason: str(row.reason),
  }),
});

const lateEarly = define<LateEarlyApplicationRecord>({
  id: 'lateEarly', table: 'late_early_applications', label: '遅刻早退申請書',
  columns: ['id', 'application_date', 'name', 'kind', 'target_date', 'scheduled_time', 'actual_time', 'reason'],
  order: ['target_date', 'id'], keyCols: ['id'], conflict: 'id',
  items: loadLateEarlyApplications, setItems: saveLateEarlyApplications,
  to: (a) => ({
    id: a.id,
    application_date: dateOrNull(a.applicationDate) ?? dateOrNull(a.targetDate),
    name: a.name ?? '',
    kind: a.type === '早退' ? '早退' : '遅刻',
    target_date: a.targetDate,
    scheduled_time: textOrNull(a.scheduledTime),
    actual_time: textOrNull(a.actualTime),
    reason: a.reason ?? '',
  }),
  from: (row) => ({
    id: str(row.id),
    applicationDate: str(row.application_date),
    name: str(row.name),
    type: row.kind === '早退' ? '早退' : '遅刻',
    targetDate: str(row.target_date),
    scheduledTime: str(row.scheduled_time),
    actualTime: str(row.actual_time),
    reason: str(row.reason),
  }),
});

interface MonthReport { year: number; month: number; weeks: WeekReportData[]; summary: string }

const WEEK_FIELDS = Object.keys(EMPTY_WEEK) as (keyof WeekReportData)[];
function normalizeWeek(w: unknown): WeekReportData {
  const o = obj(w);
  const week = { ...EMPTY_WEEK };
  for (const f of WEEK_FIELDS) if (typeof o[f] === 'string') week[f] = o[f] as string;
  return week;
}

const workReport = define<MonthReport>({
  id: 'workReport', table: 'work_reports', label: '作業報告書',
  columns: ['year', 'month', 'weeks', 'summary'],
  order: ['year', 'month'], keyCols: ['year', 'month'], conflict: 'user_id,year,month',
  items: () => listWorkReportMonths().map(({ year, month }) => ({
    year, month, weeks: loadAllWeeks(year, month), summary: loadSummary(year, month),
  })),
  setItems: (items) => {
    const keep = new Set(items.map((i) => `${i.year}-${i.month}`));
    for (const m of listWorkReportMonths()) {
      if (!keep.has(`${m.year}-${m.month}`)) removeWorkReport(m.year, m.month);
    }
    for (const i of items) {
      saveAllWeeks(i.year, i.month, i.weeks);
      saveSummary(i.year, i.month, i.summary);
    }
  },
  to: (r) => ({ year: r.year, month: r.month, weeks: r.weeks.map(normalizeWeek), summary: r.summary ?? '' }),
  from: (row) => {
    const weeks = arr<unknown>(row.weeks).map(normalizeWeek);
    return {
      year: Number(row.year),
      month: Number(row.month),
      weeks: weeks.length > 0 ? weeks : WEEK_LABELS.map(() => ({ ...EMPTY_WEEK })),
      summary: str(row.summary),
    };
  },
  hasContent: (r) => r.weeks.some(hasContent) || r.summary.trim() !== '',
});

interface SkillSheet {
  profile: SkillSheetProfile; skills: SkillEntry[]; certifications: Certification[]; workHistory: WorkHistoryEntry[];
}
const PROFILE_FIELDS = Object.keys(DEFAULT_SKILL_SHEET_PROFILE) as (keyof SkillSheetProfile)[];

const skill = define<SkillSheet>({
  id: 'skill', table: 'skill_sheets', label: 'スキル表',
  columns: ['profile', 'skills', 'certifications', 'work_history'],
  order: [], keyCols: [], conflict: 'user_id',
  items: () => [{
    profile: loadSkillProfile(), skills: loadSkillEntries(),
    certifications: loadCertifications(), workHistory: loadWorkHistory(),
  }],
  setItems: (items) => {
    const s = items[0] ?? skillEmpty();
    saveSkillProfile(s.profile);
    saveSkillEntries(s.skills);
    saveCertifications(s.certifications);
    saveWorkHistory(s.workHistory);
  },
  to: (s) => ({
    profile: Object.fromEntries(PROFILE_FIELDS.map((f) => [f, str(s.profile?.[f])])),
    skills: arr(s.skills),
    certifications: arr(s.certifications),
    work_history: arr(s.workHistory),
  }),
  from: (row) => ({
    profile: { ...DEFAULT_SKILL_SHEET_PROFILE, ...obj(row.profile) } as SkillSheetProfile,
    skills: arr(row.skills),
    certifications: arr(row.certifications),
    workHistory: arr(row.work_history),
  }),
  empty: skillEmpty(),
});

function skillEmpty(): SkillSheet {
  return { profile: { ...DEFAULT_SKILL_SHEET_PROFILE }, skills: [], certifications: [], workHistory: [] };
}

// 社員情報・氏名・基準時間・サイン（プロフィールは登録時に自動で作られるため、更新だけ行う）
interface ProfileItem {
  employeeId: string; lastName: string; name: string;
  startTime: string; endTime: string; signSelf: string; signManager: string;
}
const PROFILE_EMPTY: ProfileItem = {
  employeeId: '', lastName: '', name: '',
  startTime: DEFAULT_WORK_SETTINGS.standardStartTime, endTime: DEFAULT_WORK_SETTINGS.standardEndTime,
  signSelf: '', signManager: '',
};

const profile = define<ProfileItem>({
  id: 'profile', table: 'profiles', label: '社員情報・サイン',
  columns: [
    'employee_id', 'last_name', 'full_name', 'standard_start_time', 'standard_end_time',
    'signature_self', 'signature_manager',
  ],
  order: [], keyCols: [], conflict: 'user_id',
  items: () => {
    const p = loadUserProfile();
    const ws = loadWorkSettings();
    return [{
      employeeId: p.employeeId ?? '', lastName: p.lastName ?? '', name: loadName(),
      startTime: ws.standardStartTime, endTime: ws.standardEndTime,
      signSelf: loadSignature('self'), signManager: loadSignature('manager'),
    }];
  },
  setItems: (items) => {
    const p = items[0] ?? PROFILE_EMPTY;
    saveUserProfile({ ...loadUserProfile(), employeeId: p.employeeId, lastName: p.lastName });
    saveWorkSettings({
      ...loadWorkSettings(),
      standardStartTime: p.startTime || DEFAULT_WORK_SETTINGS.standardStartTime,
      standardEndTime: p.endTime || DEFAULT_WORK_SETTINGS.standardEndTime,
    });
    saveName(p.name);
    saveSignature('self', p.signSelf);
    saveSignature('manager', p.signManager);
  },
  to: (p) => ({
    employee_id: p.employeeId ?? '',
    last_name: p.lastName ?? '',
    full_name: p.name ?? '',
    standard_start_time: p.startTime || DEFAULT_WORK_SETTINGS.standardStartTime,
    standard_end_time: p.endTime || DEFAULT_WORK_SETTINGS.standardEndTime,
    signature_self: p.signSelf ?? '',
    signature_manager: p.signManager ?? '',
  }),
  from: (row) => ({
    employeeId: str(row.employee_id), lastName: str(row.last_name), name: str(row.full_name),
    startTime: str(row.standard_start_time), endTime: str(row.standard_end_time),
    signSelf: str(row.signature_self), signManager: str(row.signature_manager),
  }),
  empty: PROFILE_EMPTY,
});

const COLLECTIONS: Collection[] = [profile, skill, paidLeave, attendance, transport, leave, lateEarly, workReport];
const BY_ID = Object.fromEntries(COLLECTIONS.map((c) => [c.id, c])) as Record<CollectionId, Collection>;

function keyOf(c: Collection, row: Row): string {
  return c.keyCols.length ? c.keyCols.map((k) => String(row[k])).join('-') : 'me';
}

// 同じキーの行が重複していたら最初の行を使う（画面側も最初に見つかった行を使うため）
function rowMap(c: Collection, rows: Row[]): Map<string, Row> {
  const m = new Map<string, Row>();
  for (const r of rows) {
    const k = keyOf(c, r);
    if (!m.has(k)) m.set(k, r);
  }
  return m;
}

// jsonb はオブジェクトのキーの順番を並べ替えるため、キーの順番によらない文字列で比べる
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

function sameRows(c: Collection, a: Row[], b: Row[]): boolean {
  const ma = rowMap(c, a), mb = rowMap(c, b);
  if (ma.size !== mb.size) return false;
  for (const [k, r] of ma) {
    const other = mb.get(k);
    if (!other || stableStringify(r) !== stableStringify(other)) return false;
  }
  return true;
}

// ── 送信待ち ─────────────────────────────────────────────────────────────────
// コレクションごとに「キー → 変更番号」を持つ。送信中に同じ行がまた変わったときは番号が変わるので、送信待ちに残る
// 端末には保存せずメモリ上だけに持つ

type Queue = Partial<Record<CollectionId, Record<string, number>>>;
let seq = Date.now();
let queue: Queue = {};

// 送信中に同じ行がまた変わったかを比べられるよう、コピーを返す
function loadQueue(): Queue {
  return Object.fromEntries(Object.entries(queue).map(([id, m]) => [id, { ...m }])) as Queue;
}

function saveQueue(q: Queue) {
  queue = Object.fromEntries(Object.entries(q).filter(([, m]) => m && Object.keys(m).length > 0)) as Queue;
}

// ── 以前の版が端末（localStorage）に保存したデータ ────────────────────────────
// データのキーはすべて clocking_ で始まる（表示テーマとログイン状態は別のキーで、消さない）

const LEGACY_PREFIX = 'clocking_';
// 以前の版の送信待ちと、端末のデータを同期していたユーザーの ID
const LEGACY_QUEUE_KEY = 'clocking_sync_queue';
const LEGACY_SYNC_USER_KEY = 'clocking_sync_user';

function legacyKeys(): string[] {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(LEGACY_PREFIX)) keys.push(k);
    }
    return keys;
  } catch {
    return []; // 端末に保存できない設定のブラウザ
  }
}

function legacyItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function clearLegacyData() {
  for (const k of legacyKeys()) {
    try { localStorage.removeItem(k); } catch { /* 消せなくても使える */ }
  }
}

// 端末に残っている以前のデータをメモリ上に読み込む（メモリ上は空にしてから呼ぶ）
// synced: このユーザーと同期していた（送れていなかった変更だけを送る）
// unsynced: どのユーザーとも同期していない（データベースのデータとどちらを使うか決める）
// none: 移すデータはない
function loadLegacyData(userId: string): 'synced' | 'unsynced' | 'none' {
  const dataKeys = legacyKeys().filter((k) => k !== LEGACY_QUEUE_KEY && k !== LEGACY_SYNC_USER_KEY);
  const syncUser = legacyItem(LEGACY_SYNC_USER_KEY);
  const legacyQueue = legacyItem(LEGACY_QUEUE_KEY);
  if (dataKeys.length === 0) {
    clearLegacyData();
    return 'none';
  }
  if (syncUser && syncUser !== userId) {
    // 別のユーザーのデータ。送れていない変更がなければそのユーザーのデータベースに保存済みなので消し、
    // 送れていない変更があればそのユーザーがログインしたときに送れるよう残しておく
    if (!legacyQueue) clearLegacyData();
    return 'none';
  }
  for (const k of dataKeys) memoryStore.setItem(k, legacyItem(k) ?? '');
  if (!syncUser) return 'unsynced';
  try {
    const q = legacyQueue ? JSON.parse(legacyQueue) : {};
    saveQueue(q && typeof q === 'object' ? q as Queue : {});
  } catch {
    saveQueue({});
  }
  return 'synced';
}

function pendingCount(q: Queue = loadQueue()): number {
  return Object.values(q).reduce((n, m) => n + Object.keys(m ?? {}).length, 0);
}

function enqueue(id: CollectionId, keys: string[]) {
  const q = loadQueue();
  const m = q[id] ?? {};
  for (const k of keys) m[k] = ++seq;
  q[id] = m;
  saveQueue(q);
  const pending = pendingCount(q);
  // 画面の描画中に保存されても警告にならないよう、表示の更新は後で行う
  queueMicrotask(() => setState({ pending }));
}

function dequeue(id: CollectionId, sent: Record<string, number>, done: string[]) {
  const q = loadQueue();
  const m = q[id];
  if (!m) return;
  for (const k of done) if (m[k] === sent[k]) delete m[k];
  saveQueue(q);
}

function snapshot(c: Collection): Map<string, string> {
  const m = new Map<string, string>();
  for (const [k, r] of rowMap(c, c.read())) m.set(k, stableStringify(r));
  return m;
}

// 保存の前後で内容が変わった行を送信待ちに積む
function track(id: CollectionId, write: () => void) {
  const c = BY_ID[id];
  let before: Map<string, string> | null = null;
  try { before = snapshot(c); } catch { /* 読めないデータは比べずにそのまま書き込む */ }
  write();
  if (!before) return;
  try {
    const after = snapshot(c);
    const changed: string[] = [];
    for (const [k, v] of before) if (after.get(k) !== v) changed.push(k);
    for (const k of after.keys()) if (!before.has(k)) changed.push(k);
    if (changed.length > 0) {
      enqueue(id, changed);
      schedulePush();
    }
  } catch { /* 比べられなかった場合は次の同期で送れないが、この端末には保存済み */ }
}

// 古い形式の ID（日時＋乱数）や重複した ID を UUID に置き換える（クラウドの id 列は UUID のため）
function normalizeIds() {
  fixIds(loadRecords, saveRecords);
  fixIds(loadTransportRecords, saveTransportRecords);
  fixIds(loadLeaveApplications, saveLeaveApplications);
  fixIds(loadLateEarlyApplications, saveLateEarlyApplications);
}

function fixIds<T extends { id: string }>(load: () => T[], save: (items: T[]) => void) {
  const seen = new Set<string>();
  let changed = false;
  const next = load().map((item) => {
    if (isUuid(item.id) && !seen.has(item.id)) {
      seen.add(item.id);
      return item;
    }
    changed = true;
    const id = generateId();
    seen.add(id);
    return { ...item, id };
  });
  if (changed) save(next);
}

// ── クラウドとの通信 ─────────────────────────────────────────────────────────

class OfflineError extends Error {}

interface DbError { message: string; code?: string }

function isNetworkError(e: DbError): boolean {
  return !e.code && /fetch|network|load failed|timed? ?out/i.test(e.message);
}

// 通信できないときは OfflineError を投げ、それ以外は日本語の説明を返す
function describe(e: DbError): string {
  if (isNetworkError(e)) throw new OfflineError('クラウドに接続できません');
  if (e.code === '42501') return '提出済みの月か、変更する権限のないデータのため保存できません';
  if (e.code === '23514' || e.code === '22P02' || e.code === '22007' || e.code === '23502') {
    return '保存できない値が含まれています';
  }
  if (e.code === 'PGRST301' || e.code === 'PGRST303') return 'ログインの有効期限が切れました。ログインし直してください';
  return e.message;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchTable(c: Collection, uid: string): Promise<Row[]> {
  const rows: Row[] = [];
  const PAGE = 1000; // 1回に取得できる行数の上限
  for (let from = 0; ; from += PAGE) {
    // 上長は部下のデータも読めるため、必ず自分の行だけに絞る
    let q = supabase.from(c.table).select(c.columns.join(',')).eq('user_id', uid);
    for (const col of c.order) q = q.order(col, { ascending: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(describe(error));
    const page = (data ?? []) as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  const canon = rows.map((r) => c.canon(r));
  if (c.empty && canon.length === 0) return [c.empty];
  return canon;
}

type ServerData = Record<CollectionId, Row[]>;

async function fetchServer(uid: string): Promise<ServerData> {
  const entries = await Promise.all(COLLECTIONS.map(async (c) => [c.id, await fetchTable(c, uid)] as const));
  return Object.fromEntries(entries) as ServerData;
}

async function deleteRows(c: Collection, uid: string, keys: string[]): Promise<string | null> {
  if (c.keyCols.length === 0) return null; // 1人1行のテーブルは消さない
  if (c.keyCols[0] === 'id') {
    // UUID でない ID はクラウドに存在しない（古い形式の ID を置き換えたときの元の ID）
    for (const ids of chunks(keys.filter(isUuid), 100)) {
      const { error } = await supabase.from(c.table).delete().eq('user_id', uid).in('id', ids);
      if (error) return describe(error);
    }
    return null;
  }
  for (const key of keys) {
    const [year, month] = key.split('-').map(Number);
    const { error } = await supabase.from(c.table).delete().eq('user_id', uid).eq('year', year).eq('month', month);
    if (error) return describe(error);
  }
  return null;
}

async function upsertOne(c: Collection, uid: string, row: Row): Promise<string | null> {
  let { error } = await supabase.from(c.table).upsert(row, { onConflict: c.conflict });
  if (error?.code === '23505' && c.id === 'attendance') {
    // 同じ日の勤怠が別の端末から先に保存されていた場合は、この端末の内容で置き換える
    const del = await supabase.from(c.table).delete()
      .eq('user_id', uid).eq('work_date', row.work_date as string).neq('id', row.id as string);
    if (del.error) return describe(del.error);
    ({ error } = await supabase.from(c.table).upsert(row, { onConflict: c.conflict }));
  }
  return error ? describe(error) : null;
}

async function upsertRows(c: Collection, uid: string, rows: Row[]): Promise<{ ok: string[]; error: string | null }> {
  if (c.id === 'profile') {
    const { data, error } = await supabase.from(c.table).update(rows[0]).eq('user_id', uid).select('user_id');
    if (error) return { ok: [], error: describe(error) };
    if (!data || data.length === 0) return { ok: [], error: 'クラウドにプロフィールが見つかりません' };
    return { ok: ['me'], error: null };
  }
  const ok: string[] = [];
  let lastError: string | null = null;
  for (const chunk of chunks(rows.map((r) => ({ ...r, user_id: uid })), 200)) {
    const { error } = await supabase.from(c.table).upsert(chunk, { onConflict: c.conflict });
    if (!error) {
      ok.push(...chunk.map((r) => keyOf(c, r)));
      continue;
    }
    describe(error); // 通信できないときはここで中断する
    // 1行ずつ送り直し、保存できない行だけを送信待ちに残す
    for (const row of chunk) {
      const e = await upsertOne(c, uid, row);
      if (e) lastError = e;
      else ok.push(keyOf(c, row));
    }
  }
  return { ok, error: lastError };
}

async function flushQueue(uid: string): Promise<string[]> {
  const errors: string[] = [];
  for (const c of COLLECTIONS) {
    const sent = loadQueue()[c.id];
    if (!sent || Object.keys(sent).length === 0) continue;
    const local = rowMap(c, c.read());
    const upserts: Row[] = [];
    const deletes: string[] = [];
    for (const k of Object.keys(sent)) {
      const row = local.get(k);
      if (row) upserts.push(row);
      else deletes.push(k);
    }
    const done: string[] = [];
    // 同じ日の勤怠を消して作り直した場合に備え、先に削除する
    if (deletes.length > 0) {
      const e = await deleteRows(c, uid, deletes);
      if (e) errors.push(`${c.label}: ${e}`);
      else done.push(...deletes);
    }
    if (upserts.length > 0) {
      const r = await upsertRows(c, uid, upserts);
      done.push(...r.ok);
      if (r.error) errors.push(`${c.label}: ${r.error}`);
    }
    dequeue(c.id, sent, done);
  }
  return errors;
}

// クラウドの内容をこの端末に反映する。送信待ちの行はこの端末の内容を残す。変わったら true
function applyServer(server: ServerData): boolean {
  const queue = loadQueue();
  let changed = false;
  for (const c of COLLECTIONS) {
    const queued = queue[c.id] ?? {};
    const localRows = [...rowMap(c, c.read()).values()];
    const serverRows = [...rowMap(c, server[c.id]).values()];
    const serverMap = rowMap(c, serverRows);
    const localKeys = new Set(localRows.map((r) => keyOf(c, r)));
    const next: Row[] = [];
    for (const r of localRows) {
      const k = keyOf(c, r);
      if (k in queued) next.push(r);
      else {
        const s = serverMap.get(k);
        if (s) next.push(s);
      }
    }
    for (const r of serverRows) {
      const k = keyOf(c, r);
      if (!localKeys.has(k) && !(k in queued)) next.push(r);
    }
    if (!sameRows(c, localRows, next)) {
      withoutTracking(() => c.write(next));
      changed = true;
    }
  }
  return changed;
}

function summarize(rowsOf: (c: Collection) => Row[]): DataCounts {
  const count = (...cs: Collection[]) => cs.reduce((n, c) => n + rowsOf(c).filter((r) => c.hasContent(r)).length, 0);
  const counts = {
    attendance: count(attendance),
    transport: count(transport),
    applications: count(leave, lateEarly),
    workReports: count(workReport),
    others: count(profile, skill, paidLeave) > 0,
  };
  return {
    ...counts,
    any: counts.attendance + counts.transport + counts.applications + counts.workReports > 0 || counts.others,
  };
}

// ── 同期の流れ ───────────────────────────────────────────────────────────────

// ログイン中のユーザー（ログイン状態が変わったときにすぐ更新する）
let uid: string | null = null;
// メモリ上のデータ・送信待ちが誰のものか（ログインが切れても、同じユーザーでログインし直したら送信待ちを送る）
let dataOwner: string | null = null;
// データベースへ送ってよいか（端末に残っていた以前のデータとどちらを使うか決めるまでは送らない）
let syncEnabled = false;
// 端末に残っていた以前のデータを、送信待ちがなくなったら端末から消す
let legacyPending = false;
let chain: Promise<unknown> = Promise.resolve();

// 送信・取り込みは同時に走らせず、順番に行う
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const p = chain.then(task, task);
  chain = p.catch(() => undefined);
  return p;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function runSync(pullAfter: boolean): Promise<void> {
  const me = uid;
  if (!me || dataOwner !== me || !syncEnabled) return;
  setState({ phase: 'syncing' });
  try {
    normalizeIds();
    const errors = await flushQueue(me);
    if (pullAfter) {
      const server = await fetchServer(me);
      if (uid !== me) return; // 取得中にログアウトした
      const changed = applyServer(server);
      // 読み込み終えたら、いつもの画面を出す
      setState({ loaded: true, dataVersion: changed ? state.dataVersion + 1 : state.dataVersion });
    }
    if (uid !== me) return;
    // 端末に残っていた以前のデータは、すべてデータベースへ送れたら端末から消す
    if (legacyPending && pendingCount() === 0) {
      clearLegacyData();
      legacyPending = false;
    }
    setState({
      phase: errors.length > 0 ? 'error' : 'synced',
      error: errors.length > 0 ? `保存できないデータがあります（${errors[0]}）` : null,
      lastSyncedAt: Date.now(),
      pending: pendingCount(),
    });
  } catch (e) {
    if (uid !== me) return;
    const offline = e instanceof OfflineError || !navigator.onLine;
    setState({ phase: offline ? 'offline' : 'error', error: errorText(e), pending: pendingCount() });
  }
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;

// 入力が続いている間は送らず、止まってから少し待ってまとめて送る
// （送信待ちは端末に残らないため、待ち時間は短くする）
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { void exclusive(() => runSync(false)); }, 500);
}

// 送信待ちをすぐに送る（ほかのアプリに切り替えたときなど）
function pushNow() {
  if (!uid || !syncEnabled || pendingCount() === 0) return;
  clearTimeout(pushTimer);
  void exclusive(() => runSync(false));
}

// 送信待ちを送ってから、データベースの内容を読み込む
export function syncNow(): Promise<void> {
  clearTimeout(pushTimer);
  const me = uid;
  // ログイン直後の読み込みに失敗していた場合は、読み込みからやり直す
  if (me && !state.loaded && state.phase !== 'needs-choice') return exclusive(() => startSession(me, state.email));
  return exclusive(() => runSync(true));
}

let lastAutoSync = 0;
function autoSync() {
  if (!uid || !state.loaded) return;
  if (Date.now() - lastAutoSync < 5000) return;
  lastAutoSync = Date.now();
  void syncNow();
}

// メモリ上のデータと送信待ちを空にする
function resetData() {
  clearTimeout(pushTimer);
  memoryStore.clear();
  saveQueue({});
  dataOwner = null;
  syncEnabled = false;
  legacyPending = false;
}

async function startSession(userId: string, email: string | null) {
  if (uid !== userId) return;
  setState({ email, error: null, choice: null, phase: 'checking' });
  if (dataOwner !== userId) {
    // 別のユーザーのデータが残っていれば消してから読み込む
    resetData();
    dataOwner = userId;
    const legacy = loadLegacyData(userId);
    legacyPending = legacy !== 'none';
    syncEnabled = legacy !== 'unsynced';
  }
  setWriteTracker(track);
  if (syncEnabled) {
    // 送信待ち（以前の版で送れていなかった変更・ログインが切れる前の変更）を送ってから読み込む
    await runSync(true);
    return;
  }
  // 端末に、どのユーザーとも同期していない以前のデータが残っている:
  // どちらのデータを使うか決まるまではデータベースへ送らない
  try {
    const server = await fetchServer(userId);
    if (uid !== userId) return;
    const local = summarize((c) => c.read());
    const cloud = summarize((c) => server[c.id]);
    if (!local.any) await beginSync('cloud', server);
    else if (!cloud.any) await beginSync('local', server);
    else setState({ phase: 'needs-choice', choice: { local, cloud } });
  } catch (e) {
    if (uid !== userId) return;
    setState({ phase: e instanceof OfflineError ? 'offline' : 'error', error: errorText(e) });
  }
}

async function beginSync(source: 'local' | 'cloud', server: ServerData) {
  const me = uid;
  if (!me) return;
  if (source === 'local') {
    // 端末に残っていたデータをすべて送り、データベースにしかない行は消す
    withoutTracking(normalizeIds);
    const q: Queue = {};
    for (const c of COLLECTIONS) {
      const keys = new Set([...c.read(), ...server[c.id]].map((r) => keyOf(c, r)));
      q[c.id] = Object.fromEntries([...keys].map((k) => [k, ++seq]));
    }
    saveQueue(q);
  } else {
    // 端末に残っていたデータは使わずに消し、データベースのデータを読み込む
    memoryStore.clear();
    saveQueue({});
    clearLegacyData();
    legacyPending = false;
  }
  syncEnabled = true;
  setState({ choice: null, pending: pendingCount() });
  // 読み込み終えたところでいつもの画面に切り替わる
  await runSync(true);
}

// データベースと、端末に残っていた以前のデータの両方があったときに、どちらを使うか決める
export function chooseInitialData(source: 'local' | 'cloud'): Promise<void> {
  return exclusive(async () => {
    const me = uid;
    if (!me || state.phase !== 'needs-choice') return;
    setState({ phase: 'syncing', error: null });
    try {
      const server = await fetchServer(me);
      if (uid !== me) return;
      await beginSync(source, server);
    } catch (e) {
      if (uid !== me) return;
      setState({ phase: 'needs-choice', error: errorText(e) });
    }
  });
}

// ログインしていない状態になった（ログアウト・ログインの期限切れ）。ログイン画面に戻る
// ログインが切れた場合は、同じユーザーでログインし直したときに送れるよう、メモリ上の送信待ちを残しておく
function onNoSession() {
  uid = null;
  clearTimeout(pushTimer);
  setState({
    phase: 'signed-out', email: null, error: null, choice: null, passwordRecovery: false,
    loaded: false, pending: pendingCount(), authReady: true,
  });
}

// 確認メール・再設定メールのリンクが使えなかったとき、戻り先の URL にエラーが付いてくる
function readLinkError(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  new URLSearchParams(window.location.search).forEach((v, k) => { if (!params.has(k)) params.set(k, v); });
  if (!params.get('error') && !params.get('error_code')) return null;
  if (params.get('error_code') === 'otp_expired') {
    return 'メールのリンクの有効期限が切れているか、すでに使われています。もう一度やり直してください。';
  }
  return `メールのリンクを開けませんでした（${params.get('error_description') ?? params.get('error')}）`;
}

let initialized = false;

export function initCloudSync() {
  if (initialized) return;
  initialized = true;
  setState({ linkError: readLinkError() });
  supabase.auth.onAuthStateChange((event, session) => {
    const user = session?.user ?? null;
    if (event === 'PASSWORD_RECOVERY') setState({ passwordRecovery: true });
    if (user) {
      if (user.id === uid) return; // トークンの更新など
      uid = user.id;
      const email = user.email ?? null;
      // ログイン画面が一瞬出ないよう、ここで状態を決めておく
      setState({ authReady: true, email, loaded: false, linkError: null, phase: 'checking' });
      // この中で Supabase を呼ぶと処理が止まることがあるため、後で行う
      setTimeout(() => { void exclusive(() => startSession(user.id, email)); }, 0);
    } else if (!signingOut) {
      // 画面からのログアウトは signOut() の中で後始末する（途中でいつもの画面が見えないように）
      onNoSession();
    }
  });
  document.addEventListener('visibilitychange', () => {
    // ほかのアプリに切り替えたら送信待ちをすぐ送り、戻ってきたらほかの端末の変更を読み込む
    if (document.visibilityState === 'hidden') pushNow();
    else autoSync();
  });
  window.addEventListener('online', autoSync);
  // データベースに送れていない変更は端末に残らないため、ページを閉じる・再読み込みする前に確認する
  window.addEventListener('beforeunload', (e) => {
    if (pendingCount() === 0) return;
    e.preventDefault();
    e.returnValue = '';
  });
}

// ── ログイン・登録 ───────────────────────────────────────────────────────────

interface AuthErr { message: string; code?: string; status?: number; name?: string }

function authErrorText(e: AuthErr): string {
  switch (e.code) {
    case 'invalid_credentials': return 'メールアドレスまたはパスワードが違います';
    case 'email_not_confirmed': return 'メールアドレスの確認が済んでいません。届いた確認メールのリンクを開いてください';
    case 'user_already_exists':
    case 'email_exists': return 'このメールアドレスはすでに登録されています。ログインしてください';
    case 'weak_password': return 'パスワードが短すぎます。6文字以上にしてください';
    case 'over_email_send_rate_limit': return 'メールの送信回数の上限に達しました。しばらく待ってからやり直してください';
    case 'over_request_rate_limit': return '操作が多すぎます。しばらく待ってからやり直してください';
    case 'email_address_not_authorized': return 'このメールアドレスには確認メールを送れません（Supabase のメール送信設定が必要です）';
    case 'email_address_invalid': return 'メールアドレスの形式が正しくありません';
    case 'signup_disabled': return '新規登録は受け付けていません';
    case 'same_password': return 'これまでと同じパスワードは使えません';
  }
  if (e.status === 0 || e.name === 'AuthRetryableFetchError') return 'サーバーに接続できません。通信状態を確認してください';
  return e.message;
}

export async function signIn(email: string, password: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? authErrorText(error) : null;
}

// 確認メール・再設定メールのリンクからこのアプリに戻ってくる
const appUrl = () => window.location.origin + window.location.pathname;

export async function signUp(email: string, password: string): Promise<{ error: string | null; needsConfirm: boolean }> {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: appUrl() } });
  if (error) return { error: authErrorText(error), needsConfirm: false };
  return { error: null, needsConfirm: !data.session };
}

export async function requestPasswordReset(email: string): Promise<string | null> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
  return error ? authErrorText(error) : null;
}

// パスワード再設定メールのリンクから開いたときに、新しいパスワードを設定する
export async function updatePassword(password: string): Promise<string | null> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return authErrorText(error);
  setState({ passwordRecovery: false });
  return null;
}

// ログアウトの前に送信待ちを送る。送れなかった件数を返す
export async function flushBeforeSignOut(): Promise<number> {
  clearTimeout(pushTimer);
  await exclusive(() => runSync(false));
  return pendingCount();
}

let signingOut = false;

// ログアウトする（ほかの端末はログインしたまま）。できなかったときは理由を返す
export async function signOut(): Promise<string | null> {
  signingOut = true;
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) return authErrorText(error);
  } finally {
    signingOut = false;
  }
  // メモリ上のデータを消す（データはデータベースにあり、次にログインしたときに読み込む）
  setWriteTracker(null);
  resetData();
  onNoSession();
  return null;
}
