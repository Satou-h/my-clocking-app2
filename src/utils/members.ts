/**
 * members.ts — 管理者のユーザー管理（アカウントの作成・役割と上長の設定）
 *
 * ・一覧の取得と役割・上長の変更は、データベースの関数（admin_list_members / admin_set_member）で行う
 * ・アカウントの作成は秘密鍵が必要なため、Edge Function（supabase/functions/admin-create-user）で行う
 * ・どれも管理者かどうかをデータベース・Edge Function の側で確かめる（画面で隠すだけに頼らない）
 */
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type MemberRole = 'member' | 'manager' | 'admin';

export const ROLE_LABELS: Record<MemberRole, string> = { member: '一般', manager: 'リーダー', admin: '管理者' };
export const ROLES: MemberRole[] = ['member', 'manager', 'admin'];

export interface Member {
  userId: string;
  email: string;
  role: MemberRole;
  managerId: string | null;
  employeeId: string;
  lastName: string;
  fullName: string;
  lastSignInAt: string | null;
}

// 上長に選べるのは、役割が上長か管理者の人
export function canBeManager(role: MemberRole): boolean {
  return role === 'manager' || role === 'admin';
}

const asRole = (v: unknown): MemberRole => (v === 'manager' || v === 'admin' ? v : 'member');

function dbErrorText(e: { message: string; code?: string }): string {
  if (!e.code && /fetch|network|load failed/i.test(e.message)) return 'サーバーに接続できません。通信状態を確認してください';
  return e.message;
}

// ログイン中の人の役割（わからないときは null）
export async function fetchMyRole(): Promise<MemberRole | null> {
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user.id;
  if (!uid) return null;
  const { data, error } = await supabase.from('org_members').select('role').eq('user_id', uid).maybeSingle();
  if (error || !data) return null;
  return asRole(data.role);
}

export async function listMembers(): Promise<Member[]> {
  const { data, error } = await supabase.rpc('admin_list_members');
  if (error) throw new Error(dbErrorText(error));
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    userId: String(r.user_id),
    email: String(r.email ?? ''),
    role: asRole(r.role),
    managerId: typeof r.manager_id === 'string' ? r.manager_id : null,
    employeeId: String(r.employee_id ?? ''),
    lastName: String(r.last_name ?? ''),
    fullName: String(r.full_name ?? ''),
    lastSignInAt: typeof r.last_sign_in_at === 'string' ? r.last_sign_in_at : null,
  }));
}

export async function setMember(userId: string, role: MemberRole, managerId: string | null): Promise<void> {
  const { error } = await supabase.rpc('admin_set_member', { p_user: userId, p_role: role, p_manager: managerId });
  if (error) throw new Error(dbErrorText(error));
}

// 苗字と名前の区切り（全角スペース。本人が入力している氏名の形に合わせる）
const NAME_SEPARATOR = String.fromCharCode(0x3000);

// 苗字と名前から氏名を作る（Edge Function と同じ形）
export function joinFullName(lastName: string, firstName: string): string {
  const l = lastName.trim(), f = firstName.trim();
  return f ? l + NAME_SEPARATOR + f : l;
}

// アカウントを作る（確認メールは送らない）。作ったユーザーの ID を返す
// 苗字・名前は本人のプロフィール（設定の「苗字」・書類の氏名）に入る。印鑑も苗字から作られる
export async function createAccount(email: string, password: string, lastName: string, firstName: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('admin-create-user', {
    body: { email, password, lastName: lastName.trim(), firstName: firstName.trim() },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      let message: string | null = null;
      try {
        const body = await (error.context as Response).json();
        if (body && typeof body.error === 'string') message = body.error;
      } catch { /* 本文が読めないときは下の説明を使う */ }
      throw new Error(message ?? 'アカウントを作れませんでした');
    }
    if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
      throw new Error('サーバーに接続できません。通信状態を確認してください');
    }
    throw new Error(error.message);
  }
  const userId = (data as { userId?: unknown } | null)?.userId;
  if (typeof userId !== 'string') throw new Error('アカウントを作れませんでした');
  return userId;
}

// 初期パスワードを作る（読み間違えやすい 0/O・1/l/I などは使わない）
export function generatePassword(length = 10): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}
