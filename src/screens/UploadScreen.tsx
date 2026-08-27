import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
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
  durationMs: number;
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

  async function handlePicked(result: ImagePicker.ImagePickerResult, mode: 'record' | 'upload') {
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const durationMs = asset.duration ?? 0;

    if (durationMs > MAX_DURATION_MS) {
      Alert.alert('Muy largo', 'El clip tiene que durar máximo 8 segundos.');
      return;
    }

    setVideo({ uri: asset.uri, durationMs });
    setSource(mode);
  }

  async function handleRecord() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Falta permiso', 'AURAXP necesita acceso a la cámara para grabar.');
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
      Alert.alert('Falta permiso', 'AURAXP necesita acceso a tus videos para subir uno.');
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
      const scanId = await uploadAndSubmitScan(video.uri, video.durationMs, params?.challengeToken);
      navigation.navigate('Analyzing', { scanId });
    } catch (e) {
      console.warn('uploadAndSubmitScan failed', e);
      Alert.alert('No se pudo subir el video', 'Intentá de nuevo en unos segundos.');
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
  guidelines: {
    gap: spacing.xs,
  },
  guideline: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
