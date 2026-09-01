-- Bloque: Coins + Wallet + Misiones/Racha con recompensa real + Referidos.
-- Auditado primero (ver reporte de esta tarea): no existía ningún sistema
-- de economía, wallet ni ledger todavía -- esto es la base sobre la que
-- se apoyan Tienda/Inventario/Regalos/Follow (siguiente migración) y,
-- más adelante, Group Battles/AURA LIVE. Todo server-side a propósito:
-- ningún saldo se confía nunca al cliente.
--
-- NOTA (re-alineación con producción, auditoría posterior): producción
-- ya tiene este bloque aplicado -- vía una migración equivalente
-- endurecida aplicada directamente durante una auditoría -- pero con
-- CORRECCIONES sobre lo que había acá originalmente. Esta migración se
-- reescribió para (1) ser 100% idempotente contra una base que YA tiene
-- estos objetos (CREATE TABLE/INDEX IF NOT EXISTS, políticas con DROP
-- POLICY IF EXISTS + CREATE POLICY, ADD COLUMN IF NOT EXISTS, CREATE OR
-- REPLACE FUNCTION/TRIGGER) y (2) incorporar esas correcciones, para que
-- una base NUEVA termine exactamente en el mismo estado que producción:
--   - apply_coin_transaction() ahora bloquea la wallet (FOR UPDATE)
--     ANTES de revisar el idempotency_key, no después -- cierra una
--     race condition real: dos requests simultáneas con la misma
--     idempotency_key podían, en la versión vieja, pasar la revisión de
--     idempotencia AL MISMO TIEMPO (ninguna veía todavía la fila del
--     otro) y terminar aplicando el movimiento dos veces.
--   - Los RPC internos/privados quedan con su EXECUTE revocado de
--     public/anon explícitamente (antes dependían solo del default de
--     Postgres, que da EXECUTE a PUBLIC en toda función nueva salvo que
--     se revoque a mano).

-- ============================================================
-- A) Wallet + ledger inmutable
-- ============================================================
create table if not exists wallets (
  user_id uuid primary key references profiles(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

alter table wallets enable row level security;

drop policy if exists "wallets_select_own" on wallets;
create policy "wallets_select_own" on wallets
  for select using (auth.uid() = user_id);

grant select on wallets to authenticated;
-- Sin GRANT insert/update para `authenticated` a propósito: el ÚNICO
-- camino para tocar un saldo es apply_coin_transaction() (más abajo,
-- SECURITY DEFINER, revocada de authenticated) -- ni siquiera el propio
-- dueño puede escribir su fila directo.

-- Ledger append-only: 100% de la historia de un saldo, nunca resumida ni
-- borrada. `amount` positivo = crédito, negativo = débito; `balance_after`
-- deja cada fila auto-verificable sin tener que sumar todo el historial
-- cada vez que hace falta auditar. `idempotency_key` (único POR USUARIO,
-- no global) es la defensa real contra doble-cobro/doble-recompensa por
-- un reintento de red o un doble tap -- mismo criterio que ya usa
-- create_direct_challenge para Challenges duplicados.
create table if not exists coin_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  amount bigint not null check (amount <> 0),
  balance_after bigint not null,
  type text not null check (type in (
    'signup_bonus', 'mission_reward', 'streak_bonus',
    'referral_referrer_bonus', 'referral_referred_bonus',
    'pro_monthly_bonus', 'store_purchase', 'gift_sent'
  )),
  reference_type text,
  reference_id uuid,
  idempotency_key text,
  created_at timestamptz not null default now()
);

create index if not exists coin_transactions_user_id_created_idx on coin_transactions (user_id, created_at desc);
-- Único POR USUARIO (no global) -- dos usuarios distintos pueden tener
-- coincidentemente la misma key (p. ej. si algún día se arma a partir de
-- un id de fila ajena), pero el mismo usuario nunca puede aplicar la
-- misma key dos veces.
create unique index if not exists coin_transactions_user_idempotency_idx on coin_transactions (user_id, idempotency_key) where idempotency_key is not null;

alter table coin_transactions enable row level security;

drop policy if exists "coin_transactions_select_own" on coin_transactions;
create policy "coin_transactions_select_own" on coin_transactions
  for select using (auth.uid() = user_id);

grant select on coin_transactions to authenticated;
-- Sin insert para `authenticated`: solo apply_coin_transaction() escribe acá.

-- ── apply_coin_transaction: ÚNICO camino real para tocar un saldo ──────
-- Primitiva interna -- revocada de authenticated/anon a propósito (ver el
-- REVOKE al final). Cada acción económica real (misión, compra, regalo,
-- referido, PRO mensual) tiene su PROPIA función pública que valida SU
-- regla de negocio y recién then llama a esta -- nunca se expone
-- directo, así ninguna pantalla puede "acreditarse" Coins inventando un
-- `type`/`amount` propio.
--
-- CORRECCIÓN (auditoría): el orden real ahora es
--   1) LOCK de la wallet (FOR UPDATE)
--   2) recién ahí, revisar el idempotency_key
-- en vez de al revés. Con el orden viejo, dos requests concurrentes con
-- la MISMA idempotency_key podían las dos pasar el chequeo de
-- idempotencia (ninguna había insertado todavía la fila de
-- coin_transactions) antes de que cualquiera tomara el lock de la
-- wallet, y las dos terminaban aplicando el movimiento -- doble cobro o
-- doble recompensa real. Con el lock primero, la segunda request queda
-- bloqueada hasta que la primera termine (commit); cuando por fin puede
-- tomar el lock, el idempotency_key YA existe (insertado por la primera)
-- y devuelve el resultado ya aplicado sin tocar el saldo de nuevo.
create or replace function public.apply_coin_transaction(
  p_user_id uuid,
  p_amount bigint,
  p_type text,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_idempotency_key text default null
)
returns table (ok boolean, new_balance bigint, error_code text, transaction_id uuid)
language plpgsql
security definer set search_path = public
as $$
declare
  v_balance bigint;
  v_new_balance bigint;
  v_tx_id uuid;
  v_existing_id uuid;
  v_existing_balance bigint;
