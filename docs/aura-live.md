# AURA LIVE — arquitectura, configuración y limitaciones (MVP)

Este documento describe la implementación de **AURA LIVE V1**, el sistema de
transmisiones en vivo de AURA VS: un anfitrión autorizado transmite un show
real (minutos u horas, no un clip de 8s) y cualquier persona — con o sin
cuenta — puede entrar a verlo, comentar (si tiene cuenta) y reaccionar.

Rama: `feature/aura-live-mvp`, creada desde `feature/chat-v2-social-room`
(Chat V2 "Sala Social", PR #16, todavía sin fusionar a `main` al momento de
escribir esto). **Ningún merge, deploy ni migración real se hizo como parte
de este trabajo** — todo lo de abajo describe código probado localmente
(Postgres descartable, `tsc`, `regression-gate`, `expo export`), nunca
contra el proyecto Supabase real ni contra un servidor LiveKit real.

---

## 1. Principio de arquitectura: dos sistemas, una sola fuente de verdad cada uno

| Responsabilidad | Sistema |
|---|---|
| Video/audio en tiempo real, publisher/subscribers, reconexión, calidad de conexión | **LiveKit** |
| Auth, perfiles, metadata de la sala, comentarios, moderación, follows, notificaciones, analytics, votaciones, Aura Checks, seguridad/RLS | **Supabase** |

El video **nunca** pasa por Supabase Storage ni se guarda frame a frame en
Postgres. Supabase solo sabe "quién transmite, qué sala, qué dijeron, quién
votó qué" — nunca el contenido audiovisual en sí.

---

## 2. Modelo de datos (`supabase/migrations/20261004000000_aura_live_mvp.sql`)

- `profiles.can_host_live boolean default false` — allowlist explícita
  (sección 8). **Nunca** otorgable por el cliente: ningún `GRANT UPDATE`
  sobre esta columna existe para `anon`/`authenticated` en ningún lado del
  proyecto. Se activa manualmente por SQL directo (`service_role`) hasta
  que exista un flujo de aprobación real.
- `live_rooms` — metadata de cada sala: `slug` (token público corto y
  opaco, `/live/:slug`), `host_user_id`, `title`, `description`, `status`
  (`preparing` → `live` → `ended`/`cancelled`), `livekit_room_name` (nombre
  opaco en LiveKit, `live_<uuid>`, nunca el username), `peak_viewers`
  (reportado por el host desde el conteo real de LiveKit, monotónico).
- `live_comments` — persistentes, solo autenticados, máx 300 caracteres,
  rate limit 5/10s, moderables (`hidden_at`/`hidden_by`).
- `live_aura_checks` — una fila por Aura Check puntual (nunca económico,
  ver sección 6). Lectura abierta (a diferencia de `chat_guest_rewards`:
  nada acá es sensible — el path de Storage está protegido por su propia
  policy, no por ocultar el string).
- `live_polls` / `live_poll_votes` — votación A vs B, 30–60s, un voto por
  usuario (índice único). Las boletas individuales (`live_poll_votes`)
  son de lectura **cerrada**: los conteos agregados se consultan vía
  `get_live_poll_status()`, nunca exponiendo quién votó qué.
- `live_webhook_events` — auditoría cruda de eventos de LiveKit
  (reconciliación, ver sección 7). Lectura cerrada, solo `service_role`.

### RPCs (todas `SECURITY DEFINER`, `search_path` explícito, `auth.uid()` siempre — nunca un id que mande el cliente)

`create_live_room`, `start_live_room`, `end_live_room`,
`report_live_peak_viewers`, `send_live_comment`, `hide_live_comment`,
`request_live_aura_check`, `create_live_poll`, `vote_live_poll`,
`get_live_poll_status`, `close_live_poll`.

### Verificado con Postgres real (descartable, nunca el proyecto real)

