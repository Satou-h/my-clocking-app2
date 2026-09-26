/**
 * transfer.ts — QRコード / カナコード転送用データ変換ユーティリティ
 *
 * QR      : バイナリ形式 v3（勤怠 + 交通費 + 付加情報）
 * カナコード: コンパクトバイナリ v2（勤怠 + 付加情報）→ カタカナ文字列
 * 付加情報 : 基準時間（勤務設定・日ごとの変更）、社員番号、苗字
 */

import type { AttendanceRecord, AttendanceType, WorkSettings } from '../types/attendance';
import type { TransportRecord } from '../types/transport';
import { generateId } from './storage';

// ── 型コード ───────────────────────────────────────────────────────────────────
const TYPE_ENCODE: Partial<Record<AttendanceType, number>> = {
  work: 0, paid_leave: 1, planned_paid_leave: 2, holiday: 3,
  absence: 4, am_leave: 5, pm_leave: 6,
  scheduled_holiday_work: 7, legal_holiday_work: 8,
  transfer_holiday_work: 9, transfer_holiday: 10,
};
const TYPE_DECODE: AttendanceType[] = [
  'work', 'paid_leave', 'planned_paid_leave', 'holiday',
  'absence', 'am_leave', 'pm_leave', 'scheduled_holiday_work', 'legal_holiday_work',
  'transfer_holiday_work', 'transfer_holiday',
];

// ── 時刻ヘルパー ──────────────────────────────────────────────────────────────
function toMins(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function fromMins(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// ── 振替休日の日数差 ──────────────────────────────────────────────────────────
function dayNumber(d: string): number {
  const [y, m, day] = d.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, day) / 86400000);
}
function encodeTransferOffset(date: string, transferDate?: string): number {
  if (!transferDate) return 0;
  const diff = dayNumber(transferDate) - dayNumber(date);
  return diff >= -63 && diff <= 63 && diff !== 0 ? diff + 64 : 0;
}
function decodeTransferOffset(date: string, stored: number): string | undefined {
  if (stored === 0) return undefined;
  return new Date((dayNumber(date) + stored - 64) * 86400000).toISOString().slice(0, 10);
}

// ── 1レコード = 6バイトのパック ────────────────────────────────────────────────
// bit layout (48bit):
// [47:43] day(5)  [42:39] type(4)  [38] has_time(1)
// [37:27] clockIn(11)  [26:16] clockOut(11)
// [15:8]  break(8)  [7] noTransport(1)  [6:0] transferOffset(7)
// transferOffset: 振替休日の出勤日からの日数差 + 64（0 = なし、±63日まで）
function packRecord(r: AttendanceRecord): Uint8Array {
  const day = parseInt(r.date.slice(8, 10));
  const tc  = TYPE_ENCODE[r.type] ?? 0;
  const ht  = (r.clockIn && r.clockOut) ? 1 : 0;
  const ci  = ht ? Math.min(toMins(r.clockIn!), 0x7FE) : 0;
  const co  = ht ? Math.min(toMins(r.clockOut!), 0x7FE) : 0;
  const brk = Math.min(r.breakMinutes ?? 0, 255);
  const nt  = r.noTransport ? 1 : 0;
  const tro = encodeTransferOffset(r.date, r.transferDate);

  const buf = new Uint8Array(6);
  buf[0] = (day << 3) | (tc >> 1);
  buf[1] = ((tc & 1) << 7) | (ht << 6) | (ci >> 5);
  buf[2] = ((ci & 0x1F) << 3) | (co >> 8);
  buf[3] = co & 0xFF;
  buf[4] = brk;
  buf[5] = (nt << 7) | tro;
  return buf;
}

function unpackRecord(buf: Uint8Array, off: number, year: number, month: number): AttendanceRecord {
  const b = (i: number) => buf[off + i];
  const day = b(0) >> 3;
  const tc  = ((b(0) & 7) << 1) | (b(1) >> 7);
  const ht  = (b(1) >> 6) & 1;
  const ci  = ((b(1) & 0x3F) << 5) | (b(2) >> 3);
  const co  = ((b(2) & 7) << 8) | b(3);
  const brk = b(4);
  const nt  = b(5) >> 7;
  const tro = b(5) & 0x7F;

  const date = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  return {
    id: generateId(),
    date,
    type: TYPE_DECODE[tc] ?? 'work',
    clockIn:      ht ? fromMins(ci) : undefined,
    clockOut:     ht ? fromMins(co) : undefined,
    breakMinutes: brk || undefined,
    noTransport:  nt ? true : undefined,
    transferDate: decodeTransferOffset(date, tro),
  };
}

