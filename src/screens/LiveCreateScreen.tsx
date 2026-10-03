import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useSmartBack } from '../hooks/useSmartBack';
import { logEvent } from '../services/analyticsService';
import { canCurrentUserHostLive, createLiveRoom, startLiveRoom } from '../services/liveService';
import { colors, radius, spacing, typography } from '../theme/colors';

const AURA_LIVE_ENABLED = process.env.EXPO_PUBLIC_AURA_LIVE_ENABLED === 'true';

/**
 * AURA LIVE -- pantalla de creación/host (sección 13 del pedido). Solo
 * llega acá un usuario autenticado (ver RootNavigator); el permiso real
 * de transmitir (`can_host_live`) se verifica DOS veces -- acá, solo para
 * decidir qué UI mostrar, y de nuevo server-side en create_live_room()
 * (la que de verdad importa, esta pantalla es solo la mitad de UI, mismo
 * criterio que AdminDashboard/profiles.is_admin).
 *
 * Preview de cámara ANTES de crear la sala: getUserMedia crudo, sin
 * LiveKit todavía -- la conexión real a LiveKit (y por lo tanto el
 * segundo getUserMedia que hace internamente, ver liveMediaService.web)
 * ocurre recién en LiveRoomScreen después de tocar "INICIAR LIVE". Este
 * stream de preview SIEMPRE se detiene (todos los tracks) antes de
 * navegar o al desmontar -- nunca dos cámaras abiertas a la vez (sección
 * 29: "no romper Scan/cámara existente").
 */
export default function LiveCreateScreen() {
  const navigation = useRootNavigation();
  const goBack = useSmartBack();
  const videoContainerRef = useRef<View>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  const [checkingAuthorization, setCheckingAuthorization] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewActive, setPreviewActive] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [starting, setStarting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useFocusEffect(
    useCallback(() => {
      logEvent('live_create_viewed');
    }, []),
  );

  useEffect(() => {
    canCurrentUserHostLive().then((ok) => {
      setAuthorized(ok);
      setCheckingAuthorization(false);
    });
  }, []);

  function stopPreview() {
    previewStreamRef.current?.getTracks().forEach((t) => t.stop());
    previewStreamRef.current = null;
    setPreviewActive(false);
  }

  useEffect(() => stopPreview, []);

  async function handleEnablePreview() {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.mediaDevices) {
      setPreviewError('La cámara en vivo solo está disponible en el navegador por ahora.');
      return;
    }
    setPreviewError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      previewStreamRef.current = stream;
      const container = videoContainerRef.current as unknown as HTMLElement | null;
      if (container) {
        const el = document.createElement('video');
        el.autoplay = true;
        el.playsInline = true;
        el.muted = true;
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.objectFit = 'cover';
        el.srcObject = stream;
        container.innerHTML = '';
        container.appendChild(el);
      }
      setPreviewActive(true);
    } catch (e) {
      setPreviewError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'No pudimos acceder a tu cámara -- revisa los permisos del navegador.'
          : 'No pudimos acceder a tu cámara o micrófono.',
      );
    }
  }

  function toggleMic() {
    const next = !micEnabled;
    setMicEnabled(next);
    previewStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = next));
  }

  async function handleConfirmStart() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || starting) return;
    setStarting(true);
    logEvent('live_start_attempted');

    const createResult = await createLiveRoom(trimmedTitle, description.trim() || undefined);
    if (!createResult.ok || !createResult.roomId || !createResult.slug) {
      setStarting(false);
      setConfirming(false);
      logEvent('live_start_failed', { reason: createResult.errorCode ?? 'create_failed' });
      setPreviewError('No pudimos crear el LIVE. Intenta de nuevo.');
      return;
    }

    const startResult = await startLiveRoom(createResult.roomId);
    if (!startResult.ok) {
      setStarting(false);
      setConfirming(false);
      logEvent('live_start_failed', { reason: startResult.errorCode ?? 'start_failed' });
      setPreviewError('No pudimos iniciar el LIVE. Intenta de nuevo.');
      return;
    }

    // 'live_started' ya se logueó server-side dentro de start_live_room()
    // (ver la migración) -- mismo criterio que 'chat_message_sent' en
    // Chat V1: un hecho real no debe depender de un segundo logEvent()
    // del cliente que podría perderse en la navegación que sigue.
    stopPreview();
    navigation.reset({ index: 0, routes: [{ name: 'LiveRoom', params: { slug: createResult.slug } }] });
  }

  if (checkingAuthorization) {
    return (
      <ScreenContainer onBack={goBack}>
        <Text style={styles.muted}>Verificando permisos...</Text>
      </ScreenContainer>
    );
  }

  if (!AURA_LIVE_ENABLED) {
    return (
      <ScreenContainer onBack={goBack}>
        <Text style={styles.title}>AURA LIVE</Text>
        <Text style={styles.muted}>AURA LIVE todavía no está disponible.</Text>
      </ScreenContainer>
    );
  }

  if (!authorized) {
    return (
      <ScreenContainer onBack={goBack}>
        <Text style={styles.title}>AURA LIVE</Text>
        <Text style={styles.muted}>
          Transmitir en vivo todavía está limitado a cuentas autorizadas mientras probamos AURA LIVE. Si quieres ser de los
          primeros hosts, contáctanos desde Ayuda.
        </Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer onBack={goBack} style={styles.screen}>
      <Text style={styles.title}>Crear LIVE</Text>

      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Batalla de Aura -- Pichidegua"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        maxLength={120}
      />
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="Descripción (opcional)"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, styles.inputMultiline]}
        maxLength={500}
        multiline
      />

      <View style={styles.previewBox}>
        <View ref={videoContainerRef} style={styles.previewVideo} />
        {!previewActive && (
          <View style={styles.previewOverlay}>
            <Text style={styles.previewOverlayText}>Toca para activar cámara y micrófono</Text>
            <PrimaryButton label="ACTIVAR CÁMARA" onPress={handleEnablePreview} />
          </View>
        )}
      </View>

      {previewError && <Text style={styles.error}>{previewError}</Text>}

      {previewActive && (
        <View style={styles.controlsRow}>
          <Pressable style={styles.controlChip} onPress={toggleMic}>
            <Text style={styles.controlChipText}>{micEnabled ? '🎙️ Mic ON' : '🔇 Mic OFF'}</Text>
          </Pressable>
          <Pressable style={styles.controlChip} onPress={stopPreview}>
            <Text style={styles.controlChipText}>Cancelar</Text>
          </Pressable>
        </View>
      )}

      {previewActive && !confirming && (
        <PrimaryButton label="INICIAR LIVE" disabled={!title.trim()} onPress={() => setConfirming(true)} />
      )}

      {confirming && (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmText}>Estás a punto de transmitir en vivo. Todos en AURA VS podrán verte.</Text>
          <PrimaryButton label={starting ? '...' : 'SÍ, TRANSMITIR'} disabled={starting} onPress={handleConfirmStart} />
          <PrimaryButton label="Ahora no" variant="text" onPress={() => setConfirming(false)} />
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: spacing.md,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
  },
  muted: {
    ...typography.body,
    color: colors.textSecondary,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
  },
  inputMultiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  previewBox: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: 420,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  previewVideo: {
    flex: 1,
  },
  previewOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  previewOverlayText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  error: {
    ...typography.caption,
    color: colors.danger,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  controlChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  controlChipText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  confirmBox: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  confirmText: {
    ...typography.body,
    color: colors.textPrimary,
  },
});
