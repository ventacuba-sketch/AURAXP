import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { logEvent } from '../services/analyticsService';
import {
  mapAuthError,
  requestPasswordReset,
  resendConfirmationEmail,
  signIn,
  signUp,
} from '../services/authService';
import { colors, radius, spacing, typography } from '../theme/colors';

type Mode = 'signIn' | 'signUp' | 'forgotPassword';

// Evita que alguien machaque el botón de "recuperar contraseña" y
// dispare un montón de emails -- Supabase igual tiene su propio rate
// limit del lado del servidor, esto es nada más para que la persona no
// tenga que enterarse de eso por un error crudo.
const RESET_COOLDOWN_MS = 30000;

export default function AuthScreen() {
  const navigation = useRootNavigation();
  // Solo si hay algo real a lo que volver -- p. ej. se llegó empujado
  // desde ChallengeLanding al tocar ACEPTAR sin sesión. Si Auth fue la
  // primera pantalla (visita directa), no hay historial in-app y no
  // ofrecemos un botón que no lleve a ningún lado.
  const canGoBack = navigation.canGoBack();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  // Distinto de `error`: en vez de un texto suelto, ofrece las 3 salidas
  // reales cuando alguien intenta crear una cuenta que ya existe -- sin
  // revelar si está confirmada o no (Supabase tampoco lo distingue acá).
  const [showAlreadyRegistered, setShowAlreadyRegistered] = useState(false);
  // Igual de deliberado: cuando el login falla por credenciales, además
  // del mensaje se ofrece el atajo directo a recuperar contraseña -- es
  // el camino real para el caso "la cuenta existe y está confirmada pero
  // el login sigue fallando" (ver ResetPasswordScreen/authService).
  const [showLoginRecoveryHint, setShowLoginRecoveryHint] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resetCooldownActive, setResetCooldownActive] = useState(false);

  function resetTransientState() {
    setError(null);
    setSuccessMessage(null);
    setShowAlreadyRegistered(false);
    setShowLoginRecoveryHint(false);
    setResendNotice(null);
  }

  function switchMode(next: Mode) {
    resetTransientState();
    setPassword('');
    setMode(next);
  }

  async function handleSubmit() {
    resetTransientState();
    setLoading(true);
    try {
      if (mode === 'signIn') {
        await signIn(email.trim(), password);
        // Éxito -> onAuthStateChange (useAuth) actualiza la sesión y
        // RootNavigator cambia de Auth a MainTabs solo.
      } else {
        if (password.length < 8) {
          setError('La contraseña debe tener al menos 8 caracteres.');
          return;
        }
        const status = await signUp(email.trim(), password);
        if (status === 'confirmationRequired') {
          setSuccessMessage('Cuenta creada. Revisa tu correo para confirmar el registro.');
          logEvent('signup');
        } else if (status === 'alreadyRegistered') {
          setShowAlreadyRegistered(true);
        } else if (status === 'signedIn') {
          logEvent('signup');
        }
        // 'signedIn' (proyectos sin confirmación de email activada) ->
        // onAuthStateChange resuelve la navegación solo, igual que el login.
      }
    } catch (e) {
      const message = mapAuthError(e);
      setError(message);
      if (mode === 'signIn' && message === 'Correo o contraseña incorrectos.') {
        setShowLoginRecoveryHint(true);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResendConfirmation() {
    setResending(true);
    setResendNotice(null);
    try {
      await resendConfirmationEmail(email.trim());
      setResendNotice('Te reenviamos el correo de confirmación.');
    } catch (e) {
      setResendNotice(mapAuthError(e));
    } finally {
      setResending(false);
    }
  }

  async function handleRequestReset() {
    if (resetCooldownActive) return;
    resetTransientState();
    setLoading(true);
    try {
      await requestPasswordReset(email.trim());
      setSuccessMessage('Si el correo existe, te enviamos un enlace para recuperar tu contraseña.');
      setResetCooldownActive(true);
      setTimeout(() => setResetCooldownActive(false), RESET_COOLDOWN_MS);
    } catch (e) {
      // Solo se distingue un problema real (red caída, rate limit) -- eso
      // no filtra si el email existe, es lo mismo sea cual sea la cuenta.
      // Cualquier otra cosa (Supabase nunca revela "el email no existe"
      // para esta llamada) sí se trata como éxito -- no hay forma de que
      // esto termine confirmando ni negando una cuenta.
      setError(mapAuthError(e));
    } finally {
      setLoading(false);
    }
  }

  if (showAlreadyRegistered) {
    return (
      <ScreenContainer style={styles.container} onBack={canGoBack ? () => navigation.goBack() : undefined}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>AURAXP</Text>
          <Text style={styles.successText}>Esta cuenta ya existe o está pendiente de confirmación.</Text>
        </View>
        {resendNotice && <Text style={styles.resendNotice}>{resendNotice}</Text>}
        <View style={styles.actions}>
          <PrimaryButton label="INICIAR SESIÓN" onPress={() => switchMode('signIn')} />
          <PrimaryButton
            variant="ghost"
            label={resending ? 'REENVIANDO...' : 'REENVIAR CONFIRMACIÓN'}
            disabled={resending}
            onPress={handleResendConfirmation}
          />
          <PrimaryButton variant="text" label="RECUPERAR CONTRASEÑA" onPress={() => switchMode('forgotPassword')} />
        </View>
      </ScreenContainer>
    );
  }

  if (successMessage) {
    return (
      <ScreenContainer style={styles.container} onBack={canGoBack ? () => navigation.goBack() : undefined}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>AURAXP</Text>
          <Text style={styles.successText}>{successMessage}</Text>
        </View>
        <PrimaryButton label="VOLVER A INICIAR SESIÓN" onPress={() => switchMode('signIn')} />
      </ScreenContainer>
    );
  }

  if (mode === 'forgotPassword') {
    return (
      <ScreenContainer style={styles.container} onBack={canGoBack ? () => navigation.goBack() : undefined}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>AURAXP</Text>
          <Text style={styles.subtitle}>Te mandamos un link para elegir una contraseña nueva.</Text>
        </View>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          {error && <Text style={styles.error}>{error}</Text>}
        </View>

        <View style={styles.actions}>
          <PrimaryButton
            label={loading ? 'ENVIANDO...' : resetCooldownActive ? 'YA LO ENVIAMOS -- ESPERA UN MOMENTO' : 'ENVIAR ENLACE'}
            disabled={loading || !email || resetCooldownActive}
            onPress={handleRequestReset}
          />
          <PrimaryButton variant="text" label="Volver a iniciar sesión" onPress={() => switchMode('signIn')} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer style={styles.container} onBack={canGoBack ? () => navigation.goBack() : undefined}>
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
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <View style={styles.passwordRow}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Contraseña"
            placeholderTextColor={colors.textMuted}
            secureTextEntry={!showPassword}
            // Bug real encontrado auditando el flujo de login: react-native-web
            // deja autoCapitalize en 'sentences' por default si no se pasa
            // explícitamente -- ni siquiera secureTextEntry lo pisa (ver su
            // código fuente). En iOS Safari eso puede terminar
            // autocapitalizando la primera letra de la contraseña de forma
            // inconsistente entre una tipeada y otra (por eso una cuenta podía
            // quedar creada y confirmada, pero el login fallar después con
            // "Invalid login credentials" sin que la contraseña "real" hubiera
            // cambiado). Mismo fix en ResetPasswordScreen.
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
        {mode === 'signIn' && (
          <Pressable onPress={() => switchMode('forgotPassword')} hitSlop={6}>
            <Text style={styles.forgotLink}>¿Olvidaste tu contraseña?</Text>
          </Pressable>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        {showLoginRecoveryHint && (
          <PrimaryButton variant="ghost" label="RECUPERAR CONTRASEÑA" onPress={() => switchMode('forgotPassword')} />
        )}
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
          onPress={() => switchMode(mode === 'signIn' ? 'signUp' : 'signIn')}
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
    textAlign: 'center',
  },
  successText: {
    ...typography.body,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  resendNotice: {
    ...typography.caption,
    color: colors.success,
    textAlign: 'center',
    marginBottom: spacing.md,
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
  forgotLink: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'right',
  },
  error: {
    ...typography.caption,
    color: colors.danger,
  },
  actions: {
    gap: spacing.sm,
  },
});
