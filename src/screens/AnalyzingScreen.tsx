import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';

import { AuraScanner } from '../components/AuraScanner';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { SCAN_DURATION_MS, submitScan } from '../services/api';
import { getScan } from '../services/scanService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { colors, radius, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';

// Matches the stat names on the Result screen (TIMING stays — it already
// reads naturally in Spanish; the rest use the same short label ScanResult uses).
const LABELS = ['TIMING', 'CONFIANZA', 'ESTILO', 'RIESGO CRINGE'];
const LABEL_INTERVAL_MS = 380;
const PROGRESS_STEP_MS = 40;

// El backend real no reporta progreso — animamos hacia un techo visual
// mientras hacemos polling, y recién saltamos a 100% cuando el status
// real llega a 'done'. Evita una barra que miente sobre el tiempo real.
const REAL_PROGRESS_CAP = 0.9;
const REAL_PROGRESS_ESTIMATE_MS = 6000;
const POLL_INTERVAL_MS = 1500;

type AnalyzingRoute = RouteProp<RootStackParamList, 'Analyzing'>;

export default function AnalyzingScreen() {
  const navigation = useRootNavigation();
  const { params } = useRoute<AnalyzingRoute>();
  const scanId = params?.scanId;
  const useRealBackend = Boolean(scanId && isSupabaseConfigured);

  const [labelIndex, setLabelIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Anima el AuraScanner — mock: 0->1 real en SCAN_DURATION_MS.
  // Real: 0->90% estimado, se completa cuando el polling confirma 'done'.
  useEffect(() => {
    const start = Date.now();
    const cap = useRealBackend ? REAL_PROGRESS_CAP : 1;
    const duration = useRealBackend ? REAL_PROGRESS_ESTIMATE_MS : SCAN_DURATION_MS;
    const interval = setInterval(() => {
      setProgress((p) => (p >= cap ? p : Math.min(cap, (Date.now() - start) / duration)));
    }, PROGRESS_STEP_MS);
    return () => clearInterval(interval);
  }, [useRealBackend]);

  // Cycle through the label chips while the scan is being processed.
  useEffect(() => {
    const interval = setInterval(() => {
      setLabelIndex((i) => (i + 1) % LABELS.length);
    }, LABEL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Mock fallback — sin scanId real ni backend configurado.
  useEffect(() => {
    if (useRealBackend) return;
    let cancelled = false;
    submitScan(null).then(() => {
      if (!cancelled) navigation.replace('ScanResult', undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [useRealBackend, navigation]);

  // Polling real cada 1.5s (acordado: simple, sin Realtime todavía).
  useEffect(() => {
    if (!useRealBackend || !scanId) return;
    let cancelled = false;

    const interval = setInterval(async () => {
      const scan = await getScan(scanId);
      if (cancelled || !scan) return;

      if (scan.status === 'done') {
        clearInterval(interval);
        setProgress(1);
        setTimeout(() => {
          if (!cancelled) navigation.replace('ScanResult', { scanId });
        }, 300);
      } else if (scan.status === 'failed' || scan.status === 'rejected') {
        clearInterval(interval);
        setErrorMessage(
          scan.status === 'rejected'
            ? 'Este video no se pudo procesar (moderación o límite diario).'
            : 'El análisis falló. Intenta de nuevo.',
        );
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [useRealBackend, scanId, navigation]);

  if (errorMessage) {
    return (
      <ScreenContainer style={styles.center}>
        <Text style={styles.errorText}>{errorMessage}</Text>
        <PrimaryButton label="VOLVER" onPress={() => navigation.navigate('Upload')} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.center}>
      <AuraScanner progress={progress} active size={176}>
        <Text style={styles.percent}>{Math.round(progress * 100)}%</Text>
      </AuraScanner>
      <Text style={styles.title}>LEYENDO TU AURA...</Text>
      <View style={styles.labelRow}>
        {LABELS.map((label, index) => (
          <View
            key={label}
            style={[styles.labelChip, index === labelIndex && styles.labelChipActive]}
          >
            <Text style={[styles.labelText, index === labelIndex && styles.labelTextActive]}>
              {label}
            </Text>
          </View>
        ))}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  percent: {
    ...typography.title,
    color: colors.textPrimary,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
    letterSpacing: 1,
  },
  labelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  labelChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  labelChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  labelText: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  labelTextActive: {
    color: colors.accent,
  },
  errorText: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
});
