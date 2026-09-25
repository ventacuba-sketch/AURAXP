-- Punto 2 (auditoría post-iPhone): saldo grande para la cuenta de
-- pruebas @Cubanito. El pedido es explícito en "vía el mecanismo real de
-- Wallet/ledger, con una transacción identificable" -- eso es
-- apply_coin_transaction(), pero su `type` tiene un CHECK con un enum
-- FIJO (ver 20260905000000) que no incluye ningún valor de prueba. Este
-- migration solo agrega 'test_credit' a ese enum -- no ejecuta ningún
-- crédito por sí sola (eso se hace aparte, a mano, ver instrucciones
-- entregadas). Idempotente: drop+add del mismo constraint.

alter table coin_transactions drop constraint if exists coin_transactions_type_check;
alter table coin_transactions add constraint coin_transactions_type_check
  check (type in (
    'signup_bonus', 'mission_reward', 'streak_bonus',
    'referral_referrer_bonus', 'referral_referred_bonus',
    'pro_monthly_bonus', 'store_purchase', 'gift_sent',
    'test_credit'
  ));
