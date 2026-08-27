import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from './Card';
import { colors, spacing, typography } from '../theme/colors';

interface Props {
  label: string;
  value: string;
}

export function StatTile({ label, value }: Props) {
  return (
    <Card style={styles.card}>
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexBasis: '48%',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  value: {
    ...typography.title,
    color: colors.textPrimary,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    letterSpacing: 0.5,
  },
});
