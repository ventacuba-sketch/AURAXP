import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors, radius, spacing, typography } from '../theme/colors';

interface Props {
  label: string;
  tone?: 'accent' | 'secondary' | 'neutral';
  style?: ViewStyle;
}

/** Small uppercase pill — chain size, verdict tags, status labels. */
export function Badge({ label, tone = 'neutral', style }: Props) {
  return (
    <View style={[styles.base, styles[tone], style]}>
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
