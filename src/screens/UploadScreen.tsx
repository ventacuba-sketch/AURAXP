import React, { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { uploadAndSubmitScan } from '../services/scanService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { colors, radius, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';

type UploadRoute = RouteProp<RootStackParamList, 'Upload'>;

const MAX_DURATION_MS = 8000;

interface PickedVideo {
  uri: string;
  /** null cuando la duración no se pudo determinar de forma confiable. */
  durationMs: number | null;
}

const GUIDELINES = [
  'Máximo 8 segundos',
  'Procura que se vea la acción completa.',
  'AURAXP analiza el momento, no tu apariencia.',
];

export default function UploadScreen() {
  const navigation = useRootNavigation();
  const { params } = useRoute<UploadRoute>();
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [source, setSource] = useState<'record' | 'upload' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // react-native-web's Alert.alert() is a documented no-op — it does
  // nothing at all in a browser. notify() keeps the real native Alert
  // on iOS/Android, and falls back to this inline banner on web so
  // permission/duration/upload feedback is never silently dropped.
  const [notice, setNotice] = useState<string | null>(null);

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
    setVideo({ uri: asset.uri, durationMs });
    setSource(mode);
  }

  async function handleRecord() {
    if (Platform.OS === 'web') {
      // expo-image-picker no implementa una captura de cámara real en
      // web (launchCameraAsync ahí termina abriendo el mismo selector
      // de archivos que SUBIR VIDEO) — en vez de dejar que las dos
      // acciones se confundan, avisamos claramente en vez de intentarlo.
      notify(
        'Grabar no está disponible acá',
        'Grabar video no funciona de forma confiable en la vista web. Usa SUBIR VIDEO para elegir un archivo, o abre AURAXP en tu celular para grabar directo.',
      );
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      notify('Falta permiso', 'AURAXP necesita acceso a la cámara para grabar.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: MAX_DURATION_MS / 1000,
    });
    handlePicked(result, 'record');
  }

  async function handlePickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      notify('Falta permiso', 'AURAXP necesita acceso a tus videos para subir uno.');
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
    try {
      // scans.duration_ms es NOT NULL en el schema (fuera de alcance acá) —
      // cuando no pudimos determinar la duración mandamos 0 como antes.
      const durationMs = video.durationMs ?? 0;
      const scanId = await uploadAndSubmitScan(video.uri, durationMs, params?.challengeToken);
      navigation.navigate('Analyzing', { scanId });
    } catch (e) {
      console.warn('uploadAndSubmitScan failed', e);
      notify('No se pudo subir el video', 'Intenta de nuevo en unos segundos.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ScreenContainer style={styles.container}>
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
        label={submitting ? 'SUBIENDO...' : 'ANALIZAR MI AURA'}
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
