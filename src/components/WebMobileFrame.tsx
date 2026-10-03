import React, { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { colors, radius } from '../theme/colors';

const MAX_WIDTH = 430; // mobile viewport target (~390-430px)
const MAX_HEIGHT = 932; // resembles a modern phone's logical viewport height

/**
 * Web-only: most consumer screens stay centered inside a phone-sized frame.
 * Admin and Chat are exceptions: both have responsive desktop layouts and
 * must receive the real browser width. Previously /chat stayed capped at
 * 430px while ChatScreen read the desktop window width and rendered its
 * 2-column layout inside that tiny frame, which squeezed/broke desktop chat.
 */
export function WebMobileFrame({ children }: PropsWithChildren) {
  if (Platform.OS !== 'web') {
    return <>{children}</>;
  }

  if (typeof window !== 'undefined') {
    const path = window.location.pathname;
    if (path.startsWith('/admin') || path.startsWith('/chat')) {
      return <View style={styles.fullWidthOuter}>{children}</View>;
    }
  }

  return (
    <View style={styles.outer}>
      <View style={styles.phone}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fullWidthOuter: {
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