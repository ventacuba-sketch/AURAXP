import React, { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useSmartBack } from '../hooks/useSmartBack';
import { uploadAndSubmitScan, VideoTooLargeError } from '../services/scanService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { colors, radius, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';

type UploadRoute = RouteProp<RootStackParamList, 'Upload'>;

const MAX_DURATION_MS = 8000;
// Punto 15 (auditoría post-iPhone, 4G real): sin progreso % real
// disponible (uploadToSignedUrl de supabase-js no expone eventos de
// progreso -- cambiar eso es una reescritura de la subida, fuera de
// alcance acá), pasado este umbral se aclara que es la conexión, no que
// la app se colgó.
const SLOW_UPLOAD_THRESHOLD_MS = 6000;

interface PickedVideo {
  uri: string;
  /** null cuando la duración no se pudo determinar de forma confiable. */
  durationMs: number | null;
}

const GUIDELINES = [
  'Máximo 8 segundos',
  'Procura que se vea la acción completa.',
  'AURA VS analiza el momento, no tu apariencia.',
];

export default function UploadScreen() {
  const navigation = useRootNavigation();
  const goBack = useSmartBack();
  const { params } = useRoute<UploadRoute>();
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [source, setSource] = useState<'record' | 'upload' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // react-native-web's Alert.alert() is a documented no-op — it does
  // nothing at all in a browser. notify() keeps the real native Alert
  // on iOS/Android, and falls back to this inline banner on web so
  // permission/duration/upload feedback is never silently dropped.
  const [notice, setNotice] = useState<string | null>(null);
  // Punto 15 (auditoría post-iPhone, 4G real): sin progreso % real
  // disponible (uploadToSignedUrl de supabase-js no expone eventos de
  // progreso -- cambiar eso es una reescritura de la subida, fuera de
  // alcance acá), esto es la mejora mínima y segura: si "SUBIENDO..."
  // lleva más de este umbral, se aclara que es la conexión, no que la
  // app se colgó. `uploadFailed` distingue el reintento (mismo video en
  // memoria, ver más abajo) del primer intento.
  const [slowUpload, setSlowUpload] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);

  function notify(title: string, message: string) {
    if (Platform.OS === 'web') {
      setNotice(message);
    } else {
      Alert.alert(title, message);
    }
  }

  async function handlePicked(result: ImagePicker.ImagePickerResult, mode: 'record' | 'upload') {
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    // expo-image-picker documenta `duration` en milisegundos, pero su
    // implementación web lo saca directo de HTMLVideoElement.duration, que
    // está en SEGUNDOS (ver ExponentImagePicker.web.ts). Sin esta
    // normalización, un clip de 5s reportaba "durationMs: 5" -> se mostraba
    // como "(0.0s)" y nunca activaba la validación de máximo 8 segundos.
    const rawDuration = asset.duration;
    const durationMs =
      rawDuration != null && rawDuration > 0
        ? Platform.OS === 'web'
          ? Math.round(rawDuration * 1000)
          : Math.round(rawDuration)
        : null;

    if (durationMs !== null && durationMs > MAX_DURATION_MS) {
      notify('Muy largo', 'El clip tiene que durar máximo 8 segundos.');
      return;
    }

    setNotice(null);
    setUploadFailed(false);
    setVideo({ uri: asset.uri, durationMs });
    setSource(mode);
  }

  // Video de vuelta de RecordScreen (nuestra propia cámara, no la del
  // sistema) -- misma validación de duración que handlePicked, como
  // tercera capa de seguridad detrás del auto-stop nativo y el respaldo
  // por setTimeout que ya corren dentro de RecordScreen.
  useEffect(() => {
    if (!params?.recordedUri) return;

    const durationMs = params.recordedDurationMs ?? null;
    if (durationMs !== null && durationMs > MAX_DURATION_MS) {
      notify('Muy largo', 'El clip tiene que durar máximo 8 segundos.');
    } else {
      setNotice(null);
      setUploadFailed(false);
      setVideo({ uri: params.recordedUri, durationMs });
      setSource('record');
    }

    // Se consume una sola vez -- evita que el mismo param dispare este
    // efecto de nuevo si la pantalla se vuelve a renderizar por otro motivo.
    navigation.setParams({ recordedUri: undefined, recordedDurationMs: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.recordedUri]);

  function handleRecord() {
    // RecordScreen decide internamente qué mostrar: cámara nativa
    // (expo-camera) en iOS/Android, o WebCameraCapture (getUserMedia +
    // MediaRecorder) en web -- y ahí, si el navegador no soporta grabar,
    // WebCameraCapture es quien muestra el aviso de "usa SUBIR VIDEO", no
    // esta pantalla. Ya no bloqueamos web acá.
    navigation.navigate('Record', {
      challengeToken: params?.challengeToken,
      rematchTargetUsername: params?.rematchTargetUsername,
    });
  }

  async function handlePickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      notify('Falta permiso', 'AURA VS necesita acceso a tus videos para subir uno.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
    handlePicked(result, 'upload');
  }

  async function handleAnalyze() {
    if (!video) return;

    if (!isSupabaseConfigured) {
      // Sin backend configurado todavía — Analyzing cae a su fallback mock.
      navigation.navigate('Analyzing');
      return;
    }

    setSubmitting(true);
    setSlowUpload(false);
    // Sin progreso % real disponible, esto es lo mínimo honesto: si
    // "SUBIENDO..." lleva más de SLOW_UPLOAD_THRESHOLD_MS, avisa que
    // probablemente es la conexión -- nunca marca nada como terminado
    // antes de tiempo, solo cambia el texto mientras se sigue esperando.
    const slowTimer = setTimeout(() => setSlowUpload(true), SLOW_UPLOAD_THRESHOLD_MS);
    try {
      // scans.duration_ms es NOT NULL en el schema (fuera de alcance acá) —
      // cuando no pudimos determinar la duración mandamos 0 como antes.
      const durationMs = video.durationMs ?? 0;
      const scanId = await uploadAndSubmitScan(video.uri, durationMs, params?.challengeToken);
      navigation.navigate('Analyzing', {
        scanId,
        challengeToken: params?.challengeToken,
        rematchTargetUsername: params?.rematchTargetUsername,
      });
    } catch (e) {
      console.warn('uploadAndSubmitScan failed', e);
      if (e instanceof VideoTooLargeError) {
        // Mensaje de la versión de prueba (limitación temporal del plan
        // Supabase actual) — no un límite permanente de AURAXP. Ver
        // src/utils/uploadLimits.ts.
        notify(
          'Video muy pesado',
          'Este video es demasiado pesado para la versión de prueba. Intenta grabarlo en menor resolución.',
        );
      } else {
        // `video` NO se limpia acá a propósito (punto 15, auditoría
        // post-iPhone): el archivo ya elegido/grabado se queda en memoria
        // tal cual estaba, así que REINTENTAR vuelve a intentar subir ESE
        // mismo video, sin forzar grabar/elegir de nuevo.
        setUploadFailed(true);
        notify('Tu video no pudo subirse', 'Revisa tu conexión e inténtalo de nuevo.');
      }
    } finally {
      clearTimeout(slowTimer);
      setSlowUpload(false);
      setSubmitting(false);
    }
  }

  return (
    <ScreenContainer style={styles.container} onBack={goBack}>
      <View style={styles.header}>
        <Text style={styles.title}>MUÉSTRANOS EL MOMENTO</Text>
        <Text style={styles.subtitle}>Entre 5 y 8 segundos funciona mejor.</Text>
      </View>

      {/* Fills the space between the header and the pinned CTA, centering
          the capture action in it instead of leaving a dead gap below. */}
      <View style={styles.middle}>
        <View style={styles.captureArea}>
          <Pressable onPress={handleRecord} style={styles.recordWrap} hitSlop={8}>
            <View style={[styles.recordCircle, source === 'record' && styles.recordCircleActive]}>
              <View style={styles.recordDot} />
            </View>
            <Text style={[styles.recordLabel, source === 'record' && styles.recordLabelActive]}>
              GRABAR VIDEO
            </Text>
          </Pressable>

          <Pressable
            onPress={handlePickFromLibrary}
            style={[styles.uploadOption, source === 'upload' && styles.uploadOptionActive]}
          >
            <Text style={[styles.uploadIcon, source === 'upload' && styles.uploadTextActive]}>⬆</Text>
            <Text style={[styles.uploadLabel, source === 'upload' && styles.uploadTextActive]}>
              SUBIR VIDEO
            </Text>
          </Pressable>
        </View>

        {notice && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        )}

        {/* Punto 15 (auditoría post-iPhone, 4G real): sin esto, "SUBIENDO..."
            se quedaba colgado sin ninguna pista de qué estaba pasando en
            una conexión lenta -- parecía que la app se había trabado. */}
        {submitting && slowUpload && (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>Subiendo video… Tu conexión parece lenta. No cierres AURA VS.</Text>
          </View>
        )}

        {video && (
          <View style={styles.videoReady}>
            <Text style={styles.videoReadyText}>
              ✓ Video cargado
              {video.durationMs !== null ? ` (${(video.durationMs / 1000).toFixed(1)}s)` : ''}
            </Text>
          </View>
        )}

        <View style={styles.guidelines}>
          {GUIDELINES.map((line) => (
            <Text key={line} style={styles.guideline}>
              •  {line}
            </Text>
          ))}
        </View>
      </View>

      <PrimaryButton
        label={submitting ? 'SUBIENDO...' : uploadFailed ? 'REINTENTAR' : 'ANALIZAR MI AURA'}
        disabled={!video || submitting}
        onPress={handleAnalyze}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingBottom: spacing.lg,
  },
  header: {
    marginTop: spacing.lg,
  },
  middle: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    ...typography.hero,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  captureArea: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  recordWrap: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  recordCircle: {
    width: 176,
    height: 176,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordCircleActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  recordDot: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
  },
  recordLabel: {
    ...typography.subtitle,
    color: colors.textPrimary,
    letterSpacing: 1,
    marginTop: spacing.md,
  },
  recordLabelActive: {
    color: colors.accent,
  },
  uploadOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  uploadOptionActive: {
    borderColor: colors.accent,
  },
  uploadIcon: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  uploadLabel: {
    ...typography.body,
    color: colors.textSecondary,
    letterSpacing: 0.5,
  },
  uploadTextActive: {
    color: colors.accent,
  },
  notice: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.surfaceAlt,
    maxWidth: '100%',
  },
  noticeText: {
    ...typography.caption,
    color: colors.danger,
    textAlign: 'center',
  },
  videoReady: {
    alignSelf: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.success,
  },
  videoReadyText: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '700',
  },
  guidelines: {
    gap: spacing.xs,
  },
  guideline: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
