import React, { useEffect, useRef } from 'react';
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
import { consumePendingChallengeToken } from '../services/pendingChallenge';
import { tryAttributePendingReferral } from '../services/referralService';
import { logPageView } from '../services/analyticsService';
import AdminDashboardScreen from '../screens/AdminDashboardScreen';
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

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['auraxp://', 'https://auravs.app'],
  config: {
    screens: {
      AdminDashboard: 'admin',
      ChallengeLanding: 'c/:token',
      Auth: 'auth',
      Landing: 'aura',
      PublicResult: 'r/:token',
      PublicBattle: 'b/:token',
    },
  },
};

export function RootNavigator() {
  const { session, loading, passwordRecovery } = useAuth();
  const authed = !isSupabaseConfigured || Boolean(session);
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  const resumedRef = useRef(false);
  const routeNameRef = useRef<string | undefined>();

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
          nav.navigate('ChallengeLanding', { token });
        }
      });
    });
  }, [authed, passwordRecovery]);

  useEffect(() => {
    if (!session) return;
    tryAttributePendingReferral();
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
      onReady={() => {
        const route = navigationRef.current?.getCurrentRoute()?.name;
        routeNameRef.current = route;
        if (route) logPageView(route);
      }}
      onStateChange={() => {
        const route = navigationRef.current?.getCurrentRoute()?.name;
        if (route && route !== routeNameRef.current) {
          logPageView(route);
          routeNameRef.current = route;
        }
      }}
    >
      <View style={styles.appShell}>
        <View style={styles.stackArea}>
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            {authed && passwordRecovery ? (
              <Stack.Screen
                name="ResetPassword"
                component={ResetPasswordScreen}
                options={{ gestureEnabled: false }}
              />
            ) : authed ? (
              <>
                <Stack.Screen name="MainTabs" component={MainTabNavigator} />
                <Stack.Screen name="Upload" component={UploadScreen} />
                <Stack.Screen name="Record" component={RecordScreen} options={{ gestureEnabled: false }} />
                <Stack.Screen name="Analyzing" component={AnalyzingScreen} options={{ gestureEnabled: false }} />
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
              </>
            ) : (
              <>
                <Stack.Screen name="Auth" component={AuthScreen} />
                <Stack.Screen name="Landing" component={LandingScreen} />
              </>
            )}

            {/* Always registered so /admin can be opened directly. The screen
                itself verifies the authenticated admin through the RPC. */}
            <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
            <Stack.Screen name="ChallengeLanding" component={ChallengeLandingScreen} />
            <Stack.Screen name="PublicResult" component={PublicResultScreen} />
            <Stack.Screen name="PublicBattle" component={PublicBattleScreen} />
          </Stack.Navigator>
        </View>
        <BottomNavBar authed={authed} navigationRef={navigationRef} />
        {authed && <InstallInviteHost navigationRef={navigationRef} />}
        {authed && <NotificationInviteHost navigationRef={navigationRef} />}
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
