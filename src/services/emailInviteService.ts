import { logEvent } from './analyticsService';
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
    case 'not_configured': return 'Las invitaciones por email todavía no están disponibles.';
    case 'not_authenticated': return 'Tu sesión expiró. Vuelve a iniciar sesión.';
    case 'invalid_email': return 'Ingresa un email válido.';
    case 'cannot_invite_self': return 'No puedes enviarte una invitación a ti mismo.';
    case 'daily_invite_limit': return 'Llegaste al máximo de 5 invitaciones por email en 24 horas.';
    default: return 'No pudimos enviar la invitación. Inténtalo de nuevo.';
  }
}

function normalizeServerCode(value: unknown): EmailInviteErrorCode {
  const raw = String(value ?? '').toLowerCase();
  if (raw.includes('auth') || raw.includes('session') || raw.includes('jwt')) return 'not_authenticated';
  if (raw.includes('invalid') && raw.includes('email')) return 'invalid_email';
  if (raw.includes('self') || raw.includes('yourself')) return 'cannot_invite_self';
  if (raw.includes('limit') || raw.includes('rate') || raw.includes('5')) return 'daily_invite_limit';
  if (raw === 'not_configured') return 'not_configured';
  return 'send_failed';
}

/**
 * Invoca `send-email-invite`. La API key y el referral_code permanecen
 * exclusivamente server-side. El backend aplica el límite anti-spam.
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
    const code = normalizeServerCode(error.message);
    await logEvent('email_invite_failed', { code });
    throw new EmailInviteError(code, messageFor(code));
  }

  if (data?.ok || data?.success) {
    await logEvent('email_invite_sent');
    return;
  }

  const code = normalizeServerCode(data?.error ?? data?.code ?? data?.message);
  await logEvent('email_invite_failed', { code });
  throw new EmailInviteError(code, messageFor(code));
}
