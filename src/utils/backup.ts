/**
 * backup.ts — 全データバックアップ / リストア
 *
 * 全LocalStorageデータをBase64エンコードされたJSONテキストとして
 * エクスポート / インポートします。
 */

// 固定キー（storage.ts で管理しているもの）
const STATIC_KEYS = [
  'clocking_records',
  'clocking_paid_leave',
  'clocking_work_settings',
  'clocking_transport',
  'clocking_user_profile',
  'clocking_skill_entries',
  'clocking_skill_profile',
  'clocking_certifications',
  'clocking_work_history',
  'clocking_leave_applications',
  'clocking_late_early_applications',
  'clocking_leave_app_settings',
] as const;

// 動的キーのプレフィックス（作業報告: clocking_work_report_YYYY_MM など）
const DYNAMIC_PREFIX = 'clocking_work_report_';

/** バックアップの内容サマリー（インポート前の確認表示用） */
export interface BackupSummary {
  attendance: number;
  transport: number;
  paidLeave: number;
  skillEntries: number;
  certifications: number;
  leaveApps: number;
  lateEarlyApps: number;
  workReportMonths: number;
  hasWorkSettings: boolean;
  hasProfile: boolean;
  hasSkillProfile: boolean;
  hasLeaveAppSettings: boolean;
  timestamp: number;
}

// ── 内部ヘルパー ──────────────────────────────────────────────────────────────

function safeParseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

function arrayLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

function base64Encode(json: string): string {
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function base64Decode(b64: string): string {
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ── 公開 API ────────────────────────────────────────────────────────────────

/**
 * 現在の localStorage の全データをバックアップコード（Base64文字列）として返す。
 */
export function exportFullBackup(): string {
  const data: Record<string, unknown> = { v: 3, ts: Date.now() };

  // 固定キー
  for (const key of STATIC_KEYS) {
    const raw = localStorage.getItem(key);
    if (raw !== null) data[key] = safeParseJson(raw);
  }

  // 動的キー（作業報告）
  const dynamic: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(DYNAMIC_PREFIX)) {
      dynamic[key] = safeParseJson(localStorage.getItem(key));
    }
  }
  data._dynamic = dynamic;

  return base64Encode(JSON.stringify(data));
}

/**
 * バックアップコードから全データを localStorage に復元する。
 */
export function importFullBackup(base64: string): { success: boolean; error?: string } {
  try {
    const json = base64Decode(base64);
    const data = JSON.parse(json) as Record<string, unknown>;

    if (![1, 2, 3].includes(data.v as number)) {
      return { success: false, error: `バックアップのバージョン (${data.v}) が不正です` };
    }

    // 固定キーを復元
    for (const key of STATIC_KEYS) {
      if (key in data && data[key] !== undefined && data[key] !== null) {
        localStorage.setItem(key, JSON.stringify(data[key]));
      }
    }

    // 動的キーを復元
    const dynamic = (data._dynamic ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(dynamic)) {
      if (key.startsWith(DYNAMIC_PREFIX)) {
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: 'バックアップの解析に失敗しました: ' + String(e) };
  }
}

/**
 * バックアップコードの内容を読み取り、サマリーを返す。
 * コードが不正な場合は null を返す。
 */
export function parseBackupSummary(base64: string): BackupSummary | null {
  try {
    const json = base64Decode(base64);
    const data = JSON.parse(json) as Record<string, unknown>;

    if (![1, 2, 3].includes(data.v as number)) return null;

    const dynamic = (data._dynamic ?? {}) as Record<string, unknown>;
    const workReportMonths = Object.keys(dynamic).filter(
      k => k.startsWith(DYNAMIC_PREFIX) && !k.startsWith(`${DYNAMIC_PREFIX}summary_`),
    ).length;

    return {
      attendance:          arrayLen(data.clocking_records),
      transport:           arrayLen(data.clocking_transport),
      paidLeave:           arrayLen(data.clocking_paid_leave),
      skillEntries:        arrayLen(data.clocking_skill_entries),
      certifications:      arrayLen(data.clocking_certifications),
      leaveApps:           arrayLen(data.clocking_leave_applications),
      lateEarlyApps:       arrayLen(data.clocking_late_early_applications),
      workReportMonths,
      hasWorkSettings:     !!data.clocking_work_settings,
      hasProfile:          !!data.clocking_user_profile,
      hasSkillProfile:     !!data.clocking_skill_profile,
      hasLeaveAppSettings: !!data.clocking_leave_app_settings,
      timestamp:           typeof data.ts === 'number' ? data.ts : 0,
    };
  } catch {
    return null;
  }
}
