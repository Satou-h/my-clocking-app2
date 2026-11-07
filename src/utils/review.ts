/**
 * review.ts — 上長・管理者が見る「部下の提出」（部下の一覧と提出状況）
 *
 * ・上長は自分の部下、管理者は自分以外の全員が対象（読める範囲はデータベースの RLS でも同じに制限している）
 * ・部下のデータを開いて修正する処理は cloudSync.ts（openMemberData / closeMemberData）
 */
import { supabase } from './supabase';
import { parseSubmission, type Submission } from './submissions';

export interface ReviewMember {
  userId: string;
  employeeId: string;
  lastName: string;
  fullName: string;
  submissions: Submission[];
}

export function memberName(m: Pick<ReviewMember, 'fullName' | 'lastName'>): string {
  return m.fullName.trim() || m.lastName.trim() || '（氏名未設定）';
}

function dbErrorText(e: { message: string; code?: string }): string {
  if (!e.code && /fetch|network|load failed/i.test(e.message)) return 'サーバーに接続できません。通信状態を確認してください';
  return e.message;
}

export async function listReviewMembers(): Promise<ReviewMember[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const me = session?.user.id;
  if (!me) throw new Error('ログインしてください');

  // 自分の行・部下の行（管理者は全員の行）が読める
  const { data: rows, error } = await supabase.from('org_members').select('user_id,role,manager_id');
  if (error) throw new Error(dbErrorText(error));
  const members = (rows ?? []) as { user_id: string; role: string; manager_id: string | null }[];
  const isAdmin = members.some((m) => m.user_id === me && m.role === 'admin');
  const ids = members
    .filter((m) => m.user_id !== me && (isAdmin || m.manager_id === me))
    .map((m) => m.user_id);
  if (ids.length === 0) return [];

  const subQuery = (columns: string) => supabase.from('monthly_submissions').select(columns).in('user_id', ids);
  const base = 'user_id,year,month,doc,status,submitted_at,reviewed_at,review_comment';
  const [profiles, first] = await Promise.all([
    supabase.from('profiles').select('user_id,employee_id,last_name,full_name').in('user_id', ids),
    subQuery(base + ',modified_at,modified_by_name'),
  ]);
  // 修正の記録の列がないデータベースでは、記録なしとして読む
  const subs = first.error?.code === '42703' ? await subQuery(base) : first;
  if (profiles.error) throw new Error(dbErrorText(profiles.error));
  if (subs.error) throw new Error(dbErrorText(subs.error));

  const profileById = new Map(((profiles.data ?? []) as Record<string, string>[]).map((p) => [p.user_id, p]));
  const subRows = (subs.data ?? []) as unknown as Record<string, unknown>[];
  return ids
    .map((id) => {
      const p = profileById.get(id);
      return {
        userId: id,
        employeeId: p?.employee_id ?? '',
        lastName: p?.last_name ?? '',
        fullName: p?.full_name ?? '',
        submissions: subRows
          .filter((r) => r.user_id === id)
          .map(parseSubmission)
          .filter((s): s is Submission => s !== null),
      };
    })
    .sort((a, b) => a.employeeId.localeCompare(b.employeeId, 'ja') || memberName(a).localeCompare(memberName(b), 'ja'));
}
