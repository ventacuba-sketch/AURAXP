import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationContainerRef } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';

/**
 * Navegación inferior persistente (D) -- INICIO/SCAN/PERFIL, visible en
 * las pantallas SECUNDARIAS (Mis Desafíos, Ranking, Notificaciones,
 * Perfil Público, ScanResult, Challenge, Pro, ChallengeLanding
 * autenticado) que hasta ahora solo tenían la flechita de volver arriba.
 *
 * Por qué un componente propio en vez de meter estas pantallas DENTRO del
 * bottom-tabs existente (MainTabNavigator): moverlas ahí cambiaría el
 * árbol de navegación (nesting, params, el linking config, cómo
 * RootNavigator ya resuelve `navigation.navigate('MainTabs', {screen:
 * 'Profile'})` desde media docena de lugares ya probados) -- alto riesgo
 * para "no romper nada existente". Esto en cambio es puramente aditivo:
 * un sibling fijo del Stack.Navigator raíz (ver RootNavigator.tsx), sin
 * tocar un solo screen/param/ruta existente. Home (MainTabs) sigue usando
 * SU PROPIO bottom-tabs nativo -- este componente se OCULTA ahí para no
 * duplicar la barra.
 *
 * "No tapar contenido" (H) por construcción, no por padding manual: vive
 * en un View hermano de altura fija DENTRO de un contenedor flex-column
 * (RootNavigator), así que el Stack.Navigator de arriba simplemente tiene
 * menos alto disponible cuando esto está visible -- ningún screen
 * individual necesita saber que existe ni agregar padding por su cuenta.
 */
const HIDDEN_ROUTES = new Set(['MainTabs', 'Record', 'Analyzing', 'ResetPassword', 'Auth']);

interface Props {
  authed: boolean;
  /**
   * El mismo `navigationRef` que ya crea RootNavigator (usado ahí para
   * retomar un Challenge pendiente después de Auth) -- NO `useNavigation()`
   * ni `useRootNavigation()`, a propósito: este componente es un SIBLING
   * de `<Stack.Navigator>`, no un descendiente suyo (ver el comentario de
   * arriba), así que nunca recibe el `NavigationContext` que esos hooks
   * necesitan. El ref, en cambio, no depende de dónde vive el componente
   * en el árbol -- expone los mismos métodos (`navigate`/`reset`) ya
   * tipados contra `RootStackParamList`.
   */
  navigationRef: React.RefObject<NavigationContainerRef<RootStackParamList> | null>;
}

/**
 * Nombre de ruta del Stack.Navigator RAÍZ (MainTabs / Upload / ScanResult /
 * ...), NO `getCurrentRoute()` -- ese método del ref devuelve la ruta
 * HOJA más profunda de todo el árbol (p. ej. "Home"/"Profile", el tab
 * activo DENTRO de MainTabs), así que mientras el usuario está en
 * cualquier tab, el nombre nunca es "MainTabs" y `HIDDEN_ROUTES` jamás
 * matcheaba -- bug real encontrado en Playwright (la barra nueva se
 * duplicaba con el bottom-tabs nativo en Home/Perfil). `getState()` en
 * cambio da el estado del navigator raíz tal cual lo ve RootNavigator.
 */
function getRootRouteName(nav: NavigationContainerRef<RootStackParamList> | null): string | undefined {
  const state = nav?.getState();
  if (!state) return undefined;
  return state.routes[state.index]?.name;
}

export function BottomNavBar({ authed, navigationRef }: Props) {
  const insets = useSafeAreaInsets();
  // NO useNavigationState: ese hook lee un NavigationStateContext que
  // provee el propio Navigator (Stack.Navigator) a SUS descendientes, no
  // NavigationContainer a todo su árbol -- confirmado en runtime ("Couldn't
  // get the navigation state. Is your component inside a navigator?"),
  // corrigiendo la suposición incorrecta de la primera versión de este
  // archivo. El ref, en cambio, expone `getState()`/`addListener` sin
  // depender de contexto -- funciona desde cualquier lugar del árbol.
  const [routeName, setRouteName] = useState<string | undefined>(() => getRootRouteName(navigationRef.current));

  useEffect(() => {
    const nav = navigationRef.current;
    if (!nav) return;
    setRouteName(getRootRouteName(nav));
    const unsubscribe = nav.addListener('state', () => {
      setRouteName(getRootRouteName(nav));
    });
    return unsubscribe;
  }, [navigationRef]);

  if (!authed) return null;
  if (!routeName || HIDDEN_ROUTES.has(routeName)) return null;
  // ChallengeLanding es la única ruta registrada para ambos estados de
  // auth (deep link público) -- ya sabemos que `authed` es true acá
  // arriba, así que si llegamos hasta esta ruta con sesión real, mostrar
  // la barra es correcto (item I: "después de login... puede mostrar
  // navegación normal").
  //
  // Sin estado "activo" acá a propósito: esta barra SOLO se muestra en
  // pantallas secundarias (MainTabs, con su propio bottom-tabs nativo que
  // ya resuelve el resaltado, está en HIDDEN_ROUTES) -- ninguno de los 3
  // botones es nunca "la pantalla actual" mientras esto es visible, así
  // que resaltar uno sería engañoso, no informativo.

  // F) reset limpio, nunca apilar -- "Ranking -> Perfil público ->
  // Challenge -> toca INICIO" tiene que dejar SOLO Home en la pila, no
  // sumarle un cuarto screen encima.
  function goHome() {
    navigationRef.current?.reset({ index: 0, routes: [{ name: 'MainTabs', params: { screen: 'Home' } }] });
  }

  function goScan() {
    navigationRef.current?.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    navigationRef.current?.navigate('Upload');
  }

  function goProfile() {
    navigationRef.current?.reset({ index: 0, routes: [{ name: 'MainTabs', params: { screen: 'Profile' } }] });
  }

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.xs) }]}>
      <NavButton icon="🏠" label="Inicio" onPress={goHome} />
      <Pressable onPress={goScan} style={styles.scanButton} hitSlop={6}>
        <View style={styles.scanBadge}>
          <Text style={styles.scanIcon}>🎯</Text>
        </View>
        <Text style={styles.scanLabel}>Scan</Text>
      </Pressable>
      <NavButton icon="👤" label="Perfil" onPress={goProfile} />
    </View>
  );
}

function NavButton({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.navButton} hitSlop={6}>
      <Text style={styles.navIcon}>{icon}</Text>
      <Text style={styles.navLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  navButton: {
    alignItems: 'center',
    gap: 2,
    minWidth: 64,
  },
  navIcon: {
    fontSize: 20,
  },
  navLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
  scanButton: {
    alignItems: 'center',
    gap: 2,
    minWidth: 64,
  },
  scanBadge: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  scanIcon: {
    fontSize: 18,
  },
  scanLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
});
