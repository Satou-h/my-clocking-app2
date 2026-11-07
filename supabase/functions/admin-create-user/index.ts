/**
 * admin-create-user — 管理者が、アプリの「ユーザー管理」画面から社員のアカウントを作る
 *
 * ・アカウントの作成には秘密鍵が必要で、ブラウザでは行えないため、この Edge Function で行う
 * ・呼び出した人が管理者（org_members.role = 'admin'）かどうかをここで確かめる
 *   （新しい形式の API キーではゲートウェイの JWT 確認が使えないため、verify_jwt は false にして自前で確かめる）
 * ・確認メールは送らず、確認済みのアカウントとして作る（管理者が決めた初期パスワードを本人に伝える）
 * ・プロフィールと org_members の行は、データベースのトリガー（private.handle_new_user）が作る
 *   役割と上長は、アプリが作成後に admin_set_member で設定する
 *
 * デプロイ: Supabase の MCP（deploy_edge_function）または supabase functions deploy admin-create-user --no-verify-jwt
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  if (me?.role !== 'admin') return json(403, { error: 'アカウントを作れるのは管理者だけです' });

  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: '送られた内容を読み取れませんでした' });
  }
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!EMAIL_RE.test(email)) return json(400, { error: 'メールアドレスの形式が正しくありません' });
  if (password.length < 6) return json(400, { error: '初期パスワードは6文字以上にしてください' });

  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    if (error.code === 'email_exists' || error.code === 'user_already_exists' || /already/i.test(error.message)) {
      return json(409, { error: 'このメールアドレスはすでに登録されています' });
    }
    if (error.code === 'weak_password') {
      return json(400, { error: '初期パスワードが弱すぎます。英字と数字を混ぜるなどして長めにしてください' });
    }
    return json(500, { error: error.message });
  }
  return json(200, { userId: data.user.id, email });
});
