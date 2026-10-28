-- Campaign ledger is server-managed. No client can send or mark mail delivered.
create table public.reactivation_campaigns (
  id text primary key,
  segment text not null check (segment in ('A','B','legacy')),
  status text not null default 'draft' check (status in ('draft','validated','paused','completed')),
  subject text not null,
  body text not null,
  landing_url text not null,
  pilot_limit integer not null default 5 check (pilot_limit between 1 and 5),
  created_at timestamptz not null default now()
);
create table public.reactivation_preferences (
  user_id uuid primary key references auth.users(id),
  consent_at timestamptz,
  consent_evidence text,
  unsubscribed_at timestamptz,
  excluded_reason text,
  updated_at timestamptz not null default now(),
  check (consent_at is null or nullif(trim(consent_evidence),'') is not null)
);
create table public.reactivation_contacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null references public.reactivation_campaigns(id),
  user_id uuid not null references auth.users(id),
  channel text not null default 'email' check (channel='email'),
  status text not null check (status in ('reserved','sent','delivered','bounced','failed','unknown')),
  provider_message_id text unique,
  sent_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(campaign_id,user_id)
);
create index reactivation_contacts_user_time on public.reactivation_contacts(user_id,created_at desc);
alter table public.reactivation_campaigns enable row level security;
alter table public.reactivation_preferences enable row level security;
alter table public.reactivation_contacts enable row level security;
revoke all on public.reactivation_campaigns,public.reactivation_preferences,public.reactivation_contacts from anon,authenticated;
grant all on public.reactivation_campaigns,public.reactivation_preferences,public.reactivation_contacts to service_role;

-- Reserve under a user lock before any provider request. Only server workers can
-- call this function. Draft campaigns and missing consent always fail closed.
create or replace function public.reserve_reactivation_contact(p_campaign text,p_user uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare c public.reactivation_campaigns; p public.reactivation_preferences; contact_id uuid;
begin
  select * into c from public.reactivation_campaigns where id=p_campaign for update;
  if c.id is null or c.status <> 'validated' then raise exception 'campaign_not_validated'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
  select * into p from public.reactivation_preferences where user_id=p_user for update;
  if p.consent_at is null or p.unsubscribed_at is not null or p.excluded_reason is not null then raise exception 'recipient_not_eligible'; end if;
  if not exists(select 1 from auth.users u where u.id=p_user and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<now())) then raise exception 'account_not_eligible'; end if;
  if exists(select 1 from public.profiles where id=p_user and (is_admin or is_unlimited_tester)) then raise exception 'internal_account'; end if;
  if exists(select 1 from public.analytics_events where user_id=p_user and event_name in ('app_open','page_viewed','scan_upload_viewed','scan_started','scan_completed') and created_at>now()-interval '14 days') then raise exception 'recently_active'; end if;
  if exists(select 1 from auth.users where id=p_user and last_sign_in_at>now()-interval '14 days') then raise exception 'recently_active'; end if;
  if (c.segment='A' and exists(select 1 from public.scans where user_id=p_user and status='done')) or
     (c.segment='B' and not exists(select 1 from public.scans where user_id=p_user and status='done')) then raise exception 'segment_mismatch'; end if;
  if exists(select 1 from public.reactivation_contacts where user_id=p_user and (created_at>now()-interval '7 days' or sent_at>now()-interval '7 days')) or
     exists(select 1 from public.email_reminders where user_id=p_user and sent_at>now()-interval '7 days') or
     exists(select 1 from public.admin_recovery_actions where target_user_id=p_user and created_at>now()-interval '7 days') then raise exception 'frequency_limit'; end if;
  if (select count(*) from public.reactivation_contacts where campaign_id=p_campaign)>=c.pilot_limit then raise exception 'pilot_limit'; end if;
  insert into public.reactivation_contacts(campaign_id,user_id,status) values(p_campaign,p_user,'reserved') returning id into contact_id;
  return contact_id;
