import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  DarkTheme,
  LinkingOptions,
  NavigationContainer,
  NavigationContainerRef,
  Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { MainTabNavigator } from './MainTabNavigator';
import { BottomNavBar } from '../components/BottomNavBar';
import { InstallInviteHost } from '../components/InstallInviteHost';
import { NotificationInviteHost } from '../components/NotificationInviteHost';
import { useAuth } from '../hooks/useAuth';
import { acceptChallenge } from '../services/challengeService';
import { linkCampaignToCurrentUser } from '../services/campaignService';
import { consumePendingChallengeToken } from '../services/pendingChallenge';
import { tryAttributePendingReferral } from '../services/referralService';
import { logPageView } from '../services/analyticsService';
import AdminDashboardScreen from '../screens/AdminDashboardScreen';
import AdminRecoveryScreen from '../screens/AdminRecoveryScreen';
import RecoveryContactScreen from '../screens/RecoveryContactScreen';
import RecoveryScanScreen from '../screens/RecoveryScanScreen';
import AnalyzingScreen from '../screens/AnalyzingScreen';
import AuthScreen from '../screens/AuthScreen';
import BugReportScreen from '../screens/BugReportScreen';
import ChallengeLandingScreen from '../screens/ChallengeLandingScreen';
import ChallengeScreen from '../screens/ChallengeScreen';
import HelpScreen from '../screens/HelpScreen';
import InviteScreen from '../screens/InviteScreen';
import LandingScreen from '../screens/LandingScreen';
import MyChallengesScreen from '../screens/MyChallengesScreen';
import NotificationsScreen from '../screens/NotificationsScreen';
import ProScreen from '../screens/ProScreen';
import PublicProfileScreen from '../screens/PublicProfileScreen';
import PublicResultScreen from '../screens/PublicResultScreen';
import PublicBattleScreen from '../screens/PublicBattleScreen';
import RankingScreen from '../screens/RankingScreen';
import RecordScreen from '../screens/RecordScreen';
import ResetPasswordScreen from '../screens/ResetPasswordScreen';
import ScanResultScreen from '../screens/ScanResultScreen';
import StoreScreen from '../screens/StoreScreen';
import UploadScreen from '../screens/UploadScreen';
import WalletScreen from '../screens/WalletScreen';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { colors } from '../theme/colors';
import { RootStackParamList } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();

const navigationTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    border: colors.border,
    primary: colors.accent,
    text: colors.textPrimary,
  },
};

// Solo ChallengeLanding, Auth y ahora Landing tienen un path real — es lo
// único que necesita abrirse desde fuera de la app (link compartido /
// navegador / campaña de adquisición). `/aura` es ruta NUEVA y propia --
// deliberadamente no se tocó `/` (sigue cayendo en Auth para cualquier
// visitante sin sesión, exactamente como antes, incluido `?ref=CODE`) ni
// se reusó ningún nombre ya existente (evita cualquier choque con `Scan`,
// el tab).
//
// `/admin` (dashboard de analítica) -- mismo criterio: path propio, nunca
// pisa `/`. A diferencia de ChallengeLanding/PublicResult/PublicBattle,
// esta SÍ está dentro del ternario authed/!authed (ver más abajo, M1 de la
// auditoría del dashboard): sin sesión, la ruta ni siquiera existe en el
// stack, así que cae a Auth como cualquier otra ruta desconocida. Con
// sesión mala (no admin), la pantalla monta pero get_admin_dashboard
// (profiles.is_admin, SECURITY DEFINER) deniega el acceso server-side.
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['auraxp://', 'https://auravs.app'],
  config: {
    screens: {
      AdminDashboard: 'admin',
      RecoveryScan: 'recover-scan',
      ChallengeLanding: 'c/:token',
      Auth: 'auth',
      Landing: 'aura',
      PublicResult: 'r/:token',
      PublicBattle: 'b/:token',
    },
  },
};

/**
 * Root native stack: hosts the bottom tab navigator (Home / Scan / Profile)
 * as its base screen, plus the flow screens pushed on top of it. Every flow
 * screen owns its own full-bleed layout and headline, so the native header
 * chrome stays hidden throughout for a premium, non-SaaS feel — back
 * navigation is via the platform swipe/hardware gesture instead.
 *
 * Flow: Home/Scan -> Upload/Capture -> Analyzing -> Aura Replay (ScanResult) -> Challenge / Share
 *
 * Auth gate: while Supabase isn't configured, the app behaves exactly as
 * before (mock data, no login) — `authed` is forced true so nothing breaks
 * for a fresh checkout of this repo. Once configured, an anonymous visitor
 * only ever sees Auth or ChallengeLanding (the one public, unauthenticated
 * route — reachable via deep link or web URL regardless of session).
 */
