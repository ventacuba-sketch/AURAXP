import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';

import { AuraScanner } from '../components/AuraScanner';
import { PrimaryButton } from '../components/PrimaryButton';
import { WebCameraCapture } from '../components/WebCameraCapture';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { colors, radius, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';

type RecordRoute = RouteProp<RootStackParamList, 'Record'>;

/**
 * Despachador por plataforma -- expo-camera no graba en web (confirmado en
 * su propio código fuente: record()/stopRecording() ahí son no-ops), así
 * que web usa un componente completamente aparte basado en Web APIs
 * (getUserMedia + MediaRecorder). Nativo (iOS/Android) sigue exactamente
 * igual que antes -- NativeCameraRecorder de acá abajo es el mismo código
 * de siempre, solo renombrado; ni sus hooks ni su lógica se tocaron.
 */
export default function RecordScreen() {
  if (Platform.OS === 'web') {
    return <WebCameraCapture />;
  }
  return <NativeCameraRecorder />;
}

const MAX_DURATION_MS = 8000;
// Respaldo por si el corte nativo de maxDuration se demora en resolver --
// no es una licencia para grabar más de 8s a propósito. El buffer chico
// evita que este timer y el corte nativo compitan en el caso normal (que
// stopRecording() se llame dos veces casi al mismo tiempo).
const STOP_BACKUP_BUFFER_MS = 300;

/**
 * Cámara propia de AURAXP para grabar directo (en vez de delegar a la app
 * de cámara del sistema vía expo-image-picker). El corte automático a los
 * 8.0s ahora es una garantía real:
 * - Capa 1: `recordAsync({ maxDuration: 8 })` -- implementado en el módulo
 *   nativo de expo-camera para iOS y Android (no depende de qué app de
 *   cámara tenga instalada el usuario, a diferencia de
 *   `videoMaxDuration` de expo-image-picker).
 * - Capa 2: un `setTimeout` propio que llama a `stopRecording()` como
 *   respaldo si la capa 1 fallara.
 * - Capa 3: la validación de duración que ya existe en UploadScreen
 *   (sin tocar) sigue corriendo sobre el video final, sin importar de
 *   dónde vino.
 */
function NativeCameraRecorder() {
  const navigation = useRootNavigation();
  const { params } = useRoute<RecordRoute>();
  const insets = useSafeAreaInsets();

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();

  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  // La sesión nativa de cámara tarda un instante en inicializarse -- si se
  // llama a recordAsync() antes de eso puede fallar en algunos equipos
  // (sobre todo Android). Bloqueamos el botón hasta el callback nativo.
  const [cameraReady, setCameraReady] = useState(false);

  const cameraRef = useRef<CameraView | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Refs (no state) para que el cleanup de desmontaje siempre lea el valor
  // real, sin depender de closures de renders viejos.
  const recordingRef = useRef(false);
  const stopRequestedRef = useRef(false);

  function goToUpload(recordedUri?: string, recordedDurationMs?: number) {
    navigation.navigate('Upload', {
      challengeToken: params?.challengeToken,
      rematchTargetUsername: params?.rematchTargetUsername,
      recordedUri,
      recordedDurationMs,
    });
  }

  // Pide cámara + micrófono apenas se entra a la pantalla -- grabar video
  // necesita los dos permisos, no solo el de cámara.
  useEffect(() => {
    if (cameraPermission && !cameraPermission.granted && cameraPermission.canAskAgain) {
      requestCameraPermission();
    }
    if (micPermission && !micPermission.granted && micPermission.canAskAgain) {
      requestMicPermission();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraPermission?.status, micPermission?.status]);

  const clearTimers = useCallback(() => {
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
  }, []);

  // Nunca dejar timers corriendo ni la cámara grabando en segundo plano si
  // esta pantalla se desmonta (volver atrás, o cualquier otra navegación)
  // mientras hay una grabación en curso.
  useEffect(() => {
    return () => {
      clearTimers();
      if (recordingRef.current && !stopRequestedRef.current) {
        stopRequestedRef.current = true;
        cameraRef.current?.stopRecording();
      }
    };
  }, [clearTimers]);

  // Bloquea el botón físico "atrás" de Android mientras graba, en vez de
  // dejar que interrumpa la grabación por un canal distinto al botón de
  // detener propio de la pantalla (mismo criterio que gestureEnabled:
  // false para el swipe de iOS, ver RootNavigator).
  useEffect(() => {
    if (!recording) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [recording]);

  function requestStop() {
    if (stopRequestedRef.current) return; // evita llamar stopRecording() dos veces
    stopRequestedRef.current = true;
    cameraRef.current?.stopRecording();
  }

  async function handleStartRecording() {
    if (!cameraRef.current || recording || !cameraReady) return;

    stopRequestedRef.current = false;
    recordingRef.current = true;
    setElapsedMs(0);
    setRecording(true);

    const startedAt = Date.now();

    tickIntervalRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 100);

    stopTimeoutRef.current = setTimeout(() => {
      requestStop();
    }, MAX_DURATION_MS + STOP_BACKUP_BUFFER_MS);

    try {
      const video = await cameraRef.current.recordAsync({ maxDuration: MAX_DURATION_MS / 1000 });
      finishRecording(video?.uri ?? null, startedAt);
    } catch (e) {
      console.warn('recordAsync failed', e);
      finishRecording(null, startedAt);
    }
  }

  function finishRecording(uri: string | null, startedAt: number) {
    clearTimers();
    recordingRef.current = false;
    setRecording(false);

    if (!uri) {
      // No se pudo grabar (permiso revocado a mitad de camino, error del
      // módulo nativo, etc.) -- volvemos a Upload sin video en vez de
      // dejar a la persona en una pantalla de cámara rota.
      goToUpload();
      return;
    }

    goToUpload(uri, Date.now() - startedAt);
  }

  const remainingSeconds = Math.max(0, (MAX_DURATION_MS - elapsedMs) / 1000);
  const progress = Math.min(1, elapsedMs / MAX_DURATION_MS);

  const permissionsLoading = cameraPermission === null || micPermission === null;
  const permissionsGranted = Boolean(cameraPermission?.granted && micPermission?.granted);
  const canAskAgain = Boolean(cameraPermission?.canAskAgain || micPermission?.canAskAgain);

  if (permissionsLoading) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>Cargando cámara…</Text>
      </View>
    );
  }

  if (!permissionsGranted) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + spacing.lg }]}>
        <Text style={styles.permissionTitle}>Falta permiso</Text>
        <Text style={styles.permissionText}>
          AURA VS necesita acceso a la cámara y al micrófono para grabar tu momento.
        </Text>
        <View style={styles.permissionActions}>
          {canAskAgain ? (
            <PrimaryButton
              label="DAR PERMISO"
              onPress={() => {
                requestCameraPermission();
                requestMicPermission();
              }}
            />
          ) : (
            <PrimaryButton label="ABRIR AJUSTES" onPress={() => Linking.openSettings()} />
          )}
          <PrimaryButton label="VOLVER" variant="text" onPress={() => goToUpload()} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        mode="video"
        facing="back"
        onCameraReady={() => setCameraReady(true)}
      />

      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        {!recording && (
          <Pressable onPress={() => goToUpload()} style={styles.closeButton} hitSlop={12}>
            <Text style={styles.closeGlyph}>✕</Text>
          </Pressable>
        )}
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.lg }]}>
        {recording && (
          <View style={styles.countdownWrap}>
            <AuraScanner progress={progress} active size={96}>
              <Text style={styles.countdownText}>{remainingSeconds.toFixed(1)}s</Text>
            </AuraScanner>
          </View>
        )}

        <Pressable
          onPress={recording ? requestStop : handleStartRecording}
          disabled={!recording && !cameraReady}
          style={styles.recordButtonWrap}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Detener grabación' : 'Grabar video'}
        >
          <View
            style={[
              styles.recordButtonOuter,
              recording && styles.recordButtonOuterActive,
              !recording && !cameraReady && styles.recordButtonOuterDisabled,
            ]}
          >
            <View style={[styles.recordButtonInner, recording && styles.recordButtonInnerActive]} />
          </View>
        </Pressable>

        <Text style={styles.hint}>
          {recording
            ? 'Toca para detener antes de tiempo'
            : cameraReady
              ? 'Toca para grabar (máximo 8 segundos)'
              : 'Preparando cámara…'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
  permissionTitle: {
    ...typography.title,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  permissionText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  permissionActions: {
    width: '100%',
    gap: spacing.sm,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(11, 11, 18, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeGlyph: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  countdownWrap: {
    marginBottom: spacing.lg,
  },
  countdownText: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  recordButtonWrap: {
    marginBottom: spacing.md,
  },
  recordButtonOuter: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonOuterActive: {
    borderColor: colors.danger,
  },
  recordButtonOuterDisabled: {
    opacity: 0.4,
  },
  recordButtonInner: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
  },
  recordButtonInnerActive: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
  },
  hint: {
    ...typography.caption,
    color: '#fff',
    textAlign: 'center',
  },
});
