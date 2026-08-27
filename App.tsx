import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { WebMobileFrame } from './src/components/WebMobileFrame';
import { RootNavigator } from './src/navigation/RootNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <WebMobileFrame>
        <RootNavigator />
      </WebMobileFrame>
    </SafeAreaProvider>
  );
}