export function RootNavigator() {
  const { session, loading, passwordRecovery } = useAuth();
  const authed = !isSupabaseConfigured || Boolean(session);
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  const resumedRef = useRef(false);
  // Dashboard de admin (tracking de páginas) -- routeNameRef es la copia
  // "de lectura inmediata" de la ruta actual que usan onReady/onStateChange
  // más abajo para decidir si cambió (un useState solo se actualiza en el
  // próximo render, demasiado tarde para comparar en el mismo callback);
  // currentRouteName es la versión en estado, usada para el gate de
  // InstallInviteHost/NotificationInviteHost (no deben mostrarse encima
  // del dashboard).
  const routeNameRef = useRef<string | undefined>(undefined);
  const [currentRouteName, setCurrentRouteName] = useState<string | undefined>();

  // Retoma un Challenge pendiente después de pasar por Auth -- ver
  // ChallengeLandingScreen.handleAccept() y services/pendingChallenge.ts.
  // El swap de `authed` reemplaza TODO el árbol de screens (ver el
  // ternario más abajo), así que cualquier param de la ruta anterior ya
  // se perdió; esto vuelve a intentar la aceptación real desde cero con
  // el token guardado, no confía en que la navegación lo haya conservado.
  //
  // Gateado por `passwordRecovery`: si alguien volvió del link de
  // "olvidé mi contraseña" con un Challenge pendiente guardado (ver
  // AuthScreen -> handleForgotPassword), `authed` ya es true apenas
  // Supabase establece la sesión de recuperación -- sin este guard, este
  // efecto correría YA (marcando resumedRef=true) y mandaría a la persona
  // directo al Challenge sin haber llegado a cambiar la contraseña. Al
  // no marcar resumedRef mientras passwordRecovery es true, el efecto
  // vuelve a correr (está en las deps) apenas se limpia -- ahí sí retoma
  // el Challenge normalmente, ya con la contraseña nueva puesta.
  useEffect(() => {
    if (!authed || passwordRecovery || resumedRef.current) return;
    resumedRef.current = true;

    consumePendingChallengeToken().then((token) => {
      if (!token) return;
      acceptChallenge(token).then((result) => {
        const nav = navigationRef.current;
        if (!nav?.isReady()) return;
        if (result.ok) {
          nav.navigate('Challenge', { challengeToken: token });
        } else {
          // Ya expiró/lo tomaron/etc mientras el usuario se registraba --
          // la landing misma sabe mostrar el motivo correcto.
          nav.navigate('ChallengeLanding', { token });
        }
      });
    });
  }, [authed, passwordRecovery]);

  // Atribución de referido (bloque referidos) -- si esta persona llegó por
  // un link de invitación (ver referralService.captureReferralFromUrl(),
  // llamado en App.tsx al boot), recién acá hay sesión real para asociar el
  // código guardado a su cuenta. No otorga ningún Coin por sí solo -- el
  // premio real llega después, server-side, cuando complete su primer Scan
  // (ver la migración: activate_referral_on_first_scan). Sin gate de
  // passwordRecovery: no depende del flujo de Challenge pendiente y es
  // seguro de intentar en cuanto hay sesión, se recuperando contraseña o no.
  useEffect(() => {
    if (!session) return;
    tryAttributePendingReferral();
    // Dashboard de admin (atribución) -- liga la atribución de campaña
    // guardada (utm + device/browser/os, ver campaignService.ts) a esta
    // cuenta UNA sola vez por sesión nueva. A propósito acá y NO dentro de
    // logEvent(): esta última corre en cada evento de analítica de toda la
    // app, así que llamarlo ahí multiplicaba un RPC completo por cada
    // evento sin ganar ningún dato nuevo en las repeticiones (hallazgo
    // H1/H2 de la auditoría del dashboard de admin).
    void linkCampaignToCurrentUser();
  }, [session]);

  if (isSupabaseConfigured && loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      linking={linking}
      // Dashboard de admin (tracking de páginas) -- onReady/onStateChange
      // son los únicos puntos de React Navigation que ven CUALQUIER cambio
      // de ruta sin importar desde qué screen se originó; logPageView()
      // es best-effort (ver analyticsService.ts), nunca puede romper la
      // navegación real.
      onReady={() => {
        const route = navigationRef.current?.getCurrentRoute()?.name;
        routeNameRef.current = route;
        setCurrentRouteName(route);
        if (route) logPageView(route);
      }}
      onStateChange={() => {
        const route = navigationRef.current?.getCurrentRoute()?.name;
        if (route && route !== routeNameRef.current) {
          logPageView(route);
          routeNameRef.current = route;
          setCurrentRouteName(route);
        }
      }}
    >
      {/* Navegación inferior persistente (D) -- View flex-column con el
          Stack arriba (flex:1) y la barra como sibling de alto fijo abajo,
          NO un overlay -- así el contenido de cada pantalla nunca queda
          tapado (H) sin que ningún screen individual tenga que saber que
          esto existe. BottomNavBar decide sola, por nombre de ruta actual,
          en qué pantallas se muestra (ver ese componente) -- cero cambios
          acá abajo en qué screens existen o cómo navegan entre sí. */}
      <View style={styles.appShell}>
        <View style={styles.stackArea}>
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            {authed && passwordRecovery ? (
              // Rama propia, deliberadamente sin el resto de la app: mientras
              // se está recuperando la contraseña, la única pantalla que debe
              // existir es esta -- ni un deep link ni una navegación
              // accidental deberían poder sacar a nadie de acá antes de
              // terminar. clearPasswordRecovery() (llamado desde adentro) es
              // la única salida.
              <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ gestureEnabled: false }} />
            ) : authed ? (
              <>
                <Stack.Screen name="MainTabs" component={MainTabNavigator} />
                <Stack.Screen name="Upload" component={UploadScreen} />
                {/* Cámara en vivo -- bloqueamos el swipe-back nativo para que no
                    se pueda salir por accidente a mitad de una grabación; el
                    botón propio de la pantalla es la única salida mientras
                    graba. El cleanup (parar cámara, limpiar timers) corre igual
                    al desmontar sin importar cómo se salga. */}
                <Stack.Screen name="Record" component={RecordScreen} options={{ gestureEnabled: false }} />
                {/* Transient auto-advancing state — block swiping back out of it. */}
                <Stack.Screen
                  name="Analyzing"
                  component={AnalyzingScreen}
                  options={{ gestureEnabled: false }}
                />
                <Stack.Screen name="ScanResult" component={ScanResultScreen} />
                <Stack.Screen name="Challenge" component={ChallengeScreen} />
                <Stack.Screen name="MyChallenges" component={MyChallengesScreen} />
                <Stack.Screen name="Ranking" component={RankingScreen} />
                <Stack.Screen name="Notifications" component={NotificationsScreen} />
                <Stack.Screen name="PublicProfile" component={PublicProfileScreen} />
                <Stack.Screen name="Pro" component={ProScreen} />
                <Stack.Screen name="Wallet" component={WalletScreen} />
                <Stack.Screen name="Store" component={StoreScreen} />
                <Stack.Screen name="Help" component={HelpScreen} />
                <Stack.Screen name="BugReport" component={BugReportScreen} />
                <Stack.Screen name="Invite" component={InviteScreen} />
                {/* Dashboard de admin (M1, auditoría del dashboard) --
                    registrada SOLO acá, igual que Wallet/Store/etc, NO en el
                    bloque siempre-registrado de abajo (ChallengeLanding/
                    PublicResult/PublicBattle son deliberadamente públicas;
                    esta no lo es). Un visitante sin sesión que abra /admin
                    cae al primer screen del stack !authed (Auth), mismo
                    criterio ya probado que usa Landing arriba -- nunca llega
                    a montar AdminDashboardScreen. La verificación real
                    (quién es admin de verdad) sigue siendo el RPC
                    get_admin_dashboard (profiles.is_admin, SECURITY
                    DEFINER) -- esto es la mitad de UI, no reemplaza esa
                    protección server-side. */}
                <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
                <Stack.Screen name="AdminRecovery" component={AdminRecoveryScreen} />
                <Stack.Screen name="RecoveryContact" component={RecoveryContactScreen} />
                <Stack.Screen name="RecoveryScan" component={RecoveryScanScreen} />
              </>
            ) : (
              <>
                <Stack.Screen name="Auth" component={AuthScreen} />
                {/* Landing de adquisición (TikTok/Reels/Shorts) -- registrada
                    SOLO acá, igual que Auth: alguien ya logueado que abra
                    /aura nunca ve esto (React Navigation cae al primer
                    screen del stack autenticado, MainTabs, mismo criterio ya
                    probado que usa "/" para caer en Auth cuando no hay
                    sesión). */}
                <Stack.Screen name="Landing" component={LandingScreen} />
              </>
            )}
            <Stack.Screen name="ChallengeLanding" component={ChallengeLandingScreen} />
            <Stack.Screen name="PublicResult" component={PublicResultScreen} />
            <Stack.Screen name="PublicBattle" component={PublicBattleScreen} />
          </Stack.Navigator>
        </View>
        <BottomNavBar authed={authed} navigationRef={navigationRef} />
        {/* Mismo criterio que BottomNavBar: nunca chrome de la app propia
            para un visitante sin sesión (p. ej. ChallengeLanding no
            autenticado) -- ver installService.ts para por qué vive acá
            (sibling, no dentro de un tab) y no en HomeScreen. Tampoco
            encima del dashboard de admin (currentRouteName), que tiene su
            propio layout de escritorio sin estos overlays. */}
        {authed && currentRouteName !== 'AdminDashboard' && <InstallInviteHost navigationRef={navigationRef} />}
        {authed && currentRouteName !== 'AdminDashboard' && <NotificationInviteHost navigationRef={navigationRef} />}
      </View>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  appShell: {
    flex: 1,
  },
  stackArea: {
    flex: 1,
  },
});
