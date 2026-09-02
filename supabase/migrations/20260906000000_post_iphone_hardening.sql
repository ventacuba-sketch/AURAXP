-- Bloque: correcciones post-pruebas reales en iPhone (auditoría, ver
-- resumen entregado aparte). Cubre puntos 3/4 (consumibles + Boost de
-- Confeti), 8 (expiración de Challenges pendientes) y 14 (límite de 8s
-- validado server-side, columna nueva -- el chequeo en sí vive en
-- process-scan/index.ts, usando la lectura real de Gemini).
--
-- Idempotente de punta a punta (mismo criterio que el resto de este
-- bloque desde 20260905*): seguro de correr aunque ya esté aplicada, o
-- sobre una base que tenga estas columnas/funciones a medio aplicar.
-- NO se ejecuta contra producción desde este sandbox -- solo se prepara
-- el SQL, igual que las migraciones anteriores de esta sesión.

-- ============================================================
-- A) Punto 14 -- límite de 8s, defensa en profundidad a nivel de fila.
-- ============================================================
-- `duration_ms` es auto-reportado por el cliente al crear el scan (nunca
-- verificado hasta ahora) -- este CHECK bloquea el caso más simple
-- (alguien edita el JS del cliente o pega directo al insert con un
-- número > 8s). El chequeo REAL, contra el contenido del video, vive en
-- process-scan (observedDurationSec de Gemini, ver _shared/gemini.ts) --
-- ese es el que de verdad no se puede saltear, porque no depende de un
-- dato que manda el propio cliente. 8500ms (no 8000) para no rechazar un
-- clip grabado justo en el límite por un redondeo del lado del cliente.
alter table scans drop constraint if exists scans_duration_ms_check;
alter table scans add constraint scans_duration_ms_check
  check (duration_ms >= 0 and duration_ms <= 8500);

-- Columna donde process-scan deja qué consumible (si había uno armado)
-- se aplicó a ESTE resultado -- ver sección B. null = no había ninguno.
alter table scans add column if not exists consumable_effect_key text;

-- ============================================================
-- B) Puntos 3/4 -- activar un consumible (Boost de Confeti y futuros).
-- ============================================================
-- "Armado" = preparado para el PRÓXIMO Scan que termine con éxito. No es
-- lo mismo que "consumido" (consumed_at, ya existía) -- consumed_at
-- recién se setea cuando ESE Scan realmente termina bien (process-scan),
-- nunca acá en la activación. Esto es justamente lo que permite no
-- consumir la unidad si el usuario abandona o el análisis falla/rechaza.
alter table inventory_items add column if not exists armed_at timestamptz;

-- A lo sumo un consumible armado por usuario a la vez (activate_consumable
-- desarma cualquier otro antes de armar uno nuevo) -- este índice parcial
-- es lo que process-scan usa para encontrarlo rápido sin escanear toda la
-- tabla.
create index if not exists inventory_items_armed_idx on inventory_items (user_id, armed_at)
  where armed_at is not null and consumed_at is null;

-- "No permitir activar algo que no se posee, ya se consumió, o no es un
-- consumible real" -- mismo criterio de ownership que equip_item.
create or replace function public.activate_consumable(p_inventory_item_id uuid)
returns table (ok boolean, error_code text)
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_item_type text;
begin
  if v_uid is null then
    return query select false, 'not_authenticated';
    return;
  end if;

  select si.item_type into v_item_type
  from inventory_items ii
  join store_items si on si.id = ii.store_item_id
  where ii.id = p_inventory_item_id and ii.user_id = v_uid and ii.consumed_at is null;

  if v_item_type is null then
    return query select false, 'not_owned';
    return;
  end if;
  if v_item_type <> 'consumable' then
    return query select false, 'not_consumable';
    return;
  end if;

  -- Un solo consumible armado a la vez -- activar uno nuevo desarma
  -- cualquier otro que hubiera quedado pendiente de un Scan que nunca
  -- se hizo, en vez de acumular varios "en cola" (eso es justo lo que
  -- pidió evitar la auditoría: un único efecto claro para el próximo
  -- resultado, no una cola invisible).
  update inventory_items
  set armed_at = null
  where user_id = v_uid and armed_at is not null and consumed_at is null;

  update inventory_items
  set armed_at = now()
  where id = p_inventory_item_id;

  return query select true, null::text;
end;
$$;

revoke execute on function public.activate_consumable(uuid) from public, anon;
grant execute on function public.activate_consumable(uuid) to authenticated;

-- ============================================================
-- C) Punto 8 -- expiración de Challenges pendientes (72h, ya definidas
-- en `challenges.expires_at` desde 20260829120000 -- lo que faltaba era
-- aplicar el corte también al LEER la lista, no solo al intentar
-- aceptar). Lazy, sin cron: el cliente la llama antes de listar (ver
-- listMyChallenges/getChallenge/countReceivedChallenges en
-- challengeService.ts) -- si nadie mira sus Challenges por un tiempo no
-- pasa nada malo, simplemente se ponen al día la próxima vez que alguien
-- sí los mira.
-- ============================================================
create or replace function public.expire_stale_challenges()
returns void
language sql
security definer set search_path = public
as $$
  update challenges
  set status = 'expired'
  where status = 'pending'
    and expires_at < now()
    and (from_user_id = auth.uid() or target_user_id = auth.uid());
$$;

revoke execute on function public.expire_stale_challenges() from public, anon;
grant execute on function public.expire_stale_challenges() to authenticated;
