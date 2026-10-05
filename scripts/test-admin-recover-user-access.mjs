// Test de la lógica PURA de "Recuperar acceso" (sin Deno/Supabase, ver
// supabase/functions/admin-recover-user-access/outcome.ts). Cubre el bug
// reportado: `updateUserById` puede tener éxito mientras
// `resetPasswordForEmail` falla, y antes de este archivo la función
// devolvía `ok: true` igual, dejando a la UI afirmar "correo enviado"
// cuando no salió. `node scripts/test-admin-recover-user-access.mjs`.
import assert from 'node:assert/strict';
import {
  buildErrorResponse,
  buildRecoveryResponse,
  deriveRecoveryStatus,
  isFullSuccess,
} from '../supabase/functions/admin-recover-user-access/outcome.ts';

// Caso 1: recuperación completa -- confirmó (hacía falta) y el reset salió.
{
  const body = buildRecoveryResponse({
    email: 'user@test.com',
    wasUnconfirmed: true,
    passwordResetSent: true,
  });
  assert.equal(body.status, 'recovered');
  assert.equal(body.ok, true);
  assert.equal(body.passwordResetSent, true);
  assert.equal(body.emailConfirmed, true);
  assert.equal(body.alreadyConfirmed, false);
  console.log('OK: caso 1 (recuperación completa) ->', body.status, 'passwordResetSent =', body.passwordResetSent);
}

// Caso 2 (el bug reportado): confirmó el email, pero resetPasswordForEmail
// falló. Nunca debe verse como 'recovered' ni como `ok: true`, y
// `passwordResetSent` debe ser `false` explícito -- es el campo que la UI
// lee para decidir si puede afirmar "correo enviado".
{
  const body = buildRecoveryResponse({
    email: 'user@test.com',
    wasUnconfirmed: true,
    passwordResetSent: false,
  });
  assert.equal(body.status, 'partial_success');
  assert.equal(body.ok, false, 'ok debe ser false en éxito parcial -- nunca "true" con el correo sin enviar');
  assert.equal(body.passwordResetSent, false);
  assert.equal(body.emailConfirmed, true, 'el email sí se confirmó en este caso, eso no es lo que falló');
  console.log('OK: caso 2 (éxito parcial, bug reportado) ->', body.status, 'ok =', body.ok, 'passwordResetSent =', body.passwordResetSent);
}

// Caso 3: cuenta ya confirmada antes de esta llamada, reset sale bien ->
// recuperación completa igual, `alreadyConfirmed` true y `emailConfirmed`
// false (no se tocó nada en esta llamada).
{
  const body = buildRecoveryResponse({
    email: 'user@test.com',
    wasUnconfirmed: false,
    passwordResetSent: true,
  });
  assert.equal(body.status, 'recovered');
  assert.equal(body.ok, true);
  assert.equal(body.emailConfirmed, false);
  assert.equal(body.alreadyConfirmed, true);
  console.log('OK: caso 3 (ya confirmada, reset ok) ->', body.status);
}

// Caso 4: cuenta ya confirmada, reset falla -> éxito parcial también (no
// solo aplica cuando `wasUnconfirmed` es true).
{
  const body = buildRecoveryResponse({
    email: 'user@test.com',
    wasUnconfirmed: false,
    passwordResetSent: false,
  });
  assert.equal(body.status, 'partial_success');
  assert.equal(body.ok, false);
  console.log('OK: caso 4 (ya confirmada, reset falla) ->', body.status);
}

// Caso 5: error total (p.ej. confirm_failed) -- nunca confunde
// `passwordResetSent` con el estado real: siempre false salvo que se pase
// explícito (caso de audit_write_failed, que puede ocurrir después de que
// el reset sí salió).
{
  const body = buildErrorResponse('confirm_failed');
  assert.equal(body.status, 'error');
  assert.equal(body.ok, false);
  assert.equal(body.passwordResetSent, false);
  console.log('OK: caso 5 (error total) ->', body.status);
}
{
  const body = buildErrorResponse('audit_write_failed', true);
  assert.equal(body.status, 'error');
  assert.equal(body.passwordResetSent, true, 'el reset síquedó enviado antes del fallo de auditoría -- no se debe ocultar');
  console.log('OK: caso 5b (error total, pero el reset ya había salido) -> passwordResetSent =', body.passwordResetSent);
}

// Invariante general: `ok` siempre coincide con `isFullSuccess(status)`,
// nunca una combinación independiente.
for (const sent of [true, false]) {
  const status = deriveRecoveryStatus(sent);
  assert.equal(isFullSuccess(status), sent);
}

console.log('admin-recover-user-access outcome tests: OK (5 casos)');
