import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { DailyScanCounter } from '../components/DailyScanCounter';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { StatTile } from '../components/StatTile';
import { XPBar } from '../components/XPBar';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { ProfileUpdateError, updateProfile, usernameCooldownDaysLeft } from '../services/profileService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { formatLevel } from '../utils/format';

// Foto de perfil real (imagen) queda para una tarea aparte -- por ahora el
// avatar sigue siendo un emoji, elegido de este set fijo.
const AVATAR_EMOJI_OPTIONS = [
  '🙂', '😎', '🔥', '🦋', '✨', '👾', '🐉', '🌈', '💀', '🎯', '🚀', '🍀',
];

export default function ProfileScreen() {
  const { user, refetch } = useCurrentUser();
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState('🙂');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
    <ScreenContainer>
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
