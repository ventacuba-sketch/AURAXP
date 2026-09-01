import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Cuando alguien sin sesión toca ACEPTAR DESAFÍO en ChallengeLanding, hay
 * que mandarlo a Auth -- y RootNavigator reemplaza TODO el árbol de
 * screens no autenticadas por el autenticado apenas hay sesión (ver
 * RootNavigator: `authed ? <...> : <Auth/>`), así que cualquier param de
 * navegación en la ruta actual se pierde en el camino. Esto persiste el
 * token share_token pendiente por fuera de la navegación (misma
 * AsyncStorage que ya usa el cliente de Supabase para la sesión) para que
 * RootNavigator pueda retomarlo apenas `authed` se vuelve true.
 */
const STORAGE_KEY = 'auraxp_pending_challenge_token';

export async function setPendingChallengeToken(token: string): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Best-effort -- si falla, el usuario simplemente vuelve a Home tras
    // loguearse en vez de retomar el Challenge automáticamente; no bloquea
    // el login en sí.
  }
}

export async function consumePendingChallengeToken(): Promise<string | null> {
  try {
    const token = await AsyncStorage.getItem(STORAGE_KEY);
    if (token) await AsyncStorage.removeItem(STORAGE_KEY);
    return token;
  } catch {
    return null;
  }
}

/**
 * Llamar SIEMPRE al cerrar sesión -- ver ProfileScreen.handleLogout.
 *
 * Por qué: este token solo se escribe cuando NO hay sesión (ver
 * ChallengeLandingScreen.handleAccept -- el branch `if (!session)`), así
 * que si alguien ya logueado puede cerrar sesión, cualquier token que haya
 * en storage en ese momento es necesariamente de una visita SIN cuenta de
 * ANTES de este login -- nunca de la sesión que se está por cerrar. Sin
 * este cleanup, quedaría ahí para el siguiente que use el mismo dispositivo:
 * apenas esa otra persona (Usuario B) inicie sesión, el efecto de
 * RootNavigator que retoma un Challenge pendiente correría igual y
 * aceptaría, a nombre de B, un desafío que en realidad era de quien usó el
 * teléfono antes. Bien probado: A cierra sesión -> B inicia sesión en el
 * mismo dispositivo -> B nunca hereda nada de A.
 */
export async function clearPendingChallengeToken(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort, igual que el resto de este archivo.
  }
}
