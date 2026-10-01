# Claude review brief — AURA VS Analytics Dashboard

Review PR #12 and audit the implementation as a second engineer.

## Goal

Validate an admin-only product analytics dashboard for AURA VS without changing existing consumer flows.

## Review in this order

1. TypeScript/React Native Web correctness.
2. Supabase SQL correctness and performance.
3. Security:
   - raw analytics must not be exposed to the browser;
   - /admin must remain server-authorized;
   - attribution RPC must not expose user data;
   - SECURITY DEFINER functions must use a safe search_path.
4. Attribution:
   - UTM source/medium/campaign/content/term;
   - referrer host;
   - pseudonymous visitor ID;
   - device/browser/OS;
   - first-touch behavior;
   - registration and first-Scan attribution.
5. Metric definitions:
   - web visits;
   - landing visits;
   - registration funnel;
   - first Scan activation;
   - scan completion/failure;
   - social/viral loops;
   - Coins/store/PRO;
   - PWA/push;
   - public voting;
   - daily trends.
6. Recommendation logic:
   - confirm that recommendations are threshold-based and clearly distinguish observations from actions.
7. Regression risk:
   - do not modify unrelated AURA VS behavior;
   - preserve the legacy campaign attribution RPC until the new client is deployed.

## Deliverable

Return:
- CRITICAL issues
- HIGH issues
- MEDIUM issues
- LOW issues
- suggested improvements

For every issue include the exact file/function and a concrete fix. Do not rewrite unrelated code.
