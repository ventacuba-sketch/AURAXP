import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { DailyScanCounter } from '../components/DailyScanCounter';
import { PrimaryButton } from '../components/PrimaryButton';
import { ReplayPlaceholder } from '../components/ReplayPlaceholder';
import { ScreenContainer } from '../components/ScreenContainer';
import { XPBar } from '../components/XPBar';
import { useAsyncData } from '../hooks/useAsyncData';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useLatestChallengeResult } from '../hooks/useLatestChallengeResult';
import { useMyTurnChallengeCount } from '../hooks/useMyTurnChallengeCount';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useUnreadNotificationCount } from '../hooks/useUnreadNotificationCount';
import { fetchLatestReplay } from '../services/api';
import { colors, radius, spacing, typography } from '../theme/colors';
import { formatSignedXP, formatXP } from '../utils/format';

const RESULT_EVENT_COPY: Record<'won' | 'lost' | 'tie', (rival: string) => string> = {
  won: (rival) => `🏆 Le ganaste a @${rival}`,
  lost: (rival) => `💀 @${rival} te ganó`,
  tie: (rival) => `🤝 Empataste con @${rival}`,
};

/**
 * Orden de la pantalla (auditado a pedido explícito -- ver reporte de esta
 * tarea): Challenge que requiere UNA ACCIÓN MÍA primero (si existe de
 * verdad), después Scan, después la notificación de resultado más
 * reciente, después progreso/XP, después Replay/compartir. Sin esto
 * pendiente, el orden vuelve al de siempre (Scan primero) -- no se
 * reordena la pantalla entera solo para mostrar una card vacía arriba.
 */
export default function HomeScreen() {
  const { user } = useCurrentUser();
  const { data: latestReplay } = useAsyncData(fetchLatestReplay);
  const myTurnCount = useMyTurnChallengeCount();
  const latestResult = useLatestChallengeResult();
  const unreadCount = useUnreadNotificationCount();
  const navigation = useRootNavigation();

  return (
    <ScreenContainer scroll>
      <View style={styles.topRow}>
        <Text style={styles.wordmark}>AURAXP</Text>
        <Pressable onPress={() => navigation.navigate('Notifications')} style={styles.bellButton} hitSlop={8}>
          <Text style={styles.bellIcon}>🔔</Text>
          {unreadCount > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
            </View>
          )}
        </Pressable>
      </View>

      {myTurnCount != null && myTurnCount > 0 && (
        <Pressable onPress={() => navigation.navigate('MyChallenges')}>
          <Card style={styles.urgentCard}>
            <Text style={styles.urgentText}>
              ⚔️ Tenés {myTurnCount} desafío{myTurnCount === 1 ? '' : 's'} esperando tu Scan
            </Text>
            <Text style={styles.urgentArrow}>Continuar ›</Text>
          </Card>
        </Pressable>
      )}

      <View style={styles.hero}>
        <Text style={styles.headline}>¿CUÁNTA AURA TIENES?</Text>
        <Text style={styles.heroSubtitle}>
          Sube un momento. AURAXP te dice dónde ganaste o perdiste Aura.
        </Text>
        <PrimaryButton label="ESCANEAR MI AURA" onPress={() => navigation.navigate('Upload')} />
      </View>

      <DailyScanCounter />

      {/* Notificación in-app mínima (I) -- el último resultado real,
          derivado de `challenges` sin tabla nueva (ver
          useLatestChallengeResult) -- distinta de la bandeja completa
          (🔔), esta es solo el resultado más reciente sin necesitar abrirla. */}
      {latestResult && (
        <Text style={styles.latestResultText}>
          {RESULT_EVENT_COPY[latestResult.kind](latestResult.rivalUsername)}
        </Text>
      )}

      {/* Reemplaza la card "Carlos te desafió" que era mock puro (ningún
          dato real detrás, y su botón ACEPTAR ni siquiera llevaba a un
          Challenge real -- ver auditoría original). Esta sí consulta
          Challenges de verdad. */}
      <Pressable onPress={() => navigation.navigate('MyChallenges')}>
        <Card style={styles.myChallengesCard}>
          <View style={styles.myChallengesRow}>
            <Text style={styles.myChallengesTitle}>MIS DESAFÍOS ⚔️</Text>
            <Text style={styles.myChallengesArrow}>›</Text>
          </View>
        </Card>
      </Pressable>

      <View style={styles.auraSection}>
        <Text style={styles.eyebrow}>TU AURA</Text>
        <Text style={styles.auraScore}>{user ? formatXP(user.xp) : '—'}</Text>
        <XPBar xp={user?.xp ?? 0} xpToNextLevel={user?.xpToNextLevel ?? 1} level={user?.level ?? 1} />
      </View>

      {latestReplay && (
        <Card style={styles.replayCard}>
          <Text style={styles.eyebrow}>ÚLTIMO REPLAY</Text>
          <View style={styles.replayRow}>
            <ReplayPlaceholder size="sm" />
            <View style={styles.replayInfo}>
              <Text style={styles.replayXP}>{formatSignedXP(latestReplay.xpDelta)} AURA</Text>
              <Text style={styles.replayLabel}>{latestReplay.momentLabel}</Text>
              <Text style={styles.replayTimestamp}>{latestReplay.timestamp}</Text>
            </View>
          </View>
          <PrimaryButton
            label="Ver replay"
            variant="text"
            onPress={() => navigation.navigate('ScanResult', { scanId: latestReplay.id })}
          />
        </Card>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  wordmark: {
    ...typography.title,
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  bellButton: {
    padding: spacing.xs,
  },
  bellIcon: {
    fontSize: 22,
  },
  bellBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  bellBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  urgentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    borderColor: colors.accent,
  },
  urgentText: {
    ...typography.subtitle,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  urgentArrow: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '800',
  },
  latestResultText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  hero: {
    marginBottom: spacing.xl,
  },
  headline: {
    ...typography.hero,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  heroSubtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  auraSection: {
    marginBottom: spacing.xl,
  },
  eyebrow: {
    ...typography.eyebrow,
    color: colors.secondary,
    marginBottom: spacing.xs,
  },
  auraScore: {
    ...typography.display,
    color: colors.accent,
    marginBottom: spacing.md,
  },
  replayCard: {
    marginBottom: spacing.md,
  },
  replayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  replayInfo: {
    marginLeft: spacing.md,
    flex: 1,
  },
  replayXP: {
    ...typography.subtitle,
    color: colors.accent,
  },
  replayLabel: {
    ...typography.body,
    color: colors.textPrimary,
    marginTop: 2,
  },
  replayTimestamp: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  myChallengesCard: {
    marginBottom: spacing.xl,
    borderColor: colors.secondary,
  },
  myChallengesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  myChallengesTitle: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  myChallengesArrow: {
    ...typography.title,
    color: colors.textMuted,
  },
});
