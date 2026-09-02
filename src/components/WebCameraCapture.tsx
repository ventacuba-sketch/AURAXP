import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AuraScanner } from './AuraScanner';
import { PrimaryButton } from './PrimaryButton';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { colors, radius, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';

type RecordRoute = RouteProp<RootStackParamList, 'Record'>;

const MAX_DURATION_MS = 8000;
// Ver el comentario en finishRecording() -- overshoot chico y esperable
// del propio setTimeout/encoder al cortar, no más contenido real.
const AUTO_STOP_OVERSHOOT_TOLERANCE_MS = 500;

// Orden de preferencia para MediaRecorder.isTypeSupported(): mp4/H.264 va
// primero porque es lo único que graba Safari 14.1-18.3 (confirmado en la
// documentación de WebKit) -- Safari 18.4+ suma soporte de WebM, pero mp4
// sigue siendo la opción de compatibilidad más amplia. Los navegadores que
// no graban mp4 (Firefox históricamente) caen a los candidatos WebM.
const MIME_TYPE_CANDIDATES = [
  'video/mp4',
  'video/mp4;codecs="avc1,mp4a.40.2"',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

function detectWebRecordingSupport(): { supported: boolean; mimeType: string | null } {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, mimeType: null };
  }
  // getUserMedia (y por lo tanto grabar) solo existe en un contexto seguro
  // (HTTPS, o localhost) -- un link tipo http://192.168.x.x no califica.
  if (!window.isSecureContext) return { supported: false, mimeType: null };
  if (!navigator.mediaDevices?.getUserMedia) return { supported: false, mimeType: null };
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return { supported: false, mimeType: null };
  }

  const mimeType = MIME_TYPE_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
  return { supported: mimeType !== null, mimeType };
}

type PermissionState = 'pending' | 'granted' | 'denied';
type PreviewState = 'idle' | 'waiting' | 'ready' | 'error';

const PREVIEW_READY_TIMEOUT_MS = 8000;

/**
 * Logging TEMPORAL para diagnosticar el preview negro en Safari iOS (ver
 * conversación) -- mismo formato usado en el resto del proyecto para este
 * tipo de diagnóstico. Sacar una vez confirmado el fix en un iPhone real.
 */
function log(step: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ src: 'WebCameraCapture', step, t: Date.now(), ...data }));
}

/**
 * Cámara propia de AURAXP para Safari/iPhone y navegadores desktop, usando
 * Web APIs nativas (getUserMedia + MediaRecorder) -- expo-camera no graba
 * en web, así que esto es un camino completamente aparte, no una variante
 * del componente nativo. Misma UX y mismo contrato de salida que
 * NativeCameraRecorder (RecordScreen.tsx): auto-stop a 8.0s, contador
 * visual, stop manual, y vuelta a Upload con { recordedUri,
 * recordedDurationMs }.
 *
 * Auto-stop: acá no existe un "maxDuration nativo" como en expo-camera --
 * MediaRecorder no tiene ese concepto. El único mecanismo es un
 * `setTimeout` propio a los 8000ms exactos (capa 1), y la validación de
 * duración que ya existe en UploadScreen sigue corriendo sobre el video
 * final como segunda capa, sin tocarla.
 */
