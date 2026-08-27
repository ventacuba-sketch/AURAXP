import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { submitScan } from '../services/api';
import { colors, radius, spacing, typography } from '../theme/colors';

// Matches the stat names on the Result screen (TIMING stays — it already
// reads naturally in Spanish; the rest use the same short label ScanResult uses).
const LABELS = ['TIMING', 'CONFIANZA', 'ESTILO', 'RIESGO CRINGE'];
const LABEL_INTERVAL_MS = 380;

export default function AnalyzingScreen() {
  const navigation = useRootNavigation();
  const [labelIndex, setLabelIndex] = useState(0);
  const pulse = useRef(new Animated.Value(0.6)).current;

  // Pulsing ring — plain Animated, native driver, no external animation lib.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0.6,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

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
      <Animated.View style={[styles.ring, { opacity: pulse, transform: [{ scale: pulse }] }]} />
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
  ring: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: colors.accent,
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
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
