import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme/colors';
import { TimelineEvent } from '../types';
import { formatSignedXP } from '../utils/format';

export function TimelineRow({ time, delta, label }: TimelineEvent) {
  const isPositive = delta >= 0;

  return (
    <View style={styles.row}>
      <Text style={styles.time}>{time}</Text>
      <Text style={[styles.delta, { color: isPositive ? colors.accent : colors.danger }]}>
        {formatSignedXP(delta)}
      </Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  time: {
    ...typography.caption,
    color: colors.textMuted,
    width: 40,
  },
  delta: {
    ...typography.subtitle,
    width: 88,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    flex: 1,
    letterSpacing: 0.5,
  },
});
