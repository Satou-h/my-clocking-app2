/**
 * admin-set-password — 管理者が、アプリの「ユーザー管理」画面からほかの人のパスワードを変える
 *
 * ・他人のパスワードの変更には秘密鍵が必要で、ブラウザでは行えないため、この Edge Function で行う
 * ・呼び出した人が管理者（org_members.role = 'admin'）かどうかをここで確かめる
 *   （新しい形式の API キーではゲートウェイの JWT 確認が使えないため、verify_jwt は false にして自前で確かめる）
 * ・変えられるのはこのアプリのメンバー（org_members に行がある人）のうち、自分以外の人だけ
 *   （自分のパスワードは設定画面の「パスワードを変更」で変える）
 * ・本人に確認メールなどは送らない。管理者が新しいパスワードを本人に伝える
 *
 * デプロイ: Supabase の MCP（deploy_edge_function）または supabase functions deploy admin-set-password --no-verify-jwt
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
  const myId = userData.user.id;
  const { data: me, error: meError } = await admin
    .from('org_members').select('role').eq('user_id', myId).maybeSingle();
  if (meError) return json(500, { error: meError.message });
  if (me?.role !== 'admin') return json(403, { error: 'ほかの人のパスワードを変えられるのは管理者だけです' });

  let body: { userId?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: '送られた内容を読み取れませんでした' });
  }
  const userId = String(body.userId ?? '').trim();
  const password = String(body.password ?? '');
  if (!UUID_RE.test(userId)) return json(400, { error: '相手のアカウントを特定できませんでした' });
  if (userId === myId) return json(400, { error: '自分のパスワードは設定画面の「パスワードを変更」で変えてください' });
  if (password.length < 6) return json(400, { error: '新しいパスワードは6文字以上にしてください' });

  // このアプリのメンバーかどうか
  const { data: target, error: targetError } = await admin
    .from('org_members').select('user_id').eq('user_id', userId).maybeSingle();
  if (targetError) return json(500, { error: targetError.message });
  if (!target) return json(404, { error: 'このアカウントは見つかりません。一覧を読み直してください' });

  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) {
    if (error.code === 'user_not_found') {
      return json(404, { error: 'このアカウントは見つかりません。一覧を読み直してください' });
    }
    if (error.code === 'weak_password') {
      return json(400, { error: '新しいパスワードが弱すぎます。英字と数字を混ぜるなどして長めにしてください' });
    }
    return json(500, { error: error.message });
  }
  return json(200, { userId });
});
