-- 印鑑に入れる文字を本人が決められるようにする
-- ・profiles.seal_text: 本人が「印鑑」の画面で決める印鑑の文字（6文字まで）。空なら今までどおり苗字（last_name）の印鑑
-- ・monthly_submissions.confirmer_seal_text / approver_seal_text: 確認・承認した時点の、その人の印鑑の文字
--   メンバーはほかの人のプロフィールを読めないので、確認・承認した時点の文字をここに写しておく
--   （あとで印鑑の文字を変えても、確認済み・承認済みの書類の印鑑は変わらない）
-- ・confirm_documents / approve_documents を置き換え、上の2列も書き込む。
--   苗字の列（confirmer_last_name / approver_last_name）は今までどおり苗字を残す（画面の「〇〇さんが確認」に使う）
-- ・この変更より前に確認・承認された書類は文字の列が空になり、アプリは苗字の印鑑を押す
-- ・以前の版のアプリはこれらの列を読まないので、この SQL を先に当てても以前の版はそのまま動く（印鑑は苗字のまま）

alter table public.profiles
  add column if not exists seal_text text not null default '';
alter table public.profiles drop constraint if exists profiles_seal_text_length;
alter table public.profiles
  add constraint profiles_seal_text_length check (char_length(seal_text) <= 6);

alter table public.monthly_submissions
  add column if not exists confirmer_seal_text text not null default '',
  add column if not exists approver_seal_text text not null default '';

-- リーダー・管理者がメンバーの提出済みの書類を確認する（苗字が未設定の人は確認できない）
create or replace function public.confirm_documents(p_user uuid, p_year integer, p_month integer, p_docs text[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_docs  text[];
  v_last  text;
  v_seal  text;
  v_count integer;
begin
  if v_uid is null or p_user = v_uid then
    raise exception '自分の書類は確認できません';
  end if;
  if not (private.is_manager_of(p_user) or private.is_admin()) then
    raise exception '確認する権限がありません';
  end if;
  v_docs := private.valid_docs(p_docs);

  select trim(last_name), trim(seal_text) into v_last, v_seal from public.profiles where user_id = v_uid;
  if coalesce(v_last, '') = '' then
    raise exception 'あなたの苗字が未設定のため確認できません。管理者に「ユーザー管理」で苗字を設定してもらってください';
  end if;

  update public.monthly_submissions
  set status = 'confirmed',
      confirmed_by = v_uid,
      confirmed_at = now(),
      confirmer_last_name = v_last,
      confirmer_seal_text = coalesce(nullif(v_seal, ''), v_last)
  where user_id = p_user and year = p_year and month = p_month and doc = any(v_docs) and status = 'submitted';
  get diagnostics v_count = row_count;

  if v_count <> cardinality(v_docs) then
    raise exception '提出済み（確認前）ではない書類が含まれています';
  end if;
end;
$$;

-- リーダー・管理者がメンバーの確認済みの書類を承認する（苗字が未設定の人は承認できない）
create or replace function public.approve_documents(p_user uuid, p_year integer, p_month integer, p_docs text[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_docs  text[];
  v_last  text;
  v_seal  text;
  v_count integer;
begin
  if v_uid is null or p_user = v_uid then
    raise exception '自分の書類は承認できません';
  end if;
  if not (private.is_manager_of(p_user) or private.is_admin()) then
    raise exception '承認する権限がありません';
  end if;
  v_docs := private.valid_docs(p_docs);

  select trim(last_name), trim(seal_text) into v_last, v_seal from public.profiles where user_id = v_uid;
  if coalesce(v_last, '') = '' then
    raise exception 'あなたの苗字が未設定のため承認できません。管理者に「ユーザー管理」で苗字を設定してもらってください';
  end if;

  update public.monthly_submissions
  set status = 'approved',
      reviewed_by = v_uid,
      reviewed_at = now(),
      review_comment = '',
      approver_signature = coalesce(
        (select signature_manager from public.profiles where user_id = v_uid), ''),
      approver_last_name = v_last,
      approver_seal_text = coalesce(nullif(v_seal, ''), v_last)
  where user_id = p_user and year = p_year and month = p_month and doc = any(v_docs) and status = 'confirmed';
  get diagnostics v_count = row_count;

  if v_count <> cardinality(v_docs) then
    raise exception '確認済みではない書類が含まれています（承認できるのは確認済みの書類だけです）';
  end if;
end;
$$;

revoke all on function public.confirm_documents(uuid, integer, integer, text[]) from public, anon;
revoke all on function public.approve_documents(uuid, integer, integer, text[]) from public, anon;
grant execute on function public.confirm_documents(uuid, integer, integer, text[]) to authenticated, service_role;
grant execute on function public.approve_documents(uuid, integer, integer, text[]) to authenticated, service_role;
