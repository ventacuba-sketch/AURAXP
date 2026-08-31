import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '../components/Card';
import { DailyScanCounter } from '../components/DailyScanCounter';
import { InstallPrompt } from '../components/InstallPrompt';
import { PrimaryButton } from '../components/PrimaryButton';
import { ReplayPlaceholder } from '../components/ReplayPlaceholder';
import { ScreenContainer } from '../components/ScreenContainer';
import { XPBar } from '../components/XPBar';
import { useAsyncData } from '../hooks/useAsyncData';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useLatestChallengeResult } from '../hooks/useLatestChallengeResult';
import { useMyTurnChallengeCount } from '../hooks/useMyTurnChallengeCount';
import { useReceivedChallengeCount } from '../hooks/useReceivedChallengeCount';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useUnreadNotificationCount } from '../hooks/useUnreadNotificationCount';
import { fetchLatestReplay } from '../services/api';
import { fetchFrequentRivals, fetchMyStreak, FrequentRival, StreakInfo } from '../services/statsService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { formatSignedXP, formatXP } from '../utils/format';

const RESULT_EVENT_COPY: Record<'won' | 'lost' | 'tie', (rival: string) => string> = {
  won: (rival) => `🏆 Le ganaste a @${rival}`,
  lost: (rival) => `💀 @${rival} te ganó`,
  tie: (rival) => `🤝 Empataste con @${rival}`,
};

/**
 * Home ADAPTATIVA (J) -- prioriza en este orden y muestra solo lo que
 * tiene datos reales, no todo siempre:
 * 1. Banner de acción urgente: un Challenge DIRIGIDO recibido pesa más
 *    que uno que ya acepté y me falta escanear (alguien más está
 *    esperando mi respuesta, no solo mi Scan) -- se muestra COMO MUCHO
 *    uno de los dos, nunca ambos apilados.
 * 2. Scan (siempre -- es el loop central).
 * 3. Un solo bloque "adaptativo" extra: racha (si ya lleva 2+ días,
 *    una racha de 1 día no es interesante todavía) o si no, el rival más
 *    frecuente (si existe) -- nunca los dos a la vez, para no saturar.
 * 4. Progreso/XP y Replay, igual que antes.
 * El resultado más reciente sigue como una línea de texto chica (no un
 * bloque completo) debajo del contador de Scans -- barato, no compite por
 * espacio con lo de arriba.
 */
export default function HomeScreen() {
  const { user } = useCurrentUser();
  const { data: latestReplay } = useAsyncData(fetchLatestReplay);
  const { data: streak } = useAsyncData<StreakInfo | null>(fetchMyStreak);
  const { data: frequentRivals } = useAsyncData<FrequentRival[]>(() => fetchFrequentRivals(1));
  const myTurnCount = useMyTurnChallengeCount();
  const receivedCount = useReceivedChallengeCount();
  const latestResult = useLatestChallengeResult();
  const unreadCount = useUnreadNotificationCount();
  const navigation = useRootNavigation();

  const topRival = frequentRivals?.[0] ?? null;
  const showStreak = (streak?.currentStreak ?? 0) >= 2;
  const showFrequentRival = !showStreak && Boolean(topRival);

  return (
    <>
      {/* R5: se auto-evalúa cada vez que Home recupera foco -- "volver a
          Home después de demostrar valor" (Scan completado) es el
          checkpoint elegido, ver installService.shouldShowInstallInvite.
          Usa Modal (portal), así que no importa dónde vive en este árbol. */}
      <InstallPrompt />
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

      {receivedCount != null && receivedCount > 0 ? (
        <Pressable onPress={() => navigation.navigate('MyChallenges')}>
          <Card style={styles.urgentCard}>
            <Text style={styles.urgentText}>
              ⚔️ Te desafiaron -- tenés {receivedCount} respuesta{receivedCount === 1 ? '' : 's'} pendiente{receivedCount === 1 ? '' : 's'}
            </Text>
            <Text style={styles.urgentArrow}>Responder ›</Text>
          </Card>
        </Pressable>
      ) : (
        myTurnCount != null &&
        myTurnCount > 0 && (
          <Pressable onPress={() => navigation.navigate('MyChallenges')}>
            <Card style={styles.urgentCard}>
              <Text style={styles.urgentText}>
                ⚔️ Tenés {myTurnCount} desafío{myTurnCount === 1 ? '' : 's'} esperando tu Scan
              </Text>
              <Text style={styles.urgentArrow}>Continuar ›</Text>
            </Card>
          </Pressable>
        )
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

      {showStreak && streak && (
        <Card style={styles.streakCard}>
          <Text style={styles.streakText}>🔥 Racha de Aura: {streak.currentStreak} días</Text>
        </Card>
      )}

      {showFrequentRival && topRival && (
        <Pressable onPress={() => navigation.navigate('PublicProfile', { username: topRival.username })}>
          <Card style={styles.rivalCard}>
            <Text style={styles.rivalAvatar}>{topRival.avatarEmoji}</Text>
            <View style={styles.rivalInfo}>
              <Text style={styles.rivalName}>@{topRival.username}</Text>
              <Text style={styles.rivalScore}>
                {topRival.myWins}–{topRival.rivalWins}
                {topRival.ties > 0 ? `–${topRival.ties}` : ''} entre ustedes
              </Text>
            </View>
            <PrimaryButton
              label="DESAFIAR"
              variant="ghost"
              onPress={() => navigation.navigate('PublicProfile', { username: topRival.username })}
            />
          </Card>
        </Pressable>
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
    </>
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
  streakCard: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    borderColor: colors.secondary,
  },
  streakText: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  rivalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  rivalAvatar: {
    fontSize: 32,
  },
  rivalInfo: {
    flex: 1,
  },
  rivalName: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  rivalScore: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
