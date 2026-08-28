import { Session } from '@supabase/supabase-js';

import { supabase } from './supabaseClient';

export type SignUpStatus = 'signedIn' | 'confirmationRequired' | 'alreadyRegistered';

/**
 * Email + password — sin login social todavía (cero configuración externa).
 *
 * Devuelve qué pasó, en vez de solo resolver, porque "se creó la cuenta
 * pero hace falta confirmar el mail" NO es un error — es el camino
 * esperado en cualquier proyecto de Supabase con confirmación de email
 * activada (el default). La pantalla usa este status para mostrar el
 * estado correcto en cada caso.
 */
export async function signUp(email: string, password: string): Promise<SignUpStatus> {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;

  // Supabase, para no filtrar qué emails existen, responde signUp() sin
  // error para un email ya registrado y confirmado — pero `identities`
  // viene vacío en ese caso (a diferencia de un registro nuevo real).
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return 'alreadyRegistered';
  }
  if (data.session) return 'signedIn';
  return 'confirmationRequired';
}

export async function signIn(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthStateChange(callback: (session: Session | null) => void): () => void {
  if (!supabase) return () => {};
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => subscription.unsubscribe();
}

/**
 * Traduce los errores conocidos de Supabase Auth a mensajes en español
 * neutro que un usuario final pueda entender — nunca el texto técnico
 * crudo en inglés.
 */
export function mapAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('email rate limit')) {
    return 'Ya enviamos un correo de confirmación recientemente. Revisa tu bandeja de entrada o intenta de nuevo en unos minutos.';
  }
  if (lower.includes('already registered') || lower.includes('already exists')) {
    return 'Este correo ya está registrado. Inicia sesión.';
  }
  if (lower.includes('invalid login credentials') || lower.includes('invalid credentials')) {
    return 'Correo o contraseña incorrectos.';
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('network request failed') ||
    lower.includes('network error')
  ) {
    return 'No pudimos conectar con el servidor. Intenta de nuevo.';
  }

  return 'Algo salió mal. Intenta de nuevo.';
}
