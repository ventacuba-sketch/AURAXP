import { Linking } from 'react-native';

import { supabase } from './supabaseClient';

/**
 * Checkout de suscripción mensual de AURA VS PRO -- ya creado en dLocal Go,
 * un solo link fijo (no per-usuario: no lleva ningún identificador de
 * AURAXP en la URL). La activación real no depende de esta URL en sí --
 * ver syncOwnProStatus() más abajo y supabase/functions/sync-pro-subscriptions,
 * que cruza el email de quien pagó contra la cuenta logueada.
 */
export const PRO_MONTHLY_PRICE_USD = 4.99;
export const DLOCAL_CHECKOUT_URL = 'https://checkout.dlocalgo.com/validate/subscription/3JLKd9wEHw5un0ueS8q6PTNkig6QZQde';

/**
 * Abre el checkout externo de dLocal -- `Linking.openURL` es el mecanismo
 * que ya usa esta app para salir a un destino externo (ver
 * RecordScreen.tsx -> Linking.openSettings()), y en web (react-native-web)
 * `openURL` abre una pestaña nueva (`window.open(url, '_blank')`), que es
 * exactamente lo que hace falta para que funcione en Safari/iPhone sin
 * salir de AURA VS. IMPORTANTE: hay que llamarla de forma síncrona dentro
 * del onPress (sin ningún `await` antes) -- Safari bloquea como popup
 * cualquier `window.open` que no venga directo de un gesto del usuario.
 */
export function openProCheckout(): void {
  Linking.openURL(DLOCAL_CHECKOUT_URL).catch((e) => {
    console.warn('No se pudo abrir el checkout de PRO', e);
  });
}

/**
 * El ÚNICO camino real a PRO -- nunca un botón "ya pagué". Llama a
 * sync-pro-subscriptions (ver ese archivo), que lista las suscripciones
 * reales de dLocal Go y activa PRO server-side si el email de la sesión
 * actual coincide con una suscripción activa. Se dispara sola (ver
 * ProScreen -- AppState volviendo a 'active' después de abrir el
 * checkout), nunca por acción explícita del usuario más allá de volver a
 * la app. Silenciosa por diseño: si todavía no hay nada que activar
 * (pago aún no confirmado, o la persona ni llegó a pagar), simplemente no
 * pasa nada -- no es un error mostrable.
 */
export async function syncOwnProStatus(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.functions.invoke('sync-pro-subscriptions');
    if (error || !data) return false;
    return Boolean(data.activated);
  } catch {
    return false;
  }
}
