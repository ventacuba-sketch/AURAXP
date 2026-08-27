import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from './Card';
import { colors, radius, spacing, typography } from '../theme/colors';

interface Props {
  label: string;
  /** 0-100 */
  value: number;
  /** `danger` for stats where lower is better (e.g. cringe risk). */
  tone?: 'accent' | 'danger';
}

/** A 0-100 gauge card — label, big number, and a filled meter bar. */
export function StatMeter({ label, value, tone = 'accent' }: Props) {
  const fillColor = tone === 'danger' ? colors.danger : colors.accent;
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.value, { color: fillColor }]}>{Math.round(clamped)}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${clamped}%`, backgroundColor: fillColor }]} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexBasis: '48%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: spacing.sm,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 0.5,
  },
  value: {
    ...typography.title,
  },
  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
  },
});
