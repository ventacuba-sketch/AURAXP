import React, { PropsWithChildren, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { colors } from '../theme/colors';

interface Props {
  /** 0-1, how much of the ring is lit. */
  progress: number;
  size?: number;
  tickCount?: number;
  /** Gentle breathing pulse — used while a scan is actively in progress. */
  active?: boolean;
}

const TICK_LENGTH = 10;
const TICK_WIDTH = 3;

/**
 * AURAXP's recurring "scanner" identity: a radial dial of ticks that light
 * up as `progress` increases, standing in for a camera/AI scan reading.
 * Used on the Analyzing screen (progress animates 0->1 over the scan) and
 * again on the Aura Replay result (static, fully lit) so the two moments
 * share one visual language. Pure Views + transforms — no SVG dependency.
 */
export function AuraScanner({
  progress,
  size = 160,
  tickCount = 28,
  active = false,
  children,
}: PropsWithChildren<Props>) {
  const radius = size / 2;
  const litCount = Math.round(Math.min(1, Math.max(0, progress)) * tickCount);

  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!active) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.04,
          duration: 620,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 620,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  return (
    <Animated.View
      style={[
        styles.container,
        { width: size, height: size },
        active ? { transform: [{ scale: pulse }] } : null,
      ]}
    >
      {Array.from({ length: tickCount }).map((_, index) => {
        const angle = (360 / tickCount) * index;
        const lit = index < litCount;
        return (
          <View
            key={index}
            style={[
              styles.tick,
              {
                top: radius - TICK_LENGTH / 2,
                left: radius - TICK_WIDTH / 2,
                transform: [{ rotate: `${angle}deg` }, { translateY: -(radius - TICK_LENGTH) }],
              },
              lit ? styles.tickLit : styles.tickDim,
            ]}
          />
        );
      })}
      <View style={styles.center}>{children}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    position: 'absolute',
    width: TICK_WIDTH,
    height: TICK_LENGTH,
    borderRadius: TICK_WIDTH / 2,
  },
  tickLit: {
    backgroundColor: colors.accent,
  },
  tickDim: {
    backgroundColor: colors.border,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
