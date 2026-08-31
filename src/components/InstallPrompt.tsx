import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import {
  hasNativePrompt,
  isIOS,
  markInviteDismissed,
  markInviteShown,
  promptNativeInstall,
  shouldShowInstallInvite,
} from '../services/installService';
import { InstallSheet } from './InstallSheet';

/**
 * Invitación AUTOMÁTICA a instalar AURAXP (R3/R4/R5/R6) -- se monta una
 * sola vez en HomeScreen (el checkpoint "volvió a Home después de
 * demostrar valor", ver installService.shouldShowInstallInvite) usando
 * `useFocusEffect` (Home vive DENTRO de MainTabs, con contexto de
 * Navigator real -- a diferencia de BottomNavBar, acá sí es seguro usar
 * hooks de navegación).
 *
 * Re-evalúa en cada foco de Home, no solo al montar: `beforeinstallprompt`
 * puede llegar después del primer render, y así igual se agarra la
 * siguiente vez que alguien vuelve a Home -- sin necesitar un listener
 * global ni volver a montar toda la app.
 *
 * Nunca un botón muerto: en Android/Chrome/Desktop sin un
 * beforeinstallprompt capturado (browser que no lo soporta, o ya se
 * gastó) no hay ninguna acción real posible -- no se muestra nada, ni
 * siquiera la guía de iOS (que es literal solo para iOS).
 *
 * El contenido visual vive en InstallSheet, compartido con el trigger
 * manual de Perfil -> Ajustes (R7) -- acá solo se decide CUÁNDO abrirlo.
 */
export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [variant, setVariant] = useState<'ios' | 'android'>('android');

  useFocusEffect(
    useCallback(() => {
      if (!shouldShowInstallInvite()) return;
      const ios = isIOS();
      if (!ios && !hasNativePrompt()) return; // nada accionable -- no mostrar nada
      setVariant(ios ? 'ios' : 'android');
      setVisible(true);
      markInviteShown();
    }, [])
  );

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
