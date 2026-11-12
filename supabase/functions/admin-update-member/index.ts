/**
 * admin-update-member — 管理者が、アプリの「ユーザー管理」画面からメンバーの社員番号・苗字・名前を変える
 *
 * ・社員番号・苗字・名前は管理者が決める（本人の画面では変えられない）。勤務表などの書類の氏名・ファイル名・印鑑に使う
 * ・ほかの人のプロフィールは本人しか書き換えられない（RLS）ため、秘密鍵を使うこの Edge Function で書き換える
 * ・呼び出した人が管理者（org_members.role = 'admin'）かどうかをここで確かめる
 *   （新しい形式の API キーではゲートウェイの JWT 確認が使えないため、verify_jwt は false にして自前で確かめる）
 * ・変えられるのはこのアプリのメンバー（org_members に行がある人）。管理者自身の社員情報もここで変える
 * ・社員番号はほかの人と同じものにはできない（PDF のファイル名に使うため）。空にはできる
 *
 * デプロイ: Supabase の MCP（deploy_edge_function）または supabase functions deploy admin-update-member --no-verify-jwt
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// 新しい形式の秘密鍵（なければ従来の service_role 鍵）
function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    if (typeof keys.default === 'string' && keys.default) return keys.default;
  } catch { /* 従来の鍵を使う */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_MAX = 20;
const EMPLOYEE_ID_MAX = 20;

// 前後の空白を除き、間の空白は1つにまとめる
const cleanName = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
// 社員番号は空白を含めない
const cleanEmployeeId = (v: unknown) => String(v ?? '').replace(/\s+/g, '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'POST で呼び出してください' });

  const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', secretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 呼び出した人を確かめる
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'ログインが必要です' });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return json(401, { error: 'ログインの有効期限が切れました。ログインし直してください' });
  }
  const { data: me, error: meError } = await admin
    .from('org_members').select('role').eq('user_id', userData.user.id).maybeSingle();
  if (meError) return json(500, { error: meError.message });
  if (me?.role !== 'admin') return json(403, { error: '社員情報を変えられるのは管理者だけです' });

  let body: { userId?: unknown; employeeId?: unknown; lastName?: unknown; firstName?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: '送られた内容を読み取れませんでした' });
  }
  const userId = String(body.userId ?? '').trim();
  const employeeId = cleanEmployeeId(body.employeeId);
  const lastName = cleanName(body.lastName);
  const firstName = cleanName(body.firstName);
  if (!UUID_RE.test(userId)) return json(400, { error: '相手のアカウントを特定できませんでした' });
  if (!lastName) return json(400, { error: '苗字を入力してください' });
  if (lastName.length > NAME_MAX || firstName.length > NAME_MAX) {
    return json(400, { error: `苗字・名前はそれぞれ${NAME_MAX}文字以内にしてください` });
  }
  if (employeeId.length > EMPLOYEE_ID_MAX) {
    return json(400, { error: `社員番号は${EMPLOYEE_ID_MAX}文字以内にしてください` });
  }

  // このアプリのメンバーかどうか
  const { data: target, error: targetError } = await admin
    .from('org_members').select('user_id').eq('user_id', userId).maybeSingle();
  if (targetError) return json(500, { error: targetError.message });
  if (!target) return json(404, { error: 'このアカウントは見つかりません。一覧を読み直してください' });

  // 社員番号がほかの人と重ならないか
  if (employeeId) {
    const { data: same, error: sameError } = await admin
      .from('profiles').select('full_name,last_name').eq('employee_id', employeeId).neq('user_id', userId).limit(1);
    if (sameError) return json(500, { error: sameError.message });
    if (same && same.length > 0) {
      const who = String(same[0].full_name ?? '').trim() || String(same[0].last_name ?? '').trim() || 'ほかの人';
      return json(409, { error: `社員番号「${employeeId}」はすでに${who}さんが使っています` });
    }
  }

  // 氏名は苗字と名前を全角スペースで区切る（アカウント作成のときと同じ形）
  const fullName = firstName ? lastName + String.fromCharCode(0x3000) + firstName : lastName;
  const { data: rows, error } = await admin
    .from('profiles')
    .update({ employee_id: employeeId, last_name: lastName, full_name: fullName })
    .eq('user_id', userId)
    .select('user_id');
  if (error) return json(500, { error: error.message });
  if (!rows?.length) return json(404, { error: 'このアカウントのプロフィールが見つかりません' });
  return json(200, { userId, employeeId, lastName, fullName });
});
