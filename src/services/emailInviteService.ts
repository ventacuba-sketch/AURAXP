import { supabase } from './supabaseClient';

export type EmailInviteErrorCode =
  | 'not_configured'
  | 'not_authenticated'
  | 'invalid_email'
  | 'cannot_invite_self'
  | 'daily_invite_limit'
  | 'send_failed';

export class EmailInviteError extends Error {
  code: EmailInviteErrorCode;

  constructor(code: EmailInviteErrorCode, message: string) {
    super(message);
    this.name = 'EmailInviteError';
    this.code = code;
  }
}

function messageFor(code: EmailInviteErrorCode): string {
  switch (code) {
    case 'not_configured':
      return 'Las invitaciones por email todavía no están disponibles.';
    case 'not_authenticated':
      return 'Tu sesión expiró. Vuelve a iniciar sesión.';
    case 'invalid_email':
      return 'Ingresa un email válido.';
    case 'cannot_invite_self':
      return 'No puedes enviarte una invitación a ti mismo.';
    case 'daily_invite_limit':
      return 'Llegaste al máximo de 5 invitaciones por email en 24 horas.';
    case 'send_failed':
    default:
      return 'No pudimos enviar la invitación. Inténtalo de nuevo.';
  }
}

/**
 * Envía una invitación real a través de la Edge Function `send-email-invite`.
 * El cliente nunca ve la RESEND_API_KEY ni decide el código de referido:
 * ambas cosas se resuelven server-side en Supabase.
 */
export async function sendEmailInvite(email: string): Promise<void> {
  if (!supabase) throw new EmailInviteError('not_configured', messageFor('not_configured'));

  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new EmailInviteError('invalid_email', messageFor('invalid_email'));
  }

  const { data, error } = await supabase.functions.invoke('send-email-invite', {
    body: { email: normalized },
  });

  if (error) {
    throw new EmailInviteError('send_failed', messageFor('send_failed'));
  }

  if (data?.ok) return;

  const code = String(data?.error ?? 'send_failed') as EmailInviteErrorCode;
  const known: EmailInviteErrorCode[] = [
    'not_configured',
    'not_authenticated',
    'invalid_email',
    'cannot_invite_self',
    'daily_invite_limit',
    'send_failed',
  ];
  const safeCode = known.includes(code) ? code : 'send_failed';
  throw new EmailInviteError(safeCode, messageFor(safeCode));
}
