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
