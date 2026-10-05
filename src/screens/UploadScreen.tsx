import React, { useEffect, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useSmartBack } from '../hooks/useSmartBack';
import { logEvent } from '../services/analyticsService';
import { uploadAndSubmitScan, VideoTooLargeError } from '../services/scanService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { colors, radius, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';

type UploadRoute = RouteProp<RootStackParamList, 'Upload'>;
const MAX_DURATION_MS = 8000;
const SLOW_UPLOAD_THRESHOLD_MS = 6000;

interface PickedVideo { uri: string; durationMs: number | null; }

export default function UploadScreen() {
  const navigation = useRootNavigation();
  const goBack = useSmartBack();
  const { params } = useRoute<UploadRoute>();
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [source, setSource] = useState<'record' | 'upload' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [slowUpload, setSlowUpload] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);

  useEffect(() => { void logEvent('scan_upload_viewed' as any); }, []);

  function notify(title: string, message: string) {
    if (Platform.OS === 'web') setNotice(message);
    else Alert.alert(title, message);
  }

  async function handlePicked(result: ImagePicker.ImagePickerResult, mode: 'record' | 'upload') {
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const rawDuration = asset.duration;
    const durationMs = rawDuration != null && rawDuration > 0
      ? Platform.OS === 'web' ? Math.round(rawDuration * 1000) : Math.round(rawDuration)
      : null;
    if (durationMs !== null && durationMs > MAX_DURATION_MS) {
      notify('Muy largo', 'El clip tiene que durar máximo 8 segundos.');
      return;
    }
    setNotice(null); setUploadFailed(false);
    setVideo({ uri: asset.uri, durationMs }); setSource(mode);
    void logEvent('scan_video_selected' as any, { source: mode });
  }

  useEffect(() => {
    if (!params?.recordedUri) return;
    const durationMs = params.recordedDurationMs ?? null;
    if (durationMs !== null && durationMs > MAX_DURATION_MS) notify('Muy largo', 'El clip tiene que durar máximo 8 segundos.');
    else {
      setNotice(null); setUploadFailed(false);
      setVideo({ uri: params.recordedUri, durationMs }); setSource('record');
      void logEvent('scan_video_selected' as any, { source: 'record' });
    }
    navigation.setParams({ recordedUri: undefined, recordedDurationMs: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.recordedUri]);

  function handleRecord() {
    void logEvent('scan_record_clicked' as any);
    navigation.navigate('Record', { challengeToken: params?.challengeToken, rematchTargetUsername: params?.rematchTargetUsername });
  }

  async function handlePickFromLibrary() {
    void logEvent('scan_library_clicked' as any);
    // Web does not need a preflight media-library permission prompt. Asking
    // before opening the browser picker adds friction and can behave
    // inconsistently on mobile Safari. The user explicitly grants access
    // by choosing a file in the native browser picker.
    if (Platform.OS !== 'web') {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        notify('Falta permiso', 'AURA VS necesita acceso a tus videos para subir uno.');
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], videoMaxDuration: 8 });
    await handlePicked(result, 'upload');
  }

  async function handleAnalyze() {
    if (!video) return;
    void logEvent('scan_started', { source });
    if (!isSupabaseConfigured) { navigation.navigate('Analyzing'); return; }
    setSubmitting(true); setSlowUpload(false);
    const slowTimer = setTimeout(() => setSlowUpload(true), SLOW_UPLOAD_THRESHOLD_MS);
    try {
      const scanId = await uploadAndSubmitScan(video.uri, video.durationMs ?? 0, params?.challengeToken);
      void logEvent('scan_submitted' as any, { source });
      navigation.navigate('Analyzing', { scanId, challengeToken: params?.challengeToken, rematchTargetUsername: params?.rematchTargetUsername });
    } catch (e) {
      console.warn('uploadAndSubmitScan failed', e);
      void logEvent('scan_submit_failed' as any, { source, kind: e instanceof VideoTooLargeError ? 'too_large' : 'upload_error' });
      if (e instanceof VideoTooLargeError) notify('Video muy pesado', 'Este video es demasiado pesado para la versión de prueba. Intenta grabarlo en menor resolución.');
      else { setUploadFailed(true); notify('Tu video no pudo subirse', 'Revisa tu conexión e inténtalo de nuevo.'); }
    } finally { clearTimeout(slowTimer); setSlowUpload(false); setSubmitting(false); }
  }

  return (
    <ScreenContainer style={styles.container} onBack={goBack}>
      <View style={styles.header}>
        <Text style={styles.step}>ÚLTIMO PASO</Text>
        <Text style={styles.title}>MIDE TU AURA AHORA ⚡</Text>
        <Text style={styles.subtitle}>Graba o elige un video corto. En segundos verás tu puntuación.</Text>
      </View>

      <View style={styles.middle}>
        <View style={styles.captureArea}>
          <Pressable onPress={handleRecord} style={styles.recordWrap} hitSlop={8}>
            <View style={[styles.recordCircle, source === 'record' && styles.recordCircleActive]}><View style={styles.recordDot} /></View>
            <Text style={[styles.recordLabel, source === 'record' && styles.recordLabelActive]}>GRABAR AHORA</Text>
          </Pressable>
          <Text style={styles.or}>o</Text>
          <Pressable onPress={handlePickFromLibrary} style={[styles.uploadOption, source === 'upload' && styles.uploadOptionActive]}>
            <Text style={[styles.uploadIcon, source === 'upload' && styles.uploadTextActive]}>⬆</Text>
            <Text style={[styles.uploadLabel, source === 'upload' && styles.uploadTextActive]}>ELEGIR UN VIDEO</Text>
          </Pressable>
        </View>

        {notice && <View style={styles.notice}><Text style={styles.noticeText}>{notice}</Text></View>}
        {submitting && slowUpload && <View style={styles.notice}><Text style={styles.noticeText}>Subiendo video… Tu conexión parece lenta. No cierres AURA VS.</Text></View>}
        {video && <View style={styles.videoReady}><Text style={styles.videoReadyText}>✓ Listo{video.durationMs !== null ? ` · ${(video.durationMs / 1000).toFixed(1)}s` : ''}</Text></View>}
        {!video && <Text style={styles.tip}>Video recomendado: 5–8 segundos · muestra una acción o momento completo.</Text>}
      </View>

      <PrimaryButton label={submitting ? 'ANALIZANDO...' : uploadFailed ? 'REINTENTAR' : video ? '⚡ MEDIR MI AURA' : 'ELIGE O GRABA UN VIDEO'} disabled={!video || submitting} onPress={handleAnalyze} />
      <Text style={styles.free}>Tu primer Scan es gratis.</Text>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: spacing.lg },
  header: { marginTop: spacing.md, alignItems: 'center' },
  step: { ...typography.eyebrow, color: colors.accent, marginBottom: spacing.xs },
  title: { ...typography.hero, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center', maxWidth: 340 },
  middle: { flex: 1, justifyContent: 'center' },
  captureArea: { alignItems: 'center', marginBottom: spacing.md },
  recordWrap: { alignItems: 'center', marginBottom: spacing.sm },
  recordCircle: { width: 150, height: 150, borderRadius: radius.pill, borderWidth: 3, borderColor: colors.accent, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  recordCircleActive: { borderColor: colors.success, backgroundColor: colors.surfaceAlt },
  recordDot: { width: 58, height: 58, borderRadius: radius.pill, backgroundColor: colors.danger },
  recordLabel: { ...typography.subtitle, color: colors.textPrimary, letterSpacing: 1, marginTop: spacing.sm },
  recordLabelActive: { color: colors.accent },
  or: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
  uploadOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  uploadOptionActive: { borderColor: colors.accent },
  uploadIcon: { fontSize: 16, color: colors.textSecondary },
  uploadLabel: { ...typography.body, color: colors.textSecondary, letterSpacing: 0.5 },
  uploadTextActive: { color: colors.accent },
  notice: { marginTop: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surfaceAlt },
  noticeText: { ...typography.caption, color: colors.danger, textAlign: 'center' },
  videoReady: { alignSelf: 'center', marginTop: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.success },
  videoReadyText: { ...typography.caption, color: colors.success, fontWeight: '700' },
  tip: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
  free: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
});
