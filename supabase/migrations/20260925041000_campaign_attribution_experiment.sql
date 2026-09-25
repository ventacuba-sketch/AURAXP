-- Paid acquisition attribution. Visitor id contains no email/IP/device fingerprint.
create table if not exists public.campaign_attributions (
 id uuid primary key default gen_random_uuid(), visitor_id text not null unique,
 user_id uuid references auth.users(id) on delete set null,
 utm_source text,utm_medium text,utm_campaign text,utm_content text,utm_term text,landing_path text,
 first_seen_at timestamptz not null default now(),last_seen_at timestamptz not null default now());
create index if not exists campaign_attributions_user_idx on public.campaign_attributions(user_id);
alter table public.campaign_attributions enable row level security;
create or replace function public.capture_campaign_attribution(p_visitor_id text,p_source text default null,p_medium text default null,p_campaign text default null,p_content text default null,p_term text default null,p_path text default null)
returns void language plpgsql security definer set search_path=public as $$
begin
 if p_visitor_id is null or length(p_visitor_id)<8 or length(p_visitor_id)>200 then return; end if;
 insert into campaign_attributions(visitor_id,user_id,utm_source,utm_medium,utm_campaign,utm_content,utm_term,landing_path)
 values(p_visitor_id,auth.uid(),p_source,p_medium,p_campaign,p_content,p_term,p_path)
 on conflict(visitor_id) do update set user_id=coalesce(campaign_attributions.user_id,auth.uid()),last_seen_at=now();
end; $$;
grant execute on function public.capture_campaign_attribution(text,text,text,text,text,text,text) to anon,authenticated;
create or replace view public.campaign_funnel_summary as
select coalesce(a.utm_source,'(direct)') utm_source,coalesce(a.utm_medium,'(none)') utm_medium,coalesce(a.utm_campaign,'(none)') utm_campaign,coalesce(a.utm_content,'(none)') utm_content,
count(distinct a.visitor_id) visitors,count(distinct a.user_id) attributed_users,
count(distinct case when e.event_name='signup_completed' then e.user_id end) signups,
count(distinct case when e.event_name in ('first_scan_completed','scan_completed') then e.user_id end) scanners,
count(distinct case when e.event_name in ('share','result_shared') then e.user_id end) sharers
from campaign_attributions a left join analytics_events e on e.user_id=a.user_id and e.created_at>=a.first_seen_at group by 1,2,3,4;
revoke all on public.campaign_funnel_summary from anon,authenticated;
