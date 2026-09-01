import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme/colors';
import { formatLevel, formatXP, xpProgress } from '../utils/format';

interface Props {
  xp: number;
  xpToNextLevel: number;
  level: number;
}

export function XPBar({ xp, xpToNextLevel, level }: Props) {
  const progress = xpProgress(xp, xpToNextLevel);

  return (
    <View>
      <View style={styles.labelRow}>
        <Text style={styles.level}>{formatLevel(level)}</Text>
        <Text style={styles.xpText}>
          {formatXP(xp)} / {formatXP(xpToNextLevel)}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  level: {
    ...typography.eyebrow,
    color: colors.secondary,
  },
  xpText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  track: {
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
});
