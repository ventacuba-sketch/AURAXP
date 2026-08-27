import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { WebMobileFrame } from './src/components/WebMobileFrame';
import { AuthProvider } from './src/hooks/useAuth';
import { RootNavigator } from './src/navigation/RootNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <WebMobileFrame>
          <RootNavigator />
        </WebMobileFrame>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
