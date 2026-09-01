import React, { useEffect, useState } from 'react';
import { NavigationContainerRef } from '@react-navigation/native';

import { enablePush, markInviteDismissed, subscribeNotificationInvite } from '../services/pushService';
import { RootStackParamList } from '../types';
import { getRootRouteName } from '../utils/navRoute';
import { NotificationSheet } from './NotificationSheet';

// Mismas rutas inseguras que InstallInviteHost/BottomNavBar.
const UNSAFE_ROUTES = new Set(['Record', 'Analyzing', 'ResetPassword', 'Auth']);

interface Props {
  navigationRef: React.RefObject<NavigationContainerRef<RootStackParamList> | null>;
}

/**
 * Host ÚNICO del pre-prompt de notificaciones -- mismo patrón exacto que
 * InstallInviteHost (root-level singleton, sibling de Stack.Navigator,
 * nunca dentro de un tab persistente -- ver el comentario largo en
 * installService.ts sobre por qué esa arquitectura es la correcta). Dos
 * hosts independientes a propósito (no un solo host "genérico" para
 * ambos recordatorios): cada uno tiene su propia política/estado, y
 * mostrarlos simultáneamente sería ruido -- al no compartir el gate de
 * "ya se mostró algo esta sesión" entre sí, en la práctica quedan
 * naturalmente escalonados por los checkpoints desde donde se llaman
 * (ver reporte de esta tarea).
 */
export function NotificationInviteHost({ navigationRef }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    return subscribeNotificationInvite(() => setVisible(true));
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

  async function handleActivate() {
    await enablePush();
    setVisible(false);
  }

  return <NotificationSheet visible={visible} onActivate={handleActivate} onDismiss={handleDismiss} />;
}
