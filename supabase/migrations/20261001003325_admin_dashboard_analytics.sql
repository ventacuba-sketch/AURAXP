-- Historical migration kept in version control because it is already applied
-- on production. The following migration (20261001004013) replaces it with
-- the richer dashboard implementation.

create or replace function public.get_admin_dashboard(
  p_start timestamptz,
  p_end timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not_authorized';
  end if;

  select lower(email) into v_email from auth.users where id = v_uid;
  if v_email is distinct from 'ventacuba@gmail.com' then
    raise exception 'not_authorized';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid_range';
  end if;

  with e as (
    select event_name, user_id, created_at, metadata
    from public.analytics_events
    where created_at >= p_start and created_at < p_end
  ),
  k as (
    select
      count(*) filter (where event_name='landing_viewed') landing_views,
      count(*) filter (where event_name='landing_cta_clicked') landing_cta_clicks,
      count(*) filter (where event_name='signup_started') signup_starts,
      count(*) filter (where event_name='signup_completed') signup_completions,
      count(*) filter (where event_name='scan_started') scan_starts,
      count(*) filter (where event_name='scan_completed') scan_completions,
      count(*) filter (where event_name='first_scan_completed') first_scan_completions,
      count(*) filter (where event_name in ('challenge_created','challenge_direct_created')) challenge_creations,
      count(*) filter (where event_name='challenge_accepted') challenge_acceptances,
      count(*) filter (where event_name='challenge_completed') challenge_completions,
      count(*) filter (where event_name in ('share','result_shared')) shares,
      count(*) filter (where event_name='pwa_installed') pwa_installs,
      count(*) filter (where event_name='push_subscribed') push_subscriptions,
      count(*) filter (where event_name='referral_activated') referral_activations,
      count(*) filter (where event_name='pro_checkout_opened') pro_checkout_opens,
      count(distinct user_id) filter (where user_id is not null) active_users
    from e
  ),
  s as (
    select
      count(*) filter (where status='done') done_scans,
      count(*) filter (where status='failed') failed_scans,
      count(*) filter (where status='rejected') rejected_scans,
      count(distinct user_id) filter (where status='done') unique_scanners,
      round(avg(aura_score) filter (where status='done' and aura_score is not null),1) avg_aura,
      max(aura_score) filter (where status='done') best_aura
    from public.scans
    where created_at >= p_start and created_at < p_end
  ),
  u as (
    select
      count(*) filter (where created_at < p_end) total_users,
      count(*) filter (where created_at >= p_start and created_at < p_end) new_users,
      count(*) filter (where email_confirmed_at is not null and created_at < p_end) confirmed_users
    from auth.users
  ),
  pro as (
    select count(*) filter (where plan='pro' and pro_status='active') active_pro_users
    from public.profiles
  )
  select jsonb_build_object(
    'range',jsonb_build_object('start',p_start,'end',p_end),
    'kpis',jsonb_build_object(
      'landing_views',(select landing_views from k),
      'landing_cta_clicks',(select landing_cta_clicks from k),
      'signup_starts',(select signup_starts from k),
      'signup_completions',(select signup_completions from k),
      'scan_starts',(select scan_starts from k),
      'scan_completions',(select scan_completions from k),
      'first_scan_completions',(select first_scan_completions from k),
      'challenge_creations',(select challenge_creations from k),
      'challenge_acceptances',(select challenge_acceptances from k),
      'challenge_completions',(select challenge_completions from k),
      'shares',(select shares from k),
      'pwa_installs',(select pwa_installs from k),
      'push_subscriptions',(select push_subscriptions from k),
      'referral_activations',(select referral_activations from k),
      'pro_checkout_opens',(select pro_checkout_opens from k),
      'active_users',(select active_users from k),
      'done_scans',(select done_scans from s),
      'failed_scans',(select failed_scans from s),
      'rejected_scans',(select rejected_scans from s),
      'unique_scanners',(select unique_scanners from s),
      'avg_aura',(select avg_aura from s),
      'best_aura',(select best_aura from s),
      'total_users',(select total_users from u),
      'new_users',(select new_users from u),
      'confirmed_users',(select confirmed_users from u),
      'active_pro_users',(select active_pro_users from pro)
    ),
    'daily','[]'::jsonb,
    'sources','[]'::jsonb,
    'events','[]'::jsonb
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_admin_dashboard(timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.get_admin_dashboard(timestamptz,timestamptz) to authenticated;
