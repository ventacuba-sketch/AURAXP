import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { logEvent } from '../services/analyticsService';
import { getStoredUtmParams } from '../services/campaignService';
import { colors, spacing, typography } from '../theme/colors';

export default function LandingScreen() {
  const navigation = useRootNavigation();

  useEffect(() => {
    getStoredUtmParams().then((utm) => logEvent('landing_viewed', utm ? { ...utm } : undefined));
  }, []);

  async function handleCta(position: 'hero' | 'result') {
    const utm = await getStoredUtmParams();
    logEvent('landing_cta_clicked', { position, ...utm });
    navigation.navigate('Auth', { initialMode: 'signUp', context: 'measure_aura' });
  }

  async function handleChat() {
    const utm = await getStoredUtmParams();
    logEvent('landing_chat_clicked', utm ? { ...utm } : undefined);
    navigation.navigate('Chat');
  }

  return (
    <ScreenContainer scroll style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.wordmark}>AURA VS</Text>
        <Text style={styles.kicker}>🔥 EL RETO ES SIMPLE</Text>
        <Text style={styles.headline}>
          ¿CUÁNTA <Text style={styles.accent}>AURA</Text> TIENES?
        </Text>
        <Text style={styles.pitch}>
          Graba solo 8 segundos. Nuestra IA analiza tu presencia y te da tu puntuación de Aura.
        </Text>

        <Card style={styles.resultCard}>
          <Text style={styles.resultLabel}>ASÍ SE VE UN RESULTADO</Text>
          <Text style={styles.resultScore}>917 AURA 🔥</Text>
          <Text style={styles.resultChallenge}>¿Puedes superarlo?</Text>
        </Card>

        <View style={styles.heroCta}>
          <PrimaryButton label="🔥 DESCUBRIR MI AURA GRATIS" onPress={() => handleCta('hero')} />
          <Text style={styles.trust}>✓ Gratis  ·  ✓ 8 segundos  ·  ✓ Resultado con IA</Text>
          <Text style={styles.noCard}>Sin tarjeta. Crea tu cuenta gratis para guardar tu resultado.</Text>
        </View>
      </View>

      <View style={styles.steps}>
        <Text style={styles.sectionTitle}>¿QUÉ PASA DESPUÉS?</Text>
        <View style={styles.stepRow}>
          <Step number="1" text="GRABA 8s" />
          <Text style={styles.arrow}>→</Text>
          <Step number="2" text="IA ANALIZA" />
          <Text style={styles.arrow}>→</Text>
          <Step number="3" text="RECIBE TU AURA" />
        </View>
      </View>

      <View style={styles.socialProof}>
        <Text style={styles.sectionTitle}>NO TERMINA EN EL SCAN</Text>
        <Text style={styles.socialText}>⚔️ Desafía a otros   🏆 Sube en el ranking</Text>
        <Text style={styles.socialText}>💬 Entra a La Sala del Aura   👑 Compara tu nivel</Text>
      </View>

      <PrimaryButton label="⚡ QUIERO SABER MI AURA" onPress={() => handleCta('result')} />

      <View style={styles.chatBox}>
        <Text style={styles.chatTitle}>🔥 LA SALA DEL AURA</Text>
        <Text style={styles.chatBody}>Mira de qué habla la comunidad, conoce otros farmeadores y encuentra rivales.</Text>
        <PrimaryButton label="💬 ENTRAR A LA SALA" variant="ghost" onPress={handleChat} />
      </View>

      <Text style={styles.footnote}>AURA VS · Mide tu Aura. Compite. Sube de nivel.</Text>
    </ScreenContainer>
  );
}

function Step({ number, text }: { number: string; text: string }) {
  return (
    <View style={styles.step}>
      <Text style={styles.stepNumber}>{number}</Text>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingTop: spacing.md },
  hero: { alignItems: 'center', marginBottom: spacing.xl },
  wordmark: { ...typography.eyebrow, color: colors.secondary, marginBottom: spacing.sm },
  kicker: { ...typography.caption, color: colors.accent, fontWeight: '800', marginBottom: spacing.xs },
  headline: { ...typography.hero, fontSize: 36, color: colors.textPrimary, textAlign: 'center' },
  accent: { color: colors.accent },
  pitch: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, maxWidth: 330 },
  resultCard: { width: '100%', alignItems: 'center', borderColor: colors.accent, marginTop: spacing.lg, marginBottom: spacing.md, paddingVertical: spacing.md },
  resultLabel: { ...typography.eyebrow, color: colors.textMuted, marginBottom: spacing.xs },
  resultScore: { ...typography.display, color: colors.accent },
  resultChallenge: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginTop: spacing.xs },
  heroCta: { width: '100%', gap: spacing.xs, alignItems: 'center' },
  trust: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
  noCard: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  sectionTitle: { ...typography.eyebrow, color: colors.textPrimary, textAlign: 'center', marginBottom: spacing.md },
  steps: { marginBottom: spacing.xl },
  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  step: { flex: 1, alignItems: 'center' },
  stepNumber: { color: colors.accent, fontWeight: '900', fontSize: 20 },
  stepText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', fontWeight: '700', marginTop: 2 },
  arrow: { color: colors.textMuted, fontSize: 18 },
  socialProof: { marginBottom: spacing.lg },
  socialText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xs },
  chatBox: { marginTop: spacing.xl, marginBottom: spacing.lg, gap: spacing.sm },
  chatTitle: { ...typography.title, color: colors.accent, textAlign: 'center' },
  chatBody: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  footnote: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.xl },
});