begin
  -- 1) Lock PRIMERO -- ninguna otra transacción concurrente sobre esta
  -- misma wallet puede avanzar mientras esta no termine (commit/rollback).
  select balance into v_balance from wallets where user_id = p_user_id for update;
  if not found then
    return query select false, null::bigint, 'no_wallet', null::uuid;
    return;
  end if;

  -- 2) Recién con el lock tomado, revisar idempotencia (J/O): un
  -- reintento con la MISMA key nunca vuelve a aplicar el movimiento --
  -- devuelve el resultado ya aplicado, sin tocar el saldo una segunda
  -- vez. Cualquier otra request concurrente con la misma key quedó
  -- bloqueada en el FOR UPDATE de arriba hasta que esta termine, así que
  -- este chequeo ya ve el estado final real, nunca uno a medio aplicar.
  if p_idempotency_key is not null then
    select id, balance_after into v_existing_id, v_existing_balance
    from coin_transactions
    where user_id = p_user_id and idempotency_key = p_idempotency_key;

    if v_existing_id is not null then
      return query select true, v_existing_balance, null::text, v_existing_id;
      return;
    end if;
  end if;

  v_new_balance := v_balance + p_amount;
  if v_new_balance < 0 then
    return query select false, v_balance, 'insufficient_funds', null::uuid;
    return;
  end if;

  insert into coin_transactions (user_id, amount, balance_after, type, reference_type, reference_id, idempotency_key)
  values (p_user_id, p_amount, v_new_balance, p_type, p_reference_type, p_reference_id, p_idempotency_key)
  returning id into v_tx_id;

  update wallets set balance = v_new_balance, updated_at = now() where user_id = p_user_id;

  -- Analítica (T) desde el ÚNICO choke point real de la economía --
  -- 'coins_earned'/'coins_spent' quedan garantizados sin importar CUÁL de
  -- las funciones públicas (misión, compra, regalo, referido, PRO
  -- mensual) haya llamado a esto, en vez de tener que acordarse de
  -- loguearlo en cada una por separado. Best-effort real: nunca debe
  -- poder tumbar la transacción económica que ya se aplicó arriba.
  begin
    insert into analytics_events (event_name, user_id, metadata)
    values (
      case when p_amount > 0 then 'coins_earned' else 'coins_spent' end,
      p_user_id,
      jsonb_build_object('amount', abs(p_amount), 'type', p_type)
    );
  exception when others then
    raise warning 'apply_coin_transaction: analytics failed for tx %: %', v_tx_id, sqlerrm;
  end;

  return query select true, v_new_balance, null::text, v_tx_id;
