import { Session } from '@supabase/supabase-js';

import { supabase } from './supabaseClient';

export type SignUpStatus = 'signedIn' | 'confirmationRequired' | 'alreadyRegistered';

// A dónde manda Supabase el link "Confirmar correo" del email de
// verificación. Bug real encontrado probando en dos celulares: sin esto,
// Supabase usa el "Site URL" configurado en el dashboard del proyecto --
// que sigue en su default de localhost, así que cualquiera que confirmara
// su cuenta terminaba varado ahí en vez de volver a AURA VS. La raíz
// (sin path): RootNavigator ya sabe qué hacer apenas hay sesión --
// retoma el Challenge pendiente si había uno (ver pendingChallenge.ts),
// así que no hace falta una ruta de callback dedicada.
//
// IMPORTANTE: Supabase ignora un emailRedirectTo que no esté en la lista
// de Redirect URLs permitidas del proyecto (Authentication -> URL
// Configuration) -- si esa lista no incluye este dominio, cae de vuelta
// al Site URL (localhost) igual, con o sin este código. Ese es el único
// paso que no se puede hacer desde el código.
const EMAIL_CONFIRMATION_REDIRECT_URL = 'https://auravs.app';

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
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: EMAIL_CONFIRMATION_REDIRECT_URL },
  });
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

/**
 * `event` ahora se pasa tal cual además de la sesión -- useAuth lo
 * necesita para distinguir 'PASSWORD_RECOVERY' (alguien volvió del link de
 * "olvidé mi contraseña") de un login/confirmación normal. Antes se
 * descartaba (`_event`); ningún caller existente rompe por esto, todos
 * ya ignoraban el primer argumento de todos modos.
 */
export function onAuthStateChange(callback: (event: string, session: Session | null) => void): () => void {
  if (!supabase) return () => {};
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((event, session) => callback(event, session));
  return () => subscription.unsubscribe();
}

// Mismo destino que la confirmación de email (ver EMAIL_CONFIRMATION_REDIRECT_URL
// arriba) y mismo motivo: sin esto, Supabase cae al Site URL del dashboard
// (localhost). RootNavigator detecta el evento PASSWORD_RECOVERY (ver
// useAuth) y manda a ResetPasswordScreen en vez de asumir que cualquier
// sesión nueva significa "entrar a la app normal".
const PASSWORD_RESET_REDIRECT_URL = 'https://auravs.app';

/**
 * Dispara el email de "recuperar contraseña" -- respuesta idéntica exista
 * o no esa cuenta (mismo comportamiento que ya tiene Supabase acá, no
 * hay nada que decidir del lado de la app): nunca hay forma de usar esto
 * para averiguar qué emails tienen cuenta.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: PASSWORD_RESET_REDIRECT_URL,
  });
  if (error) throw error;
}

/**
 * Solo tiene sentido llamarla con la sesión de recuperación temporal que
 * deja el link del email (ver PASSWORD_RECOVERY arriba) -- Supabase la
 * exige así, no hay forma (ni debería haberla) de leer/reusar la
 * contraseña anterior desde acá.
 */
export async function updatePassword(newPassword: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

/** Reenvía el email de confirmación de cuenta -- para alguien que se
 * registró pero perdió/no encuentra el primer correo. */
export async function resendConfirmationEmail(email: string): Promise<void> {
  if (!supabase) throw new Error('Supabase no está configurado');
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: EMAIL_CONFIRMATION_REDIRECT_URL },
  });
  if (error) throw error;
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
  if (
    lower.includes('expired') ||
    lower.includes('invalid') && (lower.includes('token') || lower.includes('otp') || lower.includes('link'))
  ) {
    return 'Este enlace ya no es válido o expiró. Solicita uno nuevo.';
  }
  if (lower.includes('password') && (lower.includes('at least') || lower.includes('should be') || lower.includes('weak'))) {
    return 'La contraseña debe tener al menos 8 caracteres.';
  }
  if (lower.includes('same') && lower.includes('password')) {
    return 'La nueva contraseña tiene que ser distinta de la actual.';
  }

  return 'Algo salió mal. Intenta de nuevo.';
}
