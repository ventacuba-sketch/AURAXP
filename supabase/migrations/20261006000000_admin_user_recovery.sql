-- Admin Dashboard: módulo "Recuperación de usuarios".
--
-- Contexto (ver docs/admin-user-recovery.md para el detalle completo):
-- AURA VS tuvo, en orden, (1) confirmación de email obligatoria, (2) OTP
-- por email, (3) un periodo donde Supabase mandaba un OTP de 8 dígitos
-- pero la UI solo aceptaba 6, y (4) el funnel actual (email+contraseña,
-- sesión inmediata, `Confirm Email` desactivado). Verificado contra el
-- código fuente REAL de `github.com/supabase/auth` (internal/api/token.go):
-- el grant de password SIEMPRE rechaza el login con "Email not confirmed"
-- si `email_confirmed_at is null`, sin importar si `Confirm Email` está
-- activado o desactivado HOY en el proyecto -- desactivarlo solo cambia
-- el comportamiento de los signups NUEVOS, nunca confirma retroactivamente
-- a nadie. Por eso estas cuentas viejas siguen bloqueadas de verdad, y por
-- eso la acción "Recuperar acceso" (ver función admin-recover-user-access)
-- tiene sentido real y no es redundante con el cambio ya desplegado.
--
-- Esta migración es 100% nueva -- no toca ninguna tabla/función/migración
-- histórica. Mismo patrón de seguridad que get_admin_dashboard
-- (20261001035244_admin_dashboard_role_column_finalize.sql): RPCs
-- SECURITY DEFINER con `search_path = ''`, fail-closed sobre
-- `profiles.is_admin`, grants exclusivos a `authenticated` (nunca `anon`),
-- cero exposición de auth.users/emails al cliente normal.

-- ============================================================
-- A) Auditoría de acciones de recuperación
-- ============================================================
create table if not exists public.admin_recovery_actions (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on delete cascade,
  performed_by uuid not null references public.profiles(id) on delete restrict,
  email_confirmed boolean not null default false,
  password_reset_sent boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists admin_recovery_actions_target_idx on public.admin_recovery_actions (target_user_id, created_at desc);
create index if not exists admin_recovery_actions_performed_by_idx on public.admin_recovery_actions (performed_by, created_at desc);

alter table public.admin_recovery_actions enable row level security;
-- RLS habilitada, CERO policies -- igual criterio que live_webhook_events:
-- solo la Edge Function admin-recover-user-access (service_role) escribe
-- acá, y solo las RPCs SECURITY DEFINER de abajo la leen (para calcular
-- "usuarios recuperados"/"% recuperación"). Ningún cliente, admin
-- incluido, tiene una policy que le permita leerla o escribirla
-- directamente vía supabase-js -- todo pasa por las funciones de abajo.

-- ============================================================
-- B) Helper interno: ¿el usuario que llama es admin? (fail closed)
-- ============================================================
-- Un solo lugar para este chequeo -- evita repetir el mismo bloque
-- if/raise en las 3 RPCs de abajo. `stable`, no `security definer` propio
-- (hereda el contexto SECURITY DEFINER de quien la llama).
create or replace function public._assert_admin_caller()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_is_admin boolean;
begin
  if v_uid is null then
    raise exception 'not_authorized';
  end if;

  select p.is_admin into v_is_admin
  from public.profiles p
  where p.id = v_uid;

  if v_is_admin is not true then
    raise exception 'not_authorized';
  end if;
end;
$$;

revoke all on function public._assert_admin_caller() from public, anon, authenticated;

