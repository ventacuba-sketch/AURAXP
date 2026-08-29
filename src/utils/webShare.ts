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
 * `text` y `url` se combinan en un solo string para el fallback de
 * portapapeles (no todos los métodos separan texto de link); la Web Share
 * API real sí los recibe separados cuando está disponible.
 */
export async function shareOnWeb(text: string, url?: string): Promise<ShareOutcome> {
  const combined = url ? `${text} ${url}` : text;

  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (data: unknown) => Promise<void> }) : undefined;
  if (nav?.share) {
    try {
      await nav.share(url ? { text, url } : { text });
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