end;
$$;

revoke execute on function public.apply_coin_transaction(uuid, bigint, text, text, uuid, text) from public, anon, authenticated;

-- ============================================================
-- B) Wallet inicial automática (1.000 Coins) + código de referido
-- ============================================================
-- Trigger propio en `profiles`, NO se toca handle_new_user() (el trigger
-- ya existente de auth.users->profiles, camino crítico de Auth) -- cero
-- riesgo para el signup real, esto es puramente aditivo y corre DESPUÉS
-- de que el profile ya existe.
create or replace function public.create_wallet_for_new_profile()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_code text;
  v_attempts int := 0;
begin
  insert into wallets (user_id, balance) values (new.id, 1000);
  insert into coin_transactions (user_id, amount, balance_after, type)
  values (new.id, 1000, 1000, 'signup_bonus');

  begin
    insert into analytics_events (event_name, user_id) values ('wallet_created', new.id);
  exception when others then
    raise warning 'create_wallet_for_new_profile: analytics failed for %: %', new.id, sqlerrm;
  end;

  -- Reintenta si el código choca (8 hex mayúsculas -- colisión
  -- extremadamente improbable, pero nunca debe poder tumbar el signup).
  loop
    v_attempts := v_attempts + 1;
    v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    begin
      update profiles set referral_code = v_code where id = new.id;
      exit;
    exception when unique_violation then
      if v_attempts > 20 then exit; end if;
    end;
  end loop;

  return new;
end;
$$;

-- Función de trigger -- nadie la llama directo (Postgres ya lo impide
-- estructuralmente), pero se revoca el EXECUTE por defecto de PUBLIC
-- igual, mismo criterio que apply_coin_transaction.
revoke execute on function public.create_wallet_for_new_profile() from public, anon, authenticated;

create or replace trigger on_profile_created_wallet
  after insert on profiles
  for each row execute function public.create_wallet_for_new_profile();

-- ── Backfill para cuentas ya existentes (idempotente, seguro de re-correr) ──
insert into wallets (user_id, balance)
select id, 1000 from profiles p where not exists (select 1 from wallets w where w.user_id = p.id);

insert into coin_transactions (user_id, amount, balance_after, type)
select id, 1000, 1000, 'signup_bonus' from profiles p
where not exists (select 1 from coin_transactions t where t.user_id = p.id and t.type = 'signup_bonus');

alter table profiles add column if not exists referral_code text unique;

do $$
declare
  r record;
  v_code text;
  v_attempts int;
begin
  for r in select id from profiles where referral_code is null loop
    v_attempts := 0;
    loop
      v_attempts := v_attempts + 1;
      v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
      begin
        update profiles set referral_code = v_code where id = r.id;
        exit;
      exception when unique_violation then
        if v_attempts > 20 then exit; end if;
      end;
    end loop;
  end loop;
end $$;

-- ============================================================
-- C) Misiones diarias + racha -- recompensa real, un claim por día
-- ============================================================
-- Las misiones (scanDone/challengeCompletedToday/sharedToday, ver
-- missionsService.ts) ya se CALCULAN client-side a partir de eventos
-- reales -- eso no cambia. Lo que faltaba es el CLAIM: acá se
-- RE-VALIDA la condición server-side (nunca se confía en que el
-- cliente "dice" que la cumplió) y se garantiza un solo cobro por
-- misión por día via el UNIQUE de abajo.
create table if not exists mission_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  mission_key text not null check (mission_key in ('scan', 'challenge', 'share', 'streak')),
  day date not null,
  coins_awarded int not null,
  created_at timestamptz not null default now(),
  unique (user_id, mission_key, day)
);

alter table mission_claims enable row level security;

drop policy if exists "mission_claims_select_own" on mission_claims;
create policy "mission_claims_select_own" on mission_claims
  for select using (auth.uid() = user_id);

grant select on mission_claims to authenticated;

