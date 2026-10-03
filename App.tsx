import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from './src/components/ErrorBoundary';
import { WebMobileFrame } from './src/components/WebMobileFrame';
import { AuthProvider, useAuth } from './src/hooks/useAuth';
import { RootNavigator } from './src/navigation/RootNavigator';
import { logAppOpenOnce, logWebVisitOnce } from './src/services/analyticsService';
import { captureWebVisit } from './src/services/campaignService';
import { checkStandaloneOnBoot, registerServiceWorker } from './src/services/installService';
import { captureReferralFromUrl } from './src/services/referralService';

/**
 * Chat is intentionally registered on both sides of the auth gate so guests
 * can use the public room. React Navigation can therefore keep that screen
 * mounted while a guest signs in. Keying the navigator by auth identity
 * guarantees a clean remount on guest -> account (and account -> guest), so
 * Presence, members and private-chat permissions never retain stale guest
 * state after authentication.
 */
function AuthenticatedAppShell() {
  const { session } = useAuth();
  const identityKey = session?.user.id ?? 'guest';

  return (
    <WebMobileFrame>
      <RootNavigator key={identityKey} />
    </WebMobileFrame>
  );
}

export default function App() {
  useEffect(() => {
    logAppOpenOnce();
    registerServiceWorker();
    checkStandaloneOnBoot();
    captureReferralFromUrl();
    void captureWebVisit().then(() => logWebVisitOnce());
  }, []);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <AuthProvider>
          <AuthenticatedAppShell />
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
