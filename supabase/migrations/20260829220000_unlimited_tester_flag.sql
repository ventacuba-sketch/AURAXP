-- Segunda señal para "cuenta de prueba ilimitada", además del secret
-- UNLIMITED_TEST_USER_IDS (que sigue existiendo tal cual -- ver
-- _shared/dailyLimit.ts): una columna que se puede activar por email en
-- una sola sentencia SQL, sin que nadie tenga que copiar un
-- auth.users.id a mano ni pasar por el Dashboard.

alter table profiles add column is_unlimited_tester boolean not null default false;

-- Mismo patrón de seguridad que plan/pro_* (ver pro_plan.sql): NO se
-- agrega a ningún GRANT UPDATE para `authenticated` -- Postgres deniega
-- cualquier intento del cliente de tocar esta columna, con o sin RLS.
-- Solo service_role (Edge Functions, o esta misma migración) puede
-- escribirla.

-- Activa la cuenta de prueba pedida -- resuelve el id por email en la
-- misma sentencia, sin exponerlo ni requerir que alguien lo copie.
-- Si el email no existe todavía, el subquery no matchea ninguna fila y
-- este UPDATE simplemente no hace nada (no falla, no rompe el `db push`).
update profiles
set is_unlimited_tester = true
where id = (select id from auth.users where lower(email) = lower('ioan78dj@yahoo.es'));
