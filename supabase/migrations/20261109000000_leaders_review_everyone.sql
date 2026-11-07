-- リーダー（role = 'manager'）と管理者は、全員の提出物を確認・承認・差し戻し・修正できるようにする
-- メンバーごとにリーダーを決める設定（org_members.manager_id）は使わない
-- ・権限の判定（RLS の can_view / can_review、approve_documents / reject_documents）はすべて
--   private.is_manager_of を経由しているため、これを「呼び出した人がリーダーか管理者」に変える
-- ・manager_id 列は以前の版のアプリが読むので残すが、admin_set_member で常に空にする

-- 呼び出した人がリーダーか管理者か
create function private.is_reviewer()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.org_members
    where user_id = (select auth.uid()) and role in ('manager', 'admin')
  );
$$;

revoke all on function private.is_reviewer() from public;
grant execute on function private.is_reviewer() to authenticated;

-- target の書類を確認できるか（リーダー・管理者なら組織の誰でも。本人かどうかは呼び出す側で判定する）
-- 名前は以前のまま（RLS と承認・差し戻しの関数がこれを使っている）
create or replace function private.is_manager_of(target uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select private.is_reviewer()
     and exists (select 1 from public.org_members where user_id = target);
$$;

-- リーダーも全員の行を読めるようにする（「メンバーの提出」の一覧を作るため）
alter policy org_members_select on public.org_members
  using ((user_id = (select auth.uid())) or private.is_reviewer());

-- 役割だけを変える（p_manager は以前の版のアプリとの互換のために残し、使わない）
create or replace function public.admin_set_member(p_user uuid, p_role text, p_manager uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception '管理者だけが変更できます' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('member', 'manager', 'admin') then
    raise exception '役割の指定が正しくありません';
  end if;

  -- 同時に変更して管理者がいなくならないよう、先に行をロックする
  perform 1 from public.org_members order by user_id for update;

  if not exists (select 1 from public.org_members where user_id = p_user) then
    raise exception 'メンバーが見つかりません';
  end if;

  if p_role <> 'admin'
     and exists (select 1 from public.org_members where user_id = p_user and role = 'admin')
     and not exists (select 1 from public.org_members where role = 'admin' and user_id <> p_user) then
    raise exception '管理者が1人もいなくなるため変更できません';
  end if;

  update public.org_members set role = p_role, manager_id = null where user_id = p_user;
end;
$$;

-- これまでのリーダーの設定を消す（使わなくなったため）
update public.org_members set manager_id = null where manager_id is not null;