-- Reparto real (máximo normal ~400 Coins/día, según lo acordado):
-- scan 100 + challenge 150 + share 100 + racha hasta 50 (10 x streak,
-- tope 5 días) = 400 techo. `day` siempre en UTC -- mismo criterio que
-- get_my_streak() y daily_scan_counts, un solo huso horario en todo el
-- backend, nunca el del dispositivo del cliente.
create or replace function public.claim_mission_reward(p_mission_key text)
returns table (ok boolean, coins_awarded int, error_code text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'utc')::date;
  v_amount int;
  v_completed boolean;
  v_streak int;
  v_claim_id uuid;
  v_tx_result record;
begin
  if v_uid is null then
    return query select false, 0, 'not_authenticated';
    return;
  end if;

  if exists (select 1 from mission_claims where user_id = v_uid and mission_key = p_mission_key and day = v_today) then
    return query select false, 0, 'already_claimed';
    return;
  end if;

  if p_mission_key = 'scan' then
    v_amount := 100;
    select exists(
      select 1 from scans
      where user_id = v_uid and status = 'done' and (created_at at time zone 'utc')::date = v_today
    ) into v_completed;
  elsif p_mission_key = 'challenge' then
    v_amount := 150;
    select exists(
      select 1 from challenges
      where (from_user_id = v_uid or opponent_user_id = v_uid)
        and status = 'completed' and (resolved_at at time zone 'utc')::date = v_today
    ) into v_completed;
  elsif p_mission_key = 'share' then
    v_amount := 100;
    select exists(
      select 1 from analytics_events
      where user_id = v_uid and event_name = 'share' and (created_at at time zone 'utc')::date = v_today
    ) into v_completed;
  elsif p_mission_key = 'streak' then
    select current_streak into v_streak from get_my_streak();
    v_completed := coalesce(v_streak, 0) > 0;
    v_amount := least(coalesce(v_streak, 0), 5) * 10;
  else
    return query select false, 0, 'unknown_mission';
    return;
  end if;

  if not v_completed then
    return query select false, 0, 'not_completed';
    return;
  end if;

  begin
    insert into mission_claims (user_id, mission_key, day, coins_awarded)
    values (v_uid, p_mission_key, v_today, v_amount)
    returning id into v_claim_id;
  exception when unique_violation then
    return query select false, 0, 'already_claimed';
    return;
  end;

  select * into v_tx_result from apply_coin_transaction(
    v_uid, v_amount,
    case when p_mission_key = 'streak' then 'streak_bonus' else 'mission_reward' end,
    'mission_claims', v_claim_id, null
  );

  if v_tx_result.ok then
    begin
      insert into analytics_events (event_name, user_id, metadata)
      values ('mission_completed', v_uid, jsonb_build_object('mission_key', p_mission_key, 'coins_awarded', v_amount));
    exception when others then
      raise warning 'claim_mission_reward: analytics failed for %/%: %', v_uid, p_mission_key, sqlerrm;
    end;
  end if;

  return query select v_tx_result.ok, v_amount, v_tx_result.error_code;
end;
$$;

-- "authenticated sí, anon no" -- sin este REVOKE explícito, el default
-- de Postgres (EXECUTE a PUBLIC en toda función nueva) dejaría esto
-- llamable también por `anon`.
revoke execute on function public.claim_mission_reward(text) from public, anon;
grant execute on function public.claim_mission_reward(text) to authenticated;

-- ============================================================
-- D) Referidos -- premio SOLO cuando el referido completa su primer Scan
-- ============================================================
create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references profiles(id) on delete cascade,
  -- unique: un mismo usuario referido solo puede quedar atribuido UNA
  -- vez en toda su vida -- ni a un segundo referrer, ni dos veces al
  -- mismo (anti-abuso básico J-1).
  referred_id uuid not null unique references profiles(id) on delete cascade,
  code_used text not null,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  constraint referrals_no_self check (referrer_id <> referred_id)
);

create index if not exists referrals_referrer_id_idx on referrals (referrer_id);

alter table referrals enable row level security;

drop policy if exists "referrals_select_own" on referrals;
create policy "referrals_select_own" on referrals
  for select using (auth.uid() = referrer_id or auth.uid() = referred_id);

grant select on referrals to authenticated;