// ── 付加情報（基準時間・社員番号・苗字）─────────────────────────────────────────
// レコード列の後ろに付加する可変長ブロック:
// [std_start:12][std_end:12] = 3 bytes（勤務設定の基準時間、0xFFF = なし）
// [id_len:1][社員番号 UTF-8] [name_len:1][苗字 UTF-8]
// [custom_count:1] + custom_count × [record_index:1][start:12][end:12]（日ごとの基準時間）
export interface TransferMeta {
  workSettings?: WorkSettings;
  employeeId?: string;
  lastName?: string;
}

const NO_TIME = 0xFFF;
const encodeTime = (t?: string) => (t && /^\d{1,2}:\d{2}$/.test(t) ? toMins(t) : NO_TIME);
const decodeTime = (v: number) => (v === NO_TIME || v >= 24 * 60 ? undefined : fromMins(v));

function pushTimePair(out: number[], a?: string, b?: string) {
  const x = encodeTime(a), y = encodeTime(b);
  out.push(x >> 4, ((x & 0xF) << 4) | (y >> 8), y & 0xFF);
}
function readTimePair(buf: Uint8Array, off: number): [string | undefined, string | undefined] {
  const x = (buf[off] << 4) | (buf[off + 1] >> 4);
  const y = ((buf[off + 1] & 0xF) << 8) | buf[off + 2];
  return [decodeTime(x), decodeTime(y)];
}

function pushText(out: number[], text?: string) {
  const enc = new TextEncoder();
  let s = text ?? '';
  // 長さは1バイトで持つため、255バイトを超える場合は文字単位で切り詰める
  while (enc.encode(s).length > 255) s = s.slice(0, -1);
  const bytes = enc.encode(s);
  out.push(bytes.length, ...bytes);
}

function encodeMeta(recs: AttendanceRecord[], meta: TransferMeta): number[] {
  const out: number[] = [];
  pushTimePair(out, meta.workSettings?.standardStartTime, meta.workSettings?.standardEndTime);
  pushText(out, meta.employeeId);
  pushText(out, meta.lastName);
  const customs = recs
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.customStartTime || r.customEndTime);
  out.push(customs.length);
  for (const { r, i } of customs) {
    out.push(i);
    pushTimePair(out, r.customStartTime, r.customEndTime);
  }
  return out;
}

// 付加情報を読み取り、日ごとの基準時間は recs に反映する
function decodeMeta(buf: Uint8Array, start: number, recs: AttendanceRecord[]): TransferMeta | null {
  let off = start;
  const need = (n: number) => { if (off + n > buf.length) throw new Error('データが途中で切れています'); };
  const readText = () => {
    need(1);
    const len = buf[off++];
    need(len);
    const s = new TextDecoder().decode(buf.slice(off, off + len));
    off += len;
    return s;
  };
  try {
    need(3);
    const [stdStart, stdEnd] = readTimePair(buf, off);
    off += 3;
    const employeeId = readText();
    const lastName = readText();
    need(1);
    const customCount = buf[off++];
    for (let i = 0; i < customCount; i++) {
      need(4);
      const rec = recs[buf[off]];
      const [cs, ce] = readTimePair(buf, off + 1);
      off += 4;
      if (rec) { rec.customStartTime = cs; rec.customEndTime = ce; }
    }
    return {
      workSettings: stdStart && stdEnd ? { standardStartTime: stdStart, standardEndTime: stdEnd } : undefined,
      employeeId: employeeId || undefined,
      lastName: lastName || undefined,
    };
  } catch { return null; }
}

