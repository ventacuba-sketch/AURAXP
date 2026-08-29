/**
 * Web-only share: Web Share API cuando existe, con fallback real a
 * portapapeles (nunca un botón muerto). Diagnóstico previo confirmó que
 * `Share.share()` de react-native-web SÍ llama a `navigator.share()` de
 * verdad (no es un no-op como `Alert.alert`), pero cualquier rechazo --
 * navegador sin soporte, usuario cancela, contexto no seguro -- quedaba
 * silenciado sin feedback. Esto reemplaza esa ruta en web.
 */

export type ShareOutcome = 'shared' | 'copied' | 'unavailable';

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // sigue al fallback de abajo
  }

  // Fallback legado para contextos sin Clipboard API (HTTP, navegadores
  // viejos) -- un textarea invisible + execCommand('copy').
  try {
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * `text` y `url` SIEMPRE se combinan en un solo string -- para el
 * fallback de portapapeles, pero también para la propia Web Share API.
 *
 * Bug real encontrado probando por WhatsApp en iPhone: pasar `{ text, url
 * }` como campos separados a `navigator.share()` (como se hacía antes)
 * hace que WhatsApp en iOS reciba el texto pero DESCARTE el campo `url`
 * -- comportamiento conocido de su hoja de compartir vía Web Share API,
 * no específico de esta app: el spec no obliga a cada app receptora a
 * combinar los campos de la misma forma, y la de WhatsApp en iOS no
 * incluye `url` de forma confiable. La única forma robusta de garantizar
 * que el link viaje SIEMPRE, sea cual sea la app que reciba el share, es
 * no depender de ese campo separado: el link va incrustado en `text`.
 */
export async function shareOnWeb(text: string, url?: string): Promise<ShareOutcome> {
  const combined = url ? `${text} ${url}` : text;

  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (data: unknown) => Promise<void> }) : undefined;
  if (nav?.share) {
    try {
      await nav.share({ text: combined });
      return 'shared';
    } catch (e) {
      // El usuario cerró el sheet nativo -- no es una falla, no hay que
      // caer al portapapeles (eso sorprendería: "cancelé y me copió igual").
      if (e instanceof Error && e.name === 'AbortError') return 'shared';
      // Cualquier otro rechazo (no soportado en este contexto, etc.) sí
      // cae al portapapeles.
    }
  }

  const copied = await copyToClipboard(combined);
  return copied ? 'copied' : 'unavailable';
}

export { copyToClipboard };
