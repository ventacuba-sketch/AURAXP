import { NavigationContainerRef } from '@react-navigation/native';

import { RootStackParamList } from '../types';

/**
 * Nombre de ruta del Stack.Navigator RAÍZ (MainTabs / Upload / ScanResult /
 * ...), NO `getCurrentRoute()` -- ese método del ref devuelve la ruta
 * HOJA más profunda de todo el árbol (p. ej. "Home"/"Profile", el tab
 * activo DENTRO de MainTabs), así que mientras el usuario está en
 * cualquier tab, el nombre nunca es "MainTabs" -- bug real encontrado en
 * Playwright (ver BottomNavBar: la barra nueva se duplicaba con el
 * bottom-tabs nativo en Home/Perfil). `getState()` en cambio da el estado
 * del navigator raíz tal cual lo ve RootNavigator.
 *
 * Compartido entre BottomNavBar y InstallInviteHost -- ambos son
 * siblings del Stack.Navigator (no descendientes, ver sus propios
 * comentarios) que necesitan saber en qué ruta raíz está la app sin
 * poder usar `useNavigationState`/`useNavigation` (esos hooks dependen
 * de un NavigationContext que un sibling nunca recibe).
 */
export function getRootRouteName(nav: NavigationContainerRef<RootStackParamList> | null): string | undefined {
  const state = nav?.getState();
  if (!state) return undefined;
  return state.routes[state.index]?.name;
}
