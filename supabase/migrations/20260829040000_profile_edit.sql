-- Editar Perfil: agrega bio + cooldown de 7 días sobre cambios de username.
--
-- username_updated_at arranca en NULL a propósito (no default now()): si
-- fuera now(), la migración misma "gastaría" el primer cambio de todos los
-- usuarios existentes en el momento de aplicarla, dejándolos bloqueados 7
-- días sin haber tocado nada. NULL significa "todavía no cambió el
-- username desde que existe esta columna" -> el trigger de abajo permite
-- ese primer cambio sin esperar, y recién ahí arranca a contar.

alter table profiles add column bio text;
alter table profiles add column username_updated_at timestamptz null;

-- bio se suma a las columnas que el propio usuario puede escribir --
-- mismo mecanismo que ya protegía username/avatar_emoji: el cliente
-- autenticado no tiene GRANT UPDATE sobre xp/level/founder_number, eso no
-- cambia acá.
grant update (username, avatar_emoji, bio) on profiles to authenticated;

-- El cooldown se hace acá, en un trigger server-side, y no solo
-- deshabilitando el input en la UI: la policy `profiles_update_own` +
-- el GRANT de arriba ya le permiten al cliente autenticado hacer un
-- UPDATE de username en cualquier momento -- si la única barrera fuera
-- la UI, alcanzaría con llamar la API de Supabase directo para saltarla.
create or replace function public.enforce_username_cooldown()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.username is distinct from old.username then
    if old.username_updated_at is not null
       and now() - old.username_updated_at < interval '7 days' then
      raise exception 'username solo se puede cambiar una vez cada 7 días';
    end if;
    new.username_updated_at := now();
  end if;
  -- Si username no cambió (solo bio/avatar_emoji), username_updated_at
  -- queda intacto -- no hay penalización por editar lo demás.
  return new;
end;
$$;

create trigger profiles_username_cooldown
  before update on profiles
  for each row execute function public.enforce_username_cooldown();
