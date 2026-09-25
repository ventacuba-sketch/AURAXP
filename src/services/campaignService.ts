import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

/**
 * Atribución de campaña (landing de adquisición, TikTok/Reels/Shorts) --
 * mismo patrón exacto que referralService.captureReferralFromUrl()/
 * hasReferralCodeInUrl(): captura los `utm_*` de la URL una sola vez al
 * boot (solo si todavía no hay uno guardado, para no pisar la atribución
 * real de una visita anterior con una navegación interna sin esos
 * params) y los persiste por fuera de la navegación -- RootNavigator
 * reemplaza TODO el árbol de screens no autenticadas apenas hay sesión
 * (ver ese archivo), así que cualquier dato que viva solo en el estado
 * de LandingScreen se perdería en el camino a Auth si no se guardara acá.
 *
 * Sin tabla nueva ni servicio externo: se adjunta como `metadata` a los
 * eventos que ya existen en analyticsService (analytics_events.metadata
 * es jsonb, sin CHECK -- ver ese archivo).
 */
const STORAGE_KEY = 'auraxp_utm_params';

export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
}

const UTM_KEYS: (keyof UtmParams)[] = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

/** Llamar una vez al boot (App.tsx), igual que captureReferralFromUrl(). */
export function captureUtmFromUrl(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const search = new URLSearchParams(window.location.search);
    const params: UtmParams = {};
    for (const key of UTM_KEYS) {
      const value = search.get(key);
      if (value) params[key] = value;
    }
    if (Object.keys(params).length === 0) return;
    AsyncStorage.getItem(STORAGE_KEY).then((existing) => {
      if (!existing) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    });
  } catch {
    // best-effort -- sin UTM guardado, el resto del funnel sigue igual,
    // solo sin esa metadata en los eventos.
  }
}

/** Los UTM guardados (si hay), listos para pasar como `metadata` a
 * logEvent(). null si esta visita no vino de ninguna campaña. */
export async function getStoredUtmParams(): Promise<UtmParams | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UtmParams;
  } catch {
    return null;
  }
}
