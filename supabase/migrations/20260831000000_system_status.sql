-- Kill switch de costo: un único lugar para poder frenar/avisar sobre
-- nuevos análisis de Gemini SIN redeploy -- ver auditoría de protección de
-- costos. Hoy no cambia ningún comportamiento: la única fila nace en
-- 'normal', que es exactamente el comportamiento actual (process-scan no
-- lee esta tabla para nada más que decidir si sigue de largo).
--
-- Tres modos, en orden creciente de severidad:
--   normal       -- todo funciona como siempre (default, y el único usado hoy).
--   high_demand  -- process-scan sigue aceptando Scans normalmente; el
--                   frontend puede mostrar un aviso no bloqueante (ver
--                   get-daily-scan-status/DailyScanCounter).
--   emergency    -- process-scan rechaza el Scan ANTES de llamar a Gemini
--                   (el paso que factura) con un error claro y localizado
--                   -- no borra ni corrompe nada, el Scan queda 'rejected'
--                   como cualquier otro límite ya existente (mismo patrón
--                   que daily_upload_limit/fair_use_limit).
--
-- Para activarlo en una emergencia real, sin ningún deploy:
--   update system_status set mode = 'emergency', message = '...' where id;
-- Para volver a la normalidad:
--   update system_status set mode = 'normal', message = null where id;

create table system_status (
  -- Patrón singleton: `id boolean primary key default true` + `check (id)`
  -- hace que la tabla solo pueda tener, como mucho, UNA fila -- cualquier
  -- segundo insert choca contra la primary key. Evita que el sistema tenga
  -- que decidir "cuál fila leo" si alguna vez alguien insertara una
  -- segunda por error.
  id boolean primary key default true,
  mode text not null default 'normal',
  message text,
  updated_at timestamptz not null default now(),
  constraint system_status_single_row check (id),
  constraint system_status_mode_check check (mode in ('normal', 'high_demand', 'emergency'))
);

insert into system_status (id, mode) values (true, 'normal');

alter table system_status enable row level security;

-- Lectura pública a propósito: no es información sensible (no expone nada
-- de ningún usuario), y así el frontend puede mostrar el aviso de
-- high_demand/emergency sin pasar por un Edge Function dedicado solo para
-- esto. Sin policy de insert/update/delete para `anon`/`authenticated` --
-- a propósito, ningún cliente puede cambiar el modo. Cambiarlo es una
-- acción operativa (Dashboard > Table Editor o SQL Editor con
-- service_role), no una función de producto.
create policy "system_status_select_all" on system_status
  for select using (true);

grant select on system_status to anon, authenticated;
