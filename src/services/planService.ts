import { Linking } from 'react-native';

/**
 * Checkout de suscripción mensual de AURA VS PRO -- ya creado en dLocal Go,
 * un solo link fijo (no per-usuario: no lleva ningún identificador de
 * AURAXP en la URL). Ver dlocal-webhook para por qué eso importa: sin un
 * identificador, activar PRO automáticamente al volver del pago no es
 * seguro de hacer todavía.
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
