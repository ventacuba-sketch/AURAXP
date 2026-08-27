import React from 'react';
import { DarkTheme, NavigationContainer, Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { MainTabNavigator } from './MainTabNavigator';
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
 * as its base screen, plus the capture → result → challenge flow screens
 * pushed on top of it.
 *
 * Flow: Home → Scan → Upload/Capture → ScanResult → Challenge / Share
 */
export function RootNavigator() {
  return (
    <NavigationContainer theme={navigationTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="MainTabs" component={MainTabNavigator} options={{ headerShown: false }} />
        <Stack.Screen name="Upload" component={UploadScreen} options={{ title: 'Capture' }} />
        <Stack.Screen name="ScanResult" component={ScanResultScreen} options={{ title: 'Scan Result' }} />
        <Stack.Screen name="Challenge" component={ChallengeScreen} options={{ title: 'Challenges' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
