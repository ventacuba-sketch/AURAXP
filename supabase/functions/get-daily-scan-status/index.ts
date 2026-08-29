/**
 * get-daily-scan-status — cuántos Scans lleva hoy quien llama, contra el
 * límite diario real, y qué plan tiene -- para que DailyScanCounter
 * renderice el estado correcto sin recalcular nada por su cuenta.
 *
 * `daily_scan_counts` (y las columnas plan/pro_* de `profiles`) no son
 * legibles directo por el cliente a propósito -- ver init_schema.sql y la
 * migración que agregó plan/pro_*. Esta función es la única puerta: exige
 * JWT, usa service_role internamente, y devuelve ÚNICAMENTE lo de quien
 * llama.
 *
 * cap/isFairUseCap salen de resolveDailyCap() en _shared/dailyLimit.ts --
 * la MISMA función que usa process-scan para decidir si bloquea un Scan.
 * Un solo lugar calcula el límite; acá solo se reporta.
 *
 * No incrementa nada -- de solo lectura. process-scan sigue siendo el
 * único lugar que escribe la fila de daily_scan_counts o el plan.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { isUnlimitedTester, PlanTier, resolveDailyCap } from '../_shared/dailyLimit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await userClient.auth.getUser();

    if (!user) return jsonResponse({ error: 'No autenticado' }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const [{ data: profile }, { data: counter }] = await Promise.all([
      admin.from('profiles').select('plan, created_at, is_unlimited_tester').eq('id', user.id).single(),
      admin
        .from('daily_scan_counts')
        .select('upload_count')
        .eq('user_id', user.id)
        .eq('day', new Date().toISOString().slice(0, 10))
        .maybeSingle(),
    ]);

    const plan: PlanTier = (profile?.plan as PlanTier | undefined) ?? 'free';
    const unlimited = isUnlimitedTester(user.id, profile?.is_unlimited_tester as boolean | undefined);
    const { cap, isFairUseCap, inLaunchWindow, launchDaysLeft } = resolveDailyCap({
      plan,
      accountCreatedAt: profile?.created_at ?? new Date().toISOString(),
      unlimitedTestAccount: unlimited,
    });

    return jsonResponse({
      plan,
      count: counter?.upload_count ?? 0,
      // Nunca se manda el número real de un techo de fair-use (PRO) ni de
      // una cuenta de prueba sin límite -- ver el comentario de arriba y
      // DailyScanCounter, que decide qué mostrar según `plan`/`unlimited`
      // sin necesitar `cap` en esos dos casos.
      cap: isFairUseCap || unlimited ? null : cap,
      unlimited,
      inLaunchWindow,
      launchDaysLeft,
    });
  } catch (e) {
    console.error(e);
    return jsonResponse({ error: 'Error interno' }, 500);
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
