# Recuperación de usuarios — auditoría, arquitectura y limitaciones

Módulo nuevo del Admin Dashboard para recuperar dos poblaciones históricas:
(1) usuarios atrapados por los sistemas de confirmación de email/OTP ya
retirados y (2) usuarios registrados que nunca completaron un primer Scan.
Rama: `feature/admin-user-recovery`, desde `main`. **Ningún merge, deploy ni
migración real se aplicó como parte de este trabajo** — todo lo de abajo se
probó contra un Postgres local descartable (réplica completa del historial
de 39 migraciones + esta nueva), `tsc`, `regression-gate` y `expo export`,
nunca contra el proyecto Supabase real (ver sección 6, limitación de
credenciales).

## 0. Revisión post-PR — 2 correcciones antes de mergear

Una revisión del PR #31 encontró 2 problemas reales, corregidos en la misma
rama antes de este merge:

1. **`admin-recover-user-access` podía afirmar "correo enviado" sin
   haberlo enviado.** `updateUserById(email_confirm: true)` puede tener
   éxito mientras `resetPasswordForEmail()` falla después -- la función
   devolvía `ok: true` en ambos casos, sin forma de distinguirlos. Ahora la
   lógica de la respuesta vive en `outcome.ts` (sin I/O, testeada en
   `scripts/test-admin-recover-user-access.mjs`) y separa 3 resultados
   explícitos: `'recovered'` (confirmó si hacía falta + reset salió),
   `'partial_success'` (email confirmado pero el reset **no** salió --
   `ok: false` a propósito) y `'error'` (no se logró nada útil).
   `passwordResetSent` viaja siempre explícito (nunca `undefined`) y es la
   única fuente de verdad que la UI usa para decidir si puede decir "correo
   enviado" -- nunca infiere eso de `ok`. La pantalla ahora muestra un
   mensaje distinto y en otro color para el caso parcial.
2. **`recovery_rate_pct` podía superar 100% o caer a 0% de golpe.** La
   fórmula original dividía "recuperados históricos" (`admin_recovery_actions`)
   sobre "no confirmados ACTUALMENTE" -- apenas se recupera a alguien, sale
   del denominador pero sigue en el numerador. Reproducido con datos
   reales de prueba: recuperar a un usuario que nunca había estado
   no-confirmado (ej. reenviarle el reset por otro motivo) hacía que la
   tasa diera **200%** con solo 1 no-confirmado restante. Corregido
   definiendo la población elegible como la UNIÓN estable de "sigue sin
   confirmar hoy" y "tiene alguna acción de recuperación registrada" --
   un usuario recuperado nunca sale de esa unión, así que el numerador
   (recuperados) queda siempre contenido en el denominador (elegibles) y
   la tasa queda matemáticamente acotada a `[0, 100]`. Verificado con el
   mismo escenario reproducido (ver sección 5).

## 1. Auditoría — qué encontramos antes de escribir código

### 1.1 Historia real de confirmación/OTP (orden cronológico por migraciones/PRs)

