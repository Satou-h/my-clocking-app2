-- 印鑑の文字を保存していない人は、提出・確認・承認できないようにする
-- ・提出（submit_documents）: 本人の profiles.seal_text が空なら提出できない
-- ・確認・承認（confirm_documents / approve_documents）: 確認・承認する人の seal_text が空ならできない
--   （確認・承認すると、その人の印鑑が書類に押されるため）
-- ・取り下げ・確認や承認の取り消しは今までどおり（印鑑は押さないので止めない）
-- ・提出し直したときは、前の確認・承認で残した印鑑の文字（confirmer_seal_text / approver_seal_text）も消す
-- ・以前の版のアプリから提出しようとしても、ここで止まって理由が表示される

create or replace function public.submit_documents(p_year integer, p_month integer, p_docs text[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_docs text[];
begin
  if v_uid is null then
    raise exception 'ログインが必要です';
  end if;
  if p_year is null or p_month is null or p_year not between 2000 and 2100 or p_month not between 1 and 12 then
    raise exception '年月の指定が正しくありません';
  end if;
  v_docs := private.valid_docs(p_docs);

  if coalesce((select trim(seal_text) from public.profiles where user_id = v_uid), '') = '' then
    raise exception '印鑑が設定されていないため提出できません。「印鑑」の画面で印鑑の文字を保存してから、もう一度お試しください';
  end if;

  perform 1 from public.monthly_submissions
  where user_id = v_uid and year = p_year and month = p_month and doc = any(v_docs)
  for update;

  if exists (
    select 1 from public.monthly_submissions
    where user_id = v_uid and year = p_year and month = p_month and doc = any(v_docs)
      and status in ('submitted', 'confirmed', 'approved')
  ) then
    raise exception 'すでに提出済みの書類が含まれています';
  end if;

  insert into public.monthly_submissions (user_id, year, month, doc, status, submitted_at)
  select v_uid, p_year, p_month, d, 'submitted', now() from unnest(v_docs) as d
  on conflict (user_id, year, month, doc) do update
    set status = 'submitted', submitted_at = now(),
        reviewed_by = null, reviewed_at = null,
        review_comment = '', approver_signature = '', approver_last_name = '', approver_seal_text = '',
        confirmed_by = null, confirmed_at = null, confirmer_last_name = '', confirmer_seal_text = '',
        modified_by = null, modified_by_name = '', modified_at = null;
end;
$$;

-- リーダー・管理者がメンバーの提出済みの書類を確認する（苗字・印鑑の文字が未設定の人は確認できない）
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
  if coalesce(v_seal, '') = '' then
    raise exception 'あなたの印鑑が設定されていないため確認できません。自分のデータに戻り、「印鑑」の画面で印鑑の文字を保存してください';
  end if;

  update public.monthly_submissions
  set status = 'confirmed',
      confirmed_by = v_uid,
      confirmed_at = now(),
      confirmer_last_name = v_last,
      confirmer_seal_text = v_seal
  where user_id = p_user and year = p_year and month = p_month and doc = any(v_docs) and status = 'submitted';
  get diagnostics v_count = row_count;

  if v_count <> cardinality(v_docs) then
    raise exception '提出済み（確認前）ではない書類が含まれています';
  end if;
end;
$$;

-- リーダー・管理者がメンバーの確認済みの書類を承認する（苗字・印鑑の文字が未設定の人は承認できない）
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
  if coalesce(v_seal, '') = '' then
    raise exception 'あなたの印鑑が設定されていないため承認できません。自分のデータに戻り、「印鑑」の画面で印鑑の文字を保存してください';
  end if;

  update public.monthly_submissions
  set status = 'approved',
      reviewed_by = v_uid,
      reviewed_at = now(),
      review_comment = '',
      approver_signature = coalesce(
        (select signature_manager from public.profiles where user_id = v_uid), ''),
      approver_last_name = v_last,
      approver_seal_text = v_seal
  where user_id = p_user and year = p_year and month = p_month and doc = any(v_docs) and status = 'confirmed';
  get diagnostics v_count = row_count;

  if v_count <> cardinality(v_docs) then
    raise exception '確認済みではない書類が含まれています（承認できるのは確認済みの書類だけです）';
  end if;
end;
$$;

revoke all on function public.submit_documents(integer, integer, text[]) from public, anon;
revoke all on function public.confirm_documents(uuid, integer, integer, text[]) from public, anon;
revoke all on function public.approve_documents(uuid, integer, integer, text[]) from public, anon;
grant execute on function public.submit_documents(integer, integer, text[]) to authenticated, service_role;
grant execute on function public.confirm_documents(uuid, integer, integer, text[]) to authenticated, service_role;
grant execute on function public.approve_documents(uuid, integer, integer, text[]) to authenticated, service_role;
