-- 承認の前に「確認」を入れる（提出済み → 確認済み → 承認済み）
-- ・リーダー・管理者が提出済みの書類を確認すると「確認済み」になる。承認できるのは確認済みの書類だけ
-- ・確認済みの書類は、承認済みと同じく本人もリーダー・管理者も変更できない（本人の取り下げもできない）。
--   直すときは、リーダー・管理者が「確認を取り消す」と提出済みに戻る
-- ・確認と承認は同じ人がしてもよい（自分の書類は確認できない）
-- ・確認した時点の苗字を残し、PDFの確認の欄（勤務表: 確認印 / 休暇・遅刻早退申請書: 確認 / 交通費精算書: 検印）に
--   その苗字の印鑑を押す（苗字が未設定の人は確認できない）
-- ・承認を取り消すと確認済みに戻る（この変更より前に承認された、確認の記録がない書類は提出済みに戻る）

alter table public.monthly_submissions drop constraint monthly_submissions_status_check;
alter table public.monthly_submissions add constraint monthly_submissions_status_check
  check (status in ('submitted', 'confirmed', 'approved', 'rejected'));

alter table public.monthly_submissions
  add column confirmed_by uuid references auth.users(id) on delete set null,
  add column confirmed_at timestamptz,
  add column confirmer_last_name text not null default '';

-- ── 確認済みの書類も、提出済み・承認済みと同じく変更できない ─────────────────

create or replace function private.doc_is_open(target uuid, y integer, m integer, d text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.monthly_submissions s
    where s.user_id = target and s.year = y and s.month = m and s.doc = d
      and s.status in ('submitted', 'confirmed', 'approved')
  );
$$;

