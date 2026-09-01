import React, { useEffect, useState } from 'react';
import { NavigationContainerRef } from '@react-navigation/native';

import { markInviteDismissed, promptNativeInstall, subscribeInstallInvite } from '../services/installService';
import { RootStackParamList } from '../types';
import { getRootRouteName } from '../utils/navRoute';
import { InstallSheet } from './InstallSheet';

// Mismas rutas donde BottomNavBar tampoco se muestra por ser "inseguras"
// (cámara en vivo, transición auto-avanzante, auth) -- mostrar una
// invitación a instalar encima de esas pantallas sería, como mínimo,
// una distracción fuera de lugar, y en Record activamente estorbaría.
const UNSAFE_ROUTES = new Set(['Record', 'Analyzing', 'ResetPassword', 'Auth']);

interface Props {
  navigationRef: React.RefObject<NavigationContainerRef<RootStackParamList> | null>;
}

/**
 * Host ÚNICO de la invitación automática a instalar (A/B) -- vive a nivel
 * raíz, sibling de Stack.Navigator (igual que BottomNavBar), NUNCA dentro
 * de una pantalla del bottom-tabs.
 *
 * Por qué el cambio de arquitectura (bug real encontrado en producción,
 * ver el comentario largo en installService.ts): la versión anterior
 * montaba el popup DENTRO de HomeScreen. Home es un tab, los tabs no se
 * desmontan al perder foco -- el Modal se quedaba vivo (y a veces
 * VISIBLE) sin importar a qué pantalla navegara el usuario después,
 * porque nada lo cerraba al perder foco. Acá no hay ese problema: no
 * reacciona a foco en absoluto, solo a `requestInstallInvite()` llamado
 * explícitamente desde un puñado de checkpoints reales (ver
 * installService.ts) -- y como defensa adicional, se autocierra si la
 * navegación cae en una ruta insegura mientras está abierto (por si
 * alguna vez se abre y el usuario sigue navegando).
 */
export function InstallInviteHost({ navigationRef }: Props) {
  const [visible, setVisible] = useState(false);
  const [variant, setVariant] = useState<'ios' | 'android'>('android');

  useEffect(() => {
    return subscribeInstallInvite((v) => {
      setVariant(v);
      setVisible(true);
    });
  }, []);

  useEffect(() => {
    const nav = navigationRef.current;
    if (!nav) return;
    const unsubscribe = nav.addListener('state', () => {
      const routeName = getRootRouteName(nav);
      if (routeName && UNSAFE_ROUTES.has(routeName)) setVisible(false);
    });
    return unsubscribe;
  }, [navigationRef]);

  function handleDismiss() {
    setVisible(false);
    markInviteDismissed();
  }

  async function handleInstall() {
    const outcome = await promptNativeInstall();
    if (outcome === 'dismissed') {
      handleDismiss();
    } else {
      setVisible(false);
    }
  }

  return <InstallSheet visible={visible} variant={variant} onInstall={handleInstall} onDismiss={handleDismiss} />;
}
