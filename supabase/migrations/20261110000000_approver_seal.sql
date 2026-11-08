-- 承認した人の苗字を提出の行に残す
-- 承認された書類のPDFを出力するとき、「承認」欄（勤務表は「承認印」）にその人の苗字の印鑑を押すため。
-- メンバーはほかの人のプロフィールを読めないので、承認した時点の苗字をここに写しておく
-- （承認したあとで苗字を変えても、承認済みの書類の印鑑は変わらない）

alter table public.monthly_submissions
  add column approver_last_name text not null default '';

-- リーダー・管理者がメンバーの書類を承認する（苗字が未設定の人は、印鑑を作れないため承認できない）
create or replace function public.approve_documents(p_user uuid, p_year integer, p_month integer, p_docs text[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_docs  text[];
  v_last  text;
  v_count integer;
begin
  if v_uid is null or p_user = v_uid then
    raise exception '自分の書類は承認できません';
  end if;
  if not (private.is_manager_of(p_user) or private.is_admin()) then
    raise exception '承認する権限がありません';
  end if;
  v_docs := private.valid_docs(p_docs);

  select trim(last_name) into v_last from public.profiles where user_id = v_uid;
  if coalesce(v_last, '') = '' then
    raise exception 'あなたの苗字が未設定のため承認できません。自分のデータに戻り、「設定」で苗字を入力してください';
  end if;

  update public.monthly_submissions
  set status = 'approved',
      reviewed_by = v_uid,
      reviewed_at = now(),
      review_comment = '',
      approver_signature = coalesce(
        (select signature_manager from public.profiles where user_id = v_uid), ''),
      approver_last_name = v_last
  where user_id = p_user and year = p_year and month = p_month and doc = any(v_docs) and status = 'submitted';
  get diagnostics v_count = row_count;

  if v_count <> cardinality(v_docs) then
    raise exception '提出中ではない書類が含まれています';
  end if;
end;
$$;
