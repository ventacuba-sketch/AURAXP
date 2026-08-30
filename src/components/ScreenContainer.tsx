import React, { PropsWithChildren } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, spacing, typography } from '../theme/colors';

interface Props {
  scroll?: boolean;
  style?: ViewStyle;
  /**
   * Barra superior mínima, opcional -- solo aparece cuando el caller pasa
   * `onBack` y/o `onHome`. Bug real de navegación encontrado probando en
   * iPhone: con el header nativo siempre oculto (headerShown: false, ver
   * RootNavigator) y sin gesto de swipe-back en web, varias pantallas
   * (Upload, ChallengeLanding, ScanResult, Challenge...) no tenían NINGUNA
   * forma de volver dentro de la app -- solo el Back de Safari, justo lo
   * que no debe pasar. Centralizado acá (no un botón por pantalla) para
   * que se vea y se comporte igual en todos lados.
   */
  onBack?: () => void;
  /** Botón para ir directo a Home (MainTabs) -- se usa junto a onBack en
   * pantallas donde tiene sentido saltar directo en vez de solo retroceder
   * un paso (p. ej. ChallengeLanding, donde "atrás" puede no llevar a
   * ningún lado dentro de la app si se llegó por un link externo). */
  onHome?: () => void;
}

/** Shared dark full-bleed background + safe-area wrapper used by every screen. */
export function ScreenContainer({ children, scroll = false, style, onBack, onHome }: PropsWithChildren<Props>) {
  const Content = scroll ? ScrollView : View;
  const showTopBar = Boolean(onBack || onHome);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {showTopBar && (
        <View style={styles.topBar}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              style={styles.topBarButton}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Volver"
            >
              <Text style={styles.topBarBackGlyph}>‹</Text>
            </Pressable>
          ) : (
            <View style={styles.topBarButton} />
          )}
          {onHome && (
            <Pressable
              onPress={onHome}
              style={styles.topBarButton}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Ir a inicio"
            >
              <Text style={styles.topBarHomeGlyph}>🏠</Text>
            </Pressable>
          )}
        </View>
      )}
      <Content
        style={[styles.content, style]}
        contentContainerStyle={scroll ? styles.scrollContent : undefined}
      >
        {children}
      </Content>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  topBarButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarBackGlyph: {
    ...typography.hero,
    color: colors.textPrimary,
    marginTop: -2,
  },
  topBarHomeGlyph: {
    fontSize: 18,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
});
