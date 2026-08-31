import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { WebMobileFrame } from './src/components/WebMobileFrame';
import { AuthProvider } from './src/hooks/useAuth';
import { RootNavigator } from './src/navigation/RootNavigator';
import { logAppOpenOnce } from './src/services/analyticsService';

export default function App() {
  // Analítica de funnel (L) -- una sola vez por carga de la app, ver
  // logAppOpenOnce (el guard vive ahí, no acá, por si este componente
  // remontara). No es literalmente "abrió la app" en un sentido nativo
  // (no hay evento de sistema para eso en Expo web), pero es el proxy más
  // fiel disponible sin agregar una librería nueva solo para esto.
  useEffect(() => {
    logAppOpenOnce();
  }, []);

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