// ── 月ごとバイナリ encode / decode ─────────────────────────────────────────────
// ヘッダー: [ver:1][year_hi:1][year_lo:1][month:1][count:1] = 5 bytes
// ver 1: レコードのみ / ver 2: レコード + 付加情報
export function encodeMonth(records: AttendanceRecord[], year: number, month: number, meta: TransferMeta = {}): Uint8Array {
  const prefix = `${year}-${String(month).padStart(2,'0')}`;
  const recs = records
    .filter(r => r.date.startsWith(prefix))
    .sort((a, b) => a.date.localeCompare(b.date));
  const metaBytes = encodeMeta(recs, meta);
  const buf = new Uint8Array(5 + recs.length * 6 + metaBytes.length);
  buf[0] = 2; buf[1] = year >> 8; buf[2] = year & 0xFF; buf[3] = month; buf[4] = recs.length;
  recs.forEach((r, i) => buf.set(packRecord(r), 5 + i * 6));
  buf.set(metaBytes, 5 + recs.length * 6);
  return buf;
}

export function decodeMonth(buf: Uint8Array): { records: AttendanceRecord[]; year: number; month: number; meta?: TransferMeta } | null {
  try {
    if (buf.length < 5 || (buf[0] !== 1 && buf[0] !== 2)) return null;
    const year  = (buf[1] << 8) | buf[2];
    const month = buf[3];
    const count = buf[4];
    if (buf.length < 5 + count * 6) return null;
    const records: AttendanceRecord[] = [];
    for (let i = 0; i < count; i++) records.push(unpackRecord(buf, 5 + i * 6, year, month));
    if (buf[0] === 1) return { records, year, month };
    const meta = decodeMeta(buf, 5 + count * 6, records);
    if (!meta) return null;
    return { records, year, month, meta };
  } catch { return null; }
}

// ── 交通費コンパクトバイナリ（4 bytes/record）────────────────────────────────
// bit layout (4 bytes):
// byte0: [day:5][tripType:1][amount_hi2:2]
// byte1: [amount_mid8:8]
// byte2: [amount_lo8:8]
// byte3: [amount_last2:2][reserved:6]
// amount: 20 bits → max ¥1,048,575
// ※ 行先/出発地/到着地/備考テキストは容量節約のため含まない
function packTransport(r: TransportRecord): Uint8Array {
  const day = parseInt(r.date.slice(8, 10));
  const tt  = r.tripType === 'oneway' ? 1 : 0;
  const amt = Math.min(r.amount, 0xFFFFF); // 20 bits
  const buf = new Uint8Array(4);
  buf[0] = (day << 3) | (tt << 2) | (amt >> 18);
  buf[1] = (amt >> 10) & 0xFF;
  buf[2] = (amt >> 2)  & 0xFF;
  buf[3] = (amt & 3)   << 6;
  return buf;
}

function unpackTransport(buf: Uint8Array, off: number, year: number, month: number): TransportRecord {
  const b0 = buf[off], b1 = buf[off + 1], b2 = buf[off + 2], b3 = buf[off + 3];
  const day = b0 >> 3;
  const tt  = (b0 >> 2) & 1;
  const amt = ((b0 & 3) << 18) | (b1 << 10) | (b2 << 2) | (b3 >> 6);
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return {
    id: generateId(),
    date,
    destination: '',
    from: '',
    to: '',
    tripType: tt ? 'oneway' : 'roundtrip',
    amount: amt,
    notes: '',
  };
}

// ── QR バイナリ形式 v2 / v3 ───────────────────────────────────────────────────
// QRテキスト = "QR2:" + base64(バイナリ)
// ヘッダー (7 bytes): [ver][year_hi][year_lo][month][att_count][trp_count][flags]
// 勤怠: att_count × 6 bytes（既存フォーマット）
// 交通費: trp_count × 4 bytes（テキストフィールドは省略）
// 付加情報: ver 3 のみ（基準時間・社員番号・苗字）
//
// 旧 JSON 形式 (v1) との後方互換: decodeQR が両方を自動判別
const QR2_PREFIX = 'QR2:';

