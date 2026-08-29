import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';

import { AuraScanner } from '../components/AuraScanner';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { SCAN_DURATION_MS, submitScan } from '../services/api';
import { checkScanStatus, ScanStatusCheck, subscribeToScan } from '../services/scanService';
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
const POLL_INTERVAL_MS = 2500;

// Distingue un blip transitorio (Wi-Fi flaqueando un instante) de una falla
// real y sostenida (sesión inválida, red caída, etc.): recién después de
// varios fallos *reales* consecutivos (no "todavía pendiente" -- eso no
// cuenta como fallo) se corta el polling y se muestra un error accionable,
// en vez de quedar reintentando en silencio para siempre.
const MAX_CONSECUTIVE_ERRORS = 5;

type AnalyzingRoute = RouteProp<RootStackParamList, 'Analyzing'>;

export default function AnalyzingScreen() {
  const navigation = useRootNavigation();
  const { params } = useRoute<AnalyzingRoute>();
  const scanId = params?.scanId;
  const useRealBackend = Boolean(scanId && isSupabaseConfigured);

  const [labelIndex, setLabelIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Guard contra navegación duplicada: polling y Realtime pueden detectar
  // `done` casi al mismo tiempo -- solo la primera fuente que llega navega.
  const hasNavigatedRef = useRef(false);

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

  // Detección robusta de `done`, con tres capas independientes:
  // 1. fetch inmediato al montar (no esperar el primer tick del interval);
  // 2. polling de respaldo cada POLL_INTERVAL_MS -- la fuente de verdad
  //    real, funciona siempre, con o sin Realtime habilitado;
  // 3. Realtime como aceleración opcional -- si `scans` no está en la
  //    publicación supabase_realtime, el canal simplemente no dispara
  //    nunca y el polling sigue cubriendo todo el flujo solo.
  // Cualquiera de las tres que detecte `done` navega; un guard evita que
  // dos fuentes disparen la navegación dos veces.
  useEffect(() => {
    if (!useRealBackend || !scanId) return;
    let cancelled = false;
    let consecutiveErrors = 0;
    let pollTimer: ReturnType<typeof setInterval> | undefined;

    const finishSuccess = () => {
      if (hasNavigatedRef.current || cancelled) return;
      hasNavigatedRef.current = true;
      if (pollTimer) clearInterval(pollTimer);
      unsubscribeRealtime();
      setProgress(1);
      setTimeout(() => {
        if (!cancelled) navigation.replace('ScanResult', { scanId });
      }, 300);
    };

    const finishFailure = (reason: 'failed' | 'rejected', errorCode?: string | null) => {
      if (hasNavigatedRef.current || cancelled) return;
      hasNavigatedRef.current = true;
      if (pollTimer) clearInterval(pollTimer);
      unsubscribeRealtime();
      setErrorMessage(
        reason === 'rejected'
          ? 'Este video no se pudo procesar (moderación o límite diario).'
          : errorCode === 'gemini_unavailable'
            ? 'La IA está temporalmente ocupada. Intenta de nuevo en unos minutos.'
            : 'El análisis falló. Intenta de nuevo.',
      );
    };

    const handleResult = (result: ScanStatusCheck) => {
      if (cancelled || hasNavigatedRef.current) return;

      switch (result.kind) {
        case 'pending':
          consecutiveErrors = 0;
          return;
        case 'done':
          finishSuccess();
          return;
        case 'failed':
        case 'rejected':
          finishFailure(result.kind, result.scan.error_message);
          return;
        case 'error':
          consecutiveErrors += 1;
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            if (pollTimer) clearInterval(pollTimer);
            unsubscribeRealtime();
            setErrorMessage('No pudimos confirmar el resultado. Revisa tu conexión e intenta de nuevo.');
          }
          return;
      }
    };

    // Capa 3: Realtime, solo acelera -- una fila que llega por acá se trata
    // igual que una detectada por polling, sin pasar por el contador de
    // errores (es una señal push, no una verificación que pueda fallar).
    const unsubscribeRealtime = subscribeToScan(scanId, (scan) => {
      if (scan.status === 'done') finishSuccess();
      else if (scan.status === 'failed') finishFailure('failed', scan.error_message);
      else if (scan.status === 'rejected') finishFailure('rejected', scan.error_message);
    });

    const poll = () => {
      checkScanStatus(scanId).then(handleResult);
    };

    poll(); // Capa 1: fetch inmediato al montar, no esperar el primer tick.
    pollTimer = setInterval(poll, POLL_INTERVAL_MS); // Capa 2: respaldo.

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      unsubscribeRealtime();
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
