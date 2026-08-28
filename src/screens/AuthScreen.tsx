import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { mapAuthError, signIn, signUp } from '../services/authService';
import { colors, radius, spacing, typography } from '../theme/colors';

type Mode = 'signIn' | 'signUp';

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setLoading(true);
    try {
      if (mode === 'signIn') {
        await signIn(email.trim(), password);
        // Éxito -> onAuthStateChange (useAuth) actualiza la sesión y
        // RootNavigator cambia de Auth a MainTabs solo.
      } else {
        const status = await signUp(email.trim(), password);
        if (status === 'confirmationRequired') {
          setSuccessMessage('Cuenta creada. Revisa tu correo para confirmar el registro.');
        } else if (status === 'alreadyRegistered') {
          setError('Este correo ya está registrado. Inicia sesión.');
        }
        // 'signedIn' (proyectos sin confirmación de email activada) ->
        // onAuthStateChange resuelve la navegación solo, igual que el login.
      }
    } catch (e) {
      setError(mapAuthError(e));
    } finally {
      setLoading(false);
    }
  }

  function handleBackToSignIn() {
    setSuccessMessage(null);
    setError(null);
    setPassword('');
    setMode('signIn');
  }

  if (successMessage) {
    return (
      <ScreenContainer style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>AURAXP</Text>
          <Text style={styles.successText}>{successMessage}</Text>
        </View>
        <PrimaryButton label="VOLVER A INICIAR SESIÓN" onPress={handleBackToSignIn} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.wordmark}>AURAXP</Text>
        <Text style={styles.subtitle}>
          {mode === 'signIn' ? 'Entra a tu cuenta.' : 'Crea tu cuenta.'}
        </Text>
      </View>

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Contraseña"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          label={loading ? '...' : mode === 'signIn' ? 'ENTRAR' : 'CREAR CUENTA'}
          disabled={loading || !email || !password}
          onPress={handleSubmit}
        />
        <PrimaryButton
          variant="text"
          label={mode === 'signIn' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Entra'}
          onPress={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}
        />
      </View>
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
  error: {
    ...typography.caption,
    color: colors.danger,
  },
  actions: {
    gap: spacing.sm,
  },
});
