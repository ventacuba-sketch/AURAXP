// Lógica pura de la respuesta de "Recuperar acceso" -- sin I/O, sin
// imports de Deno/Supabase -- a propósito, para poder testearla con
// Node plano (ver scripts/test-admin-recover-user-access.mjs) sin
// necesitar el runtime de Edge Functions. `index.ts` importa esto mismo,
// nunca una copia: el test cubre el código real, no una reimplementación.
//
// Invariante que esto existe para garantizar: la UI NUNCA puede leer
// "correo enviado" cuando `passwordResetSent` es false. Antes de este
// archivo, `ok: true` se devolvía aunque `resetPasswordForEmail()` hubiera
// fallado después de confirmar el email -- un éxito total y un éxito
// parcial quedaban indistinguibles para el frontend.
export type RecoveryStatus = 'recovered' | 'partial_success' | 'error';

export interface RecoveryResponseBody {
  ok: boolean;
  status: RecoveryStatus;
  passwordResetSent: boolean;
  email?: string;
  emailConfirmed?: boolean;
  alreadyConfirmed?: boolean;
  error?: string;
}

/**
 * Deriva el status a partir de si el reset de contraseña salió. Solo se
 * llama una vez que la confirmación de email (si hacía falta) ya tuvo
 * éxito -- un fallo ahí es 'error' total, manejado antes de llegar acá
 * (ver buildErrorResponse).
 */
export function deriveRecoveryStatus(passwordResetSent: boolean): 'recovered' | 'partial_success' {
  return passwordResetSent ? 'recovered' : 'partial_success';
}

/** `ok` es la única bandera booleana de conveniencia -- siempre derivada
 * de `status`, nunca independiente de él (evita que una rama nueva deje
 * `ok` y `status` contradiciéndose). */
export function isFullSuccess(status: RecoveryStatus): boolean {
  return status === 'recovered';
}

export function buildErrorResponse(error: string, passwordResetSent = false): RecoveryResponseBody {
  return { ok: false, status: 'error', error, passwordResetSent };
}

export function buildRecoveryResponse(params: {
  email: string;
  wasUnconfirmed: boolean;
  passwordResetSent: boolean;
}): RecoveryResponseBody {
  const status = deriveRecoveryStatus(params.passwordResetSent);
  return {
    ok: isFullSuccess(status),
    status,
    email: params.email,
    emailConfirmed: params.wasUnconfirmed,
    alreadyConfirmed: !params.wasUnconfirmed,
    passwordResetSent: params.passwordResetSent,
  };
}
