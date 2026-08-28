import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import {
  DarkTheme,
  LinkingOptions,
  NavigationContainer,
  Theme,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { MainTabNavigator } from './MainTabNavigator';
import { useAuth } from '../hooks/useAuth';
import AnalyzingScreen from '../screens/AnalyzingScreen';
import AuthScreen from '../screens/AuthScreen';
import ChallengeLandingScreen from '../screens/ChallengeLandingScreen';
import ChallengeScreen from '../screens/ChallengeScreen';
import RecordScreen from '../screens/RecordScreen';
import ScanResultScreen from '../screens/ScanResultScreen';
import UploadScreen from '../screens/UploadScreen';
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

// Solo ChallengeLanding (y Auth) tienen un path real — es lo único que
// necesita abrirse desde fuera de la app (link compartido / navegador).
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['auraxp://', 'https://auraxp.app'],
  config: {
    screens: {
      ChallengeLanding: 'c/:token',
      Auth: 'auth',
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
  const { session, loading } = useAuth();
  const authed = !isSupabaseConfigured || Boolean(session);

  if (isSupabaseConfigured && loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navigationTheme} linking={linking}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {authed ? (
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
          </>
        ) : (
          <Stack.Screen name="Auth" component={AuthScreen} />
        )}
        <Stack.Screen name="ChallengeLanding" component={ChallengeLandingScreen} />
      </Stack.Navigator>
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
});
