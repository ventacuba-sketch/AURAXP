import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { logEvent } from '../services/analyticsService';
import { getStoredUtmParams } from '../services/campaignService';
import { colors, radius, spacing, typography } from '../theme/colors';

/**
 * Landing pública de adquisición -- pensada para tráfico de TikTok/Reels/
 * Shorts (ver `linking` en RootNavigator.tsx para la ruta exacta). Vende
 * la EXPERIENCIA antes que la cuenta: "¿cuánta Aura tienes?", no "crea tu
 * cuenta" -- el registro llega recién al tocar el CTA, y ahí mismo se
 * presenta como el paso para medir el Aura (ver AuthScreen, `context:
 * 'measure_aura'`), nunca como el producto en sí.
 *
 * Solo registrada cuando NO hay sesión (ver RootNavigator) -- alguien ya
 * logueado que toque el link de la campaña nunca ve esto, entra
 * directo a la app. Reutiliza ScreenContainer/Card/PrimaryButton/theme
 * tal cual el resto de AURA VS -- cero componentes ni estilos nuevos por
 * fuera del sistema ya existente, y cero animaciones (rendimiento en
 * móvil sobre TikTok es la prioridad explícita del pedido).
 */
export default function LandingScreen() {
  const navigation = useRootNavigation();

  useEffect(() => {
    getStoredUtmParams().then((utm) => logEvent('landing_viewed', utm ? { ...utm } : undefined));
  }, []);

  async function handleCta(position: 'hero' | 'example') {
    const utm = await getStoredUtmParams();
    logEvent('landing_cta_clicked', { position, ...utm });
    // Auth sigue siendo el único camino real a Upload/Scan sin sesión (esa
    // pantalla ni existe en el stack no-autenticado, ver RootNavigator) --
    // `context: 'measure_aura'` es solo copy distinto en Auth, ninguna
    // lógica de autenticación cambia.
    navigation.navigate('Auth', { initialMode: 'signUp', context: 'measure_aura' });
  }

  return (
    <ScreenContainer scroll style={styles.screen}>
      {/* ── Hero: debe entenderse sin scroll ────────────────────────── */}
      <View style={styles.hero}>
        <Text style={styles.wordmark}>AURA VS</Text>
        <Text style={styles.headline}>
          ¿CUÁNTA <Text style={styles.headlineAccent}>AURA</Text> TIENES? 👀
        </Text>
        <Text style={styles.subheadline}>
          Descúbrelo <Text style={styles.free}>GRATIS</Text> con IA.
        </Text>
        <Text style={styles.pitch}>
          Graba 8 segundos. La IA mide tu Aura. Compite contra otros y demuestra quién tiene más.
        </Text>

        <View style={styles.heroCta}>
          <PrimaryButton label="⚡ MEDIR MI AURA GRATIS" onPress={() => handleCta('hero')} />
          <Text style={styles.trustRow}>✓ Gratis · ✓ Con IA · ✓ Solo 8 segundos</Text>
        </View>
      </View>

      {/* ── Qué puedes hacer -- los 4 mensajes principales, junto al hero */}
      <View style={styles.features}>
        <FeatureCard emoji="🤖" title="AURA SCAN CON IA" body="La IA analiza tu actitud, estilo, confianza y presencia." />
        <FeatureCard emoji="⚔️" title="CHALLENGES ONLINE" body="Desafía a tus amigos y compite contra otros jugadores." />
        <FeatureCard emoji="🌎" title="COMUNIDAD AURA" body="Sigue jugadores, comparte resultados y descubre quién está subiendo." />
        <FeatureCard emoji="🏆" title="RANKING + RECOMPENSAS" body="Sube de nivel, completa misiones y gana Coins." />
      </View>

      {/* ── Cómo funciona -- una sola línea, sin explicaciones largas ─── */}
      <Text style={styles.flowLine}>GRABA 8s → IA ANALIZA → DESCUBRE TU AURA → DESAFÍA → SUBE EN EL RANKING</Text>

      {/* ── Ejemplo real de resultado (misma estética que ScanResult:
          typography.display en accent, ver theme/colors.ts) -- etiquetado
          como EJEMPLO a propósito, nunca se presenta como un dato real de
          quien está mirando. */}
      <Card style={styles.exampleCard}>
        <Text style={styles.exampleTag}>EJEMPLO</Text>
        <Text style={styles.exampleScore}>917 AURA 🔥</Text>
        <Text style={styles.exampleCaption}>¿Puedes superarlo?</Text>
      </Card>

      <PrimaryButton label="⚡ MEDIR MI AURA GRATIS" onPress={() => handleCta('example')} />

      {/* ── Funciones secundarias -- compactas, sin competir visualmente
          con los 4 mensajes principales de arriba (chips chicos, sin
          Card ni emoji propio). */}
      <View style={styles.secondary}>
        <Text style={styles.secondaryTitle}>Y TAMBIÉN</Text>
        <View style={styles.chipRow}>
          {SECONDARY_FEATURES.map((label) => (
            <View key={label} style={styles.chip}>
              <Text style={styles.chipText}>{label}</Text>
            </View>
          ))}
        </View>
      </View>

      <Text style={styles.footnote}>Solo pedimos una cuenta gratis para guardar tu resultado y competir.</Text>
    </ScreenContainer>
  );
}

const SECONDARY_FEATURES = [
  'XP y niveles',
  'Coins',
  'Misiones diarias',
  'Rachas',
  'Follow',
  'Regalos',
  'Tienda',
  'Invitar amigos',
];

function FeatureCard({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <Card style={styles.featureCard}>
      <Text style={styles.featureEmoji}>{emoji}</Text>
      <View style={styles.featureText}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureBody}>{body}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingTop: spacing.lg,
  },
  hero: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  wordmark: {
    ...typography.eyebrow,
    color: colors.secondary,
    marginBottom: spacing.md,
  },
  headline: {
    ...typography.hero,
    fontSize: 34,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  headlineAccent: {
    color: colors.accent,
  },
  subheadline: {
    ...typography.title,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  free: {
    color: colors.accent,
    fontWeight: '800',
  },
  pitch: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  heroCta: {
    width: '100%',
    marginTop: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
  },
  trustRow: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  features: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  featureEmoji: {
    fontSize: 28,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  featureBody: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  flowLine: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    fontWeight: '700',
    marginBottom: spacing.lg,
  },
  exampleCard: {
    alignItems: 'center',
    borderColor: colors.accent,
    marginBottom: spacing.md,
  },
  exampleTag: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  exampleScore: {
    ...typography.display,
    color: colors.accent,
  },
  exampleCaption: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  secondary: {
    marginTop: spacing.xxl,
    marginBottom: spacing.lg,
  },
  secondaryTitle: {
    ...typography.eyebrow,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  chipText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
});
