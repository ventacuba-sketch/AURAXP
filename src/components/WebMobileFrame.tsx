import React, { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { colors, radius } from '../theme/colors';

const MAX_WIDTH = 430; // mobile viewport target (~390-430px)
const MAX_HEIGHT = 932; // resembles a modern phone's logical viewport height

/**
 * Web-only: centers the consumer app inside a mobile-sized container.
 * Desktop-first surfaces such as Admin and Chat V2 use the full browser
 * viewport so their responsive layouts can actually reach desktop widths.
 * Native iOS/Android render children directly with no wrapper.
 */
export function WebMobileFrame({ children }: PropsWithChildren) {
  if (Platform.OS !== 'web') {
    return <>{children}</>;
  }

  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
  const usesDesktopViewport = pathname.startsWith('/admin') || pathname.startsWith('/chat');

  if (usesDesktopViewport) {
    return <View style={styles.desktopOuter}>{children}</View>;
  }

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
