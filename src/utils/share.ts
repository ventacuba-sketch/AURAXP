import { Platform, Share } from 'react-native';

import { logEvent } from '../services/analyticsService';
import { copyToClipboard, shareImageOnWeb, shareOnWeb, ShareOutcome } from './webShare';

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
 *
 * Único punto de paso para TODO share de texto de la app (invitación de
 * Challenge, resultado sin imagen, etc.) -- por eso es también el único
 * lugar que hace falta para loguear el evento de analítica 'share' (ver
 * analyticsService.ts) sin tener que instrumentar cada pantalla que
 * comparte algo por separado.
 */
export async function shareText(text: string, url?: string): Promise<ShareOutcome> {
  logEvent('share', { kind: 'text' });
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
 * Comparte una imagen (PNG, típicamente la result card de un Challenge
 * completado -- ver utils/shareCard.ts) junto con texto y un link.
 *
 * Solo tiene efecto real en web (ver shareImageOnWeb) -- en nativo
 * (iOS/Android) compartir un archivo requiere `expo-sharing` +
 * `expo-file-system` para escribirlo a un uri temporal antes de pasarlo al
 * share sheet nativo; `expo-sharing` NO está instalado en este proyecto
 * todavía y agregarlo implica un rebuild nativo que este sandbox no puede
 * compilar ni probar en un dispositivo real, así que en nativo esto
 * degrada honestamente a compartir solo texto+link (shareText) -- nunca
 * fallar en silencio, pero tampoco fingir que mandó una imagen que no
 * mandó. Ver el reporte de esta tarea para el paso exacto de cuando se
 * agregue esa dependencia.
 */
export async function shareImage(blob: Blob | null, filename: string, text: string, url?: string): Promise<ShareOutcome> {
  if (Platform.OS === 'web' && blob) {
    logEvent('share', { kind: 'image' });
    return shareImageOnWeb(blob, filename, text, url);
  }
  // El fallback nativo pasa por shareText(), que ya loguea 'share' --
  // no se duplica acá.
  return shareText(text, url);
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
