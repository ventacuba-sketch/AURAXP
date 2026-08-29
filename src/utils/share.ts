import { Platform, Share } from 'react-native';

import { copyToClipboard, shareOnWeb, ShareOutcome } from './webShare';

export type { ShareOutcome };

/**
 * Comparte texto (opcionalmente con un link separado) usando el mecanismo
 * más confiable disponible en cada plataforma:
 * - Web: Web Share API si existe, si no copia al portapapeles -- nunca un
 *   botón muerto (ver webShare.ts para el diagnóstico completo).
 * - Nativo (iOS/Android): el share sheet del sistema vía `Share.share()`.
 * Devuelve el resultado para que la pantalla pueda mostrar feedback
 * explícito ("Enlace copiado") en el caso de fallback -- ignorarlo sigue
 * siendo válido para el caller que no lo necesite.
 */
export async function shareText(text: string, url?: string): Promise<ShareOutcome> {
  if (Platform.OS === 'web') {
    return shareOnWeb(text, url);
  }
  try {
    await Share.share({ message: url ? `${text} ${url}` : text });
    return 'shared';
  } catch {
    return 'unavailable';
  }
}

/**
 * Copia un link directo al portapapeles -- para un botón "COPIAR LINK"
 * separado de "COMPARTIR". En nativo no hay una lib de Clipboard instalada
 * en este proyecto todavía, así que cae al share sheet del sistema (que ya
 * trae su propia opción de copiar) en vez de agregar una dependencia nueva
 * solo para esto.
 */
export async function copyLink(link: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return copyToClipboard(link);
  }
  try {
    await Share.share({ message: link });
    return true;
  } catch {
    return false;
  }
}
