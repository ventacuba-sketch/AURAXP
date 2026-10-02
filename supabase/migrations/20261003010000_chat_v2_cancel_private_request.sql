alter table public.chat_private_requests
  drop constraint if exists chat_private_requests_status_check;

alter table public.chat_private_requests
  add constraint chat_private_requests_status_check
  check (status = any (array['pending'::text, 'accepted'::text, 'rejected'::text, 'cancelled'::text]));

create or replace function public.cancel_private_chat_request(p_target_username text)
returns table(ok boolean, error_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_target_id uuid;
  v_req public.chat_private_requests%rowtype;
begin
  if v_uid is null then
    return query select false, 'not_authenticated'::text;
    return;
  end if;

  select p.id into v_target_id
  from public.profiles p
  where p.username = p_target_username;

  if v_target_id is null then
    return query select false, 'target_not_found'::text;
    return;
  end if;

  select * into v_req
  from public.chat_private_requests r
  where r.requester_id = v_uid
    and r.recipient_id = v_target_id
    and r.status = 'pending'
  order by r.created_at desc
  limit 1
  for update;

  if not found then
    return query select false, 'not_pending'::text;
    return;
  end if;

  update public.chat_private_requests
  set status = 'cancelled', responded_at = now()
  where id = v_req.id
    and requester_id = v_uid
    and status = 'pending';

  delete from public.notifications
  where user_id = v_target_id
    and kind = 'chat_private_request'
    and rival_user_id = v_uid
    and created_at >= v_req.created_at;

  begin
    insert into public.analytics_events(event_name, user_id, metadata)
    values ('chat_private_request_cancelled', v_uid, jsonb_build_object('target_user_id', v_target_id, 'request_id', v_req.id));
  exception when others then
    null;
  end;

  return query select true, null::text;
end;
$$;

revoke execute on function public.cancel_private_chat_request(text) from public, anon;
grant execute on function public.cancel_private_chat_request(text) to authenticated;