Replay completo de las 36 migraciones del proyecto (incluida esta) desde
cero, dos veces. Batería de seguridad/concurrencia ejecutada y confirmada:

- Un usuario sin `can_host_live` **no puede** crear una sala (verificado).
- Un viewer **no puede** iniciar/terminar la sala de otro (verificado).
- Un invitado (`anon`) **no puede** ejecutar ninguna RPC de escritura
  (`create_live_room`, `send_live_comment`, etc.) — `permission denied`
  real de Postgres, no un chequeo de aplicación (verificado).
- Rate limit de comentarios: 5 ok, 6º rechazado (verificado).
- Moderación: un viewer no puede ocultar el comentario de otro; el host de
  la sala sí; un comentario oculto desaparece del `SELECT` de `anon`
  (verificado).
- Aura Check: solo el host puede pedirlo, solo con un `storage_path` bajo
  su propia carpeta, rate limit 1/30s por sala (verificado).
- Votación: un usuario no puede votar dos veces el mismo poll; los
  conteos agregados son correctos; `anon` no puede leer `live_poll_votes`
  directo (verificado).
- `report_live_peak_viewers`: solo el host, y el valor nunca retrocede
  (`greatest()`) — verificado con dos llamadas, una mayor y una menor.
- Regresión: Chat V1 (invitado), Chat V2 y el dashboard de admin
  siguieron funcionando exactamente igual después de aplicar esta
  migración (verificado).

