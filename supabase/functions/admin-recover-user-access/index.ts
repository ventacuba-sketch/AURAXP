import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildErrorResponse, buildRecoveryResponse, type RecoveryResponseBody } from './outcome.ts';

// "Recuperar acceso": la única acción administrativa de este módulo que
// modifica un usuario real. Diseño deliberado (ver
// supabase/migrations/20261006000000_admin_user_recovery.sql para el
// contexto completo):
//
// - Actúa sobre EXACTAMENTE un userId por llamada -- nunca hay un modo
//   bulk/"confirmar todos". Confirmar accidentalmente una cuenta falsa,
//   bot o con email mal escrito queda acotado a esa única fila.
// - NUNCA usa `auth.admin.generateLink()`. Esa API devuelve un
//   action_link/token de sesión directamente en la respuesta -- si el
//   admin lo recibiera, podría entrar a la cuenta del usuario sin su
//   consentimiento (account takeover). En su lugar: confirma el email
//   server-side y dispara el flujo YA EXISTENTE y seguro de recuperación
//   de contraseña (`resetPasswordForEmail`), que solo el dueño real de la
//   cuenta puede completar porque el link llega a SU bandeja de entrada.
// - Queda auditado (quién, cuándo, qué se hizo) en
//   public.admin_recovery_actions, con RLS habilitada y cero policies --
//   nadie lee/escribe esa tabla directo, solo esta función (service_role)
//   y las RPCs SECURITY DEFINER del dashboard.
// Toda respuesta -- éxito o error -- trae siempre `status` y
// `passwordResetSent` (nunca `undefined`): el frontend puede afirmar "se
// envió el correo" únicamente leyendo `passwordResetSent === true`, sin
// depender de `ok` ni de la ausencia del campo. La forma exacta del body
// vive en outcome.ts (testeado con Node plano, ver
// scripts/test-admin-recover-user-access.mjs) -- acá solo se serializa.
const json = (body: RecoveryResponseBody, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const errorJson = (error: string, status: number, passwordResetSent = false) =>
  json(buildErrorResponse(error, passwordResetSent), status);

const RESEND_REDIRECT_TO = 'https://auravs.app/reset-password';
const COOLDOWN_MINUTES = 5;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return errorJson('method_not_allowed', 405);

  const authHeader = req.headers.get('authorization');
  if (!authHeader) return errorJson('unauthorized', 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user: caller }, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !caller) return errorJson('unauthorized', 401);

  const admin = createClient(url, serviceKey);
  const { data: callerProfile, error: profileError } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', caller.id)
    .maybeSingle();
  if (profileError) return errorJson('profile_lookup_failed', 500);
  if (!callerProfile?.is_admin) return errorJson('not_authorized', 403);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const targetUserId = typeof body.userId === 'string' ? body.userId : null;
  const confirmed = body.confirm === true;
  if (!targetUserId) return errorJson('missing_user_id', 400);
  if (!confirmed) return errorJson('confirmation_required', 400);

  const { data: targetLookup, error: targetError } = await admin.auth.admin.getUserById(targetUserId);
  const target = targetLookup?.user;
  if (targetError || !target?.email) return errorJson('user_not_found', 404);

  const since = new Date(Date.now() - COOLDOWN_MINUTES * 60 * 1000).toISOString();
  const { count: recentActions, error: cooldownError } = await admin
    .from('admin_recovery_actions')
    .select('id', { count: 'exact', head: true })
    .eq('target_user_id', targetUserId)
    .gte('created_at', since);
  if (cooldownError) return errorJson('cooldown_check_failed', 500);
  if ((recentActions ?? 0) > 0) return errorJson('recovery_cooldown', 429);

  const wasUnconfirmed = !target.email_confirmed_at;
  if (wasUnconfirmed) {
    const { error: confirmError } = await admin.auth.admin.updateUserById(targetUserId, { email_confirm: true });
    // Nada se auditó ni se envió todavía -- la confirmación es la base de
    // toda la operación. Si falla, es un error total: no queda ninguna
    // ambigüedad posible con un reset parcialmente enviado.
    if (confirmError) return errorJson('confirm_failed', 500);
  }

  // Cliente anon nuevo, sin el token del admin en el header -- el reset
  // debe comportarse exactamente igual que si el propio usuario lo hubiera
  // pedido desde "Olvidé mi contraseña".
  const publicClient = createClient(url, anonKey);
  const { error: resetError } = await publicClient.auth.resetPasswordForEmail(target.email, {
    redirectTo: RESEND_REDIRECT_TO,
  });
  const passwordResetSent = !resetError;

  const { error: auditError } = await admin.from('admin_recovery_actions').insert({
    target_user_id: targetUserId,
    performed_by: caller.id,
    email_confirmed: wasUnconfirmed,
    password_reset_sent: passwordResetSent,
    notes: resetError ? `reset_email_failed: ${resetError.message}` : null,
  });
  if (auditError) return errorJson('audit_write_failed', 500, passwordResetSent);

  // 'recovered' vs 'partial_success' vs 'error' -- nunca colapsados en un
  // solo `ok: true` -- ver outcome.ts (testeado en
  // scripts/test-admin-recover-user-access.mjs).
  return json(buildRecoveryResponse({ email: target.email, wasUnconfirmed, passwordResetSent }));
});
