-- Activación real de PRO: la pieza que faltaba para poder correlacionar un
-- pago de dLocal Go con una cuenta de AURAXP. dLocal Go no soporta crear
-- una suscripción per-usuario vía API (el checkout es un link fijo por
-- plan, ver planService.ts) -- pero SÍ devuelve `client_email` en cada
-- suscripción cuando se lista vía su API REST (confirmado leyendo el
-- código fuente de un cliente open-source de dLocal Go, ver
-- sync-pro-subscriptions/index.ts para el detalle completo). Esa función
-- necesita cruzar ese email contra auth.users -- una tabla que no es
-- accesible via PostgREST (no vive en el schema `public`), así que hace
-- falta esta única función puente.

-- SECURITY DEFINER: corre con los privilegios de quien la creó (que sí
-- puede leer auth.users), así una Edge Function con service_role puede
-- invocarla vía RPC sin necesitar acceso directo al schema `auth`.
create or replace function public.find_profile_id_by_email(p_email text)
returns uuid
language sql
security definer set search_path = public, auth
stable
as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

-- Postgres otorga EXECUTE a PUBLIC por default en una función nueva --
-- hay que revocarlo explícitamente. Ni `anon` ni `authenticated` deben
-- poder llamar esto: permitiría enumerar qué emails tienen cuenta en
-- AURAXP probando uno por uno. Solo debe ser alcanzable server-side
-- (service_role, que igual ignora estos GRANTs).
revoke execute on function public.find_profile_id_by_email(text) from public, anon, authenticated;
