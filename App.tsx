import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from './src/components/ErrorBoundary';
import { WebMobileFrame } from './src/components/WebMobileFrame';
import { AuthProvider } from './src/hooks/useAuth';
import { RootNavigator } from './src/navigation/RootNavigator';
import { logAppOpenOnce, logWebVisitOnce } from './src/services/analyticsService';
import { captureWebVisit } from './src/services/campaignService';
import { checkStandaloneOnBoot, registerServiceWorker } from './src/services/installService';
import { captureReferralFromUrl } from './src/services/referralService';

export default function App() {
  useEffect(() => {
    logAppOpenOnce();

    // Acquisition telemetry: capture UTM/referrer/device context before
    // logging the web visit so the dashboard can attribute traffic.
    void captureWebVisit().then(() => logWebVisitOnce());

    registerServiceWorker();
    checkStandaloneOnBoot();
    captureReferralFromUrl();
  }, []);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthProvider>
          <WebMobileFrame>
            <RootNavigator />
          </WebMobileFrame>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
