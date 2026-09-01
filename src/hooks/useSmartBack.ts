import { useCallback } from 'react';

import { useRootNavigation } from './useRootNavigation';

/**
 * "Volver" que nunca deja a nadie colgado: si hay una pantalla anterior en
 * el stack (llegaste navegando desde adentro de la app), la usa; si no
 * (p. ej. abriste un link directo y esta fue la primera pantalla), cae a
 * Home en vez de no hacer nada. Pensado para pasarse tal cual como
 * `onBack` de ScreenContainer.
 */
export function useSmartBack(): () => void {
  const navigation = useRootNavigation();
  return useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.navigate('MainTabs');
    }
  }, [navigation]);
}
