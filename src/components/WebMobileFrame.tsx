import React, { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { colors, radius } from '../theme/colors';

const MAX_WIDTH = 430; // mobile viewport target (~390-430px)
const MAX_HEIGHT = 932; // resembles a modern phone's logical viewport height

/**
 * Web-only: centers the app inside a mobile-sized container so it doesn't
 * stretch across a wide desktop browser window. Native iOS/Android render
 * `children` directly with no extra wrapping view — this is a structural
 * no-op there, so native layout is completely unaffected.
 */
export function WebMobileFrame({ children }: PropsWithChildren) {
  if (Platform.OS !== 'web') {
    return <>{children}</>;
  }

  // The admin analytics route is a desktop dashboard rather than the
  // consumer mobile experience. Opening /admin directly therefore uses the
  // full browser viewport while the public app keeps the phone frame.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
    return <View style={styles.adminOuter}>{children}</View>;
  }

  return (
    <View style={styles.outer}>
      <View style={styles.phone}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  adminOuter: {
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
