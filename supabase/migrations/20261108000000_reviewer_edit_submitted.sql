-- 上長・管理者が、部下の提出済み（承認前）の書類を修正できるようにする
-- ・上長は自分の部下、管理者は自分以外の全員が対象（自分の書類は今までどおり取り下げてから直す）
-- ・修正できるのは提出済み（submitted）の書類だけ。未提出・差し戻し・承認済みの書類は修正できない
--   （本人は提出済みの書類を変更できないため、本人と上長が同時に同じデータを直すことはない）
-- ・上長・管理者が修正したら、その書類の提出の行に修正した人と日時を記録する（本人の提出画面に表示する）

alter table public.monthly_submissions
  add column modified_by uuid references auth.users(id) on delete set null,
  add column modified_by_name text not null default '',
  add column modified_at timestamptz;

-- ── 上長・管理者として修正できるか ──────────────────────────────────────

-- 部下（管理者は自分以外の全員）のデータか
create function private.can_review(target uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select target <> (select auth.uid()) and (private.is_manager_of(target) or private.is_admin());
$$;

create function private.doc_is_reviewable(target uuid, y integer, m integer, d text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.can_review(target) and exists (
    select 1 from public.monthly_submissions s
    where s.user_id = target and s.year = y and s.month = m and s.doc = d and s.status = 'submitted'
  );
$$;

create function private.doc_date_is_reviewable(target uuid, dt date, d text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.doc_is_reviewable(target, extract(year from dt)::integer, extract(month from dt)::integer, d);
$$;

-- 休暇申請書（取得日が月をまたぐことがある）: 提出済みの月の日を含み、承認済みの月の日を含まないもの
create function private.leave_is_reviewable(target uuid, entries jsonb)
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
        on s.user_id = target and s.doc = 'leave' and s.year = months.y and s.month = months.m and s.status = 'approved'
    );
$$;

-- スキル表（月ごとのデータではない）: スキルシートかスキル一覧が提出済みのもの
create function private.skill_is_reviewable(target uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.can_review(target) and exists (
    select 1 from public.monthly_submissions s
    where s.user_id = target and s.doc in ('skillSheet', 'workHistory') and s.status = 'submitted'
  );
$$;

revoke all on function private.can_review(uuid) from public;
revoke all on function private.doc_is_reviewable(uuid, integer, integer, text) from public;
revoke all on function private.doc_date_is_reviewable(uuid, date, text) from public;
revoke all on function private.leave_is_reviewable(uuid, jsonb) from public;
revoke all on function private.skill_is_reviewable(uuid) from public;
grant execute on function private.can_review(uuid) to authenticated;
grant execute on function private.doc_is_reviewable(uuid, integer, integer, text) to authenticated;
grant execute on function private.doc_date_is_reviewable(uuid, date, text) to authenticated;
grant execute on function private.leave_is_reviewable(uuid, jsonb) to authenticated;
grant execute on function private.skill_is_reviewable(uuid) to authenticated;

-- ── 上長・管理者の書き込みを許可する（本人用のポリシーとは別に追加する。どちらかを満たせば書ける） ──

create policy attendance_insert_reviewer on public.attendance_records for insert to authenticated
  with check (private.doc_date_is_reviewable(user_id, work_date, 'attendance'));
create policy attendance_update_reviewer on public.attendance_records for update to authenticated
  using (private.doc_date_is_reviewable(user_id, work_date, 'attendance'))
  with check (private.doc_date_is_reviewable(user_id, work_date, 'attendance'));
create policy attendance_delete_reviewer on public.attendance_records for delete to authenticated
  using (private.doc_date_is_reviewable(user_id, work_date, 'attendance'));

create policy paid_leave_insert_reviewer on public.paid_leave_settings for insert to authenticated
  with check (private.doc_is_reviewable(user_id, year, month, 'attendance'));
create policy paid_leave_update_reviewer on public.paid_leave_settings for update to authenticated
  using (private.doc_is_reviewable(user_id, year, month, 'attendance'))
  with check (private.doc_is_reviewable(user_id, year, month, 'attendance'));
create policy paid_leave_delete_reviewer on public.paid_leave_settings for delete to authenticated
  using (private.doc_is_reviewable(user_id, year, month, 'attendance'));

create policy transport_insert_reviewer on public.transport_records for insert to authenticated
  with check (private.doc_date_is_reviewable(user_id, trip_date, 'transport'));
create policy transport_update_reviewer on public.transport_records for update to authenticated
  using (private.doc_date_is_reviewable(user_id, trip_date, 'transport'))
  with check (private.doc_date_is_reviewable(user_id, trip_date, 'transport'));
create policy transport_delete_reviewer on public.transport_records for delete to authenticated
  using (private.doc_date_is_reviewable(user_id, trip_date, 'transport'));

create policy late_early_insert_reviewer on public.late_early_applications for insert to authenticated
  with check (private.doc_date_is_reviewable(user_id, target_date, 'lateEarly'));
create policy late_early_update_reviewer on public.late_early_applications for update to authenticated
  using (private.doc_date_is_reviewable(user_id, target_date, 'lateEarly'))
  with check (private.doc_date_is_reviewable(user_id, target_date, 'lateEarly'));
create policy late_early_delete_reviewer on public.late_early_applications for delete to authenticated
  using (private.doc_date_is_reviewable(user_id, target_date, 'lateEarly'));

create policy leave_insert_reviewer on public.leave_applications for insert to authenticated
  with check (private.leave_is_reviewable(user_id, date_entries));
create policy leave_update_reviewer on public.leave_applications for update to authenticated
  using (private.leave_is_reviewable(user_id, date_entries))
  with check (private.leave_is_reviewable(user_id, date_entries));
create policy leave_delete_reviewer on public.leave_applications for delete to authenticated
  using (private.leave_is_reviewable(user_id, date_entries));

create policy work_reports_insert_reviewer on public.work_reports for insert to authenticated
  with check (private.doc_is_reviewable(user_id, year, month, 'workReport'));
create policy work_reports_update_reviewer on public.work_reports for update to authenticated
  using (private.doc_is_reviewable(user_id, year, month, 'workReport'))
  with check (private.doc_is_reviewable(user_id, year, month, 'workReport'));
create policy work_reports_delete_reviewer on public.work_reports for delete to authenticated
  using (private.doc_is_reviewable(user_id, year, month, 'workReport'));

create policy skill_sheets_insert_reviewer on public.skill_sheets for insert to authenticated
  with check (private.skill_is_reviewable(user_id));
create policy skill_sheets_update_reviewer on public.skill_sheets for update to authenticated
  using (private.skill_is_reviewable(user_id))
  with check (private.skill_is_reviewable(user_id));

-- ── 上長・管理者が修正したことを記録する ────────────────────────────────

-- 行が含まれる書類と年月（書き込み制限と同じ対応）
create function private.row_periods(tbl text, r jsonb)
returns table (doc text, y integer, m integer)
language sql immutable
set search_path = ''
as $$
  select 'attendance', substr(r ->> 'work_date', 1, 4)::integer, substr(r ->> 'work_date', 6, 2)::integer
  where tbl = 'attendance_records' and r ? 'work_date'
  union all
  select 'attendance', (r ->> 'year')::integer, (r ->> 'month')::integer
  where tbl = 'paid_leave_settings' and r ? 'year'
  union all
  select 'transport', substr(r ->> 'trip_date', 1, 4)::integer, substr(r ->> 'trip_date', 6, 2)::integer
  where tbl = 'transport_records' and r ? 'trip_date'
  union all
  select 'lateEarly', substr(r ->> 'target_date', 1, 4)::integer, substr(r ->> 'target_date', 6, 2)::integer
  where tbl = 'late_early_applications' and r ? 'target_date'
  union all
  select 'workReport', (r ->> 'year')::integer, (r ->> 'month')::integer
  where tbl = 'work_reports' and r ? 'year'
  union all
  select 'leave',
    case when (e.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' then substr(e.value ->> 'date', 1, 4)::integer end,
    case when (e.value ->> 'date') ~ '^\d{4}-\d{2}-\d{2}$' then substr(e.value ->> 'date', 6, 2)::integer end
  from jsonb_array_elements(
    case when tbl = 'leave_applications' and jsonb_typeof(r -> 'date_entries') = 'array' then r -> 'date_entries' else '[]'::jsonb end
  ) as e(value);
$$;

revoke all on function private.row_periods(text, jsonb) from public;

create function private.record_review_edit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_target uuid;
  v_name   text;
  v_old    jsonb;
  v_new    jsonb;
begin
  if TG_OP = 'DELETE' then
    v_target := OLD.user_id;
  else
    v_target := NEW.user_id;
  end if;
  -- 本人の保存や、ログインしていない処理（管理用の操作）は記録しない
  if v_uid is null or v_target is null or v_uid = v_target then
    return null;
  end if;

  select coalesce(nullif(trim(full_name), ''), nullif(trim(last_name), ''), '') into v_name
  from public.profiles where user_id = v_uid;

  if TG_TABLE_NAME = 'skill_sheets' then
    update public.monthly_submissions
    set modified_by = v_uid, modified_by_name = coalesce(v_name, ''), modified_at = now()
    where user_id = v_target and doc in ('skillSheet', 'workHistory') and status = 'submitted';
    return null;
  end if;

  if TG_OP <> 'INSERT' then v_old := to_jsonb(OLD); end if;
  if TG_OP <> 'DELETE' then v_new := to_jsonb(NEW); end if;

  update public.monthly_submissions s
  set modified_by = v_uid, modified_by_name = coalesce(v_name, ''), modified_at = now()
  from (
    select * from private.row_periods(TG_TABLE_NAME, v_old)
    union
    select * from private.row_periods(TG_TABLE_NAME, v_new)
  ) as p
  where s.user_id = v_target and s.doc = p.doc and s.year = p.y and s.month = p.m and s.status = 'submitted';
  return null;
end;
$$;

revoke all on function private.record_review_edit() from public;

create trigger record_review_edit after insert or update or delete on public.attendance_records
  for each row execute function private.record_review_edit();
create trigger record_review_edit after insert or update or delete on public.paid_leave_settings
  for each row execute function private.record_review_edit();
create trigger record_review_edit after insert or update or delete on public.transport_records
  for each row execute function private.record_review_edit();
create trigger record_review_edit after insert or update or delete on public.late_early_applications
  for each row execute function private.record_review_edit();
create trigger record_review_edit after insert or update or delete on public.leave_applications
  for each row execute function private.record_review_edit();
create trigger record_review_edit after insert or update or delete on public.work_reports
  for each row execute function private.record_review_edit();
create trigger record_review_edit after insert or update or delete on public.skill_sheets
  for each row execute function private.record_review_edit();

-- ── 出し直したら、修正の記録も消す ─────────────────────────────────────

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
      and status in ('submitted', 'approved')
  ) then
    raise exception 'すでに提出済みの書類が含まれています';
  end if;

  insert into public.monthly_submissions (user_id, year, month, doc, status, submitted_at)
  select v_uid, p_year, p_month, d, 'submitted', now() from unnest(v_docs) as d
  on conflict (user_id, year, month, doc) do update
    set status = 'submitted', submitted_at = now(),
        reviewed_by = null, reviewed_at = null,
        review_comment = '', approver_signature = '',
        modified_by = null, modified_by_name = '', modified_at = null;
end;
$$;
