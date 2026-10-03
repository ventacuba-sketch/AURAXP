-- Admin-only aggregate analytics for Sala del Aura / Chat V2.
-- No email, message body or private conversation content is returned.

create or replace function public.get_admin_chat_dashboard(
  p_start timestamptz,
  p_end timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_admin boolean;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not_authorized'; end if;
  select p.is_admin into v_is_admin from public.profiles p where p.id = v_uid;
  if v_is_admin is not true then raise exception 'not_authorized'; end if;
  if p_start is null or p_end is null or p_end <= p_start then raise exception 'invalid_range'; end if;

  with
  e as (
    select ae.event_name, ae.user_id, ae.created_at, ae.metadata
    from public.analytics_events ae
    where ae.created_at >= p_start and ae.created_at < p_end and ae.event_name like 'chat_%'
  ),
  event_kpis as (
    select
      count(*) filter (where event_name = 'chat_viewed') as chat_views,
      count(distinct metadata ->> 'visitor_id') filter (where event_name = 'chat_viewed' and metadata ->> 'visitor_id' is not null) as unique_chat_visitors,
      count(distinct user_id) filter (where event_name = 'chat_viewed' and user_id is not null) as registered_chat_viewers,
      count(*) filter (where event_name = 'chat_guest_created') as guest_created,
      count(*) filter (where event_name = 'chat_signup_prompted') as signup_prompted,
      count(distinct metadata ->> 'visitor_id') filter (where event_name = 'chat_signup_started' and metadata ->> 'visitor_id' is not null) as signup_started_visitors,
      count(distinct metadata ->> 'visitor_id') filter (where event_name = 'chat_signup_completed' and metadata ->> 'visitor_id' is not null) as signup_completed_visitors,
      count(distinct metadata ->> 'visitor_id') filter (where event_name = 'chat_first_scan_completed' and metadata ->> 'visitor_id' is not null) as first_scan_visitors,
      count(*) filter (where event_name = 'chat_scan_cta_clicked') as scan_cta_clicks,
      count(*) filter (where event_name = 'chat_invite_clicked') as invite_clicks,
      count(*) filter (where event_name = 'chat_members_opened') as members_opens,
      count(*) filter (where event_name in ('chat_profile_opened','chat_member_profile_opened')) as profile_opens,
      count(*) filter (where event_name = 'chat_follow_clicked') as follow_clicks,
      count(*) filter (where event_name = 'chat_private_inbox_opened') as private_inbox_opens,
      count(*) filter (where event_name = 'chat_private_conversation_opened') as private_conversation_opens
    from e
  ),
  returners as (
    select count(*) as returning_chat_visitors
    from (
      select metadata ->> 'visitor_id' as visitor_id
      from e
      where event_name = 'chat_viewed' and metadata ->> 'visitor_id' is not null
      group by metadata ->> 'visitor_id'
      having count(distinct (created_at at time zone 'America/Santiago')::date) >= 2
    ) x
  ),
  global_messages as (
    select
      count(*) as global_messages,
      count(distinct case when cm.user_id is not null then 'u:' || cm.user_id::text when cm.guest_id is not null then 'g:' || cm.guest_id else null end) as global_unique_senders,
      count(distinct cm.user_id) filter (where cm.user_id is not null) as registered_global_senders,
      count(distinct cm.guest_id) filter (where cm.guest_id is not null) as guest_global_senders,
      count(*) filter (where cm.hidden_at is not null) as hidden_global_messages,
      round(avg(char_length(cm.body))::numeric, 1) as avg_global_message_length
    from public.chat_messages cm
    where cm.created_at >= p_start and cm.created_at < p_end
  ),
  global_reactions as (
    select count(*) as reactions,
      count(distinct case when cr.user_id is not null then 'u:' || cr.user_id::text when cr.guest_id is not null then 'g:' || cr.guest_id else null end) as unique_reactors
    from public.chat_reactions cr
    where cr.created_at >= p_start and cr.created_at < p_end
  ),
  rewards as (
    select count(*) as guest_rewards_issued,
      count(*) filter (where cgr.claimed_at is not null) as guest_rewards_claimed,
      coalesce(sum(cgr.amount),0) as guest_reward_coins_issued,
      coalesce(sum(cgr.amount) filter (where cgr.claimed_at is not null),0) as guest_reward_coins_claimed
    from public.chat_guest_rewards cgr
    where cgr.created_at >= p_start and cgr.created_at < p_end
  ),
  private_requests as (
    select count(*) as private_requests,
      count(*) filter (where cpr.status='accepted') as private_requests_accepted,
      count(*) filter (where cpr.status='rejected') as private_requests_rejected,
      count(*) filter (where cpr.status='cancelled') as private_requests_cancelled,
      count(*) filter (where cpr.status='pending') as private_requests_pending
    from public.chat_private_requests cpr
    where cpr.created_at >= p_start and cpr.created_at < p_end
  ),
  private_conversations as (
    select count(*) as private_conversations_created
    from public.chat_private_conversations cpc
    where cpc.created_at >= p_start and cpc.created_at < p_end
  ),
  private_messages as (
    select count(*) as private_messages,
      count(distinct cpm.sender_id) as private_unique_senders,
      count(distinct cpm.conversation_id) as private_active_conversations,
      count(*) filter (where cpm.hidden_at is not null) as hidden_private_messages,
      round(avg(char_length(cpm.body))::numeric,1) as avg_private_message_length
    from public.chat_private_messages cpm
    where cpm.created_at >= p_start and cpm.created_at < p_end
  ),
  blocks as (
    select count(*) as blocks from public.chat_blocks cb where cb.created_at >= p_start and cb.created_at < p_end
  ),
  daily as (
    select d.day,
      coalesce(ev.views,0) as views,
      coalesce(ev.unique_visitors,0) as unique_visitors,
      coalesce(gm.global_messages,0) as global_messages,
      coalesce(pm.private_messages,0) as private_messages,
      coalesce(gr.reactions,0) as reactions,
      coalesce(ev.signup_completions,0) as signup_completions,
      coalesce(ev.first_scans,0) as first_scans,
      coalesce(pr.private_requests,0) as private_requests
    from generate_series(
      date_trunc('day', p_start at time zone 'America/Santiago'),
      date_trunc('day', (p_end - interval '1 microsecond') at time zone 'America/Santiago'),
      interval '1 day'
    ) d(day)
    left join lateral (
      select count(*) filter (where ae.event_name='chat_viewed') as views,
        count(distinct ae.metadata ->> 'visitor_id') filter (where ae.event_name='chat_viewed' and ae.metadata ->> 'visitor_id' is not null) as unique_visitors,
        count(*) filter (where ae.event_name='chat_signup_completed') as signup_completions,
        count(*) filter (where ae.event_name='chat_first_scan_completed') as first_scans
      from public.analytics_events ae
      where ae.created_at >= (d.day at time zone 'America/Santiago')
        and ae.created_at < ((d.day + interval '1 day') at time zone 'America/Santiago')
        and ae.event_name like 'chat_%'
    ) ev on true
    left join lateral (select count(*) as global_messages from public.chat_messages cm where cm.created_at >= (d.day at time zone 'America/Santiago') and cm.created_at < ((d.day + interval '1 day') at time zone 'America/Santiago')) gm on true
    left join lateral (select count(*) as private_messages from public.chat_private_messages cpm where cpm.created_at >= (d.day at time zone 'America/Santiago') and cpm.created_at < ((d.day + interval '1 day') at time zone 'America/Santiago')) pm on true
    left join lateral (select count(*) as reactions from public.chat_reactions cr where cr.created_at >= (d.day at time zone 'America/Santiago') and cr.created_at < ((d.day + interval '1 day') at time zone 'America/Santiago')) gr on true
    left join lateral (select count(*) as private_requests from public.chat_private_requests cpr where cpr.created_at >= (d.day at time zone 'America/Santiago') and cpr.created_at < ((d.day + interval '1 day') at time zone 'America/Santiago')) pr on true
    order by d.day
  ),
  hourly as (
    select h.hour, coalesce(gm.global_messages,0) as global_messages, coalesce(pm.private_messages,0) as private_messages, coalesce(ev.views,0) as views
    from generate_series(0,23) h(hour)
    left join (select extract(hour from cm.created_at at time zone 'America/Santiago')::int as hour, count(*) as global_messages from public.chat_messages cm where cm.created_at >= p_start and cm.created_at < p_end group by 1) gm on gm.hour=h.hour
    left join (select extract(hour from cpm.created_at at time zone 'America/Santiago')::int as hour, count(*) as private_messages from public.chat_private_messages cpm where cpm.created_at >= p_start and cpm.created_at < p_end group by 1) pm on pm.hour=h.hour
    left join (select extract(hour from ae.created_at at time zone 'America/Santiago')::int as hour, count(*) as views from public.analytics_events ae where ae.created_at >= p_start and ae.created_at < p_end and ae.event_name='chat_viewed' group by 1) ev on ev.hour=h.hour
    order by h.hour
  ),
  top_global_users as (
    select coalesce(nullif(p.username,''),'Usuario') as username, count(*) as messages,
      count(*) filter (where cm.hidden_at is not null) as hidden_messages
    from public.chat_messages cm join public.profiles p on p.id=cm.user_id
    where cm.created_at >= p_start and cm.created_at < p_end
    group by cm.user_id,p.username order by messages desc limit 10
  ),
  emoji_rows as (
    select cr.emoji, count(*) as count from public.chat_reactions cr
    where cr.created_at >= p_start and cr.created_at < p_end
    group by cr.emoji order by count desc,cr.emoji limit 10
  ),
  prompt_rows as (
    select coalesce(nullif(e.metadata ->> 'reason',''),'sin_dato') as reason, count(*) as count
    from e where e.event_name='chat_signup_prompted' group by 1 order by count desc
  ),
  rates as (
    select
      case when ek.unique_chat_visitors>0 then round(rr.returning_chat_visitors::numeric/ek.unique_chat_visitors*100,1) else 0 end as returning_visitor_rate,
      case when gm.global_messages>0 then round(gr.reactions::numeric/gm.global_messages*100,1) else 0 end as reactions_per_100_messages,
      case when gm.global_unique_senders>0 then round(gm.global_messages::numeric/gm.global_unique_senders,1) else 0 end as messages_per_sender,
      case when pr.private_requests>0 then round(pr.private_requests_accepted::numeric/pr.private_requests*100,1) else 0 end as private_accept_rate,
      case when pr.private_requests>0 then round((pr.private_requests_accepted+pr.private_requests_rejected)::numeric/pr.private_requests*100,1) else 0 end as private_response_rate,
      case when pc.private_conversations_created>0 then round(pm.private_active_conversations::numeric/pc.private_conversations_created*100,1) else 0 end as private_conversation_activation_rate,
      case when pm.private_active_conversations>0 then round(pm.private_messages::numeric/pm.private_active_conversations,1) else 0 end as private_messages_per_active_conversation,
      case when rw.guest_rewards_issued>0 then round(rw.guest_rewards_claimed::numeric/rw.guest_rewards_issued*100,1) else 0 end as guest_reward_claim_rate,
      case when ek.signup_started_visitors>0 then round(ek.signup_completed_visitors::numeric/ek.signup_started_visitors*100,1) else 0 end as chat_signup_completion_rate,
      case when ek.signup_completed_visitors>0 then round(ek.first_scan_visitors::numeric/ek.signup_completed_visitors*100,1) else 0 end as chat_signup_to_first_scan_rate
    from event_kpis ek,returners rr,global_messages gm,global_reactions gr,private_requests pr,private_conversations pc,private_messages pm,rewards rw
  )
  select jsonb_build_object(
    'range',jsonb_build_object('start',p_start,'end',p_end,'timezone','America/Santiago'),
    'kpis',jsonb_build_object(
      'chat_views',ek.chat_views,'unique_chat_visitors',ek.unique_chat_visitors,'registered_chat_viewers',ek.registered_chat_viewers,'returning_chat_visitors',rr.returning_chat_visitors,
      'global_messages',gm.global_messages,'global_unique_senders',gm.global_unique_senders,'registered_global_senders',gm.registered_global_senders,'guest_global_senders',gm.guest_global_senders,'avg_global_message_length',gm.avg_global_message_length,
      'reactions',gr.reactions,'unique_reactors',gr.unique_reactors,'hidden_global_messages',gm.hidden_global_messages,
      'guest_created',ek.guest_created,'guest_rewards_issued',rw.guest_rewards_issued,'guest_rewards_claimed',rw.guest_rewards_claimed,'guest_reward_coins_issued',rw.guest_reward_coins_issued,'guest_reward_coins_claimed',rw.guest_reward_coins_claimed,
      'signup_prompted',ek.signup_prompted,'signup_started_visitors',ek.signup_started_visitors,'signup_completed_visitors',ek.signup_completed_visitors,'first_scan_visitors',ek.first_scan_visitors,
      'scan_cta_clicks',ek.scan_cta_clicks,'invite_clicks',ek.invite_clicks,'members_opens',ek.members_opens,'profile_opens',ek.profile_opens,'follow_clicks',ek.follow_clicks,
      'private_inbox_opens',ek.private_inbox_opens,'private_conversation_opens',ek.private_conversation_opens,
      'private_requests',pr.private_requests,'private_requests_accepted',pr.private_requests_accepted,'private_requests_rejected',pr.private_requests_rejected,'private_requests_cancelled',pr.private_requests_cancelled,'private_requests_pending',pr.private_requests_pending,
      'private_conversations_created',pc.private_conversations_created,'private_messages',pm.private_messages,'private_unique_senders',pm.private_unique_senders,'private_active_conversations',pm.private_active_conversations,'avg_private_message_length',pm.avg_private_message_length,
      'hidden_private_messages',pm.hidden_private_messages,'blocks',b.blocks
    ),
    'rates',to_jsonb(rt),
    'daily',coalesce((select jsonb_agg(to_jsonb(daily)) from daily),'[]'::jsonb),
    'hourly',coalesce((select jsonb_agg(to_jsonb(hourly)) from hourly),'[]'::jsonb),
    'top_global_users',coalesce((select jsonb_agg(to_jsonb(top_global_users)) from top_global_users),'[]'::jsonb),
    'emojis',coalesce((select jsonb_agg(to_jsonb(emoji_rows)) from emoji_rows),'[]'::jsonb),
    'signup_prompt_reasons',coalesce((select jsonb_agg(to_jsonb(prompt_rows)) from prompt_rows),'[]'::jsonb)
  ) into v_result
  from event_kpis ek,returners rr,global_messages gm,global_reactions gr,rewards rw,private_requests pr,private_conversations pc,private_messages pm,blocks b,rates rt;

  return v_result;
end;
$$;

revoke execute on function public.get_admin_chat_dashboard(timestamptz,timestamptz) from public, anon;
grant execute on function public.get_admin_chat_dashboard(timestamptz,timestamptz) to authenticated;
