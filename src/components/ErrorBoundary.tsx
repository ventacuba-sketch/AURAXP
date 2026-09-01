import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from './PrimaryButton';
import { colors, spacing, typography } from '../theme/colors';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Red de seguridad de último recurso (bloque auditoría pre-lanzamiento) --
 * hasta ahora la app NO tenía ningún error boundary: un error de render no
 * capturado en CUALQUIER pantalla (un `.map()` sobre un dato inesperado,
 * un null que no debería serlo, lo que sea) desmontaba TODO el árbol de
 * React y dejaba a la persona en una pantalla blanca sin ningún camino de
 * vuelta -- ni mensaje, ni botón, nada. Esto no reemplaza arreglar bugs
 * reales; es la diferencia entre "algo salió mal, reintentar" y "la app
 * dejó de existir" cuando algo que no probamos igual se rompe en
 * producción.
 *
 * Class component a propósito -- getDerivedStateFromError/componentDidCatch
 * no tienen equivalente en hooks, es la única forma real de capturar un
 * error de render en React.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    console.error(
      JSON.stringify({
        src: 'ErrorBoundary',
        event: 'render_error',
        message: error instanceof Error ? error.message : String(error),
        componentStack: info.componentStack ?? null,
      }),
    );
  }

  // En web, recargar la página es la recuperación más confiable (limpia
  // cualquier estado de React a medio romper); en nativo no hay "recargar",
  // así que se reintenta re-montando el árbol -- si el error era transitorio
  // (una respuesta rara de la red, por ejemplo) alcanza, y si era realmente
  // un bug reproducible, la persona puede volver a tocar RECARGAR sin quedar
  // trabada.
  handleReload = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.emoji}>⚠️</Text>
          <Text style={styles.title}>Algo salió mal</Text>
          <Text style={styles.body}>Tuvimos un problema inesperado. Probá de nuevo.</Text>
          <PrimaryButton label="RECARGAR" onPress={this.handleReload} />
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emoji: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
});