create or replace function private.leave_is_open(target uuid, entries jsonb)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(entries) = 'array' then entries else '[]'::jsonb end) as e(value)
    join public.monthly_submissions s
      on s.user_id = target and s.doc = 'leave' and s.status in ('submitted', 'confirmed', 'approved')
     and s.year = case when (e.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' then substr(e.value ->> 'date', 1, 4)::integer end
     and s.month = case when (e.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' then substr(e.value ->> 'date', 6, 2)::integer end
  );
$$;

-- 上長・管理者が修正できる休暇申請書: 提出済みの月の日を含み、確認済み・承認済みの月の日を含まないもの
-- （月ごとの書類は doc_is_reviewable が提出済み（submitted）だけを修正できるとしているので、確認済みは修正できない）
create or replace function private.leave_is_reviewable(target uuid, entries jsonb)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  with months as (
    select distinct
      case when (e.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' then substr(e.value ->> 'date', 1, 4)::integer end as y,
      case when (e.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' then substr(e.value ->> 'date', 6, 2)::integer end as m
    from jsonb_array_elements(case when jsonb_typeof(entries) = 'array' then entries else '[]'::jsonb end) as e(value)
  )
  select private.can_review(target)
    and exists (
      select 1 from months join public.monthly_submissions s
        on s.user_id = target and s.doc = 'leave' and s.year = months.y and s.month = months.m and s.status = 'submitted'
    )
    and not exists (
      select 1 from months join public.monthly_submissions s
        on s.user_id = target and s.doc = 'leave' and s.year = months.y and s.month = months.m
       and s.status in ('confirmed', 'approved')
    );
$$;

-- ── 提出・取り下げ ──────────────────────────────────────────────────────

-- 自分の書類を提出する（提出済み・確認済み・承認済みの書類が含まれていたら、どれも提出しない）
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
        review_comment = '', approver_signature = '', approver_last_name = '',
        confirmed_by = null, confirmed_at = null, confirmer_last_name = '',
        modified_by = null, modified_by_name = '', modified_at = null;
end;
$$;

-- 自分の提出を取り下げる（確認前の書類だけ。取り下げると、また変更できる）
create or replace function public.withdraw_documents(p_year integer, p_month integer, p_docs text[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_docs  text[];
  v_count integer;
begin
  if v_uid is null then
    raise exception 'ログインが必要です';
  end if;
  v_docs := private.valid_docs(p_docs);

  delete from public.monthly_submissions
  where user_id = v_uid and year = p_year and month = p_month and doc = any(v_docs) and status = 'submitted';
  get diagnostics v_count = row_count;

  if v_count <> cardinality(v_docs) then
    raise exception '取り下げできない書類が含まれています（確認済み・承認済みの書類と、提出していない書類は取り下げできません）';
  end if;
end;
$$;

-- ── 確認・確認の取り消し ────────────────────────────────────────────────

-- リーダー・管理者がメンバーの提出済みの書類を確認する（苗字が未設定の人は、印鑑を作れないため確認できない）
create function public.confirm_documents(p_user uuid, p_year integer, p_month integer, p_docs text[])
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
    raise exception '自分の書類は確認できません';
  end if;
  if not (private.is_manager_of(p_user) or private.is_admin()) then
    raise exception '確認する権限がありません';
  end if;
  v_docs := private.valid_docs(p_docs);

  select trim(last_name) into v_last from public.profiles where user_id = v_uid;
  if coalesce(v_last, '') = '' then
    raise exception 'あなたの苗字が未設定のため確認できません。自分のデータに戻り、「設定」で苗字を入力してください';
  end if;

  update public.monthly_submissions
  set status = 'confirmed',
      confirmed_by = v_uid,
      confirmed_at = now(),
      confirmer_last_name = v_last
  where user_id = p_user and year = p_year and month = p_month and doc = any(v_docs) and status = 'submitted';
  get diagnostics v_count = row_count;

  if v_count <> cardinality(v_docs) then
    raise exception '提出済み（確認前）ではない書類が含まれています';
  end if;
end;
$$;

-- リーダー・管理者が、メンバーの確認済みの書類の確認を取り消す（提出済みに戻る。承認済みの書類は先に承認を取り消す）
-- リーダー・管理者が修正した記録（modified_*）は、提出し直すまで残す
create function public.unconfirm_documents(p_user uuid, p_year integer, p_month integer, p_docs text[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_docs  text[];
  v_count integer;
begin
  if v_uid is null or p_user = v_uid then
    raise exception '自分の書類の確認は取り消せません';
  end if;
  if not (private.is_manager_of(p_user) or private.is_admin()) then
    raise exception '確認を取り消す権限がありません';
  end if;
  v_docs := private.valid_docs(p_docs);

  update public.monthly_submissions
  set status = 'submitted',
      confirmed_by = null,
      confirmed_at = null,
      confirmer_last_name = ''
  where user_id = p_user and year = p_year and month = p_month and doc = any(v_docs) and status = 'confirmed';
  get diagnostics v_count = row_count;

  if v_count <> cardinality(v_docs) then
    raise exception '確認済み（承認前）ではない書類が含まれています';
  end if;
end;
$$;

revoke all on function public.confirm_documents(uuid, integer, integer, text[]) from public, anon;
revoke all on function public.unconfirm_documents(uuid, integer, integer, text[]) from public, anon;
grant execute on function public.confirm_documents(uuid, integer, integer, text[]) to authenticated, service_role;
grant execute on function public.unconfirm_documents(uuid, integer, integer, text[]) to authenticated, service_role;

-- ── 承認・承認の取り消し ────────────────────────────────────────────────

-- リーダー・管理者がメンバーの確認済みの書類を承認する（苗字が未設定の人は、印鑑を作れないため承認できない）
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
  where user_id = p_user and year = p_year and month = p_month and doc = any(v_docs) and status = 'confirmed';
  get diagnostics v_count = row_count;

  if v_count <> cardinality(v_docs) then
    raise exception '確認済みではない書類が含まれています（承認できるのは確認済みの書類だけです）';
  end if;
end;
$$;

-- リーダー・管理者が、メンバーの承認済みの書類の承認を取り消す（確認済みに戻る。確認の記録がなければ提出済みに戻る）
create or replace function public.unapprove_documents(p_user uuid, p_year integer, p_month integer, p_docs text[])
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_docs  text[];
  v_count integer;
begin
  if v_uid is null or p_user = v_uid then
    raise exception '自分の書類の承認は取り消せません';
  end if;
  if not (private.is_manager_of(p_user) or private.is_admin()) then
    raise exception '承認を取り消す権限がありません';
  end if;
  v_docs := private.valid_docs(p_docs);

  update public.monthly_submissions
  set status = case when confirmed_at is not null then 'confirmed' else 'submitted' end,
      reviewed_by = null,
      reviewed_at = null,
      review_comment = '',
      approver_signature = '',
      approver_last_name = ''
  where user_id = p_user and year = p_year and month = p_month and doc = any(v_docs) and status = 'approved';
  get diagnostics v_count = row_count;

  if v_count <> cardinality(v_docs) then
    raise exception '承認済みではない書類が含まれています';
  end if;
end;
$$;
