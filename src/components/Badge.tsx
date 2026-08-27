import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme/colors';

interface Props {
  label: string;
  tone?: 'accent' | 'secondary' | 'neutral';
}

/** Small uppercase pill — founder badge, chain size, status tags. */
export function Badge({ label, tone = 'neutral' }: Props) {
  return (
    <View style={[styles.base, styles[tone]]}>
      <Text style={[styles.label, styles[`${tone}Label` as const]]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  label: {
    ...typography.caption,
    letterSpacing: 0.5,
  },
  neutral: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  neutralLabel: {
    color: colors.textSecondary,
  },
  accent: {
    borderColor: colors.accent,
    backgroundColor: 'transparent',
  },
  accentLabel: {
    color: colors.accent,
  },
  secondary: {
    borderColor: colors.secondary,
    backgroundColor: 'transparent',
  },
  secondaryLabel: {
    color: colors.secondary,
  },
});