**Dos bugs reales encontrados y corregidos durante esta auditoría** (ambos
solo en la copia de este branch — nunca se tocó la rama `feature/chat-v2-social-room` original ni PR #16):

1. `20261003000000_chat_v2_social_room.sql` usaba `do $ ... $` (un solo
   signo `$`) para envolver el bloque de publicación de Realtime — sintaxis
   **inválida** en Postgres (el delimitador dollar-quote mínimo es `$$`).
   Esto habría roto cualquier `supabase db push` real contra producción.
   Corregido a `do $$ ... $$` en este branch; **recomendado aplicar el
   mismo fix de una línea en la rama/PR de Chat V2 antes de fusionarla**.
2. `send_live_comment()` (migración de AURA LIVE) tenía una ambigüedad de
   columna `id` idéntica a un bug ya conocido del proyecto
   (`created_at` en `send_chat_message` de Chat V1) — el `RETURNS
   TABLE(id, ...)` de la función colisionaba con la columna `id` de
   `live_rooms` en una subconsulta. Encontrado ejecutando la función de
   verdad contra Postgres (ni `tsc` ni el build lo detectan) y corregido
   calificando la columna.

---

## 3. LiveKit — tokens, permisos, seguridad

### `livekit-token` (Edge Function)

Único emisor de tokens. El cliente **nunca** decide su rol: la función
mira `live_rooms.host_user_id` contra el `auth.uid()` real (o rechaza si
no hay sesión ni `guestId` válido) y arma el grant correspondiente.

| Rol | `canPublish` | `canSubscribe` | `canPublishData` |
|---|---|---|---|
| Host (`user.id === room.host_user_id`) | `true` | `true` | `false` |
| Viewer (autenticado o invitado) | `false` | `true` | `false` |

- Identidad **siempre opaca**: `user:<uuid>` o `guest:<visitor_id>` — el
  mismo `visitor_id` que ya usa Chat V1/V2 (nunca email/username/nombre
  real en el room name ni en el participant identity).
- `livekit_room_name` es `live_<uuid>`, generado server-side — nunca el
  slug público ni nada derivado del host.
- TTL del token: 6 horas (generoso para un show largo). Cualquier
  reconexión real vuelve a pedir un token fresco, así que esto solo acota
  la conexión inicial ininterrumpida, no la duración total del LIVE.
- Un viewer solo recibe token cuando `status = 'live'`; un host puede
  pedirlo en `preparing` o `live`, nunca en `ended`/`cancelled`.

**Por qué el JWT se arma a mano (Web Crypto, HMAC-SHA256) en vez de usar
`livekit-server-sdk`:** ese paquete no se pudo probar contra el runtime
real de Supabase Edge Functions desde este entorno (sin proyecto Supabase
real para desplegar). Web Crypto es nativo de Deno, cero dependencia npm,
cero riesgo de incompatibilidad para la ruta más crítica de seguridad de
todo AURA LIVE. El formato de claims sigue el esquema público y estable de
LiveKit Access Tokens, pero **nunca se verificó contra un servidor LiveKit
real** — ver sección 8 (limitaciones).

### `livekit-webhook` (Edge Function)

Reconciliación server-side (sección 35 del pedido original): si el host
pierde conexión/cierra la pestaña sin llamar `end_live_room`, LiveKit
notifica `room_finished` acá y la sala se marca `ended` igual.

Verifica la firma del webhook (JWT HS256 con el API secret, claim
`sha256` = hash del body crudo) antes de procesar nada — **fail-closed**:
cualquier fallo de verificación devuelve 401 y nunca toca `live_rooms`.
**Esta verificación es una reconstrucción de buena fe del esquema de
LiveKit, nunca probada contra una entrega real** (ver sección 8).

### `process-live-aura-check` (Edge Function)

Reutiliza `_shared/gemini.ts` (`analyzeVideo`, `prepareGeminiVideoFile`) y
`_shared/scoring.ts` (`computeAuraScore`, función pura) — exactamente la
misma lógica que `process-scan`, sin duplicar prompt ni modelo. Nunca
toca `scans`, `profiles.xp/level`, `wallets`, `coin_transactions` ni
`daily_scan_counts` — un Aura Check de LIVE no otorga XP, no otorga
Coins, no altera rachas, no completa misiones de Scan.

---

## 4. Capa de medios (web/PWA primero)

- `liveMediaService.web.ts` — wrapper fino sobre `livekit-client`
  (connect/disconnect/setMicEnabled/setCameraEnabled/switchCamera). El
  sufijo `.web` es intencional: Metro lo resuelve automático en bundles
  web; una futura `liveMediaService.native.ts` con la misma forma de API
  podría implementar la versión con development build + LiveKit React
  Native sin tocar ninguna pantalla.
- Los tracks de video se adjuntan a nodos DOM reales (`track.attach()`)
  vía refs de `View` (que en web son el `<div>` subyacente) — nunca JSX
  `<video>` (el namespace JSX de React Native no declara elementos DOM).
- **Viewer count real**: `room.remoteParticipants.size` de LiveKit —
  nunca incluye al participante local, así que funciona igual sea quien
  pregunte el host o un viewer (nunca cuenta al host como espectador).
  Única fuente de verdad del conteo; Presence (Chat V2) no se reutiliza
  acá a propósito, para no mezclar dos conceptos (presencia social del
  Chat vs. conexiones reales de video de un LIVE).
- Reacciones (`🔥⚡❤️`): Supabase **Broadcast** (`liveRealtimeService.ts`),
  nunca una fila por reacción — serían escrituras sin límite real en un
  show de horas.
- Comentarios: Postgres Changes (persistentes, `live_comments`).
- Aura Check: `liveAuraCapture.ts` **clona** el `MediaStreamTrack` local
  ya publicado (`track.clone()`) y lo graba ~8s con `MediaRecorder` —
  nunca toca ni pausa el track principal. Feature-detect explícito de
  `MediaRecorder.isTypeSupported(...)`: si el navegador no soporta ningún
  mimeType candidato, el botón de Aura Check simplemente se deshabilita
  con un mensaje legible, el LIVE sigue funcionando igual.

---

## 5. Navegación

- `LiveCreate` (autenticado, sin path propio — nunca se comparte un link
  a "crear un LIVE").
- `LiveRoom` (pública, `/live/:slug` — igual criterio que
  `ChallengeLanding`/`PublicResult`/`PublicBattle`/`Chat`: un invitado
  puede abrir el link y ver el LIVE sin registrarse).
- `ChatScreen` ahora muestra `LiveLobbyCard` ("🔴 EN VIVO AHORA" +
  "+ Iniciar LIVE" para hosts autorizados) — componente propio, puramente
  aditivo, nunca datos falsos si no hay ningún LIVE activo.

### La corrección estructural del bug de QA de Chat V2

Chat V2 tuvo un bug real detectado en dos iPhone: la pantalla de Chat
podía seguir mostrando a alguien como invitado después de loguearse,
porque resolvía su identidad en un `useEffect(() => {...}, [])` — una
sola vez al montar, nunca reactivo a un cambio de sesión posterior.

`LiveRoomScreen` evita esta clase de bug por diseño: la identidad del
viewer sale de `useAuth().session` (reactivo, actualizado por
`onAuthStateChange`), y el efecto que conecta a LiveKit depende
explícitamente de `session?.user.id` en su arreglo de dependencias. Un
login real mientras se mira un LIVE siempre dispara: desconexión del
viewer invitado → pedido de un token nuevo con la identidad real →
reconexión como autenticado. Nunca queda un token/conexión/suscripción
vieja de invitado. Ver sección 7 (QA) para el límite real de esta
verificación (revisión de código, no un navegador real).

---

## 6. Qué NO hace AURA LIVE V1 (a propósito)

- No analiza la transmisión completa con IA — solo clips puntuales de
  Aura Check, a pedido explícito del host.
- No otorga XP, Coins, ni completa misiones por nada relacionado a LIVE.
- No graba la transmisión automáticamente (sección 22 — arquitectura
  preparada para una fase futura, no implementada).
- No integra TikTok/Instagram/YouTube — `liveEgressService.ts` es un
  stub deliberadamente no funcional (`AURA_LIVE_EGRESS_ENABLED = false`,
  ninguna llamada de red real, ningún credential en ningún lado).
- No reemplaza Challenge/Battle asíncrono existente — son sistemas
  paralelos, cero código compartido ni tocado.

---

## 7. Analytics

22 eventos `live_*` agregados a `analyticsService.ts`. Varios se loguean
**server-side** desde las RPCs (`live_created`, `live_started`,
`live_ended`, `live_comment_sent`, `live_aura_check_started`,
`live_poll_started`, `live_vote_cast`) — mismo criterio que
`chat_message_sent` en Chat V1: un hecho real no debe depender de que el
cliente siga conectado. El resto (vistas, intentos, reacciones efímeras,
prompts de registro, conversión de invitado) solo existe del lado del
cliente. Nunca se registran tokens de LiveKit ni secretos.

---

## 8. Limitaciones honestas (no verificado desde este entorno)

Este trabajo se hizo sin proyecto LiveKit real, sin credenciales, y sin
acceso a un navegador/dispositivo físico. Lo siguiente está implementado
y pasa `tsc`/`regression-gate`/`expo export`/pruebas SQL reales, pero
**nunca se probó end-to-end**:

- Conexión real a un servidor LiveKit (publish/subscribe real).
- El formato exacto del JWT de `livekit-token` contra un servidor LiveKit
  real (la forma de claims es la documentada públicamente por LiveKit,
  pero nunca se confirmó un `room.connect()` real aceptándolo).
- La verificación de firma de `livekit-webhook` contra una entrega real
  de webhook de LiveKit.
- Safari/iOS real: `getUserMedia`, `MediaRecorder`, reconexión en
  background, cámara frontal/trasera.
- Dos dispositivos reales (host + viewer) viéndose entre sí.
- La transición invitado→login dentro de un LIVE en un navegador real
  (verificado solo por revisión de código, ver sección 5).

**Antes de considerar esto listo para cualquier usuario real**: crear un
proyecto LiveKit (Cloud o self-hosted), configurar los secrets (sección
9), desplegar a Preview, y correr la matriz de QA manual de la sección
10 con dispositivos físicos.

---

## 9. Configuración manual necesaria (no se puede hacer desde este entorno)

1. **Crear un proyecto LiveKit** (LiveKit Cloud es lo más simple para
   empezar: https://cloud.livekit.io) y obtener `LIVEKIT_URL` (wss://...),
   `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
2. **Secrets de Supabase** (Edge Functions, nunca en `.env` del cliente):
   ```
   supabase secrets set LIVEKIT_URL=wss://tu-proyecto.livekit.cloud
   supabase secrets set LIVEKIT_API_KEY=...
   supabase secrets set LIVEKIT_API_SECRET=...
   ```
3. **Desplegar las 3 Edge Functions nuevas** (`livekit-token`,
   `livekit-webhook`, `process-live-aura-check`) — esto es un paso manual
   que este entorno no puede ejecutar (no hay proyecto Supabase real
   conectado):
   ```
   supabase functions deploy livekit-token
   supabase functions deploy livekit-webhook
   supabase functions deploy process-live-aura-check
   ```
4. **Aplicar la migración** `20261004000000_aura_live_mvp.sql` al
   proyecto real (`supabase db push`) — **no se hizo como parte de este
   trabajo**, requiere tu autorización explícita.
5. **Configurar el webhook en el dashboard de LiveKit** apuntando a
   `https://<tu-proyecto>.supabase.co/functions/v1/livekit-webhook`,
   suscripto al menos a `room_finished`.
6. **Habilitar hosts de prueba** — `can_host_live` se activa manualmente:
   ```sql
   update public.profiles set can_host_live = true where username = 'tu_usuario_de_prueba';
   ```
7. **Variables de entorno del build** (secrets de GitHub Actions, mismo
   lugar que `EXPO_PUBLIC_SUPABASE_URL`):
   `EXPO_PUBLIC_LIVEKIT_URL`, `EXPO_PUBLIC_AURA_LIVE_ENABLED=true`.

Mientras cualquiera de estos pasos falte, la UI de AURA LIVE se mantiene
oculta (`EXPO_PUBLIC_AURA_LIVE_ENABLED` no es `'true'`) — nunca se muestra
un botón roto a un usuario real.

---

## 10. Costos y riesgos conocidos

- **LiveKit factura por minuto-participante conectado.** Un show de una
  hora con 50 espectadores simultáneos es ~51 "participant-minutes" por
  minuto real de show — revisar el pricing del proyecto LiveKit elegido
  antes de habilitar para usuarios reales.
- **Egress (grabación/RTMP externo) está completamente desactivado**
  (`AURA_LIVE_EGRESS_ENABLED = false`, sin Edge Function, sin UI) —
  activar esto en el futuro implica transcodificación server-side con
  costo real por minuto; requiere una decisión explícita, nunca un
  default.
- **Gemini (Aura Check)**: rate-limited a 1 por sala cada 30s
  server-side, y es una acción explícita del host (nunca automática) —
  mismo control de costo que el resto de la app.
- **Sin recording automático en V1** — evita acumular storage sin
  control; preparado para una fase futura (sección "Futuro" abajo), no
  implementado.

---

## 11. Futuro (arquitectura dejada preparada, no implementada)

- **V2**: co-host remoto, participante invitado al escenario, overlays,
  scoreboard, Aura AI comentando eventos concretos (preparado
  conceptualmente, sin agente escuchando continuamente).
- **V3**: Group Battles, equipos, torneos, rankings en vivo.
- **V4**: `liveEgressService.ts` ya tiene la forma de API
  (`startExternalStream`/`stopExternalStream`) para RTMP hacia
  TikTok/Instagram/YouTube vía LiveKit Egress, grabación, highlights por
  IA, clips verticales — todo detrás de flags explícitamente apagados
  hoy.
