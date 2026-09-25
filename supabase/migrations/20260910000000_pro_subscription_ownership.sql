-- Bug real confirmado (auditoría): una suscripción real de dLocal
-- (165746, reconciliada a mano a @Cubanito en una migración/turno
-- anterior) podía ser reclamada de nuevo por CUALQUIER otra cuenta cuya
-- sesión tuviera el mismo `client_email` -- los modos 1 (self-sync) y 2
-- (sync completa) de sync-pro-subscriptions activaban PRO por email sin
-- verificar si esa suscripción ya pertenecía a otro perfil. Una cuenta
-- de pruebas del flujo de referidos terminó con plan='pro' REAL (no un
-- bug visual) y un crédito indebido de +5.000 Coins ('pro_monthly_bonus',
-- ya revertido vía ledger en un turno anterior), solo por abrir
-- ProScreen -- ver supabase/functions/sync-pro-subscriptions/index.ts,
-- que ahora verifica ownership antes de activar
-- (isSubscriptionClaimedByAnotherProfile()) en el mismo commit que esta
-- migración.
--
-- Esta migración refuerza ese mismo invariante a nivel de base de datos
-- -- "un subscription_id de dLocal pertenece como máximo a un perfil" --
-- y limpia los metadatos residuales que le quedaron a esa cuenta de
-- pruebas específica.

-- ============================================================
-- 1) Índice único parcial: pro_subscription_id pertenece a lo sumo a UN
--    perfil. Parcial (WHERE ... IS NOT NULL) porque múltiples perfiles
--    FREE con pro_subscription_id NULL es el estado normal y esperado --
--    un índice único sin el WHERE rompería eso. Verificado sin
--    duplicados en producción antes de este deploy (confirmado aparte,
--    no por esta migración). Si CREATE UNIQUE INDEX fallara acá por un
--    duplicado real, es una señal genuina de que hace falta resolver esa
--    colisión primero -- nunca debe silenciarse con IF NOT EXISTS (eso
--    solo evita el error de "ya existe", no de "hay duplicados").
create unique index if not exists profiles_pro_subscription_id_unique
  on profiles (pro_subscription_id)
  where pro_subscription_id is not null;

-- ============================================================
-- 2) Limpieza puntual de metadatos residuales -- SOLO la cuenta de
--    pruebas exacta reportada, y SOLO si sigue exactamente en el estado
--    descrito (plan/pro_status/pro_subscription_id ya correctos, FREE)
--    -- si algo cambió desde el reporte, este UPDATE no toca nada en vez
--    de arriesgar pisar un estado real distinto. No toca wallets ni
--    coin_transactions -- los 5.000 Coins indebidos ya se revirtieron
--    vía apply_coin_transaction() (ledger real) en un turno anterior;
--    esto es solo metadata de perfil que quedó huérfana de esa
--    activación indebida.
update profiles
set pro_started_at = null,
    pro_coins_credited_month = null
where id = '1719f38d-a7b8-470a-adff-e8c502c97cff'
  and plan = 'free'
  and pro_status is null
  and pro_subscription_id is null;
