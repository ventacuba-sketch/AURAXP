-- AURA VS — analytics attribution + admin dashboard.
-- Aggregated dashboard data is exposed through one admin-only RPC.
-- Raw analytics tables remain inaccessible to the browser.

alter table public.campaign_attributions
  add column if not exists referrer_host text,
  add column if not exists device_type text,
  add column if not exists browser text,
  add column if not exists os_name text;

create index if not exists campaign_attributions_first_seen_idx
  on public.campaign_attributions(first_seen_at desc);

create index if not exists campaign_attributions_source_idx
  on public.campaign_attributions(utm_source, utm_medium, utm_campaign);

create or replace function public.capture_campaign_attribution(
  p_visitor_id text,
  p_source text default null,
  p_medium text default null,
  p_campaign text default null,
  p_content text default null,
  p_term text default null,
  p_path text default null,
  p_referrer_host text default null,
  p_device_type text default null,
  p_browser text default null,
  p_os_name text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_visitor_id is null or length(p_visitor_id) < 8 or length(p_visitor_id) > 200 then
    return;
  end if;

  insert into public.campaign_attributions(
    visitor_id, user_id, utm_source, utm_medium, utm_campaign,
    utm_content, utm_term, landing_path, referrer_host,
    device_type, browser, os_name
  )
  values (
    p_visitor_id, (select auth.uid()), p_source, p_medium, p_campaign,
    p_content, p_term, p_path, p_referrer_host,
    p_device_type, p_browser, p_os_name
  )
  on conflict(visitor_id) do update set
    user_id = coalesce(public.campaign_attributions.user_id, (select auth.uid())),
    utm_source = coalesce(excluded.utm_source, public.campaign_attributions.utm_source),
    utm_medium = coalesce(excluded.utm_medium, public.campaign_attributions.utm_medium),
    utm_campaign = coalesce(excluded.utm_campaign, public.campaign_attributions.utm_campaign),
    utm_content = coalesce(excluded.utm_content, public.campaign_attributions.utm_content),
    utm_term = coalesce(excluded.utm_term, public.campaign_attributions.utm_term),
    landing_path = coalesce(excluded.landing_path, public.campaign_attributions.landing_path),
    referrer_host = coalesce(excluded.referrer_host, public.campaign_attributions.referrer_host),
    device_type = coalesce(excluded.device_type, public.campaign_attributions.device_type),
    browser = coalesce(excluded.browser, public.campaign_attributions.browser),
    os_name = coalesce(excluded.os_name, public.campaign_attributions.os_name),
    last_seen_at = now();
end;
$$;

revoke all on function public.capture_campaign_attribution(text,text,text,text,text,text,text) from public, anon, authenticated;
-- Keep the legacy 7-argument RPC callable so the currently deployed app
-- remains compatible until the dashboard branch is deployed.
grant execute on function public.capture_campaign_attribution(text,text,text,text,text,text,text) to anon, authenticated;
revoke all on function public.capture_campaign_attribution(text,text,text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.capture_campaign_attribution(text,text,text,text,text,text,text,text,text,text,text) to anon, authenticated;

create or replace function public.get_admin_dashboard(
  p_start timestamptz,
  p_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not_authorized'; end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = v_uid;

  if v_email is distinct from 'ventacuba@gmail.com' then
    raise exception 'not_authorized';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid_range';
  end if;

  with
  e as (
    select ae.event_name, ae.user_id, ae.created_at, ae.metadata
    from public.analytics_events ae
    where ae.created_at >= p_start and ae.created_at < p_end
  ),
  k as (
    select
      count(*) filter (where event_name = 'web_visit') as web_visits,
      count(distinct metadata ->> 'visitor_id') filter (where event_name = 'web_visit' and metadata ->> 'visitor_id' is not null) as web_unique_visitors,
      count(*) filter (where event_name = 'app_open') as app_opens,
      count(distinct user_id) filter (where user_id is not null) as active_users,
      count(*) filter (where event_name = 'landing_viewed') as landing_views,
      count(distinct metadata ->> 'visitor_id') filter (where event_name = 'landing_viewed' and metadata ->> 'visitor_id' is not null) as landing_unique_visitors,
      count(*) filter (where event_name = 'landing_cta_clicked') as landing_cta_clicks,
      count(distinct user_id) filter (where event_name = 'signup_started' and user_id is not null) as signup_starts,
      count(distinct user_id) filter (where event_name = 'signup_completed' and user_id is not null) as signup_completions,
      count(*) filter (where event_name = 'scan_started') as scan_starts,
      count(distinct user_id) filter (where event_name = 'scan_completed' and user_id is not null) as scan_users,
      count(*) filter (where event_name = 'scan_completed') as scan_completions,
      count(distinct user_id) filter (where event_name = 'first_scan_completed' and user_id is not null) as first_scan_users,
      count(*) filter (where event_name in ('share','result_shared')) as shares,
      count(distinct user_id) filter (where event_name in ('share','result_shared') and user_id is not null) as sharers,
      count(*) filter (where event_name in ('challenge_created','challenge_direct_created')) as challenge_creations,
      count(*) filter (where event_name = 'challenge_accepted') as challenge_acceptances,
      count(*) filter (where event_name = 'challenge_completed') as challenge_completions,
      count(*) filter (where event_name = 'follow') as follows,
      count(*) filter (where event_name = 'gift_sent') as gifts_sent,
      count(*) filter (where event_name = 'gift_received') as gifts_received,
      count(*) filter (where event_name = 'item_purchased') as item_purchases,
      count(*) filter (where event_name = 'mission_completed') as missions_completed,
      count(*) filter (where event_name = 'referral_activated') as referrals_activated,
      count(*) filter (where event_name = 'pwa_installed') as pwa_installs,
      count(*) filter (where event_name = 'push_subscribed') as push_subscriptions,
      count(*) filter (where event_name = 'bug_reported') as bug_reports,
      count(*) filter (where event_name = 'public_result_viewed') as public_result_views,
      count(*) filter (where event_name = 'public_result_voted') as public_result_votes,
      count(*) filter (where event_name = 'public_battle_viewed') as public_battle_views,
      count(*) filter (where event_name = 'public_battle_voted') as public_battle_votes,
      count(*) filter (where event_name = 'pro_checkout_opened') as pro_checkout_opens,
      count(*) filter (where event_name like '%rpc_error' or event_name like '%_error') as analytics_errors
    from e
  ),
  s as (
    select
      count(*) filter (where s.status = 'done') as done_scans,
      count(*) filter (where s.status = 'failed') as failed_scans,
      count(*) filter (where s.status = 'rejected') as rejected_scans,
      count(*) filter (where s.status = 'processing') as processing_scans,
      count(distinct s.user_id) filter (where s.status = 'done') as unique_scanners,
      round(avg(s.aura_score) filter (where s.status = 'done' and s.aura_score is not null), 1) as avg_aura,
      max(s.aura_score) filter (where s.status = 'done') as best_aura,
      round(avg(extract(epoch from (s.analyzed_at - s.created_at))) filter (where s.status = 'done' and s.analyzed_at is not null), 1) as avg_scan_seconds
    from public.scans s
    where s.created_at >= p_start and s.created_at < p_end
  ),
  u as (
    select
      count(*) filter (where u.created_at < p_end) as total_users,
      count(*) filter (where u.created_at >= p_start and u.created_at < p_end) as new_users,
      count(*) filter (where u.email_confirmed_at >= p_start and u.email_confirmed_at < p_end) as confirmed_users
    from auth.users u
  ),
  pro as (
    select
      count(*) filter (where p.plan = 'pro' and p.pro_status = 'active') as active_pro_users,
      count(*) filter (where p.plan = 'pro' and p.pro_started_at >= p_start and p.pro_started_at < p_end) as new_pro_users
    from public.profiles p
  ),
  wallet as (
    select
      coalesce(sum(ct.amount) filter (where ct.amount > 0), 0) as coins_earned,
      coalesce(abs(sum(ct.amount) filter (where ct.amount < 0)), 0) as coins_spent
    from public.coin_transactions ct
    where ct.created_at >= p_start and ct.created_at < p_end
  ),
  daily as (
    select
      d.day,
      count(*) filter (where e.event_name = 'web_visit') as web_visits,
      count(*) filter (where e.event_name = 'landing_viewed') as landing_views,
      count(*) filter (where e.event_name = 'landing_cta_clicked') as cta_clicks,
      count(*) filter (where e.event_name = 'signup_completed') as registrations,
      count(*) filter (where e.event_name = 'first_scan_completed') as first_scans,
      count(*) filter (where e.event_name = 'scan_completed') as scans,
      count(*) filter (where e.event_name = 'challenge_completed') as challenges,
      count(*) filter (where e.event_name in ('share','result_shared')) as shares,
      count(distinct e.user_id) filter (where e.user_id is not null) as active_users
    from generate_series(date_trunc('day', p_start), date_trunc('day', p_end - interval '1 microsecond'), interval '1 day') d(day)
    left join e on e.created_at >= d.day and e.created_at < d.day + interval '1 day'
    group by d.day
    order by d.day
  ),
  source_rows as (
    select
      coalesce(nullif(a.utm_source,''), nullif(a.referrer_host,''), '(direct)') as source,
      coalesce(a.utm_medium,'(none)') as medium,
      coalesce(a.utm_campaign,'(none)') as campaign,
      count(distinct a.visitor_id) as visitors,
      count(distinct a.user_id) filter (where a.user_id is not null) as attributed_users,
      count(distinct e.user_id) filter (where e.event_name = 'signup_completed' and e.user_id is not null) as signups,
      count(distinct e.user_id) filter (where e.event_name = 'first_scan_completed' and e.user_id is not null) as first_scanners,
      count(distinct e.user_id) filter (where e.event_name in ('share','result_shared') and e.user_id is not null) as sharers
    from public.campaign_attributions a
    left join e on e.user_id = a.user_id
    where a.first_seen_at >= p_start and a.first_seen_at < p_end
    group by 1,2,3
    order by visitors desc
    limit 20
  ),
  device_rows as (
    select coalesce(nullif(a.device_type,''),'unknown') as device, count(distinct a.visitor_id) as visitors
    from public.campaign_attributions a
    where a.first_seen_at >= p_start and a.first_seen_at < p_end
    group by 1
    order by visitors desc
    limit 10
  ),
  browser_rows as (
    select coalesce(nullif(a.browser,''),'unknown') as browser, count(distinct a.visitor_id) as visitors
    from public.campaign_attributions a
    where a.first_seen_at >= p_start and a.first_seen_at < p_end
    group by 1
    order by visitors desc
    limit 10
  ),
  event_rows as (
    select e.event_name, count(*) as count
    from e
    group by e.event_name
    order by count desc
    limit 30
  ),
  rates as (
    select
      case when k.landing_views > 0 then round(k.landing_cta_clicks::numeric / k.landing_views * 100,1) else 0 end as landing_ctr,
      case when k.signup_starts > 0 then round(k.signup_completions::numeric / k.signup_starts * 100,1) else 0 end as signup_completion_rate,
      case when k.signup_completions > 0 then round(k.first_scan_users::numeric / k.signup_completions * 100,1) else 0 end as signup_to_scan_rate,
      case when k.scan_starts > 0 then round(k.scan_completions::numeric / k.scan_starts * 100,1) else 0 end as scan_completion_rate,
      case when k.challenge_creations > 0 then round(k.challenge_acceptances::numeric / k.challenge_creations * 100,1) else 0 end as challenge_accept_rate,
      case when k.scan_users > 0 then round(k.sharers::numeric / k.scan_users * 100,1) else 0 end as share_rate
    from k
  )
  select jsonb_build_object(
    'range', jsonb_build_object('start', p_start, 'end', p_end),
    'kpis', jsonb_build_object(
      'web_visits', k.web_visits, 'web_unique_visitors', k.web_unique_visitors, 'app_opens', k.app_opens, 'active_users', k.active_users,
      'landing_views', k.landing_views, 'landing_unique_visitors', k.landing_unique_visitors, 'landing_cta_clicks', k.landing_cta_clicks,
      'signup_starts', k.signup_starts, 'signup_completions', k.signup_completions,
      'new_users', u.new_users, 'total_users', u.total_users, 'confirmed_users', u.confirmed_users,
      'first_scan_users', k.first_scan_users, 'scan_starts', k.scan_starts, 'scan_completions', k.scan_completions, 'unique_scanners', s.unique_scanners,
      'done_scans', s.done_scans, 'failed_scans', s.failed_scans, 'rejected_scans', s.rejected_scans, 'processing_scans', s.processing_scans,
      'avg_scan_seconds', s.avg_scan_seconds, 'avg_aura', s.avg_aura, 'best_aura', s.best_aura,
      'challenge_creations', k.challenge_creations, 'challenge_acceptances', k.challenge_acceptances, 'challenge_completions', k.challenge_completions,
      'shares', k.shares, 'sharers', k.sharers, 'follows', k.follows, 'gifts_sent', k.gifts_sent, 'gifts_received', k.gifts_received,
      'item_purchases', k.item_purchases, 'missions_completed', k.missions_completed, 'referrals_activated', k.referrals_activated,
      'pwa_installs', k.pwa_installs, 'push_subscriptions', k.push_subscriptions, 'bug_reports', k.bug_reports,
      'public_result_views', k.public_result_views, 'public_result_votes', k.public_result_votes, 'public_battle_views', k.public_battle_views, 'public_battle_votes', k.public_battle_votes,
      'pro_checkout_opens', k.pro_checkout_opens, 'active_pro_users', pro.active_pro_users, 'new_pro_users', pro.new_pro_users,
      'coins_earned', wallet.coins_earned, 'coins_spent', wallet.coins_spent, 'analytics_errors', k.analytics_errors
    ),
    'rates', jsonb_build_object(
      'landing_ctr', rates.landing_ctr, 'signup_completion_rate', rates.signup_completion_rate, 'signup_to_scan_rate', rates.signup_to_scan_rate,
      'scan_completion_rate', rates.scan_completion_rate, 'challenge_accept_rate', rates.challenge_accept_rate, 'share_rate', rates.share_rate
    ),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day',daily.day,'web_visits',daily.web_visits,'landing_views',daily.landing_views,'cta_clicks',daily.cta_clicks,'registrations',daily.registrations,'first_scans',daily.first_scans,'scans',daily.scans,'challenges',daily.challenges,'shares',daily.shares,'active_users',daily.active_users)) from daily), '[]'::jsonb),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source',source_rows.source,'medium',source_rows.medium,'campaign',source_rows.campaign,'visitors',source_rows.visitors,'attributed_users',source_rows.attributed_users,'signups',source_rows.signups,'first_scanners',source_rows.first_scanners,'sharers',source_rows.sharers)) from source_rows), '[]'::jsonb),
    'devices', coalesce((select jsonb_agg(jsonb_build_object('device',device_rows.device,'visitors',device_rows.visitors)) from device_rows), '[]'::jsonb),
    'browsers', coalesce((select jsonb_agg(jsonb_build_object('browser',browser_rows.browser,'visitors',browser_rows.visitors)) from browser_rows), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('event_name',event_rows.event_name,'count',event_rows.count)) from event_rows), '[]'::jsonb),
    'recommendations', jsonb_build_array(
      case
        when k.landing_views >= 20 and rates.landing_ctr < 20 then jsonb_build_object('priority','high','area','landing','title','Revisar conversión del landing','detail','El CTA recibe menos del 20% de las visitas al landing. Conviene probar copy, ejemplo de resultado y posición del CTA.')
        when k.landing_views >= 20 then jsonb_build_object('priority','ok','area','landing','title','Landing con señal suficiente','detail','El CTR del CTA está por encima del umbral de revisión automática. Seguir comparando por fuente/campaña.')
        else jsonb_build_object('priority','info','area','landing','title','Falta volumen para evaluar el landing','detail','Acumula al menos 20 visitas antes de tomar decisiones sobre conversión.')
      end,
      case
        when k.signup_starts >= 10 and rates.signup_completion_rate < 60 then jsonb_build_object('priority','high','area','registro','title','Revisar fricción de registro','detail','Menos del 60% de los intentos de registro llegan a completarse.')
        when k.signup_completions >= 10 and rates.signup_to_scan_rate < 50 then jsonb_build_object('priority','high','area','activacion','title','Revisar el paso registro → primer Scan','detail','Una parte importante de los registrados todavía no llega al primer Scan.')
        else jsonb_build_object('priority','info','area','activacion','title','Medir activación por cohorte','detail','Comparar registro → primer Scan por fuente y campaña para detectar qué tráfico trae usuarios realmente activos.')
      end,
      case
        when k.scan_starts >= 10 and rates.scan_completion_rate < 80 then jsonb_build_object('priority','high','area','scanner','title','Revisar fallos del Scanner','detail','La finalización del Scan está por debajo del 80%. Revisar errores, permisos de cámara, carga y procesamiento.')
        when s.avg_scan_seconds is not null and s.avg_scan_seconds > 20 then jsonb_build_object('priority','medium','area','scanner','title','Revisar tiempo de procesamiento','detail','El tiempo medio de procesamiento supera 20 segundos en el periodo seleccionado.')
        else jsonb_build_object('priority','info','area','scanner','title','Scanner estable','detail','No aparece una alerta automática de finalización o latencia con el volumen actual.')
      end,
      case
        when k.challenge_creations >= 10 and rates.challenge_accept_rate < 40 then jsonb_build_object('priority','medium','area','social','title','Revisar aceptación de Challenges','detail','Menos del 40% de los Challenges creados llegan a aceptación.')
        else jsonb_build_object('priority','info','area','social','title','Impulsar el loop social','detail','Comparar shares, Challenges, follows y referidos por fuente para identificar los canales que generan usuarios que invitan a otros.')
      end,
      case
        when k.analytics_errors >= 5 then jsonb_build_object('priority','high','area','tecnico','title','Hay errores registrados','detail','Se detectaron eventos de error en el periodo. Revisar el detalle de eventos y logs antes de aumentar inversión.')
        else jsonb_build_object('priority','info','area','tecnico','title','Telemetría sin alerta crítica','detail','No se detectó un volumen alto de eventos de error en este periodo.')
      end
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_admin_dashboard(timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.get_admin_dashboard(timestamptz,timestamptz) to authenticated;
