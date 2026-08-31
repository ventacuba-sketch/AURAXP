import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { DailyScanCounter } from '../components/DailyScanCounter';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { StatTile } from '../components/StatTile';
import { XPBar } from '../components/XPBar';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { signOut } from '../services/authService';
import { clearPendingChallengeToken } from '../services/pendingChallenge';
import { ProfileUpdateError, updateProfile, usernameCooldownDaysLeft } from '../services/profileService';
import { DailyScanStatus, fetchDailyScanStatus } from '../services/scanService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { colors, radius, spacing, typography } from '../theme/colors';
import { formatLevel } from '../utils/format';

// Foto de perfil real (imagen) queda para una tarea aparte -- por ahora el
// avatar sigue siendo un emoji, elegido de este set fijo.
const AVATAR_EMOJI_OPTIONS = [
  '🙂', '😎', '🔥', '🦋', '✨', '👾', '🐉', '🌈', '💀', '🎯', '🚀', '🍀',
];

export default function ProfileScreen() {
  const { user, refetch } = useCurrentUser();
  const navigation = useRootNavigation();
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState('🙂');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Mismo dato real que ya usa DailyScanCounter (get-daily-scan-status) --
  // se reconsulta acá en vez de intentar compartir estado con ese
  // componente hermano, mismo patrón que useCurrentUser en varias
  // pantallas. Solo se usa `plan`, así que un fetch extra liviano es mejor
  // que acoplar dos componentes que hoy son independientes.
  const [planStatus, setPlanStatus] = useState<DailyScanStatus | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchDailyScanStatus().then((result) => {
        if (!cancelled && result) setPlanStatus(result);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  // Reset the form to the current profile every time edit mode opens (not
  // on every render) so a discarded edit never leaks into the next one.
  useEffect(() => {
    if (editing && user) {
      setUsername(user.username);
      setBio(user.bio ?? '');
      setAvatarEmoji(user.avatarEmoji);
      setErrorMessage(null);
    }
  }, [editing, user]);

  const cooldownDaysLeft = usernameCooldownDaysLeft(user?.usernameUpdatedAt ?? null);
  const usernameLocked = cooldownDaysLeft > 0;

  /**
   * Cierra sesión de verdad -- ver auditoría de "Cerrar sesión":
   * - `signOut()` limpia la sesión real de Supabase (su propio storage);
   *   `onAuthStateChange` dispara solo, RootNavigator desmonta TODO el
   *   árbol autenticado y vuelve a `<Auth/>` -- ahí se pierde, por
   *   desmontaje normal de React, cualquier estado en memoria (user, XP,
   *   lo que sea) sin necesitar limpiarlo a mano acá.
   * - `clearPendingChallengeToken()` es el único estado que sobrevive en
   *   AsyncStorage por fuera de la sesión de Supabase -- sin esto, un
   *   token pendiente de una visita SIN cuenta de antes de este login
   *   quedaría para el próximo que use el mismo dispositivo (ver ese
   *   archivo para el detalle completo del riesgo A->B).
   * - NUNCA toca cuenta/XP/Challenges/Profile/PRO/Scans -- todo eso vive
   *   en el backend, cerrar sesión no borra ni modifica ninguna fila.
   */
  async function handleLogout() {
    setLoggingOut(true);
    try {
      await clearPendingChallengeToken();
      await signOut();
    } catch (e) {
      console.warn('signOut failed', e);
    } finally {
      setLoggingOut(false);
      setConfirmingLogout(false);
    }
  }

  async function handleSave() {
    if (!username.trim()) {
      setErrorMessage('El username no puede estar vacío.');
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    try {
      await updateProfile({ username: username.trim(), avatarEmoji, bio: bio.trim() });
      refetch();
      setEditing(false);
    } catch (e) {
      setErrorMessage(e instanceof ProfileUpdateError ? e.message : 'No pudimos guardar los cambios.');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <ScreenContainer scroll style={styles.editContainer}>
        <Text style={styles.editTitle}>EDITAR PERFIL</Text>

        <Text style={styles.label}>AVATAR</Text>
        <View style={styles.emojiGrid}>
          {AVATAR_EMOJI_OPTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => setAvatarEmoji(emoji)}
              style={[styles.emojiOption, emoji === avatarEmoji && styles.emojiOptionSelected]}
            >
              <Text style={styles.emojiOptionText}>{emoji}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>USERNAME</Text>
        <TextInput
          style={[styles.input, usernameLocked && styles.inputDisabled]}
          value={username}
          onChangeText={setUsername}
          editable={!usernameLocked}
          autoCapitalize="none"
          placeholder="username"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={usernameLocked ? styles.cooldownLocked : styles.cooldownFree}>
          {usernameLocked
            ? `Podrás cambiar tu username nuevamente en ${cooldownDaysLeft} día${cooldownDaysLeft === 1 ? '' : 's'}`
            : 'Puedes cambiar tu username ahora'}
        </Text>

        <Text style={styles.label}>BIO</Text>
        <TextInput
          style={[styles.input, styles.bioInput]}
          value={bio}
          onChangeText={setBio}
          placeholder="Cuéntanos algo sobre ti"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={160}
        />

        {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

        <View style={styles.editActions}>
          <PrimaryButton
            label={saving ? 'GUARDANDO...' : 'GUARDAR'}
            disabled={saving}
            onPress={handleSave}
          />
          <PrimaryButton
            variant="text"
            label="CANCELAR"
            disabled={saving}
            onPress={() => setEditing(false)}
          />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll>
      <View style={styles.avatarBlock}>
        <Text style={styles.avatar}>{user?.avatarEmoji ?? '🙂'}</Text>
        <Text style={styles.username}>@{user?.username ?? 'you'}</Text>
        {user && <Badge label={`FOUNDER #${user.founderNumber}`} tone="accent" />}
        {user?.bio && <Text style={styles.bio}>{user.bio}</Text>}
        <PrimaryButton variant="ghost" label="EDITAR PERFIL" onPress={() => setEditing(true)} />
      </View>

      <Card style={styles.card}>
        <XPBar xp={user?.xp ?? 0} xpToNextLevel={user?.xpToNextLevel ?? 1} level={user?.level ?? 1} />
      </Card>

      <View style={styles.statsRow}>
        <StatTile label="RACHA 🔥" value={String(user?.streakDays ?? 0)} />
        <StatTile label="NIVEL" value={formatLevel(user?.level ?? 0)} />
      </View>

      <DailyScanCounter />

      <Pressable onPress={() => navigation.navigate('MyChallenges')}>
        <Card style={styles.linkCard}>
          <Text style={styles.linkCardLabel}>MIS DESAFÍOS ⚔️</Text>
          <Text style={styles.linkCardArrow}>›</Text>
        </Card>
      </Pressable>

      {/* Sin Supabase configurado (modo mock/dev) ni plan ni cerrar sesión
          significan algo real -- se oculta entero en vez de mostrar un
          "FREE" inventado o un botón que no puede hacer nada. */}
      {isSupabaseConfigured && (
        <View style={styles.settingsSection}>
          <Text style={styles.settingsTitle}>AJUSTES</Text>

          {planStatus && (
            <View style={styles.planRow}>
              <Text style={styles.planLabel}>
                Plan actual: {planStatus.unlimited ? 'PRUEBA (ilimitado)' : planStatus.plan === 'pro' ? 'PRO' : 'FREE'}
              </Text>
              {!planStatus.unlimited && planStatus.plan !== 'pro' && (
                <PrimaryButton variant="text" label="Ver PRO" onPress={() => navigation.navigate('Pro')} />
              )}
            </View>
          )}

          {confirmingLogout ? (
            <View style={styles.logoutConfirm}>
              <Text style={styles.logoutConfirmText}>¿Cerrar sesión?</Text>
              <View style={styles.logoutConfirmActions}>
                <View style={styles.logoutConfirmButton}>
                  <PrimaryButton
                    variant="ghost"
                    label="CANCELAR"
                    disabled={loggingOut}
                    onPress={() => setConfirmingLogout(false)}
                  />
                </View>
                <View style={styles.logoutConfirmButton}>
                  <PrimaryButton
                    label={loggingOut ? 'CERRANDO...' : 'CERRAR SESIÓN'}
                    disabled={loggingOut}
                    onPress={handleLogout}
                  />
                </View>
              </View>
            </View>
          ) : (
            <PrimaryButton variant="text" label="CERRAR SESIÓN" onPress={() => setConfirmingLogout(true)} />
          )}
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  avatarBlock: {
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  avatar: {
    fontSize: 56,
    marginBottom: spacing.sm,
  },
  username: {
    ...typography.title,
    color: colors.textPrimary,
  },
  bio: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  card: {
    marginBottom: spacing.lg,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    borderColor: colors.secondary,
  },
  linkCardLabel: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  linkCardArrow: {
    ...typography.title,
    color: colors.textMuted,
  },
  settingsSection: {
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  settingsTitle: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  logoutConfirm: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  logoutConfirmText: {
    ...typography.subtitle,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  logoutConfirmActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  logoutConfirmButton: {
    flex: 1,
  },
  editContainer: {
    paddingTop: spacing.xl,
  },
  editTitle: {
    ...typography.title,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  emojiOption: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiOptionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  emojiOptionText: {
    fontSize: 24,
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
  inputDisabled: {
    opacity: 0.5,
  },
  bioInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  cooldownLocked: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  cooldownFree: {
    ...typography.caption,
    color: colors.success,
    marginTop: spacing.xs,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.md,
  },
  editActions: {
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
});
