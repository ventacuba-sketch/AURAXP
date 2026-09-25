import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';

const EMOJIS = ['🎉', '✨', '🎊', '⭐'];
const PIECE_COUNT = 24;

interface Piece {
  emoji: string;
  left: number; // % del ancho
  delay: number;
  duration: number;
  rotateDeg: number;
  size: number;
}

function buildPieces(): Piece[] {
  return Array.from({ length: PIECE_COUNT }).map(() => ({
    emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
    left: Math.random() * 92,
    delay: Math.random() * 250,
    duration: 1400 + Math.random() * 900,
    rotateDeg: Math.random() > 0.5 ? 360 : -360,
    size: 16 + Math.random() * 14,
  }));
}

/**
 * Boost de Confeti (bloque tienda/consumibles, punto 3/4 de la auditoría
 * post-iPhone) -- efecto de una sola vez, sin librería nueva (Animated
 * puro, mismo enfoque que AuraScanner). Se monta en ScanResultScreen
 * SOLO cuando `scan.consumable_effect_key === 'confetti_boost'` (lo
 * decide el server en process-scan, nunca el cliente) y se desmonta solo
 * después de terminar -- no vuelve a dispararse si la pantalla se
 * re-renderiza por otro motivo (progress/replay), porque no depende de
 * ningún estado que cambie con eso.
 */
export function ConfettiBurst({ onDone }: { onDone?: () => void }) {
  const piecesRef = useRef<Piece[]>(buildPieces());
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 2200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) onDone?.();
    });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.container]}>
      {piecesRef.current.map((piece, index) => {
        const fall = progress.interpolate({
          inputRange: [0, 1],
          outputRange: [-20, 420],
        });
        const opacity = progress.interpolate({
          inputRange: [0, 0.1, 0.8, 1],
          outputRange: [0, 1, 1, 0],
        });
        const rotate = progress.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', `${piece.rotateDeg}deg`],
        });
        return (
          <Animated.Text
            key={index}
            style={[
              styles.piece,
              {
                left: `${piece.left}%`,
                fontSize: piece.size,
                opacity,
                transform: [{ translateY: fall }, { rotate }],
              },
            ]}
          >
            {piece.emoji}
          </Animated.Text>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    zIndex: 20,
    overflow: 'hidden',
  },
  piece: {
    position: 'absolute',
    top: 0,
  },
});
