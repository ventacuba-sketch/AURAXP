import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { logEvent } from '../services/analyticsService';
import { getStoredUtmParams } from '../services/campaignService';
import { setPendingFirstScan } from '../services/pendingAcquisition';
import { colors, spacing, typography } from '../theme/colors';

/** Landing pública de adquisición: una sola promesa, medir el Aura. */
export default function LandingScreen() {
  const navigation = useRootNavigation();

  useEffect(() => {
    getStoredUtmParams().then((utm) => logEvent('landing_viewed', utm ? { ...utm } : undefined));
  }, []);

  async function handleCta(position: 'hero' | 'example') {
    const utm = await getStoredUtmParams();
    await setPendingFirstScan();
    void logEvent('landing_cta_clicked', { position, ...utm });
    navigation.navigate('Auth', { initialMode: 'signUp', context: 'measure_aura' });
  }

  return (
    <ScreenContainer scroll style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.wordmark}>AURA VS</Text>
        <Text style={styles.headline}>
          ¿CUÁNTA <Text style={styles.headlineAccent}>AURA</Text> TIENES?
        </Text>
        <Text style={styles.pitch}>
          Sube un video de hasta 8 segundos. La IA mide tu Aura y te da tu puntuación.
        </Text>

        <View style={styles.heroCta}>
          <PrimaryButton label="⚡ MIDE TU AURA GRATIS" onPress={() => handleCta('hero')} />
          <Text style={styles.trustRow}>Gratis · Con IA · Sin descargar ninguna app</Text>
        </View>

        <Card style={styles.resultPreview}>
          <Text style={styles.exampleTag}>TU RESULTADO SE VERÁ ASÍ</Text>
          <Text style={styles.exampleScore}>8.742 AURA 🔥</Text>
          <Text style={styles.exampleCaption}>¿Cuánto marcará el tuyo?</Text>
        </Card>
      </View>

      <View style={styles.proofBlock}>
        <Text style={styles.proofTitle}>MIDE. COMPARTE. COMPITE.</Text>
        <Text style={styles.proofBody}>
          Después de descubrir tu Aura puedes desafiar a otros, subir en el ranking y ganar Coins.
        </Text>
      </View>

      <PrimaryButton label="⚡ QUIERO SABER MI AURA" onPress={() => handleCta('example')} />

      <View style={styles.features}>
        <FeatureCard emoji="🤖" title="AURA SCAN IA" body="Obtén tu puntuación." />
        <FeatureCard emoji="⚔️" title="CHALLENGES" body="Compite contra otros." />
        <FeatureCard emoji="🏆" title="RANKING" body="Sube de nivel." />
      </View>

      <Text style={styles.footnote}>Solo necesitas una cuenta gratis para guardar tu resultado.</Text>
    </ScreenContainer>
  );
}

function FeatureCard({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <Card style={styles.featureCard}>
      <Text style={styles.featureEmoji}>{emoji}</Text>
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.featureBody}>{body}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { paddingTop: spacing.md },
  hero: { alignItems: 'center', marginBottom: spacing.lg },
  wordmark: { ...typography.eyebrow, color: colors.secondary, marginBottom: spacing.sm },
  headline: { ...typography.hero, fontSize: 34, color: colors.textPrimary, textAlign: 'center' },
  headlineAccent: { color: colors.accent },
  pitch: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, maxWidth: 330 },
  heroCta: { width: '100%', marginTop: spacing.md, gap: spacing.xs, alignItems: 'center' },
  trustRow: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  resultPreview: { width: '100%', alignItems: 'center', borderColor: colors.accent, marginTop: spacing.lg, marginBottom: 0 },
  exampleTag: { ...typography.eyebrow, color: colors.textMuted, marginBottom: spacing.xs },
  exampleScore: { ...typography.display, color: colors.accent },
  exampleCaption: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  proofBlock: { alignItems: 'center', marginBottom: spacing.md },
  proofTitle: { ...typography.title, color: colors.textPrimary, textAlign: 'center' },
  proofBody: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs, maxWidth: 340 },
  features: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl, marginBottom: spacing.lg },
  featureCard: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  featureEmoji: { fontSize: 22, marginBottom: 2 },
  featureTitle: { ...typography.caption, fontWeight: '800', color: colors.textPrimary, textAlign: 'center' },
  featureBody: { ...typography.caption, fontSize: 11, color: colors.textSecondary, textAlign: 'center', marginTop: 2 },
  footnote: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.xl },
});
