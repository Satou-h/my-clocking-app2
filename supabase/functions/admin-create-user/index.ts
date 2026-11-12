/**
 * admin-create-user — 管理者が、アプリの「ユーザー管理」画面から社員のアカウントを作る
 *
 * ・アカウントの作成には秘密鍵が必要で、ブラウザでは行えないため、この Edge Function で行う
 * ・呼び出した人が管理者（org_members.role = 'admin'）かどうかをここで確かめる
 *   （新しい形式の API キーではゲートウェイの JWT 確認が使えないため、verify_jwt は false にして自前で確かめる）
 * ・確認メールは送らず、確認済みのアカウントとして作る（管理者が決めた初期パスワードを本人に伝える）
 * ・プロフィールと org_members の行は、データベースのトリガー（private.handle_new_user）が作る
 *   社員番号・苗字・名前が送られていれば、作ったあとプロフィールの社員番号（employee_id）・苗字（last_name）・
 *   氏名（full_name）に入れる（勤務表などの書類の氏名・ファイル名に使い、印鑑も苗字から作られる。
 *   本人は変えられず、あとから変えるときは管理者が admin-update-member で変える）
 *   社員番号はほかの人と同じものにはできない（PDF のファイル名に使うため）
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
  if (me?.role !== 'admin') return json(403, { error: 'アカウントを作れるのは管理者だけです' });

  let body: { email?: unknown; password?: unknown; lastName?: unknown; firstName?: unknown; employeeId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: '送られた内容を読み取れませんでした' });
  }
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  // 社員番号・苗字・名前は省略できる（以前の版のアプリからの呼び出しには含まれない）
  const lastName = cleanName(body.lastName);
  const firstName = cleanName(body.firstName);
  const employeeId = cleanEmployeeId(body.employeeId);
  if (!EMAIL_RE.test(email)) return json(400, { error: 'メールアドレスの形式が正しくありません' });
  if (password.length < 6) return json(400, { error: '初期パスワードは6文字以上にしてください' });
  if (firstName && !lastName) return json(400, { error: '苗字を入力してください' });
  if (lastName.length > NAME_MAX || firstName.length > NAME_MAX) {
    return json(400, { error: `苗字・名前はそれぞれ${NAME_MAX}文字以内にしてください` });
  }
  if (employeeId.length > EMPLOYEE_ID_MAX) {
    return json(400, { error: `社員番号は${EMPLOYEE_ID_MAX}文字以内にしてください` });
  }

  // 社員番号がほかの人と重ならないか
  if (employeeId) {
    const { data: same, error: sameError } = await admin
      .from('profiles').select('full_name,last_name').eq('employee_id', employeeId).limit(1);
    if (sameError) return json(500, { error: sameError.message });
    if (same && same.length > 0) {
      const who = String(same[0].full_name ?? '').trim() || String(same[0].last_name ?? '').trim() || 'ほかの人';
      return json(409, { error: `社員番号「${employeeId}」はすでに${who}さんが使っています` });
    }
  }

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
  const userId = data.user.id;

  if (lastName || employeeId) {
    const values: Record<string, string> = {};
    if (employeeId) values.employee_id = employeeId;
    if (lastName) {
      // 氏名は苗字と名前を全角スペースで区切る
      values.last_name = lastName;
      values.full_name = firstName ? lastName + String.fromCharCode(0x3000) + firstName : lastName;
    }
    const { data: rows, error: profileError } = await admin
      .from('profiles').update(values).eq('user_id', userId).select('user_id');
    if (profileError || !rows?.length) {
      // 社員番号・苗字・氏名が入っていないアカウントを残さない（作り直せるように消す）
      await admin.auth.admin.deleteUser(userId);
      const reason = profileError?.message ?? 'プロフィールが見つかりません';
      return json(500, { error: `社員番号・苗字・氏名を保存できなかったため、アカウントを作りませんでした（${reason}）` });
    }
  }
  return json(200, { userId, email });
});
