import { createClient } from '@supabase/supabase-js';

// 接続先の Supabase プロジェクト（my-clocking-app2）
// publishable key はブラウザに公開する前提のキー。データは RLS により、ログインした本人の分しか読み書きできない
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://snewyhwpobkdsmxxrhnc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_XqWivlv3132Lka_4U_Y6Mw_QmK9lQSi';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // パスワード再設定メールのリンクから戻ってきたときに、そのままログイン状態にする
    detectSessionInUrl: true,
  },
});
