-- AURAXP — esquema inicial del MVP funcional.
-- Tablas: profiles, scans, challenges, daily_scan_counts.
-- Alcance a propósito: nada de feed, ranking, chain real ni amistades.
--
-- Principio de seguridad central: el cliente autenticado puede INSERTAR
-- su propio scan (solo columnas "de entrada"), pero NUNCA puede escribir
-- status/stats/aura_score/xp_awarded. Esos campos nacen NULL/default y
-- solo el Edge Function (service_role, que ignora RLS) los completa.

-- ============================================================
-- Extensiones
-- ============================================================
create extension if not exists "pgcrypto";

-- ============================================================
-- Enums y secuencias
-- ============================================================
create type scan_status as enum ('pending', 'processing', 'done', 'failed', 'rejected');
create sequence founder_number_seq start 1;

-- ============================================================
-- profiles
-- ============================================================
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  avatar_emoji text not null default '🙂',
  founder_number int unique not null default nextval('founder_number_seq'),
  xp bigint not null default 0,
  level int not null default 1,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);

-- Vista pública mínima: lo único que otro usuario puede ver de vos
-- (usada para el preview del Challenge y, más adelante, el versus).
create view public_profiles as
  select id, username, avatar_emoji from profiles;

grant select on public_profiles to anon, authenticated;

-- Column-level grant: username/avatar_emoji son las ÚNICAS columnas que
-- un usuario autenticado puede tocar de su propia fila. xp, level y
-- founder_number no son otorgables — no es una convención de la app,
-- es un permiso que Postgres no le da al rol `authenticated`.
grant update (username, avatar_emoji) on profiles to authenticated;

create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- Crea el profile automáticamente al registrarse.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, 'user_' || substr(new.id::text, 1, 8));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- scans
-- ============================================================
create table scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  status scan_status not null default 'pending',

  -- entrada (el cliente las setea al insertar)
  video_path text not null,
  video_hash text not null,
  duration_ms int not null,

  -- salida (solo las escribe process-scan vía service_role)
  gemini_raw jsonb,
  stats jsonb,
  beats jsonb,
  verdict_headline text,
  verdict_tag text,
  aura_score int,
  xp_awarded int,
  moderation_flagged boolean not null default false,
  moderation_reason text,
  error_message text,

  created_at timestamptz not null default now(),
  analyzed_at timestamptz
);

create index scans_user_id_idx on scans (user_id, created_at desc);
create index scans_video_hash_idx on scans (video_hash);

alter table scans enable row level security;

create policy "scans_select_own" on scans
  for select using (auth.uid() = user_id);

-- El cliente solo puede insertar estas 4 columnas de "entrada".
-- status/stats/beats/aura_score/xp_awarded/verdict_* nacen NULL/default.
grant insert (user_id, video_path, video_hash, duration_ms) on scans to authenticated;

create policy "scans_insert_own" on scans
  for insert with check (auth.uid() = user_id);

-- Sin GRANT UPDATE a `authenticated`: nadie autenticado puede modificar
-- un scan después de crearlo. Esta es la protección central contra
-- falsificar el propio Aura Score / XP desde el cliente.

-- ============================================================
-- challenges
-- ============================================================
create table challenges (
  id uuid primary key default gen_random_uuid(),
  share_token text unique not null,
  source_scan_id uuid not null references scans(id) on delete cascade,
  from_user_id uuid not null references profiles(id) on delete cascade,
  target_scan_id uuid references scans(id),
  created_at timestamptz not null default now()
);

create index challenges_share_token_idx on challenges (share_token);

alter table challenges enable row level security;

create policy "challenges_select_own" on challenges
  for select using (auth.uid() = from_user_id);

grant insert (share_token, source_scan_id, from_user_id) on challenges to authenticated;

create policy "challenges_insert_own" on challenges
  for insert with check (auth.uid() = from_user_id);

-- target_scan_id solo lo escribe process-scan (service_role) cuando
-- alguien completa el challenge. Sin acceso anónimo directo a esta
-- tabla: el preview público pasa por el Edge Function get-challenge-preview.

-- ============================================================
-- daily_scan_counts — anti-farming, uso exclusivo del Edge Function
-- ============================================================
create table daily_scan_counts (
  user_id uuid not null references profiles(id) on delete cascade,
  day date not null default current_date,
  upload_count int not null default 0,
  xp_scan_count int not null default 0,
  primary key (user_id, day)
);

alter table daily_scan_counts enable row level security;
-- A propósito: ninguna policy para `authenticated`/`anon`. Acceso cero
-- desde el cliente; solo service_role la lee/escribe.

-- ============================================================
-- Storage: bucket privado "scans", carpeta = user_id
-- ============================================================
insert into storage.buckets (id, name, public)
values ('scans', 'scans', false)
on conflict (id) do nothing;

create policy "scans_bucket_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'scans'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "scans_bucket_select_own" on storage.objects
  for select using (
    bucket_id = 'scans'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
