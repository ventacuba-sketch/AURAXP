/**
 * Cliente mínimo para la API REST de dLocal Go -- solo lo que
 * sync-pro-subscriptions necesita (listar las suscripciones de nuestro
 * plan). No es un wrapper genérico ni cubre pagos/refunds/otros endpoints
 * que esta app no usa.
 *
 * ============================================================
 * DE DÓNDE SALE ESTO (nada acá es adivinado)
 * ============================================================
 * docs.dlocalgo.com/helpcenter.dlocalgo.com no son alcanzables desde este
 * sandbox (egress bloqueado a esos dominios). En cambio, se leyó el código
 * fuente completo (no solo el README) del cliente Ruby open-source
 * MetaLabs-inc/dlocal_go (github.com/MetaLabs-inc/dlocal_go), que envuelve
 * exactamente esta misma API -- confirmado porque sus URLs de checkout de
 * suscripción coinciden carácter por carácter con el link real que usa
 * AURAXP (`https://checkout.dlocalgo.com/validate/subscription/<plan_id>`).
 * De ahí:
 * - Auth: header `Authorization: Bearer <api_key>:<api_secret>` (ver
 *   endpoint_generator.rb del gem -- `"Bearer #{api_key}:#{api_secret}"`).
 * - Base URL: https://api.dlocalgo.com (producción) /
 *   https://api-sbx.dlocalgo.com (sandbox) -- ver constants.rb del gem.
 * - Listar suscripciones de un plan: GET
 *   /v1/subscription/plan/:plan_id/subscription/all -- paginado, devuelve
 *   { data: [...], total_elements, total_pages, page, number_of_elements,
 *   size } (ver responses/array.rb del gem).
 * - Cada suscripción trae (ver responses/subscription.rb del gem): id,
 *   country, subscription_token, status, active, client_id,
 *   client_first_name, client_last_name, client_email, created_at,
 *   updated_at, entre otros. `client_email` es el email que la persona
 *   pagadora escribió en el checkout hosteado por dLocal -- es el único
 *   dato que tenemos para cruzar contra una cuenta de AURAXP, porque el
 *   link de checkout es fijo/genérico (no lleva ningún identificador
 *   nuestro, ver planService.ts).
 *
 * dLocal Go NO expone (según lo que se pudo confirmar) un endpoint para
 * crear una suscripción per-usuario vía API con una referencia propia --
 * las suscripciones nacen únicamente cuando alguien completa ese checkout
 * hosteado. Por eso la activación acá es por sincronización (listar y
 * cruzar por email), no por webhook con una referencia nuestra.
 */

export interface DlocalGoSubscription {
  id: string;
  status: string;
  active: boolean;
  client_email: string | null;
  client_first_name?: string;
  client_last_name?: string;
  created_at?: string;
  updated_at?: string;
}

interface DlocalGoListResponse {
  data: DlocalGoSubscription[];
  total_pages?: number;
  page?: number;
}

export interface DlocalGoConfig {
  apiKey: string;
  apiSecret: string;
  environment: 'production' | 'sandbox';
  planId: string;
}

function baseUrl(environment: 'production' | 'sandbox'): string {
  return environment === 'production' ? 'https://api.dlocalgo.com' : 'https://api-sbx.dlocalgo.com';
}

/**
 * Todas las suscripciones del plan configurado, todas las páginas.
 * Límite de páginas duro (200) como red de seguridad -- nunca debería
 * hacer falta ni cerca de eso para el volumen de AURAXP, pero evita un
 * loop infinito si la forma real de paginación no calzara exactamente
 * como quedó documentada arriba.
 */
export async function listAllSubscriptions(config: DlocalGoConfig): Promise<DlocalGoSubscription[]> {
  const authHeader = `Bearer ${config.apiKey}:${config.apiSecret}`;
  const all: DlocalGoSubscription[] = [];
  const MAX_PAGES = 200;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${baseUrl(config.environment)}/v1/subscription/plan/${config.planId}/subscription/all?page=${page}`;
    const res = await fetch(url, { headers: { Authorization: authHeader, 'Content-Type': 'application/json' } });

    if (!res.ok) {
      throw new Error(`dLocal Go respondió ${res.status} listando suscripciones (page ${page}): ${await res.text()}`);
    }

    const body = (await res.json()) as DlocalGoListResponse;
    const items = Array.isArray(body.data) ? body.data : [];
    all.push(...items);

    if (items.length === 0) break;
    if (typeof body.total_pages === 'number' && page >= body.total_pages) break;
  }

  return all;
}
