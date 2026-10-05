-- AURA LIVE: notify followers when a host goes live.
-- Reuses the existing notifications -> pg_net -> send-push pipeline.

alter table public.notifications
  add column if not exists live_room_id uuid references public.live_rooms(id) on delete set null;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind = any (array[
    'challenge_accepted','challenge_completed','challenge_received','challenge_rejected',
    'referral_activated','new_follower','gift_received','chat_private_request',
    'chat_private_request_accepted','chat_private_message','live_started'
  ]::text[]));

create unique index if not exists notifications_live_started_once_idx
  on public.notifications(user_id, live_room_id)
  where kind='live_started';

create or replace function public.start_live_room(p_room_id uuid)
returns table(ok boolean,error_code text)
language plpgsql security definer set search_path=''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_room public.live_rooms%rowtype;
begin
  if v_uid is null then return query select false,'not_authenticated'; return; end if;
  select * into v_room from public.live_rooms where id=p_room_id for update;
  if not found then return query select false,'not_found'; return; end if;
  if v_room.host_user_id<>v_uid then return query select false,'not_authorized'; return; end if;
  if v_room.status='live' then return query select true,null::text; return; end if;
  if v_room.status<>'preparing' then return query select false,'invalid_state'; return; end if;

  update public.live_rooms set status='live',started_at=now() where id=p_room_id;

  insert into public.notifications(user_id,kind,rival_user_id,live_room_id)
  select f.follower_id,'live_started',v_uid,p_room_id
  from public.follows f
  where f.followee_id=v_uid and f.follower_id<>v_uid
  on conflict (user_id,live_room_id) where kind='live_started' do nothing;

  begin
    insert into public.analytics_events(event_name,user_id,metadata)
    values('live_started',v_uid,jsonb_build_object('live_room_id',p_room_id));
  exception when others then null;
  end;
  return query select true,null::text;
end;
$function$;
