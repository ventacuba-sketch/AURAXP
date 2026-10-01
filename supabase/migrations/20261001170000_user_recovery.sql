-- AURA VS user recovery: admin-only recovery queue + WhatsApp consent + audit trail.
create table if not exists public.user_recovery_contacts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  whatsapp_phone text,
  whatsapp_opt_in boolean not null default false,
  whatsapp_consented_at timestamptz,
  whatsapp_prompted_at timestamptz,
  whatsapp_opted_out_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_recovery_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('magic_link','whatsapp','email','push')),
  action text not null check (action in ('generated','sent','opened','converted')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists user_recovery_attempts_user_created_idx
  on public.user_recovery_attempts(user_id, created_at desc);

alter table public.user_recovery_contacts enable row level security;
alter table public.user_recovery_attempts enable row level security;

drop policy if exists "recovery contact own read" on public.user_recovery_contacts;
create policy "recovery contact own read" on public.user_recovery_contacts for select to authenticated
using (user_id = auth.uid());
drop policy if exists "recovery contact own insert" on public.user_recovery_contacts;
create policy "recovery contact own insert" on public.user_recovery_contacts for insert to authenticated
with check (user_id = auth.uid());
drop policy if exists "recovery contact own update" on public.user_recovery_contacts;
create policy "recovery contact own update" on public.user_recovery_contacts for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.user_recovery_attempts from anon, authenticated;
-- Contact writes go only through set_whatsapp_recovery(): otherwise a client
-- could forge consent timestamps/status with a direct table UPDATE.
revoke insert, update, delete on public.user_recovery_contacts from anon, authenticated;
grant select on public.user_recovery_contacts to authenticated;

drop policy if exists "recovery contact own insert" on public.user_recovery_contacts;
drop policy if exists "recovery contact own update" on public.user_recovery_contacts;

create or replace function public.set_whatsapp_recovery(p_phone text, p_opt_in boolean)
returns void language plpgsql security definer set search_path=public as $$
declare v_phone text := regexp_replace(coalesce(p_phone,''), '[^0-9+]', '', 'g');
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_opt_in and (length(v_phone) < 8 or length(v_phone) > 18) then raise exception 'invalid_phone'; end if;
  insert into public.user_recovery_contacts(user_id, whatsapp_phone, whatsapp_opt_in, whatsapp_consented_at, whatsapp_prompted_at, whatsapp_opted_out_at, updated_at)
  values(auth.uid(), case when p_opt_in then v_phone else null end, p_opt_in,
         case when p_opt_in then now() end, now(), case when not p_opt_in then now() end, now())
  on conflict(user_id) do update set
    whatsapp_phone=excluded.whatsapp_phone, whatsapp_opt_in=excluded.whatsapp_opt_in,
    whatsapp_consented_at=case when excluded.whatsapp_opt_in then now() else user_recovery_contacts.whatsapp_consented_at end,
    whatsapp_prompted_at=coalesce(user_recovery_contacts.whatsapp_prompted_at, now()),
    whatsapp_opted_out_at=case when not excluded.whatsapp_opt_in then now() else null end,
    updated_at=now();
end $$;
grant execute on function public.set_whatsapp_recovery(text,boolean) to authenticated;

create or replace function public.get_admin_recovery_users(p_limit int default 200)
returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare v_admin boolean; v_result jsonb;
begin
 select coalesce(is_admin,false) into v_admin from public.profiles where id=auth.uid();
 if not coalesce(v_admin,false) then raise exception 'not_authorized'; end if;
 select jsonb_build_object(
   'summary', jsonb_build_object(
      'registered', count(*),
      'needs_recovery', count(*) filter(where not exists(select 1 from public.scans s where s.user_id=u.id and s.status='done')),
      'scanned', count(*) filter(where exists(select 1 from public.scans s where s.user_id=u.id and s.status='done')),
      'whatsapp_opted_in', count(*) filter(where coalesce(c.whatsapp_opt_in,false))
   ),
   'users', coalesce(jsonb_agg(jsonb_build_object(
      'user_id',u.id,'email',u.email,'registered_at',u.created_at,'last_sign_in_at',u.last_sign_in_at,
      'email_confirmed',u.email_confirmed_at is not null,
      'has_scan',exists(select 1 from public.scans s where s.user_id=u.id and s.status='done'),
      'scan_count',(select count(*) from public.scans s where s.user_id=u.id and s.status='done'),
      'first_scan_at',(select min(s.created_at) from public.scans s where s.user_id=u.id and s.status='done'),
      'whatsapp_phone',case when c.whatsapp_opt_in then c.whatsapp_phone else null end,
      'whatsapp_opt_in',coalesce(c.whatsapp_opt_in,false),
      'recovery_attempts',(select count(*) from public.user_recovery_attempts a where a.user_id=u.id),
      'last_recovery_at',(select max(a.created_at) from public.user_recovery_attempts a where a.user_id=u.id),
      'source',ca.utm_source,'medium',ca.utm_medium,'campaign',ca.utm_campaign
   ) order by (exists(select 1 from public.scans s where s.user_id=u.id and s.status='done')) asc,u.created_at desc)
   filter(where u.id is not null),'[]'::jsonb)
 ) into v_result
 from (select * from auth.users order by created_at desc limit greatest(1,least(p_limit,500))) u
 left join public.user_recovery_contacts c on c.user_id=u.id
 left join lateral (select utm_source,utm_medium,utm_campaign from public.campaign_attributions x where x.user_id=u.id order by x.last_seen_at desc limit 1) ca on true;
 return v_result;
end $$;
revoke all on function public.get_admin_recovery_users(int) from public,anon;
grant execute on function public.get_admin_recovery_users(int) to authenticated;

create or replace function public.record_recovery_open(p_channel text)
returns void language plpgsql security definer set search_path=public as $$
begin
 if auth.uid() is null then return; end if;
 insert into public.user_recovery_attempts(user_id,channel,action,created_by)
 values(auth.uid(),case when p_channel in ('magic_link','whatsapp','email','push') then p_channel else 'magic_link' end,'opened',auth.uid());
end $$;
grant execute on function public.record_recovery_open(text) to authenticated;