1. **Confirmación de email obligatoria** (esquema inicial).
2. **OTP de 6 dígitos** (PR #26 `fix/email-otp-clean-oct5`) — reemplazó el
   link de confirmación por un código.
3. **Periodo roto**: Supabase mandaba un OTP de 8 dígitos pero la UI solo
   aceptaba 6 (mencionado explícitamente en el pedido; coherente con que
   `pendingOtp.ts` tiene funciones de guardado/lectura sin ningún llamador
   real en el código actual — quedaron como vestigio).
4. **Funnel actual, sin OTP** (PR #30 `fix/remove-signup-otp-oct5`,
   fusionado 2026-10-05): `signUp()` deja sesión inmediata, `Confirm Email`
   desactivado en el proyecto. `clearPendingSignupOtp()` sigue llamándose
   defensivamente en cada montaje de `AuthScreen` y tras un login exitoso —
   limpia cualquier resto de estado OTP persistido por una versión vieja de
   la app en el dispositivo del usuario, así que un OTP viejo guardado en
   `AsyncStorage` nunca puede resucitar una pantalla OTP (no existe ninguna
   ruta/pantalla OTP en el routing actual — confirmado por grep en
   `RootNavigator.tsx` y `AuthScreen.tsx`).

### 1.2 ¿Desactivar "Confirm Email" ya arregló a los usuarios viejos?

**No.** Verificado contra el código fuente real de
`github.com/supabase/auth` (`internal/api/token.go`, grant de password):
el login rechaza con `email not confirmed` de forma **incondicional** si
`email_confirmed_at is null`, sin mirar el valor actual de `Confirm Email`
del proyecto. Ese toggle solo cambia el comportamiento de los **signups
nuevos** desde que se desactivó — nunca confirma retroactivamente a nadie.
Por eso las cuentas de los puntos 1–3 siguen bloqueadas hoy, de verdad, y
por eso la acción "Recuperar acceso" (sección 3) tiene sentido real.

### 1.3 Fuentes de atribución disponibles, de más a menos reciente

1. `public.user_attributions` (desde el 5-oct, hardening de atribución) —
   la más completa: `fbclid`/`fbc`/`fbp`/UTMs completos, vinculada por
   trigger `after insert on auth.users` (corre incluso sin confirmar email).
2. `public.campaign_attributions` (desde el 25-sep) — visitor_id + UTMs,
   vinculada por RPC (`capture_campaign_attribution`) llamada desde el
   cliente, más la vinculación por trigger agregada el 5-oct para signups
   nuevos.
3. `analytics_events.metadata` (desde el 25-sep, `feat: add paid
   acquisition attribution funnel`) — **no incorporada en ningún lugar
   existente del dashboard**, y la agregamos acá como tercer fallback: cada
   evento llevaba ya entonces `utm_source`/`utm_medium`/`utm_campaign`/
   `utm_content`/`visitor_id` en su `metadata` jsonb, grabado en el momento
   mismo del evento — no depende de que el RPC de vinculación haya corrido
   con éxito. Se usa el evento más antiguo de cada usuario que sí tenga
   `utm_source` para aproximar first-touch. Verificado con datos sintéticos
   (sección 5): recupera attribution Meta real para un usuario sin ninguna
   fila en las otras dos tablas.

Ninguna fuente cubre usuarios anteriores al 25-sep — para esos, el único
dato real es que existen y están confirmados o no; la atribución se muestra
como **"Sin atribución"**, nunca inventada.

### 1.4 A/B / creativo

No existe infraestructura de A/B testing en el esquema. Se usa
`utm_content` como identificador de creativo — mismo criterio que ya usa
`get_admin_dashboard` (`DashboardSource.campaign`).

### 1.5 País / geolocalización

No existe ninguna columna de país/geolocalización en ninguna tabla del
proyecto. El filtro pedido por país **no se implementó** — inventar un dato
que no existe habría violado la instrucción explícita de nunca inventar
atribución.

## 2. Qué se construyó

### 2.1 Migración `20261006000000_admin_user_recovery.sql`

100% nueva — no modifica ninguna tabla, función ni migración histórica.

- **`public.admin_recovery_actions`**: auditoría de toda acción de
  recuperación (`target_user_id`, `performed_by`, `email_confirmed`,
  `password_reset_sent`, `notes`, `created_at`). RLS habilitada, **cero
  policies** — igual criterio que `live_webhook_events`: solo la Edge
  Function (service_role) escribe, solo las RPCs de abajo (SECURITY
  DEFINER) la leen. Ningún cliente, admin incluido, puede leerla/escribirla
  directo vía supabase-js (verificado en la sección 5.3).
- **`public._assert_admin_caller()`**: único chequeo fail-closed sobre
  `profiles.is_admin`, reutilizado por las 3 RPCs de abajo.
- **`public.admin_user_recovery_kpis(...)`** → jsonb con `registered`,
  `unconfirmed_legacy`, `no_first_scan`, `reached_upload_abandoned`,
  `attempted_scan_failed`, `recovered`, `recovery_rate_pct`.
- **`public.admin_list_user_recovery(...)`** → tabla paginada (máx 200/
  página), búsqueda por email parcial o `user_id` exacto, filtros por
  segmento/fuente/confirmado/primer-scan/campaña/creativo, columna
  `funnel_stage` (`registered_only` → `viewed_upload` → `selected_video` →
  `attempted_submit` → `completed_first_scan`).
- **`public.admin_get_user_recovery_detail(p_user_id)`** → jsonb con datos
  del usuario, últimos 50 Scans, últimos 200 eventos y el historial de
  acciones de recuperación sobre esa cuenta.

Las 3 RPCs: `security definer`, `set search_path = ''`, `revoke all` de
`public/anon/authenticated` + `grant execute` solo a `authenticated` (la
protección real es `_assert_admin_caller()`, no el grant — mismo patrón
que `get_admin_dashboard`).

### 2.2 Edge Function `admin-recover-user-access`

Única acción que modifica un usuario real. Diseño deliberado:

- Actúa sobre **exactamente un `userId` por llamada** — no existe un modo
  bulk. Confirmar por error una cuenta falsa/bot/email mal escrito queda
  acotado a esa única fila, nunca un lote.
- Requiere `confirm: true` explícito en el body (el botón de la UI exige
  una segunda pulsación de confirmación, ver 2.3) y cooldown de 5 minutos
  por usuario para evitar reenvíos accidentales.
- **Nunca usa `auth.admin.generateLink()`.** Esa API devuelve un
  `action_link`/token de sesión directamente en la respuesta al admin —
  si lo recibiera, podría entrar a la cuenta del usuario sin su
  consentimiento (account takeover). Encontramos exactamente este patrón
  inseguro en una rama vieja y sin fusionar de este mismo repo
  (`feature/user-recovery`, PR #14 abierto en draft desde el 1-oct,
  función `admin-generate-recovery-link`) — devolvía `magicLink` en el
  JSON de respuesta. No se tocó esa rama; se documenta acá como evidencia
  de por qué el diseño de este módulo es deliberadamente distinto.
- En su lugar: confirma el email server-side (`auth.admin.updateUserById`,
  requiere `service_role`, solo posible desde una Edge Function — nunca
  desde una RPC de Postgres) y dispara el flujo **ya existente y seguro**
  de recuperación de contraseña (`resetPasswordForEmail`, con un cliente
  anon nuevo, sin el token de sesión del admin) — el link llega a la
  bandeja de entrada real del usuario, igual que si hubiera tocado
  "Olvidé mi contraseña" él mismo.
- Queda auditado en `admin_recovery_actions` (quién, cuándo, qué se hizo).

### 2.3 Dashboard — pantalla "Recuperación de usuarios"

`AdminUserRecoveryScreen.tsx` (ruta `/admin/recuperacion`, mismo criterio
de acceso que `/admin`: la pantalla no gatea nada, la protección real son
las RPCs). KPIs del periodo, filtros (fecha, segmento, fuente
Meta/orgánico/otro, campaña, creativo, búsqueda por email/user_id), tabla
paginada, y panel de detalle por usuario (atribución completa, Scans,
últimos eventos, historial de recuperación, botón "Recuperar acceso" con
confirmación de 2 toques — mismo patrón ya usado en
`ChatPrivateConversationScreen.tsx` para bloquear usuarios, en vez de
`Alert.alert`, que es no-op real en react-native-web).

## 3. Qué NO se construyó (a propósito)

- **Ninguna reconfirmación/OTP nueva.** No se tocó `authService.ts`,
  `AuthScreen.tsx` ni el funnel de signup.
- **Ningún envío de campaña real.** El segmento "registrado + sin primer
  Scan + email usable" queda **definido** (es exactamente el filtro
  `p_segment = 'no_first_scan'` de `admin_list_user_recovery`, con
  `confirmed = true` para asegurar que el email es entregable) pero no se
  conectó a ningún proveedor de envío. Para una futura campaña "Mide tu
  Aura": reutilizar ese mismo filtro, agregar una Edge Function de envío
  con su propia tabla de auditoría (mismo patrón que
  `admin_recovery_actions`) y un flag explícito que el admin dispare a
  mano por lote — nunca automático.
