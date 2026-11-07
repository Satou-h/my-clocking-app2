-- 提出を「月ごと」から「月×書類ごと」にする（ダウンロードと同じく、書類を選んで提出する）
-- 提出済み（submitted）・承認済み（approved）の書類は、その月の元データを変更できない
-- ※ monthly_submissions が空のときに実行する（doc 列を NOT NULL で追加するため）

alter table public.monthly_submissions add column doc text not null;
alter table public.monthly_submissions add constraint monthly_submissions_doc_check
  check (doc in ('attendance', 'transport', 'leave', 'lateEarly', 'workReport', 'skillSheet', 'workHistory'));
alter table public.monthly_submissions drop constraint monthly_submissions_pkey;
alter table public.monthly_submissions add primary key (user_id, year, month, doc);

-- ── 書類が変更できるか ──────────────────────────────────────────────

create function private.doc_is_open(target uuid, y integer, m integer, d text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.monthly_submissions s
    where s.user_id = target and s.year = y and s.month = m and s.doc = d
      and s.status in ('submitted', 'approved')
  );
$$;

create function private.doc_date_is_open(target uuid, dt date, d text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.doc_is_open(target, extract(year from dt)::integer, extract(month from dt)::integer, d);
$$;

-- 休暇申請書は1件に複数の取得日（月をまたぐこともある）があるため、どれか1日でも提出済みの月なら変更できない
create function private.leave_is_open(target uuid, entries jsonb)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from jsonb_array_elements(case when jsonb_typeof(entries) = 'array' then entries else '[]'::jsonb end) as e(value)
    join public.monthly_submissions s
      on s.user_id = target and s.doc = 'leave' and s.status in ('submitted', 'approved')
     and s.year = case when (e.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' then substr(e.value ->> 'date', 1, 4)::integer end
     and s.month = case when (e.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' then substr(e.value ->> 'date', 6, 2)::integer end
  );
$$;

revoke all on function private.doc_is_open(uuid, integer, integer, text) from public;
revoke all on function private.doc_date_is_open(uuid, date, text) from public;
revoke all on function private.leave_is_open(uuid, jsonb) from public;
grant execute on function private.doc_is_open(uuid, integer, integer, text) to authenticated;
grant execute on function private.doc_date_is_open(uuid, date, text) to authenticated;
grant execute on function private.leave_is_open(uuid, jsonb) to authenticated;

-- ── 行の書き込み制限を書類単位にする ──────────────────────────────────

alter policy attendance_insert on public.attendance_records
  with check ((user_id = (select auth.uid())) and private.doc_date_is_open(user_id, work_date, 'attendance'));
alter policy attendance_update on public.attendance_records
  using ((user_id = (select auth.uid())) and private.doc_date_is_open(user_id, work_date, 'attendance'))
  with check ((user_id = (select auth.uid())) and private.doc_date_is_open(user_id, work_date, 'attendance'));
alter policy attendance_delete on public.attendance_records
  using ((user_id = (select auth.uid())) and private.doc_date_is_open(user_id, work_date, 'attendance'));

-- 月初の有給残日数は勤務表に載るため、勤務表と一緒に締める
alter policy paid_leave_insert on public.paid_leave_settings
  with check ((user_id = (select auth.uid())) and private.doc_is_open(user_id, year, month, 'attendance'));
alter policy paid_leave_update on public.paid_leave_settings
  using ((user_id = (select auth.uid())) and private.doc_is_open(user_id, year, month, 'attendance'))
  with check ((user_id = (select auth.uid())) and private.doc_is_open(user_id, year, month, 'attendance'));
alter policy paid_leave_delete on public.paid_leave_settings
  using ((user_id = (select auth.uid())) and private.doc_is_open(user_id, year, month, 'attendance'));

alter policy transport_insert on public.transport_records
  with check ((user_id = (select auth.uid())) and private.doc_date_is_open(user_id, trip_date, 'transport'));
alter policy transport_update on public.transport_records
  using ((user_id = (select auth.uid())) and private.doc_date_is_open(user_id, trip_date, 'transport'))
  with check ((user_id = (select auth.uid())) and private.doc_date_is_open(user_id, trip_date, 'transport'));
alter policy transport_delete on public.transport_records
  using ((user_id = (select auth.uid())) and private.doc_date_is_open(user_id, trip_date, 'transport'));

alter policy late_early_insert on public.late_early_applications
  with check ((user_id = (select auth.uid())) and private.doc_date_is_open(user_id, target_date, 'lateEarly'));
alter policy late_early_update on public.late_early_applications
  using ((user_id = (select auth.uid())) and private.doc_date_is_open(user_id, target_date, 'lateEarly'))
  with check ((user_id = (select auth.uid())) and private.doc_date_is_open(user_id, target_date, 'lateEarly'));
alter policy late_early_delete on public.late_early_applications
  using ((user_id = (select auth.uid())) and private.doc_date_is_open(user_id, target_date, 'lateEarly'));

alter policy leave_insert on public.leave_applications
  with check ((user_id = (select auth.uid())) and private.leave_is_open(user_id, date_entries));
alter policy leave_update on public.leave_applications
  using ((user_id = (select auth.uid())) and private.leave_is_open(user_id, date_entries))
  with check ((user_id = (select auth.uid())) and private.leave_is_open(user_id, date_entries));
alter policy leave_delete on public.leave_applications
  using ((user_id = (select auth.uid())) and private.leave_is_open(user_id, date_entries));

alter policy work_reports_insert on public.work_reports
  with check ((user_id = (select auth.uid())) and private.doc_is_open(user_id, year, month, 'workReport'));
alter policy work_reports_update on public.work_reports
  using ((user_id = (select auth.uid())) and private.doc_is_open(user_id, year, month, 'workReport'))
  with check ((user_id = (select auth.uid())) and private.doc_is_open(user_id, year, month, 'workReport'));
alter policy work_reports_delete on public.work_reports
  using ((user_id = (select auth.uid())) and private.doc_is_open(user_id, year, month, 'workReport'));

-- ── 月単位の関数を書類単位の関数に置き換える ──────────────────────────

drop function public.submit_month(integer, integer);
drop function public.withdraw_month(integer, integer);
drop function public.approve_month(uuid, integer, integer);
drop function public.reject_month(uuid, integer, integer, text);
drop function private.date_is_open(uuid, date);
drop function private.month_is_open(uuid, integer, integer);

-- 書類の指定を確かめ、重複を除いて返す
create function private.valid_docs(p_docs text[])
returns text[]
language plpgsql immutable
set search_path = ''
as $$
declare
  v_docs text[];
begin
  select array_agg(distinct d) into v_docs from unnest(coalesce(p_docs, '{}')) as d;
  if v_docs is null then
    raise exception '書類を選んでください';
  end if;
  if exists (
    select 1 from unnest(v_docs) as d
    where d is null or d not in ('attendance', 'transport', 'leave', 'lateEarly', 'workReport', 'skillSheet', 'workHistory')
  ) then
    raise exception '書類の指定が正しくありません';
  end if;
  return v_docs;
end;
$$;

revoke all on function private.valid_docs(text[]) from public;
grant execute on function private.valid_docs(text[]) to authenticated;

-- 自分の書類を提出する（提出済み・承認済みの書類が含まれていたら、どれも提出しない）
create function public.submit_documents(p_year integer, p_month integer, p_docs text[])
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
      and status in ('submitted', 'approved')
  ) then
    raise exception 'すでに提出済みの書類が含まれています';
  end if;

  insert into public.monthly_submissions (user_id, year, month, doc, status, submitted_at)
  select v_uid, p_year, p_month, d, 'submitted', now() from unnest(v_docs) as d
  on conflict (user_id, year, month, doc) do update
    set status = 'submitted', submitted_at = now(),
        reviewed_by = null, reviewed_at = null,
        review_comment = '', approver_signature = '';
end;
$$;

-- 自分の提出を取り下げる（承認前の書類だけ。取り下げると、また変更できる）
create function public.withdraw_documents(p_year integer, p_month integer, p_docs text[])
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
    raise exception '取り下げできない書類が含まれています（承認済みの書類と、提出していない書類は取り下げできません）';
  end if;
end;
$$;

-- 上長・管理者が部下の書類を承認する（承認する画面は未作成）
create function public.approve_documents(p_user uuid, p_year integer, p_month integer, p_docs text[])
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
    raise exception '自分の書類は承認できません';
  end if;
  if not (private.is_manager_of(p_user) or private.is_admin()) then
    raise exception '承認する権限がありません';
  end if;
  v_docs := private.valid_docs(p_docs);

  update public.monthly_submissions
  set status = 'approved',
      reviewed_by = v_uid,
      reviewed_at = now(),
      review_comment = '',
      approver_signature = coalesce(
        (select signature_manager from public.profiles where user_id = v_uid), '')
  where user_id = p_user and year = p_year and month = p_month and doc = any(v_docs) and status = 'submitted';
  get diagnostics v_count = row_count;

  if v_count <> cardinality(v_docs) then
    raise exception '提出中ではない書類が含まれています';
  end if;
end;
$$;

-- 上長・管理者が部下の書類を差し戻す（理由は必須。差し戻した書類はまた変更できる。画面は未作成）
create function public.reject_documents(p_user uuid, p_year integer, p_month integer, p_docs text[], p_comment text)
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
    raise exception '自分の書類は差し戻しできません';
  end if;
  if not (private.is_manager_of(p_user) or private.is_admin()) then
    raise exception '差し戻す権限がありません';
  end if;
  if coalesce(trim(p_comment), '') = '' then
    raise exception '差し戻しの理由を入力してください';
  end if;
  v_docs := private.valid_docs(p_docs);

  update public.monthly_submissions
  set status = 'rejected',
      reviewed_by = v_uid,
      reviewed_at = now(),
      review_comment = p_comment,
      approver_signature = ''
  where user_id = p_user and year = p_year and month = p_month and doc = any(v_docs) and status = 'submitted';
  get diagnostics v_count = row_count;

  if v_count <> cardinality(v_docs) then
    raise exception '提出中ではない書類が含まれています';
  end if;
end;
$$;

revoke all on function public.submit_documents(integer, integer, text[]) from public, anon;
revoke all on function public.withdraw_documents(integer, integer, text[]) from public, anon;
revoke all on function public.approve_documents(uuid, integer, integer, text[]) from public, anon;
revoke all on function public.reject_documents(uuid, integer, integer, text[], text) from public, anon;
grant execute on function public.submit_documents(integer, integer, text[]) to authenticated, service_role;
grant execute on function public.withdraw_documents(integer, integer, text[]) to authenticated, service_role;
grant execute on function public.approve_documents(uuid, integer, integer, text[]) to authenticated, service_role;
grant execute on function public.reject_documents(uuid, integer, integer, text[], text) to authenticated, service_role;
