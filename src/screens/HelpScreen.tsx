import React, { useEffect } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useSmartBack } from '../hooks/useSmartBack';
import { logEvent } from '../services/analyticsService';
import { colors, spacing, typography } from '../theme/colors';

const SUPPORT_EMAIL = 'soporte@auravs.app';

const FAQ: { q: string; a: string }[] = [
  {
    q: '¿Qué es Aura?',
    // Punto 18 (auditoría post-iPhone): "puntaje real" sonaba a que la IA
    // mide algo objetivo/verdadero sobre la persona -- nunca fue la
    // intención (ver _shared/scoring.ts: es una fórmula social/de
    // entretenimiento, no una medición seria). Mismo tono divertido, sin
    // esa afirmación.
    a: 'Tu puntuación de Aura, calculada por IA a partir de un video corto: presencia, actitud y energía.',
  },
  { q: '¿Cómo funciona XP?', a: 'Ganas XP por cada Scan y por Challenges completados -- sube tu nivel y tu posición en el ranking.' },
  {
    q: '¿Cómo funcionan los Coins?',
    a: 'Una moneda propia de AURA VS para la tienda (cosméticos, efectos, regalos) -- nunca compran Aura, XP ni victorias.',
  },
  {
    q: '¿Qué puedo comprar con Coins?',
    a: 'Consumibles, efectos visuales, cosméticos para tu perfil (marcos, insignias) y regalos para mandarle a otros usuarios.',
  },
  {
    q: '¿Qué NO puedo comprar con Coins?',
    a: 'Nunca Aura, XP, votos, victorias ni ninguna ventaja competitiva. Los Coins son 100% cosméticos/sociales.',
  },
  {
    q: '¿Cómo funcionan las misiones diarias?',
    a: 'Cada día puedes reclamar Coins por hacer un Scan, completar un Challenge y compartir un resultado -- hasta ~400 Coins/día. Se reinician a la medianoche (UTC).',
  },
  {
    q: '¿Cómo funcionan los referidos?',
    a: 'Comparte tu código desde "Invitar amigos". Cuando la persona invitada completa su primer Scan, tú ganas 5.000 Coins y ella 2.500 -- nunca por solo registrarse.',
  },
  {
    q: '¿Cómo funcionan los Challenges?',
    a: 'Desafía a un amigo (por link o directo desde su perfil) -- cuando ambos escanean, se compara el resultado y hay un ganador.',
  },
  {
    q: '¿Qué es PRO?',
    a: 'Una suscripción con beneficios extra, incluyendo un bono mensual de Coins -- se administra desde tu perfil, es independiente de la economía normal de Coins.',
  },
  { q: '¿Cómo instalo AURA VS en mi teléfono?', a: 'Desde Perfil, toca "Instalar AURA VS" y sigue la guía según tu dispositivo.' },
  {
    q: 'Privacidad',
    a: 'Tu email, plan y videos son privados. Lo único público de tu perfil es username, avatar, nivel, XP y tus stats de Challenge.',
  },
];

/** FAQ/Ayuda (bloque soporte) -- contenido estático, sin datos de
 * usuario. Accesible desde Perfil. */
export default function HelpScreen() {
  const goBack = useSmartBack();
  const navigation = useRootNavigation();

  useEffect(() => {
    logEvent('help_opened');
  }, []);

  return (
    <ScreenContainer scroll onBack={goBack}>
      <Text style={styles.title}>AYUDA</Text>

      {FAQ.map((item) => (
        <View key={item.q} style={styles.item}>
          <Text style={styles.question}>{item.q}</Text>
          <Text style={styles.answer}>{item.a}</Text>
        </View>
      ))}

      <Text style={styles.sectionTitle}>¿NO ENCONTRASTE LO QUE BUSCABAS?</Text>
      <PrimaryButton label="REPORTAR UN PROBLEMA" onPress={() => navigation.navigate('BugReport')} />
      <Pressable onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} style={styles.emailRow}>
        <Text style={styles.emailText}>{SUPPORT_EMAIL}</Text>
      </Pressable>
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
  item: {
    marginBottom: spacing.lg,
  },
  question: {
    ...typography.subtitle,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  answer: {
    ...typography.body,
    color: colors.textSecondary,
  },
  sectionTitle: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  emailRow: {
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  emailText: {
    ...typography.body,
    color: colors.accent,
  },
});