-- ============================================================
-- C) KPIs del módulo
-- ============================================================
-- Todas las columnas "derivadas" (confirmed/has_first_scan/source_group/
-- funnel_stage/is_meta) se recalculan EN CADA RPC a propósito -- mismo
-- criterio que get_admin_dashboard (SQL autocontenido por función, sin
-- vistas intermedias compartidas) para que cada función sea auditable de
-- punta a punta leyendo un solo archivo.
--
-- p_source_group: 'meta' | 'organic' | 'other' | null (todos).
-- p_confirmed: true | false | null (todos).
-- p_has_first_scan: true | false | null (todos).
-- p_campaign / p_creative: igualdad exacta contra utm_campaign/utm_content
-- (NULL = sin filtro). `p_creative` es utm_content -- es el único campo
-- que de verdad identifica una variante/creativo en este esquema (no
-- existe ninguna infraestructura de A/B testing separada, ver auditoría).
-- Sin filtro de país: ningún dato de país/geolocalización existe en
-- ninguna tabla de este proyecto -- no se inventa uno acá.
create or replace function public.admin_user_recovery_kpis(
  p_start timestamptz,
  p_end timestamptz,
  p_source_group text default null,
  p_confirmed boolean default null,
  p_has_first_scan boolean default null,
  p_campaign text default null,
  p_creative text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public._assert_admin_caller();

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid_range';
  end if;

  -- Tercera fuente de respaldo para atribución: `analytics_events.metadata`
  -- trae utm_source/visitor_id ya grabados en cada evento desde
  -- `feat: add paid acquisition attribution funnel` (25-sep) -- anterior a
  -- `user_attributions` (5-oct) y más robusto que `campaign_attributions`
  -- porque queda fijo en la fila del evento, no depende de que el RPC de
  -- vinculación haya corrido con éxito. Se usa el evento MÁS ANTIGUO de
  -- cada usuario que SÍ tenga utm_source para aproximar first-touch.
  with ae_attr as (
    select distinct on (ae.user_id)
      ae.user_id,
      ae.metadata ->> 'utm_source' as utm_source,
      ae.metadata ->> 'utm_medium' as utm_medium,
      ae.metadata ->> 'utm_campaign' as utm_campaign,
      ae.metadata ->> 'utm_content' as utm_content,
      ae.metadata ->> 'visitor_id' as visitor_id
    from public.analytics_events ae
    where ae.user_id is not null and ae.metadata ? 'utm_source'
    order by ae.user_id, ae.created_at asc
  ),
  base as (
    select
      au.id as user_id,
      au.email_confirmed_at,
      coalesce(ua.utm_source, ca.utm_source, aa.utm_source) as utm_source,
      coalesce(ua.utm_campaign, ca.utm_campaign, aa.utm_campaign) as utm_campaign,
      coalesce(ua.utm_content, ca.utm_content, aa.utm_content) as utm_content,
      ua.fbclid,
      ua.fbc,
      exists(select 1 from public.scans s where s.user_id = au.id and s.status = 'done') as has_first_scan,
      exists(select 1 from public.analytics_events ae where ae.user_id = au.id and ae.event_name = 'scan_upload_viewed') as reached_upload,
      exists(select 1 from public.analytics_events ae where ae.user_id = au.id and ae.event_name = 'scan_submit_failed') as had_submit_failure
    from auth.users au
    left join public.user_attributions ua on ua.user_id = au.id
    left join public.campaign_attributions ca on ca.user_id = au.id
    left join ae_attr aa on aa.user_id = au.id
    where au.created_at >= p_start and au.created_at < p_end
  ),
  classified as (
    select
      b.*,
      (b.email_confirmed_at is not null) as confirmed,
      case
        when b.fbclid is not null or b.fbc is not null
          or b.utm_source ilike '%facebook%' or b.utm_source ilike '%instagram%'
          or b.utm_source ilike '%meta%' or b.utm_source ilike '%fb%'
        then 'meta'
        when b.utm_source is null and b.fbclid is null and b.fbc is null then 'organic'
        else 'other'
      end as source_group
    from base b
  ),
  filtered as (
    select *
    from classified c
    where (p_source_group is null or c.source_group = p_source_group)
      and (p_confirmed is null or c.confirmed = p_confirmed)
      and (p_has_first_scan is null or c.has_first_scan = p_has_first_scan)
      and (p_campaign is null or c.utm_campaign = p_campaign)
      and (p_creative is null or c.utm_content = p_creative)
  ),
  recovered as (
    select count(distinct ara.target_user_id) as recovered_count
    from public.admin_recovery_actions ara
    join filtered f on f.user_id = ara.target_user_id
  )
  select jsonb_build_object(
    'range', jsonb_build_object('start', p_start, 'end', p_end),
    'registered', (select count(*) from filtered),
    'unconfirmed_legacy', (select count(*) from filtered where not confirmed),
    'no_first_scan', (select count(*) from filtered where not has_first_scan),
    'reached_upload_abandoned', (select count(*) from filtered where reached_upload and not has_first_scan),
    'attempted_scan_failed', (select count(*) from filtered where had_submit_failure and not has_first_scan),
    'recovered', r.recovered_count,
    'recovery_rate_pct', case
      when (select count(*) from filtered where not confirmed) > 0
      then round(r.recovered_count::numeric / (select count(*) from filtered where not confirmed) * 100, 1)
      else 0
    end
  )
  into v_result
  from recovered r;

  return v_result;
end;
$$;

revoke all on function public.admin_user_recovery_kpis(timestamptz,timestamptz,text,boolean,boolean,text,text) from public, anon, authenticated;
grant execute on function public.admin_user_recovery_kpis(timestamptz,timestamptz,text,boolean,boolean,text,text) to authenticated;

-- ============================================================
-- D) Tabla detallada (paginada, con búsqueda)
-- ============================================================
-- p_segment acota a una de las dos poblaciones del pedido sin duplicar
-- esta función: 'unconfirmed' (grupo 1), 'no_first_scan' (grupo 2), o
-- null (todos los registrados en el rango). p_search es email (ilike
-- parcial) o un user_id exacto (comparación de texto -- un UUID inválido
-- simplemente no matchea nada, nunca un error).
create or replace function public.admin_list_user_recovery(
  p_start timestamptz,
  p_end timestamptz,
  p_segment text default null,
  p_source_group text default null,
  p_confirmed boolean default null,
  p_has_first_scan boolean default null,
  p_campaign text default null,
  p_creative text default null,
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  user_id uuid,
  email text,
  username text,
  registered_at timestamptz,
  email_confirmed_at timestamptz,
  confirmed boolean,
  last_sign_in_at timestamptz,
  last_event_name text,
  last_event_at timestamptz,
  visitor_id text,
  has_attribution boolean,
  source_group text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  scans_total bigint,
  scans_done bigint,
  has_first_scan boolean,
  first_scan_at timestamptz,
  reached_upload boolean,
  reached_video_selected boolean,
  reached_submitted boolean,
  submit_failure_count bigint,
  funnel_stage text,
  recovered boolean,
  total_count bigint
)
language plpgsql
security definer
set search_path = ''
stable
as $$
begin
  perform public._assert_admin_caller();

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid_range';
  end if;

  return query
  with ae_attr as (
    select distinct on (ae.user_id)
      ae.user_id,
      ae.metadata ->> 'utm_source' as utm_source,
      ae.metadata ->> 'utm_medium' as utm_medium,
      ae.metadata ->> 'utm_campaign' as utm_campaign,
      ae.metadata ->> 'utm_content' as utm_content,
      ae.metadata ->> 'visitor_id' as visitor_id
    from public.analytics_events ae
    where ae.user_id is not null and ae.metadata ? 'utm_source'
    order by ae.user_id, ae.created_at asc
  ),
  base as (
    select
      au.id as user_id,
      au.email,
      au.created_at as registered_at,
      au.email_confirmed_at,
      au.last_sign_in_at,
      p.username,
      coalesce(ua.visitor_id, ca.visitor_id, aa.visitor_id) as visitor_id,
      coalesce(ua.utm_source, ca.utm_source, aa.utm_source) as utm_source,
      coalesce(ua.utm_medium, ca.utm_medium, aa.utm_medium) as utm_medium,
      coalesce(ua.utm_campaign, ca.utm_campaign, aa.utm_campaign) as utm_campaign,
      coalesce(ua.utm_content, ca.utm_content, aa.utm_content) as utm_content,
      ua.fbclid,
      ua.fbc,
      (select count(*) from public.scans s where s.user_id = au.id) as scans_total,
      (select count(*) filter (where s.status = 'done') from public.scans s where s.user_id = au.id) as scans_done,
      (select min(s.created_at) from public.scans s where s.user_id = au.id and s.status = 'done') as first_scan_at,
      (select ae.event_name from public.analytics_events ae where ae.user_id = au.id order by ae.created_at desc limit 1) as last_event_name,
      (select max(ae.created_at) from public.analytics_events ae where ae.user_id = au.id) as last_event_at,
      exists(select 1 from public.analytics_events ae where ae.user_id = au.id and ae.event_name = 'scan_upload_viewed') as reached_upload,
      exists(select 1 from public.analytics_events ae where ae.user_id = au.id and ae.event_name in ('scan_video_selected','scan_record_clicked')) as reached_video_selected,
      exists(select 1 from public.analytics_events ae where ae.user_id = au.id and ae.event_name = 'scan_submitted') as reached_submitted,
      (select count(*) from public.analytics_events ae where ae.user_id = au.id and ae.event_name = 'scan_submit_failed') as submit_failure_count,
      exists(select 1 from public.admin_recovery_actions ara where ara.target_user_id = au.id) as recovered
    from auth.users au
    left join public.profiles p on p.id = au.id
    left join public.user_attributions ua on ua.user_id = au.id
    left join public.campaign_attributions ca on ca.user_id = au.id
    left join ae_attr aa on aa.user_id = au.id
    where au.created_at >= p_start and au.created_at < p_end
  ),
  classified as (
    select
      b.*,
      (b.email_confirmed_at is not null) as confirmed,
      (b.scans_done > 0) as has_first_scan,
      (b.utm_source is not null or b.fbclid is not null or b.fbc is not null or b.visitor_id is not null) as has_attribution,
      case
        when b.fbclid is not null or b.fbc is not null
          or b.utm_source ilike '%facebook%' or b.utm_source ilike '%instagram%'
          or b.utm_source ilike '%meta%' or b.utm_source ilike '%fb%'
        then 'meta'
        when b.utm_source is null and b.fbclid is null and b.fbc is null then 'organic'
        else 'other'
      end as source_group,
      case
        when b.scans_done > 0 then 'completed_first_scan'
        when b.submit_failure_count > 0 or b.reached_submitted then 'attempted_submit'
        when b.reached_video_selected then 'selected_video'
        when b.reached_upload then 'viewed_upload'
        else 'registered_only'
      end as funnel_stage
    from base b
  ),
  filtered as (
    select *
    from classified c
    where (p_segment is null
           or (p_segment = 'unconfirmed' and not c.confirmed)
           or (p_segment = 'no_first_scan' and not c.has_first_scan))
      and (p_source_group is null or c.source_group = p_source_group)
      and (p_confirmed is null or c.confirmed = p_confirmed)
      and (p_has_first_scan is null or c.has_first_scan = p_has_first_scan)
      and (p_campaign is null or c.utm_campaign = p_campaign)
      and (p_creative is null or c.utm_content = p_creative)
      and (p_search is null or p_search = ''
           or c.email ilike '%' || p_search || '%'
           or c.user_id::text = p_search)
  )
  select
    f.user_id, f.email, f.username, f.registered_at, f.email_confirmed_at, f.confirmed,
    f.last_sign_in_at, f.last_event_name, f.last_event_at, f.visitor_id, f.has_attribution,
    f.source_group, f.utm_source, f.utm_medium, f.utm_campaign, f.utm_content,
    f.scans_total, f.scans_done, f.has_first_scan, f.first_scan_at,
    f.reached_upload, f.reached_video_selected, f.reached_submitted, f.submit_failure_count,
    f.funnel_stage, f.recovered,
    count(*) over() as total_count
  from filtered f
  order by f.registered_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;