- **Ninguna confirmación masiva.** No existe ningún RPC/función que reciba
  una lista de usuarios o un filtro para confirmar en lote.

## 4. Seguridad — qué se verificó realmente

Contra el Postgres local (sección 5): un llamador anónimo y un llamador
autenticado no-admin reciben `not_authorized` en las 3 RPCs; un `authenticated`
sin pasar por las RPCs no puede hacer `select * from admin_recovery_actions`
ni `select * from auth.users` directo (grants/RLS lo bloquean con
`insufficient_privilege`); un `user_id` inexistente en el detalle devuelve
`not_found` limpio, nunca una fila vacía ambigua.

## 5. Pruebas realizadas

1. **Replay completo de las 40 migraciones** (todo el historial +
   `20261006000000_admin_user_recovery.sql`) contra Postgres 16 local,
   stub de `auth`/`storage`/`net`/`pg_net`. Pasa limpio.
   - Se encontró y confirmó, de nuevo, el bug ya conocido y documentado en
     PR #19 (`do $ ... $` inválido en
     `20261003000000_chat_v2_social_room.sql`, ya fusionada en `main`):
     sigue sin corregirse en el historial real. Se parcheó solo en la
     copia local usada para esta prueba (nunca en el repo) para poder
     continuar el replay; **se recomienda corregirlo en un PR aparte
     contra `main`** (es un fix de una línea, `$` → `$$`), igual
     recomendación que ya se hizo en PR #19.
