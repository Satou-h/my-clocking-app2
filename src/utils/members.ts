/**
 * members.ts — 管理者のユーザー管理（アカウントの作成・役割の設定・パスワードの変更）
 *
 * ・リーダー・管理者は全員の提出物を確認できるため、メンバーごとのリーダーは設定しない
 * ・一覧の取得と役割の変更は、データベースの関数（admin_list_members / admin_set_member）で行う
 * ・アカウントの作成とほかの人のパスワードの変更は秘密鍵が必要なため、
 *   Edge Function（supabase/functions/admin-create-user / admin-set-password）で行う
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
  employeeId: string;
  lastName: string;
  fullName: string;
  lastSignInAt: string | null;
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
    employeeId: String(r.employee_id ?? ''),
    lastName: String(r.last_name ?? ''),
    fullName: String(r.full_name ?? ''),
    lastSignInAt: typeof r.last_sign_in_at === 'string' ? r.last_sign_in_at : null,
  }));
}

// 役割を変える（p_manager はデータベースの関数の互換のために残っている引数で、使われない）
export async function setRole(userId: string, role: MemberRole): Promise<void> {
  const { error } = await supabase.rpc('admin_set_member', { p_user: userId, p_role: role, p_manager: null });
  if (error) throw new Error(dbErrorText(error));
}

// 苗字と名前の区切り（全角スペース。本人が入力している氏名の形に合わせる）
const NAME_SEPARATOR = String.fromCharCode(0x3000);

// 苗字と名前から氏名を作る（Edge Function と同じ形）
export function joinFullName(lastName: string, firstName: string): string {
  const l = lastName.trim(), f = firstName.trim();
  return f ? l + NAME_SEPARATOR + f : l;
}

// Edge Function を呼び、失敗したら関数が返した説明（なければ fallback）で例外にする
async function invokeAdminFunction(name: string, body: Record<string, unknown>, fallback: string): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      let message: string | null = null;
      try {
        const res = await (error.context as Response).json();
        if (res && typeof res.error === 'string') message = res.error;
      } catch { /* 本文が読めないときは fallback を使う */ }
      throw new Error(message ?? fallback);
    }
    if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
      throw new Error('サーバーに接続できません。通信状態を確認してください');
    }
    throw new Error(error.message);
  }
  return data;
}

// アカウントを作る（確認メールは送らない）。作ったユーザーの ID を返す
// 苗字・名前は本人のプロフィール（設定の「苗字」・書類の氏名）に入る。印鑑も苗字から作られる
export async function createAccount(email: string, password: string, lastName: string, firstName: string): Promise<string> {
  const data = await invokeAdminFunction(
    'admin-create-user',
    { email, password, lastName: lastName.trim(), firstName: firstName.trim() },
    'アカウントを作れませんでした',
  );
  const userId = (data as { userId?: unknown } | null)?.userId;
  if (typeof userId !== 'string') throw new Error('アカウントを作れませんでした');
  return userId;
}

// ほかの人のパスワードを変える（Edge Function admin-set-password。自分のパスワードは設定画面で変える）
export async function setMemberPassword(userId: string, password: string): Promise<void> {
  await invokeAdminFunction('admin-set-password', { userId, password }, 'パスワードを変えられませんでした');
}

// 初期パスワードを作る（読み間違えやすい 0/O・1/l/I などは使わない）
export function generatePassword(length = 10): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}
