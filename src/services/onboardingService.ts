import AsyncStorage from '@react-native-async-storage/async-storage';

import { logEvent } from './analyticsService';

/**
 * Onboarding (bloque 12) -- NO es un tutorial ni pantallas nuevas: el
 * checkpoint real de "completó el loop núcleo" (registro -> primer Scan ->
 * resultado) es simplemente la primera vez que alguien ve un resultado de
 * Scan real (ScanResultScreen con un `result` cargado). Un flag por
 * dispositivo en AsyncStorage (mismo patrón que pendingChallenge.ts/
 * referralService.ts) evita loguear el evento o mostrar el highlight de
 * Coins/Wallet más de una vez, sin depender de una columna nueva en
 * `profiles` ni de un round-trip al server solo para esto.
 */
const SEEN_FIRST_RESULT_KEY = 'auraxp_seen_first_result_highlight';

/**
 * Llamar en cada mount de ScanResultScreen con un `result` real. Devuelve
 * `true` SOLO la primera vez que se llama en este dispositivo -- ese es el
 * momento de mostrar el highlight de Coins/Wallet/próximo paso; llamadas
 * siguientes (otro Scan, o volver a ver un replay viejo) devuelven `false`
 * sin loguear el evento de nuevo.
 */
export async function markFirstResultSeen(): Promise<boolean> {
  try {
    const seen = await AsyncStorage.getItem(SEEN_FIRST_RESULT_KEY);
    if (seen) return false;
    await AsyncStorage.setItem(SEEN_FIRST_RESULT_KEY, '1');
    logEvent('onboarding_completed');
    return true;
  } catch {
    // best-effort -- si falla, en el peor caso se vuelve a mostrar el
    // highlight una vez más la próxima vez, nunca bloquea el resultado real.
    return false;
  }
}
