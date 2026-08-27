import React from 'react';
import { DarkTheme, NavigationContainer, Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { MainTabNavigator } from './MainTabNavigator';
import AnalyzingScreen from '../screens/AnalyzingScreen';
import ChallengeScreen from '../screens/ChallengeScreen';
import ScanResultScreen from '../screens/ScanResultScreen';
import UploadScreen from '../screens/UploadScreen';
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

/**
 * Root native stack: hosts the bottom tab navigator (Home / Scan / Profile)
 * as its base screen, plus the flow screens pushed on top of it. Every flow
 * screen owns its own full-bleed layout and headline, so the native header
 * chrome stays hidden throughout for a premium, non-SaaS feel — back
 * navigation is via the platform swipe/hardware gesture instead.
 *
 * Flow: Home/Scan -> Upload/Capture -> Analyzing -> Aura Replay (ScanResult) -> Challenge / Share
 */
export function RootNavigator() {
  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="MainTabs" component={MainTabNavigator} />
        <Stack.Screen name="Upload" component={UploadScreen} />
        {/* Transient auto-advancing state — block swiping back out of it. */}
        <Stack.Screen name="Analyzing" component={AnalyzingScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="ScanResult" component={ScanResultScreen} />
        <Stack.Screen name="Challenge" component={ChallengeScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
