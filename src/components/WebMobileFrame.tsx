import React, { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';

import { colors, radius } from '../theme/colors';

const MAX_WIDTH = 430;
const MAX_HEIGHT = 932;
const DESKTOP_BREAKPOINT = 800;

/**
 * Web shell: consumer routes remain phone-sized on mobile. Admin and Chat
 * only expand to the full viewport on real tablet/desktop widths; this avoids
 * the Chat desktop header squeezing its identity into a vertical column on
 * iPhone Safari.
 */
export function WebMobileFrame({ children }: PropsWithChildren) {
  const { width } = useWindowDimensions();
  if (Platform.OS !== 'web') return <>{children}</>;

  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  const desktopRoute = pathname.startsWith('/admin') || pathname.startsWith('/chat');
  const usesDesktopViewport = desktopRoute && width >= DESKTOP_BREAKPOINT;

  if (usesDesktopViewport) return <View style={styles.desktopOuter}>{children}</View>;

  return (
    <View style={styles.outer}>
      <View style={styles.phone}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  desktopOuter: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: colors.background,
  },
  outer: {
    flex: 1,
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.webOuterBackground,
  },
  phone: {
    flex: 1,
    width: '100%',
    maxWidth: MAX_WIDTH,
    maxHeight: MAX_HEIGHT,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
});
