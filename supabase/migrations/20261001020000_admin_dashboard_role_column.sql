-- M1/M2 fixes from the second pass of the admin analytics dashboard audit
-- (docs/CLAUDE_ANALYTICS_REVIEW.md):
--
-- M2) Replaces the hardcoded admin email check inside get_admin_dashboard()
--     with a profiles.is_admin boolean flag, following the exact same
--     pattern already used for profiles.is_unlimited_tester
--     (20260829220000_unlimited_tester_flag.sql): a plain column that no
--     client can ever write, because the column-level grant on profiles
--     (`grant update (username, avatar_emoji) on profiles to authenticated;`,
--     20260827220530_init_schema.sql) only ever lists username/avatar_emoji.
--     Postgres denies any attempt by the `authenticated` role to touch any
--     other column, is_admin included, regardless of the profiles_update_own
--     RLS policy -- only service_role or a migration (like the UPDATE below)
--     can set it. The RPC itself is SECURITY DEFINER, so reading is_admin
--     here bypasses RLS the same way the existing auth.users lookup already
--     did, and the check fails closed: a NULL (no profile row, or anything
--     else unexpected) is treated as "not admin", never as "admin by
--     default".
-- M1) /admin was already backend-gated by this RPC (it raises
--     'not_authorized' and returns no data at all when the caller isn't
--     the admin -- no partial stats are ever exposed to a regular user),
--     but AdminDashboard was also registered in RootNavigator.tsx outside
--     the authed/!authed branch, in the same slot as the deliberately
--     public ChallengeLanding/PublicResult/PublicBattle screens, so an
--     unauthenticated visitor could reach the screen component itself. The
--     accompanying RootNavigator.tsx change moves it inside the authed
--     branch -- this migration is the backend half of that fix (the data
--     protection), the navigator change is the UI half (the screen itself
--     isn't reachable at all while logged out, same as Wallet/Store/etc).

alter table public.profiles add column if not exists is_admin boolean not null default false;

-- Hardening explícito (fail closed, pedido para is_admin): revoca
-- cualquier UPDATE a nivel de TABLA sobre profiles para authenticated/anon
-- y vuelve a otorgar exactamente las columnas que el cliente necesita
-- escribir hoy (username/avatar_emoji/bio -- ver init_schema.sql +
-- profile_edit.sql, es la lista completa y acumulada). Un GRANT UPDATE
-- por columna (como el de username/avatar_emoji/bio) solo restringe de
-- verdad si NUNCA existió un GRANT UPDATE a nivel de tabla por separado
-- -- Postgres une ambos tipos de privilegio, y uno a nivel de tabla
-- siempre cubre TODAS las columnas sin importar los grants por columna
-- que se agreguen después. Esta migración no puede confirmar desde este
-- entorno si el proyecto real tiene o no ese GRANT de tabla de fábrica
-- (depende de cómo Supabase haya inicializado el proyecto) -- este
-- REVOKE+GRANT dejan el resultado correcto en cualquiera de los dos
-- casos, sin tocar ninguna columna que el cliente ya usa (no es
-- destructivo) y sin ampliar el alcance de esta tarea a auditar el resto
-- de columnas de profiles (plan/pro_status/xp/level/is_unlimited_tester
-- quedan exactamente como estaban, solo potencialmente más protegidas).
revoke update on public.profiles from authenticated, anon;
grant update (username, avatar_emoji, bio) on public.profiles to authenticated;

-- Activa la cuenta administradora que hasta ahora estaba hardcodeada
-- dentro de get_admin_dashboard() -- mismo criterio que
-- is_unlimited_tester: resuelve el id por email en la misma sentencia, sin
-- exponerlo ni requerir que nadie lo copie a mano. Si el email no existe
-- todavía, el subquery no matchea ninguna fila y el UPDATE simplemente no
-- hace nada (no falla, no rompe el `db push`).
update public.profiles
set is_admin = true
where id = (select id from auth.users where lower(email) = lower('ventacuba@gmail.com'));

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
  v_is_admin boolean;
  v_result jsonb;
begin
  if v_uid is null then raise exception 'not_authorized'; end if;

  select p.is_admin into v_is_admin
  from public.profiles p
  where p.id = v_uid;

  -- Fail closed: cualquier cosa que no sea exactamente `true` (NULL por
  -- falta de fila, false, etc.) se trata como "no admin".
  if v_is_admin is not true then
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
      -- C2: distinct referral_id, not row count -- activate_referral_on_first_scan()
      -- inserts one row for the referrer and one for the referred user per activation.
      count(distinct metadata ->> 'referral_id') filter (where event_name = 'referral_activated' and metadata ->> 'referral_id' is not null) as referrals_activated,
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
    left join e on e.user_id = a.user_id and e.created_at >= a.first_seen_at
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
  )
  -- Bug encontrado al verificar esta migración contra Postgres real (no lo
  -- detectaban tsc/regression-gate/build, ninguno ejecuta SQL): faltaba
  -- este FROM. Sin él, Postgres no puede resolver k./s./u./pro./wallet./
  -- rates. en el select de arriba ("missing FROM-clause entry") y el RPC
  -- falla para CUALQUIER llamada, admin incluido -- k/s/u/pro/wallet/rates
  -- son CTEs de una sola fila (agregados sin group by), así que un cross
  -- join simple entre todas es siempre exactamente 1x1x1x1x1x1 = 1 fila.
  from k, s, u, pro, wallet, rates
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_admin_dashboard(timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.get_admin_dashboard(timestamptz,timestamptz) to authenticated;
