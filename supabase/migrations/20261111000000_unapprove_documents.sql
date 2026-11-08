-- リーダー・管理者が、メンバーの承認済みの書類の承認を取り消す
-- ・取り消すと提出済み（承認前）に戻る。本人は取り下げられ、リーダー・管理者は修正・承認し直せる
-- ・取り消せるのは承認できる人と同じ（リーダー・管理者。自分の書類は対象外）
-- ・承認した人の記録（reviewed_by / reviewed_at / approver_last_name）は消す。
--   リーダー・管理者が修正した記録（modified_*）は、提出し直すまで残す

create function public.unapprove_documents(p_user uuid, p_year integer, p_month integer, p_docs text[])
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
  set status = 'submitted',
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

revoke all on function public.unapprove_documents(uuid, integer, integer, text[]) from public, anon;
grant execute on function public.unapprove_documents(uuid, integer, integer, text[]) to authenticated, service_role;
