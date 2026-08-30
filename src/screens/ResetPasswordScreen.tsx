import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useAuth } from '../hooks/useAuth';
import { mapAuthError, updatePassword } from '../services/authService';
import { colors, radius, spacing, typography } from '../theme/colors';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Se renderiza en vez de la app normal mientras `passwordRecovery` está en
 * true (ver useAuth/RootNavigator) -- es decir, justo después de volver
 * del link de "olvidé mi contraseña". Al confirmar, clearPasswordRecovery()
 * hace que RootNavigator vuelva a mostrar la app normal solo -- ahí retoma
 * un Challenge pendiente si lo había (mismo mecanismo de siempre, ver
 * pendingChallenge.ts), sin que este flujo tenga que saber nada de eso.
 */
export default function ResetPasswordScreen() {
  const { clearPasswordRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit() {
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setLoading(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (e) {
      setError(mapAuthError(e));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <ScreenContainer style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>AURAXP</Text>
          <Text style={styles.successText}>Contraseña actualizada.</Text>
        </View>
        <PrimaryButton label="ENTRAR A AURAXP" onPress={clearPasswordRecovery} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.wordmark}>AURAXP</Text>
        <Text style={styles.subtitle}>Elige tu nueva contraseña.</Text>
      </View>

      <View style={styles.form}>
        <View style={styles.passwordRow}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Nueva contraseña"
            placeholderTextColor={colors.textMuted}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            value={password}
            onChangeText={setPassword}
          />
          <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10} style={styles.toggle}>
            <Text style={styles.toggleText}>{showPassword ? 'OCULTAR' : 'MOSTRAR'}</Text>
          </Pressable>
        </View>
        <TextInput
          style={styles.input}
          placeholder="Repite la contraseña"
          placeholderTextColor={colors.textMuted}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          value={confirmPassword}
          onChangeText={setConfirmPassword}
        />
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      <PrimaryButton
        label={loading ? 'GUARDANDO...' : 'GUARDAR CONTRASEÑA'}
        disabled={loading || !password || !confirmPassword}
        onPress={handleSubmit}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
  },
  header: {
    marginBottom: spacing.xxl,
    alignItems: 'center',
  },
  wordmark: {
    ...typography.hero,
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  successText: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  form: {
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    ...typography.body,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingRight: spacing.sm,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    ...typography.body,
  },
  toggle: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  toggleText: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
  },
  error: {
    ...typography.caption,
    color: colors.danger,
  },
});
