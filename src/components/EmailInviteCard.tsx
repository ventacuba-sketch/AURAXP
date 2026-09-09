import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { logEvent } from '../services/analyticsService';
import { EmailInviteError, sendEmailInvite } from '../services/emailInviteService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { Card } from './Card';
import { PrimaryButton } from './PrimaryButton';

export function EmailInviteCard() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleOpen() {
    setOpen(true);
    setSuccess(false);
    setError(null);
    void logEvent('email_invite_opened');
  }

  function handleClose() {
    if (sending) return;
    setOpen(false);
    setEmail('');
    setError(null);
    setSuccess(false);
  }

  async function handleSend() {
    if (sending) return;
    setSending(true);
    setError(null);
    setSuccess(false);
    try {
      await sendEmailInvite(email);
      setSuccess(true);
      setEmail('');
    } catch (e) {
      setError(e instanceof EmailInviteError ? e.message : 'No pudimos enviar la invitación. Inténtalo de nuevo.');
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <Card style={styles.card}>
        <View style={styles.row}>
          <View style={styles.copy}>
            <Text style={styles.title}>📩 INVITAR AMIGOS</Text>
            <Text style={styles.subtitle}>Invítalos por email y gana Coins cuando completen su primer Scan.</Text>
          </View>
          <PrimaryButton variant="text" label="INVITAR" onPress={handleOpen} />
        </View>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>📩 INVITAR POR EMAIL</Text>
      <Text style={styles.subtitle}>Enviaremos tu invitación con tu código de referido. Máximo 5 en 24 horas.</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={(value) => {
          setEmail(value);
          setError(null);
          setSuccess(false);
        }}
        editable={!sending}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        placeholder="amigo@email.com"
        placeholderTextColor={colors.textMuted}
        returnKeyType="send"
        onSubmitEditing={handleSend}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      {success && <Text style={styles.success}>✓ Invitación enviada.</Text>}
      <View style={styles.actions}>
        <View style={styles.actionButton}>
          <PrimaryButton variant="ghost" label="CANCELAR" disabled={sending} onPress={handleClose} />
        </View>
        <View style={styles.actionButton}>
          <PrimaryButton
            label={sending ? 'ENVIANDO...' : 'ENVIAR INVITACIÓN'}
            disabled={sending || !email.trim()}
            onPress={handleSend}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    borderColor: colors.secondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  copy: { flex: 1 },
  title: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
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
    marginTop: spacing.md,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  success: {
    ...typography.caption,
    color: colors.success,
    marginTop: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionButton: { flex: 1 },
});
