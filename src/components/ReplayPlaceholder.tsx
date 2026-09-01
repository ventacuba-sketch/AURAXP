import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';

import { colors, radius, spacing, typography } from '../theme/colors';

interface Props {
  size?: 'sm' | 'lg';
  style?: ViewStyle;
}

/**
 * A styled stand-in for a video/replay thumbnail — no camera, no media
 * pipeline yet, just a dark bordered surface with a play glyph so layouts
 * read correctly ahead of the real capture flow.
 */
export function ReplayPlaceholder({ size = 'lg', style }: Props) {
  const isLarge = size === 'lg';

  return (
    <View style={[styles.base, isLarge ? styles.large : styles.small, style]}>
      <View style={[styles.playButton, isLarge ? styles.playButtonLarge : styles.playButtonSmall]}>
        <Text style={isLarge ? styles.playGlyphLarge : styles.playGlyphSmall}>▶</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  large: {
    aspectRatio: 9 / 12,
    borderRadius: radius.lg,
  },
  small: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
  },
  playButton: {
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonLarge: {
    width: 56,
    height: 56,
  },
  playButtonSmall: {
    width: 28,
    height: 28,
  },
  playGlyphLarge: {
    ...typography.title,
    color: colors.textSecondary,
    marginLeft: spacing.xs / 2,
  },
  playGlyphSmall: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