export function WebCameraCapture() {
  const navigation = useRootNavigation();
  const { params } = useRoute<RecordRoute>();
  const insets = useSafeAreaInsets();

  // Se evalúa una sola vez al montar -- no cambia durante la vida de la
  // pantalla.
  const [{ supported, mimeType }] = useState(detectWebRecordingSupport);
  const [permissionState, setPermissionState] = useState<PermissionState>('pending');
  // Separado de permissionState a propósito: "permiso concedido" (stream
  // obtenido) no es lo mismo que "el <video> está realmente reproduciendo
  // frames" -- ver el efecto de abajo que asigna srcObject y espera a que
  // sea reproducible antes de dejar grabar.
  const [previewState, setPreviewState] = useState<PreviewState>('idle');
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Refs (no state) para que el cleanup de desmontaje siempre lea el valor
  // real, sin depender de closures de renders viejos -- mismo patrón que
  // NativeCameraRecorder.
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

  function clearTimers() {
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  // getUserMedia ES el prompt de permiso en web -- a diferencia de
  // expo-camera no hay un paso separado de "consultar sin preguntar".
  // Pedimos apenas se entra a la pantalla, solo si el navegador soporta
  // grabar (si no, ver el estado `!supported` más abajo).
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;

    log('getUserMedia:start');
    navigator.mediaDevices
      // facingMode como objeto con `ideal` (no el string suelto) evita
      // tratarlo como constraint exacta -- si el equipo no tiene cámara
      // trasera, igual devuelve la que tenga en vez de rechazar el pedido.
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        log('getUserMedia:success', {
          tracks: stream.getTracks().map((t) => ({
            kind: t.kind,
            label: t.label,
            readyState: t.readyState,
            enabled: t.enabled,
            muted: t.muted,
          })),
        });
        // OJO: NO tocar videoRef.current acá -- en este punto permissionState
        // todavía es 'pending', así que el <video> ni siquiera está montado
        // todavía (se monta recién cuando permissionState pasa a 'granted',
        // más abajo en el render). Asignarlo acá sería un no-op silencioso
        // contra un ref null -- era exactamente el bug del preview negro.
        // El efecto de más abajo (dependiente de permissionState) es quien
        // conecta el stream al <video> una vez que ya existe en el DOM.
        streamRef.current = stream;
        setPermissionState('granted');
      })
      .catch((e) => {
        log('getUserMedia:error', { error: String(e), name: e instanceof Error ? e.name : undefined });
        console.warn('getUserMedia failed', e);
        if (!cancelled) setPermissionState('denied');
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  // Conecta el stream al <video> DESPUÉS de que permissionState pase a
  // 'granted' -- recién ahí React ya montó el elemento (ver el render más
  // abajo), así que videoRef.current es válido. Espera a loadedmetadata/
  // canplay (y confirma videoWidth/videoHeight > 0) antes de habilitar
  // grabar, para nunca dejar grabar un preview que en realidad está negro.
  useEffect(() => {
    if (permissionState !== 'granted') return undefined;

    const stream = streamRef.current;
    const video = videoRef.current;
    if (!stream || !video) {
      log('preview:missing_refs', { hasStream: Boolean(stream), hasVideoEl: Boolean(video) });
      setPreviewState('error');
      return undefined;
    }

    let settled = false;
    setPreviewState('waiting');
    video.srcObject = stream;

    function markReadyIfPlayable(source: string) {
      if (settled || !video) return;
      const { videoWidth, videoHeight, readyState } = video;
      if (videoWidth > 0 && videoHeight > 0) {
        settled = true;
        log('preview:ready', { source, videoWidth, videoHeight, readyState });
        setPreviewState('ready');
      } else {
        log('preview:dimensions_still_zero', { source, videoWidth, videoHeight, readyState });
      }
    }

    function handleLoadedMetadata() {
      if (!video) return;
      log('preview:loadedmetadata', {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
      });
      markReadyIfPlayable('loadedmetadata');
    }

    function handleCanPlay() {
      if (!video) return;
      log('preview:canplay', {
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        readyState: video.readyState,
      });
      markReadyIfPlayable('canplay');
    }

    function handleVideoError() {
      log('preview:video_error', {
        error: video?.error ? { code: video.error.code, message: video.error.message } : null,
      });
      if (!settled) {
        settled = true;
        setPreviewState('error');
      }
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('error', handleVideoError);

    // Safari requiere invocar play() explícitamente (autoPlay solo no
    // alcanza siempre) y su Promise puede rechazar -- nunca la dejamos sin
    // manejar.
    video
      .play()
      .then(() => {
        log('preview:play_resolved', {
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          readyState: video.readyState,
        });
        markReadyIfPlayable('play_resolved');
      })
      .catch((e) => {
        log('preview:play_rejected', { error: String(e) });
        console.warn('video.play() failed', e);
      });

    const timeoutId = setTimeout(() => {
      if (!settled) {
        log('preview:timeout', {
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          readyState: video.readyState,
        });
        settled = true;
        setPreviewState('error');
      }
    }, PREVIEW_READY_TIMEOUT_MS);

    return () => {
      clearTimeout(timeoutId);
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('error', handleVideoError);
    };
  }, [permissionState]);

  // Nunca dejar el stream, el MediaRecorder ni los timers vivos si esta
  // pantalla se desmonta (volver atrás, o cualquier otra navegación)
  // mientras hay una grabación en curso.
  useEffect(() => {
    return () => {
      clearTimers();
      if (recordingRef.current && !stopRequestedRef.current) {
        stopRequestedRef.current = true;
        try {
          recorderRef.current?.stop();
        } catch {
          // Ya estaba detenido -- no hay nada que hacer.
        }
      }
      stopStream();
    };
  }, []);

  function requestStop() {
    if (stopRequestedRef.current) return; // evita el segundo stop() (MediaRecorder tira InvalidStateError si ya está inactivo)
    stopRequestedRef.current = true;
    try {
      recorderRef.current?.stop();
    } catch (e) {
      console.warn('MediaRecorder.stop failed', e);
    }
  }

  function handleStartRecording() {
    // previewState !== 'ready' cubre justo el bug que estamos arreglando:
    // nunca arrancar a grabar mientras el <video> no esté confirmado
    // reproduciendo frames reales (videoWidth/videoHeight > 0) -- si no,
    // grabaríamos un clip negro sin que nadie se entere hasta Gemini.
    if (recording || !streamRef.current || !mimeType || previewState !== 'ready') return;

    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorderRef.current = recorder;
    chunksRef.current = [];

    const startedAt = Date.now();

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType });
      chunksRef.current = [];
      finishRecording(URL.createObjectURL(blob), startedAt);
    };

    recorder.onerror = (event) => {
      console.warn('MediaRecorder error', event);
      finishRecording(null, startedAt);
    };

    stopRequestedRef.current = false;
    recordingRef.current = true;
    setElapsedMs(0);
    setRecording(true);

    tickIntervalRef.current = setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 100);

    // Único mecanismo de auto-stop en web (MediaRecorder no tiene
    // maxDuration propio) -- la validación de duración en UploadScreen es
    // la segunda capa, sin tocar.
    stopTimeoutRef.current = setTimeout(() => {
      requestStop();
    }, MAX_DURATION_MS);

    recorder.start();
  }

  function finishRecording(uri: string | null, startedAt: number) {
    clearTimers();
    recordingRef.current = false;
    setRecording(false);
    stopStream();

    if (!uri) {
      // No se pudo grabar (permiso revocado a mitad de camino, error del
      // MediaRecorder, etc.) -- volvemos a Upload sin video en vez de
      // dejar a la persona en una pantalla de cámara rota.
      goToUpload();
      return;
    }

    const measuredMs = Date.now() - startedAt;
    // El auto-stop de acá arriba (setTimeout a los 8000ms) mide el tiempo
    // real hasta que el MediaRecorder termina de escribir el archivo --
    // eso incluye unos pocos ms de latencia del propio setTimeout/encoder,
    // no contenido de video real de más. Si la medición se pasa apenas
    // (overshoot chico y esperable), la recortamos a los 8000 exactos; si
    // se pasa por mucho -- señal de que el auto-stop realmente falló --
    // dejamos pasar el valor real para que la validación de duración de
    // UploadScreen (sin tocar) lo agarre como corresponde.
    const durationMs =
      measuredMs > MAX_DURATION_MS && measuredMs <= MAX_DURATION_MS + AUTO_STOP_OVERSHOOT_TOLERANCE_MS
        ? MAX_DURATION_MS
        : measuredMs;

    goToUpload(uri, durationMs);
  }

  const remainingSeconds = Math.max(0, (MAX_DURATION_MS - elapsedMs) / 1000);
  const progress = Math.min(1, elapsedMs / MAX_DURATION_MS);

  if (!supported) {
    return (
      <View style={[styles.center, { paddingTop: insets.top + spacing.lg }]}>
        <Text style={styles.permissionTitle}>Grabar no está disponible acá</Text>
        <Text style={styles.permissionText}>
          Este navegador no soporta grabar video directo. Usa SUBIR VIDEO para elegir un archivo.
        </Text>
        <PrimaryButton label="VOLVER" onPress={() => goToUpload()} />
      </View>
    );
  }

  if (permissionState === 'denied') {
    return (
      <View style={[styles.center, { paddingTop: insets.top + spacing.lg }]}>
        <Text style={styles.permissionTitle}>Falta permiso</Text>
        <Text style={styles.permissionText}>
          AURA VS necesita acceso a la cámara y al micrófono para grabar tu momento. Revisa los permisos
          de este sitio en los ajustes de tu navegador.
        </Text>
        <PrimaryButton label="VOLVER" onPress={() => goToUpload()} />
      </View>
    );
  }

  if (permissionState !== 'granted') {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>Cargando cámara…</Text>
      </View>
    );
  }

  if (previewState === 'error') {
    return (
      <View style={[styles.center, { paddingTop: insets.top + spacing.lg }]}>
        <Text style={styles.permissionTitle}>No pudimos mostrar la cámara</Text>
        <Text style={styles.permissionText}>
          Hubo un problema mostrando la vista previa. Intenta de nuevo o usa SUBIR VIDEO.
        </Text>
        <PrimaryButton label="VOLVER" onPress={() => goToUpload()} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {React.createElement('video', {
        ref: videoRef,
        autoPlay: true,
        muted: true,
        playsInline: true,
        style: videoElStyle,
      })}

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
          disabled={!recording && previewState !== 'ready'}
          style={styles.recordButtonWrap}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Detener grabación' : 'Grabar video'}
        >
          <View
            style={[
              styles.recordButtonOuter,
              recording && styles.recordButtonOuterActive,
              !recording && previewState !== 'ready' && styles.recordButtonOuterDisabled,
            ]}
          >
            <View style={[styles.recordButtonInner, recording && styles.recordButtonInnerActive]} />
          </View>
        </Pressable>

        <Text style={styles.hint}>
          {recording
            ? 'Toca para detener antes de tiempo'
            : previewState === 'ready'
              ? 'Toca para grabar (máximo 8 segundos)'
              : 'Preparando cámara…'}
        </Text>
      </View>
    </View>
  );
}

// El <video> es un elemento DOM crudo (ver React.createElement('video', ...)
// más abajo) -- su `style` es CSS real, no un ViewStyle de React Native,
// así que vive aparte de StyleSheet.create en vez de forzar el tipo.
const videoElStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
};

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
    gap: spacing.md,
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