-- Llamada UNA vez por el usuario NUEVO, apenas hay sesión, con el código
-- capturado de la URL (?ref=CODE) -- ver services/referralService.ts.
-- Solo REGISTRA la atribución; el pago queda condicionado al primer Scan
-- real (trigger de abajo), nunca acá.
create or replace function public.attribute_referral(p_code text)
returns table (ok boolean, error_code text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_referrer_id uuid;
begin
  if v_uid is null then
    return query select false, 'not_authenticated';
    return;
  end if;

  if exists (select 1 from referrals where referred_id = v_uid) then
    return query select false, 'already_attributed';
    return;
  end if;

  select id into v_referrer_id from profiles where referral_code = upper(p_code);
  if v_referrer_id is null then
    return query select false, 'invalid_code';
    return;
  end if;

  if v_referrer_id = v_uid then
    return query select false, 'cannot_refer_self';
    return;
  end if;

  insert into referrals (referrer_id, referred_id, code_used) values (v_referrer_id, v_uid, upper(p_code));
  return query select true, null::text;
end;
$$;

-- "authenticated sí, anon no" -- ver comentario equivalente en
-- claim_mission_reward.
revoke execute on function public.attribute_referral(text) from public, anon;
grant execute on function public.attribute_referral(text) to authenticated;

-- Activación real (anti-abuso J: "premio SOLO cuando complete su primer
-- Scan válido") -- trigger aislado en su propio EXCEPTION handler, nunca
-- puede tumbar el UPDATE real de `scans` que lo dispara. `for update`
-- sobre la fila de referrals: dos scans casi simultáneos (no debería
-- pasar, pero por las dudas) no pueden activar el mismo referido dos veces.
create or replace function public.activate_referral_on_first_scan()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_ref referrals%rowtype;
begin
  select * into v_ref from referrals where referred_id = new.user_id and activated_at is null for update;
  if not found then
    return new;
  end if;

  update referrals set activated_at = now() where id = v_ref.id;

  perform apply_coin_transaction(v_ref.referrer_id, 5000, 'referral_referrer_bonus', 'referrals', v_ref.id, 'referral_referrer_' || v_ref.id::text);
  perform apply_coin_transaction(v_ref.referred_id, 2500, 'referral_referred_bonus', 'referrals', v_ref.id, 'referral_referred_' || v_ref.id::text);

  begin
    insert into notifications (user_id, kind, rival_user_id) values (v_ref.referrer_id, 'referral_activated', v_ref.referred_id);
  exception when others then
    raise warning 'activate_referral_on_first_scan: notification failed for referral %: %', v_ref.id, sqlerrm;
  end;

  -- Analítica server-side (T) -- mismo criterio que challenge_completed
  -- en challengeResolution.ts: la activación es un hecho que pasa server-
  -- side y no depende de que el referrer siga conectado en ese momento,
  -- así que no puede depender de un logEvent() del cliente.
  begin
    insert into analytics_events (event_name, user_id, metadata) values
      ('referral_activated', v_ref.referrer_id, jsonb_build_object('referral_id', v_ref.id)),
      ('referral_activated', v_ref.referred_id, jsonb_build_object('referral_id', v_ref.id, 'role', 'referred'));
  exception when others then
    raise warning 'activate_referral_on_first_scan: analytics failed for referral %: %', v_ref.id, sqlerrm;
  end;

  return new;
exception when others then
  raise warning 'activate_referral_on_first_scan failed for scan %: %', new.id, sqlerrm;
  return new;
end;
$$;

-- Función de trigger -- nadie la llama directo (Postgres ya lo impide
-- estructuralmente), pero se revoca el EXECUTE por defecto de PUBLIC
-- igual, mismo criterio que apply_coin_transaction/create_wallet_for_new_profile.
revoke execute on function public.activate_referral_on_first_scan() from public, anon, authenticated;

create or replace trigger scans_referral_activation_trigger
  after update of status on scans
  for each row
  when (new.status = 'done' and old.status is distinct from 'done')
  execute function public.activate_referral_on_first_scan();

-- 'referral_activated' es un kind nuevo -- widen del CHECK (idempotente,
-- ver la migración de hardening del bloque anterior para el mismo patrón).
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in (
    'challenge_accepted', 'challenge_completed', 'challenge_received', 'challenge_rejected',
    'referral_activated', 'new_follower', 'gift_received'
  ));