2. **Datos sintéticos** representando los 2 segmentos pedidos (usuario
   viejo confirmado con atribución Meta solo en `analytics_events.metadata`,
   usuario viejo sin confirmar sin atribución, usuario confirmado sin Scan
   que llegó a Upload y falló, usuario confirmado con Scan completo) +
   verificación de los 3 RPCs: KPIs correctos, filtro por segmento/fuente
   correcto, búsqueda por email parcial correcta, fallback de atribución
   por `analytics_events.metadata` correcto (recupera un usuario Meta real
   que no tenía fila en ninguna de las otras dos tablas), detalle por
   usuario correcto, `admin_recovery_actions` refleja correctamente
   `recovered`/`recovery_rate_pct` tras una recuperación simulada.
3. **Seguridad**: anon y authenticated-no-admin rechazados en las 3 RPCs;
   acceso directo a `admin_recovery_actions` y a `auth.users` denegado para
   el rol `authenticated`.
4. **Tests específicos de la revisión post-PR (sección 0)**:
   - `node --experimental-strip-types scripts/test-admin-recover-user-access.mjs`
     -- 5 casos sobre la lógica pura de `outcome.ts`: recuperación completa,
     el bug reportado exacto (confirmó pero el reset falló -- `status`
     queda en `'partial_success'`, `ok: false`, `passwordResetSent: false`),
     cuenta ya confirmada con reset ok/con reset fallido, y error total
     con y sin un reset que ya había salido antes del fallo. Los 5 pasan.
   - Reproducción exacta del bug de `recovery_rate_pct` contra Postgres
     real: 2 no-confirmados, se recupera uno + un usuario que NUNCA había
     estado no-confirmado (reenvío de reset por otro motivo) -- con la
     fórmula vieja esto daba **200%**; con la corregida da **66.7%**
     (acotado, `assert v_rate <= 100` pasa). Luego se recupera también al
     último no-confirmado: `unconfirmed_legacy` llega a 0 y la tasa da
     **100%** (no 0%, como daba la fórmula vieja al dividir por un
     denominador que se vació).
4. **`npx tsc --noEmit`**: limpio.
5. **`node scripts/regression-gate.mjs`**: OK, 26 archivos (sin contratos
   nuevos para este módulo — mismo criterio que el Admin Dashboard
   original, que tampoco está en este gate: el gate protege el funnel de
   adquisición/Auth/Scan/Chat/LIVE, no las pantallas admin-only).
6. **`npx expo export --platform web`**: build exitoso.

## 6. Limitación explícita: sin credenciales de Supabase reales

Este entorno no tiene acceso a las credenciales del proyecto Supabase real
(no hay `.env`, solo `.env.example`; `scripts/backend-smoke.mjs` requiere
`SUPABASE_URL`/`SUPABASE_ANON_KEY` reales y no están disponibles). Por lo
tanto **no fue posible obtener conteos reales de producción** (cuántos
usuarios no confirmados existen hoy, cuántos sin primer Scan, cuántos
atribuibles a Meta). El mecanismo está probado end-to-end contra una
réplica real de Postgres con el esquema completo — los conteos reales
aparecerán en la pantalla del dashboard apenas se aplique esta migración al
proyecto real. Si se quieren esos números antes de mergear, se puede correr
`admin_user_recovery_kpis('2000-01-01', now())` directo en el SQL Editor de
Supabase con la migración ya aplicada.