export function encodeQR(att: AttendanceRecord[], trp: TransportRecord[], year: number, month: number, meta: TransferMeta = {}): string {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const attRecs = att.filter(r => r.date.startsWith(prefix)).sort((a, b) => a.date.localeCompare(b.date));
  const trpRecs = trp.filter(r => r.date.startsWith(prefix)).sort((a, b) => a.date.localeCompare(b.date));

  const metaBytes = encodeMeta(attRecs, meta);
  const dataLen = 7 + attRecs.length * 6 + trpRecs.length * 4;
  const buf = new Uint8Array(dataLen + metaBytes.length);
  buf[0] = 3;                              // version
  buf[1] = year >> 8; buf[2] = year & 0xFF;
  buf[3] = month;
  buf[4] = attRecs.length;
  buf[5] = trpRecs.length;
  buf[6] = 0;                              // flags (reserved)
  attRecs.forEach((r, i) => buf.set(packRecord(r),    7 + i * 6));
  trpRecs.forEach((r, i) => buf.set(packTransport(r), 7 + attRecs.length * 6 + i * 4));
  buf.set(metaBytes, dataLen);

  let binary = '';
  buf.forEach(b => (binary += String.fromCharCode(b)));
  return QR2_PREFIX + btoa(binary);
}

export function decodeQR(text: string): { att: AttendanceRecord[]; trp: TransportRecord[]; year: number; month: number; meta?: TransferMeta } | null {
  // ── v2 バイナリ形式 ──
  if (text.startsWith(QR2_PREFIX)) {
    try {
      const binary = atob(text.slice(QR2_PREFIX.length));
      const buf = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
      if (buf.length < 7 || (buf[0] !== 2 && buf[0] !== 3)) return null;
      const year   = (buf[1] << 8) | buf[2];
      const month  = buf[3];
      const attCnt = buf[4];
      const trpCnt = buf[5];
      if (buf.length < 7 + attCnt * 6 + trpCnt * 4) return null;
      const att: AttendanceRecord[] = [];
      for (let i = 0; i < attCnt; i++) att.push(unpackRecord(buf, 7 + i * 6, year, month));
      const trp: TransportRecord[] = [];
      for (let i = 0; i < trpCnt; i++) trp.push(unpackTransport(buf, 7 + attCnt * 6 + i * 4, year, month));
      if (buf[0] === 2) return { att, trp, year, month };
      const meta = decodeMeta(buf, 7 + attCnt * 6 + trpCnt * 4, att);
      if (!meta) return null;
      return { att, trp, year, month, meta };
    } catch { return null; }
  }

  // ── v1 JSON 形式（後方互換）──
  try {
    interface QRPayload { v: 1; y: number; m: number; att: AttendanceRecord[]; trp: TransportRecord[] }
    const p: QRPayload = JSON.parse(text);
    if (p.v !== 1 || !p.att) return null;
    const att = (p.att ?? []).map(r => ({ ...r, id: generateId() }));
    const trp = (p.trp ?? []).map(r => ({ ...r, id: generateId() }));
    return { att, trp, year: p.y, month: p.m };
  } catch { return null; }
}

// ── カナコード: バイト ↔ カタカナ ─────────────────────────────────────────────
// Base64(パディングなし) 64文字 → カタカナ 64文字に対応させることでカナコードを生成
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
//           ← A-Z(26) a-z(26) 0-9(10) +/(2) = 64 ─────────────────────────────
const KANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲンァィゥェォッャュョーガギグゲゴザジズ';
//            ↑ 基本カタカナ46 + 小文字9 + ー1 + 濁音8 = 64 ──────────────────────

if (import.meta.env.DEV && B64.length !== KANA.length) {
  console.error(`transfer.ts: B64(${B64.length}) ≠ KANA(${KANA.length})`);
}

export function bytesToJumon(bytes: Uint8Array): string {
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  // base64(no padding) → kana substitution
  return btoa(bin).replace(/=/g, '').split('').map(c => {
    const i = B64.indexOf(c);
    return i >= 0 ? KANA[i] : c;
  }).join('');
}

export function jumonToBytes(kana: string): Uint8Array | null {
  const clean = kana.replace(/\s/g, '');
  let b64 = clean.split('').map(c => {
    const i = KANA.indexOf(c);
    return i >= 0 ? B64[i] : c;
  }).join('');
  // padding を復元
  while (b64.length % 4 !== 0) b64 += '=';
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch { return null; }
}

// カナコード表示用フォーマット: 5文字ずつグループ化し、5グループで改行
export function formatJumon(raw: string): string {
  const chars = raw.replace(/\s/g, '');
  const groups: string[] = [];
  for (let i = 0; i < chars.length; i += 5) groups.push(chars.slice(i, i + 5));
  const lines: string[] = [];
  for (let i = 0; i < groups.length; i += 5) lines.push(groups.slice(i, i + 5).join('　'));
  return lines.join('\n');
}
