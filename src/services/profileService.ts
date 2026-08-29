import { getSession } from './authService';
import { supabase } from './supabaseClient';

/** Días de cooldown entre cambios de username — debe reflejar el trigger
 * `enforce_username_cooldown` en supabase/migrations/*_profile_edit.sql. */
const USERNAME_COOLDOWN_DAYS = 7;

export interface ProfileUpdate {
  username?: string;
  avatarEmoji?: string;
  bio?: string;
}

export class ProfileUpdateError extends Error {}

function mapProfileUpdateError(message: string): string {
  if (message.includes('username solo se puede cambiar')) {
    // Mismo texto que lanza el trigger -- ya está en español y es claro,
    // pero lo homogeneizamos con el resto de mensajes de error de la app.
    return 'Ya cambiaste tu username hace poco. Probá de nuevo más adelante.';
  }
  if (message.includes('duplicate key') && message.includes('username')) {
    return 'Ese username ya está en uso.';
  }
  return 'No pudimos guardar los cambios. Intenta de nuevo.';
}

/**
 * Actualiza username/avatar_emoji/bio de la propia fila en `profiles`.
 * El cooldown de 7 días sobre username se aplica server-side (trigger
 * enforce_username_cooldown) -- si se viola, Supabase devuelve un error de
 * Postgres que acá se traduce a un mensaje legible.
 */
export async function updateProfile(update: ProfileUpdate): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado');
  const session = await getSession();
  if (!session) throw new Error('No autenticado');

  const payload: Record<string, string> = {};
  if (update.username !== undefined) payload.username = update.username;
  if (update.avatarEmoji !== undefined) payload.avatar_emoji = update.avatarEmoji;
  if (update.bio !== undefined) payload.bio = update.bio;

  const { error } = await supabase.from('profiles').update(payload).eq('id', session.user.id);
  if (error) throw new ProfileUpdateError(mapProfileUpdateError(error.message));
}

/**
 * 0 si ya puede cambiar el username (nunca lo cambió, o pasaron los 7
 * días); si no, cuántos días completos faltan -- para mostrar "Podrás
 * cambiar tu username nuevamente en N días".
 */
export function usernameCooldownDaysLeft(usernameUpdatedAt: string | null): number {
  if (!usernameUpdatedAt) return 0;
  const cooldownMs = USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const remainingMs = cooldownMs - (Date.now() - new Date(usernameUpdatedAt).getTime());
  return remainingMs <= 0 ? 0 : Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
}
