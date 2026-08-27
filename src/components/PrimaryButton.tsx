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
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        variant === 'primary' && styles.primary,
        variant === 'ghost' && styles.ghost,
        variant === 'text' && styles.text,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.label,
          variant === 'primary' && styles.labelPrimary,
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
  labelGhost: {
    color: colors.textPrimary,
  },
  labelText: {
    color: colors.accent,
  },
});
