import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useSmartBack } from '../hooks/useSmartBack';
import { logEvent } from '../services/analyticsService';
import { BugReportKind, submitBugReport } from '../services/bugReportService';
import { colors, radius, spacing, typography } from '../theme/colors';

const KIND_OPTIONS: { key: BugReportKind; label: string }[] = [
  { key: 'bug', label: 'BUG' },
  { key: 'suggestion', label: 'SUGERENCIA' },
  { key: 'other', label: 'OTRO' },
];

/** Reportar bug/sugerencia (bloque soporte) -- guarda server-side
 * (bug_reports), con contexto útil automático (pantalla/plataforma/user
 * agent) pero nunca nada sensible. Sin panel de lectura del lado del
 * cliente todavía -- ver la migración. */
export default function BugReportScreen() {
  const goBack = useSmartBack();
  const [kind, setKind] = useState<BugReportKind>('bug');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    if (!message.trim()) return;
    setSending(true);
    const ok = await submitBugReport(kind, message.trim(), 'BugReport');
    setSending(false);
    if (ok) {
      logEvent('bug_reported', { kind });
      setSent(true);
      setMessage('');
    }
  }

  if (sent) {
    return (
      <ScreenContainer style={styles.center} onBack={goBack}>
        <Text style={styles.thanksTitle}>¡Gracias! ✅</Text>
        <Text style={styles.thanksBody}>Lo recibimos y lo vamos a revisar.</Text>
        <PrimaryButton label="MANDAR OTRO" variant="text" onPress={() => setSent(false)} />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll onBack={goBack}>
      <Text style={styles.title}>REPORTAR UN PROBLEMA</Text>

      <View style={styles.kindRow}>
        {KIND_OPTIONS.map((opt) => (
          <Pressable
            key={opt.key}
            onPress={() => setKind(opt.key)}
            style={[styles.kindOption, kind === opt.key && styles.kindOptionActive]}
          >
            <Text style={[styles.kindText, kind === opt.key && styles.kindTextActive]}>{opt.label}</Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        style={styles.input}
        placeholder="Cuéntanos qué pasó..."
        placeholderTextColor={colors.textMuted}
        value={message}
        onChangeText={setMessage}
        multiline
        numberOfLines={6}
      />

      <PrimaryButton label={sending ? 'ENVIANDO...' : 'ENVIAR'} disabled={sending || !message.trim()} onPress={handleSubmit} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.textPrimary,
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
  },
  kindRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  kindOption: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kindOptionActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  kindText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  kindTextActive: {
    color: colors.accent,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.textPrimary,
    minHeight: 140,
    textAlignVertical: 'top',
    marginBottom: spacing.lg,
    ...typography.body,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  thanksTitle: {
    ...typography.title,
    color: colors.textPrimary,
  },
  thanksBody: {
    ...typography.body,
    color: colors.textSecondary,
  },
});
