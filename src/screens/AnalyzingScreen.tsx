import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuraScanner } from '../components/AuraScanner';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { SCAN_DURATION_MS, submitScan } from '../services/api';
import { colors, radius, spacing, typography } from '../theme/colors';

// Matches the stat names on the Result screen (TIMING stays — it already
// reads naturally in Spanish; the rest use the same short label ScanResult uses).
const LABELS = ['TIMING', 'CONFIANZA', 'ESTILO', 'RIESGO CRINGE'];
const LABEL_INTERVAL_MS = 380;
const PROGRESS_STEP_MS = 40;

export default function AnalyzingScreen() {
  const navigation = useRootNavigation();
  const [labelIndex, setLabelIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  // Drives the AuraScanner ring — the same scanner identity reused on the
  // result screen — filling in step with the (mock) scan duration.
  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setProgress(Math.min(1, (Date.now() - start) / SCAN_DURATION_MS));
    }, PROGRESS_STEP_MS);
    return () => clearInterval(interval);
  }, []);

  // Cycle through the label chips while the (mock) scan is "processed".
  useEffect(() => {
    const interval = setInterval(() => {
      setLabelIndex((i) => (i + 1) % LABELS.length);
    }, LABEL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Simulate the scoring call, then hand off to the result screen.
  useEffect(() => {
    let cancelled = false;
    submitScan(null).then(() => {
      if (!cancelled) {
        navigation.replace('ScanResult', undefined);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [navigation]);

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
});