end $$;
revoke all on function public.reserve_reactivation_contact(text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_reactivation_contact(text,uuid) to service_role;

create or replace function public.unsubscribe_reactivation()
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  insert into public.reactivation_preferences(user_id,unsubscribed_at) values(auth.uid(),now())
  on conflict(user_id) do update set unsubscribed_at=now(),updated_at=now();
end $$;
revoke all on function public.unsubscribe_reactivation() from public,anon,authenticated;
grant execute on function public.unsubscribe_reactivation() to authenticated;

create or replace function public.admin_reactivation_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform public._assert_admin_caller();
  with people as (
    select u.id, case when exists(select 1 from public.scans s where s.user_id=u.id and s.status='done') then 'B' else 'A' end segment,
      case when p.excluded_reason is not null then 'excluded'
           when p.unsubscribed_at is not null then 'unsubscribed'
           when coalesce(pr.is_admin,false) or coalesce(pr.is_unlimited_tester,false) then 'internal'
           when u.deleted_at is not null or u.email_confirmed_at is null or u.banned_until>now() then 'account_blocked'
           when u.last_sign_in_at>now()-interval '14 days' or exists(select 1 from public.analytics_events e where e.user_id=u.id and e.event_name in ('app_open','page_viewed','scan_upload_viewed','scan_started','scan_completed') and e.created_at>now()-interval '14 days') then 'active'
           when p.consent_at is null then 'consent_unverified'
           when exists(select 1 from public.reactivation_contacts r where r.user_id=u.id and (r.created_at>now()-interval '7 days' or r.sent_at>now()-interval '7 days')) then 'frequency_limit'
           else 'eligible' end eligibility
    from auth.users u left join public.profiles pr on pr.id=u.id left join public.reactivation_preferences p on p.user_id=u.id
  ), outcomes as (
    select r.*, exists(select 1 from public.analytics_events e where e.user_id=r.user_id and e.event_name in ('app_open','page_viewed','scan_upload_viewed','scan_started','scan_completed') and e.created_at>r.sent_at and e.created_at<=r.sent_at+interval '7 days') or exists(select 1 from auth.users u where u.id=r.user_id and u.last_sign_in_at>r.sent_at and u.last_sign_in_at<=r.sent_at+interval '7 days') returned,
    (select count(*) from public.scans s where s.user_id=r.user_id and s.status='done' and coalesce(s.analyzed_at,s.created_at)>r.sent_at and coalesce(s.analyzed_at,s.created_at)<=r.sent_at+interval '7 days') completed_scans,
    exists(select 1 from public.analytics_events e where e.user_id=r.user_id and e.metadata->>'utm_campaign'=r.campaign_id and e.created_at>r.sent_at and e.created_at<=r.sent_at+interval '7 days') attributed_return
    from public.reactivation_contacts r
  ) select jsonb_build_object(
    'segments',(select coalesce(jsonb_agg(x),'[]') from (select segment,eligibility,count(*) users from people group by 1,2)x),
    'campaigns',(select coalesce(jsonb_agg(x),'[]') from (
      select c.id,c.segment,c.status,c.subject,c.body,c.landing_url,count(o.id) contacts,
      count(o.id) filter(where o.sent_at is not null) sent,
      count(o.id) filter(where o.status='delivered') delivered,
      count(o.id) filter(where o.status='bounced') bounced,
      count(o.id) filter(where o.status='unknown') unknown,
      count(o.id) filter(where o.opened_at is not null) recorded_opens,
      count(o.id) filter(where o.clicked_at is not null) recorded_clicks,
      count(o.id) filter(where o.returned) returned,
      count(o.id) filter(where o.completed_scans>0) scanned_users,
      coalesce(sum(o.completed_scans),0) completed_scans,
      count(o.id) filter(where o.attributed_return) attributed_returns
      from public.reactivation_campaigns c left join outcomes o on o.campaign_id=c.id group by c.id)x),
    'contacts',(select coalesce(jsonb_agg(x),'[]') from (select campaign_id,user_id,channel,status,sent_at,opened_at,clicked_at,returned,completed_scans,attributed_return from outcomes order by sent_at desc nulls last limit 200)x)
  ) into result;
  return result;
end $$;
revoke all on function public.admin_reactivation_overview() from public,anon,authenticated;
grant execute on function public.admin_reactivation_overview() to authenticated;

insert into public.reactivation_campaigns(id,segment,status,subject,body,landing_url) values
('legacy-first-scan','legacy','completed','Recordatorios históricos','Historial conciliado; entrega no implica regreso.','https://auravs.app/aura'),
('aura-return-a-20261028','A','draft','Tu primer Scan te está esperando 👀','Graba o sube un video de hasta 8 segundos y descubre tu Aura. ¿Te animas a probar?','https://auravs.app/aura?utm_source=resend&utm_medium=email&utm_campaign=aura-return-a-20261028'),
('aura-return-b-20261028','B','draft','¿Cuánta Aura tienes hoy? ✨','Vuelve con un nuevo video de hasta 8 segundos, mira tu resultado y desafía a un amigo.','https://auravs.app/aura?utm_source=resend&utm_medium=email&utm_campaign=aura-return-b-20261028');
insert into public.reactivation_contacts(campaign_id,user_id,status,provider_message_id,sent_at,created_at)
select 'legacy-first-scan',user_id,'unknown',provider_message_id,sent_at,created_at from public.email_reminders where status='sent';
