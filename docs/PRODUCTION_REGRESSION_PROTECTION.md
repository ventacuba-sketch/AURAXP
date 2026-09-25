# Production regression protection

AURA VS deploys are gated by three layers:

1. TypeScript compile check.
2. Critical contract regression test for Scan/share, Challenge, public result, public Battle and funnel analytics wiring.
3. Live read-only/invalid-input smoke calls against production Supabase RPCs. They detect missing functions, SQL ambiguity/parser errors and broken public RPC contracts without creating users, scans, votes or Challenges.

Only after all gates pass can FTPS deployment run. After deploy, GitHub checks the production root and /aura URLs.

## Rule for future migrations
Any migration that replaces a critical RPC must preserve its signature and pass the regression gate. Never use unqualified column names inside PL/pgSQL when a RETURNS TABLE output variable has the same name; qualify table columns with aliases.

This does not prove every UI interaction, payment-provider flow or camera behavior. Those require dedicated end-to-end/device tests. It does block the class of regression that caused create_direct_challenge to fail with an ambiguous share_token.
