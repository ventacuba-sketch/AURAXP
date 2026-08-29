/**
 * get-daily-scan-status — cuántos Scans lleva hoy quien llama, contra el
 * límite diario real (DAILY_UPLOAD_CAP).
 *
 * `daily_scan_counts` tiene RLS habilitado SIN policies para
 * authenticated/anon a propósito (ver init_schema.sql: "acceso cero desde
 * el cliente; solo service_role la lee/escribe") -- así que el frontend no
 * puede leerla directo, ni debería poder (mismo motivo anti-farming que ya
 * regía el límite en sí: no dar visibilidad fina del contador exacto a
 * cualquier query arbitraria). Esta función es la única puerta: requiere
 * JWT, usa service_role internamente, y devuelve ÚNICAMENTE el conteo de
 * HOY de quien llama -- nunca el de otro usuario, nunca otras columnas.
 *
 * No incrementa nada -- de solo lectura. process-scan sigue siendo el
 * único lugar que escribe la fila.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { isUnlimitedTestUser } from '../_shared/dailyLimit.ts';
import { DAILY_UPLOAD_CAP } from '../_shared/scoring.ts';

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

    const unlimited = isUnlimitedTestUser(user.id);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const today = new Date().toISOString().slice(0, 10);
    const { data: counter } = await admin
      .from('daily_scan_counts')
      .select('upload_count')
      .eq('user_id', user.id)
      .eq('day', today)
      .maybeSingle();

    return jsonResponse({
      count: counter?.upload_count ?? 0,
      cap: DAILY_UPLOAD_CAP,
      unlimited,
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
