import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, spacing, typography } from '../theme/colors';

interface Props {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'ghost' | 'text';
  disabled?: boolean;
}

/**
 * The one button component for every CTA in the app.
 * - `primary`: filled accent — the main action on a screen.
 * - `ghost`: outlined — secondary action (e.g. "SHARE RESULT").
 * - `text`: no fill/border — tertiary/low-emphasis action (e.g. "SCAN AGAIN").
 */
export function PrimaryButton({ label, onPress, variant = 'primary', disabled = false }: Props) {
  // Primary gets an unmistakable inactive look (flat grey, muted text) rather
  // than just a dimmed accent — so "can I tap this yet" is never ambiguous.
  const primaryDisabled = variant === 'primary' && disabled;

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        primaryDisabled && styles.primaryDisabled,
        variant === 'ghost' && styles.ghost,
        variant === 'text' && styles.text,
        disabled && !primaryDisabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.label,
          variant === 'primary' && styles.labelPrimary,
          primaryDisabled && styles.labelPrimaryDisabled,
          variant === 'ghost' && styles.labelGhost,
          variant === 'text' && styles.labelText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: colors.accent,
  },
  primaryDisabled: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: {
    backgroundColor: 'transparent',
    paddingVertical: spacing.sm,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.8,
  },
  label: {
    ...typography.subtitle,
  },
  labelPrimary: {
    color: colors.onAccent,
  },
  labelPrimaryDisabled: {
    color: colors.textMuted,
  },
  labelGhost: {
    color: colors.textPrimary,
  },
  labelText: {
    color: colors.accent,
  },
});