revoke all on function public.admin_list_user_recovery(timestamptz,timestamptz,text,text,boolean,boolean,text,text,text,int,int) from public, anon, authenticated;
grant execute on function public.admin_list_user_recovery(timestamptz,timestamptz,text,text,boolean,boolean,text,text,text,int,int) to authenticated;

-- ============================================================
-- E) Detalle de un usuario (funnel individual + timeline de eventos)
-- ============================================================
create or replace function public.admin_get_user_recovery_detail(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_result jsonb;
begin
  perform public._assert_admin_caller();

  if p_user_id is null then
    raise exception 'invalid_user_id';
  end if;

  with ae_attr as (
    select distinct on (ae.user_id)
      ae.user_id,
      ae.metadata ->> 'utm_source' as utm_source,
      ae.metadata ->> 'utm_medium' as utm_medium,
      ae.metadata ->> 'utm_campaign' as utm_campaign,
      ae.metadata ->> 'utm_content' as utm_content,
      ae.metadata ->> 'utm_term' as utm_term,
      ae.metadata ->> 'visitor_id' as visitor_id
    from public.analytics_events ae
    where ae.user_id = p_user_id and ae.metadata ? 'utm_source'
    order by ae.user_id, ae.created_at asc
  ),
  u as (
    select
      au.id as user_id, au.email, au.created_at as registered_at, au.email_confirmed_at,
      au.last_sign_in_at, au.confirmation_sent_at, p.username,
      coalesce(ua.visitor_id, ca.visitor_id, aa.visitor_id) as visitor_id,
      coalesce(ua.utm_source, ca.utm_source, aa.utm_source) as utm_source,
      coalesce(ua.utm_medium, ca.utm_medium, aa.utm_medium) as utm_medium,
      coalesce(ua.utm_campaign, ca.utm_campaign, aa.utm_campaign) as utm_campaign,
      coalesce(ua.utm_content, ca.utm_content, aa.utm_content) as utm_content,
      coalesce(ua.utm_term, ca.utm_term, aa.utm_term) as utm_term,
      ua.fbclid, ua.fbc, ua.fbp
    from auth.users au
    left join public.profiles p on p.id = au.id
    left join public.user_attributions ua on ua.user_id = au.id
    left join public.campaign_attributions ca on ca.user_id = au.id
    left join ae_attr aa on aa.user_id = au.id
    where au.id = p_user_id
  ),
  scans_rows as (
    select s.id, s.status, s.created_at, s.analyzed_at, s.aura_score
    from public.scans s
    where s.user_id = p_user_id
    order by s.created_at desc
    limit 50
  ),
  events_rows as (
    select ae.event_name, ae.created_at, ae.metadata
    from public.analytics_events ae
    where ae.user_id = p_user_id
    order by ae.created_at desc
    limit 200
  ),
  recovery_rows as (
    select ara.id, ara.performed_by, ara.email_confirmed, ara.password_reset_sent, ara.notes, ara.created_at
    from public.admin_recovery_actions ara
    where ara.target_user_id = p_user_id
    order by ara.created_at desc
  )
  select jsonb_build_object(
    'user', (select to_jsonb(u) from u),
    'scans', coalesce((select jsonb_agg(to_jsonb(scans_rows)) from scans_rows), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(events_rows)) from events_rows), '[]'::jsonb),
    'recovery_actions', coalesce((select jsonb_agg(to_jsonb(recovery_rows)) from recovery_rows), '[]'::jsonb)
  )
  into v_result;

  if (v_result->'user') = 'null'::jsonb then
    raise exception 'not_found';
  end if;

  return v_result;
end;
$$;

revoke all on function public.admin_get_user_recovery_detail(uuid) from public, anon, authenticated;
grant execute on function public.admin_get_user_recovery_detail(uuid) to authenticated;
