create or replace function public.admin_user_recovery_kpis(p_start timestamptz, p_end timestamptz, p_source_group text default null, p_confirmed boolean default null, p_has_first_scan boolean default null, p_campaign text default null, p_creative text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
 perform public._assert_admin_caller();
 if p_start is null or p_end is null or p_end <= p_start then raise exception 'invalid_range'; end if;
 with ae_attr as (
  select distinct on (ae.user_id) ae.user_id,ae.metadata->>'utm_source' utm_source,ae.metadata->>'utm_medium' utm_medium,ae.metadata->>'utm_campaign' utm_campaign,ae.metadata->>'utm_content' utm_content,ae.metadata->>'visitor_id' visitor_id
  from public.analytics_events ae where ae.user_id is not null and ae.metadata ? 'utm_source' order by ae.user_id,ae.created_at asc
 ), base as (
  select au.id user_id,au.email_confirmed_at,au.last_sign_in_at,coalesce(ua.utm_source,ca.utm_source,aa.utm_source) utm_source,coalesce(ua.utm_campaign,ca.utm_campaign,aa.utm_campaign) utm_campaign,coalesce(ua.utm_content,ca.utm_content,aa.utm_content) utm_content,ua.fbclid,ua.fbc,
  exists(select 1 from public.scans s where s.user_id=au.id and s.status='done') has_first_scan,
  exists(select 1 from public.analytics_events ae where ae.user_id=au.id and ae.event_name='scan_upload_viewed') reached_upload,
  exists(select 1 from public.analytics_events ae where ae.user_id=au.id and ae.event_name='scan_submit_failed') had_submit_failure,
  (select max(ara.created_at) from public.admin_recovery_actions ara where ara.target_user_id=au.id and ara.password_reset_sent is true) recovery_sent_at
  from auth.users au left join public.user_attributions ua on ua.user_id=au.id left join public.campaign_attributions ca on ca.user_id=au.id left join ae_attr aa on aa.user_id=au.id where au.created_at>=p_start and au.created_at<p_end
 ), classified as (
  select b.*,(b.email_confirmed_at is not null) confirmed,(b.recovery_sent_at is not null) recovery_sent,(b.recovery_sent_at is not null and b.last_sign_in_at is not null and b.last_sign_in_at>b.recovery_sent_at) recovered,
  case when b.fbclid is not null or b.fbc is not null or b.utm_source ilike '%facebook%' or b.utm_source ilike '%instagram%' or b.utm_source ilike '%meta%' or b.utm_source ilike '%fb%' then 'meta' when b.utm_source is null and b.fbclid is null and b.fbc is null then 'organic' else 'other' end source_group from base b
 ), filtered as (
  select * from classified c where (p_source_group is null or c.source_group=p_source_group) and (p_confirmed is null or c.confirmed=p_confirmed) and (p_has_first_scan is null or c.has_first_scan=p_has_first_scan) and (p_campaign is null or c.utm_campaign=p_campaign) and (p_creative is null or c.utm_content=p_creative)
 )
 select jsonb_build_object('range',jsonb_build_object('start',p_start,'end',p_end),'registered',(select count(*) from filtered),'unconfirmed_legacy',(select count(*) from filtered where not confirmed),'no_first_scan',(select count(*) from filtered where not has_first_scan),'reached_upload_abandoned',(select count(*) from filtered where reached_upload and not has_first_scan),'attempted_scan_failed',(select count(*) from filtered where had_submit_failure and not has_first_scan),'recovery_sent',(select count(*) from filtered where recovery_sent),'recovered',(select count(*) from filtered where recovered),'recovery_rate_pct',case when (select count(*) from filtered where recovery_sent)>0 then round((select count(*) from filtered where recovered)::numeric/(select count(*) from filtered where recovery_sent)*100,1) else 0 end) into v_result;
 return v_result;
end;
$$;
