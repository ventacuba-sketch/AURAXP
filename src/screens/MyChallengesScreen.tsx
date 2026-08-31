import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useSmartBack } from '../hooks/useSmartBack';
import {
  CHALLENGE_LIST_PAGE_SIZE,
  cancelChallenge,
  challengeShareUrl,
  createChallenge,
  listMyChallenges,
} from '../services/challengeService';
import { colors, spacing, typography } from '../theme/colors';
import { ChallengeListItem } from '../types';
import { formatRelativeTime, formatSignedXP } from '../utils/format';
import { copyLink, shareText } from '../utils/share';

/**
 * "MIS DESAFÍOS ⚔️" -- historial completo de Challenges del usuario,
 * paginado. Consulta la MISMA tabla `challenges` que ya usa el Challenge
 * real (ver challengeService.listMyChallenges) -- nada de esto duplica esa
 * tabla ni su RLS. Toda acción de acá reutiliza los flujos reales
 * existentes (createChallenge, cancelChallenge, ChallengeScreen para el
 * detalle completo) -- ver comentarios por acción abajo.
 */
export default function MyChallengesScreen() {
  const navigation = useRootNavigation();
  const goBack = useSmartBack();
  const { user } = useCurrentUser();

  const [items, setItems] = useState<ChallengeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadFirstPage = useCallback(() => {
    setLoading(true);
    listMyChallenges(0, CHALLENGE_LIST_PAGE_SIZE).then((page) => {
      setItems(page.items);
      setHasMore(page.hasMore);
      setLoading(false);
    });
  }, []);

  // Refresca cada vez que se vuelve a esta pantalla -- volver de cancelar,
  // de hacer el Scan de un desafío aceptado, o de ver el resultado de uno
  // recién completado siempre debe reflejarse acá sin un pull-to-refresh
  // manual.
  useFocusEffect(loadFirstPage);

  function handleLoadMore() {
    setLoadingMore(true);
    listMyChallenges(items.length, CHALLENGE_LIST_PAGE_SIZE).then((page) => {
      setItems((prev) => [...prev, ...page.items]);
      setHasMore(page.hasMore);
      setLoadingMore(false);
    });
  }

  function openChallenge(item: ChallengeListItem) {
    // Reutiliza ChallengeScreen tal cual para CUALQUIER estado -- ya sabe
    // renderizar pending/accepted/completed/cancelled/expired con polling,
    // reintentos y todo. Cero lógica de Challenge duplicada acá.
    navigation.navigate('Challenge', { challengeToken: item.shareToken });
  }

  async function handleShareAgain(item: ChallengeListItem) {
    if (!user) return;
    setBusyId(item.id);
    try {
      const result = await shareText(
        `${user.username} te desafía en AURA VS ⚔️ ¿Tienes más Aura?`,
        challengeShareUrl(item.shareToken),
      );
      if (result === 'copied') setNotice('Enlace copiado');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCopyLink(item: ChallengeListItem) {
    const ok = await copyLink(challengeShareUrl(item.shareToken));
    setNotice(ok ? 'Enlace copiado' : 'No pudimos copiar el enlace.');
  }

  async function handleCancel(item: ChallengeListItem) {
    setBusyId(item.id);
    const ok = await cancelChallenge(item.id);
    setBusyId(null);
    if (ok) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: 'cancelled' } : i)));
    } else {
      setNotice('No se pudo cancelar (¿ya lo aceptaron?).');
      loadFirstPage();
    }
  }

  async function handleRematch(item: ChallengeListItem) {
    if (!item.myScanId) return;
    setBusyId(item.id);
    try {
      const newToken = await createChallenge(item.myScanId);
      navigation.navigate('Challenge', { challengeToken: newToken });
    } catch (e) {
      console.warn('rematch createChallenge failed', e);
      setNotice('No pudimos crear la revancha.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScreenContainer scroll onBack={goBack}>
      <Text style={styles.title}>MIS DESAFÍOS ⚔️</Text>

      {notice && <Text style={styles.notice}>{notice}</Text>}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Todavía no tienes desafíos.</Text>
          <Text style={styles.emptySubtext}>Desafía a un amigo desde tu próximo Scan.</Text>
          <PrimaryButton label="ESCANEAR MI AURA" onPress={() => navigation.navigate('Upload')} />
        </View>
      ) : (
        <>
          <View style={styles.list}>
            {items.map((item) => (
              <ChallengeRow
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onOpen={() => openChallenge(item)}
                onShareAgain={() => handleShareAgain(item)}
                onCopyLink={() => handleCopyLink(item)}
                onCancel={() => handleCancel(item)}
                onRematch={() => handleRematch(item)}
              />
            ))}
          </View>

          {hasMore && (
            <PrimaryButton
              label={loadingMore ? 'CARGANDO...' : 'CARGAR MÁS'}
              variant="ghost"
              disabled={loadingMore}
              onPress={handleLoadMore}
            />
          )}
        </>
      )}
    </ScreenContainer>
  );
}

const STATE_LABEL: Record<ChallengeListItem['status'], string> = {
  pending: 'Esperando rival',
  accepted: 'Esperando resultado',
  completed: 'Completado',
  cancelled: 'Cancelado',
  expired: 'Expirado',
};

function resultLine(item: ChallengeListItem, myUserId: string | undefined): string | null {
  if (item.status !== 'completed') return null;
  if (item.isTie) return '🤝 EMPATE';
  if (myUserId && item.winnerUserId === myUserId) return '🏆 GANASTE';
  return '💀 PERDISTE';
}

function ChallengeRow({
  item,
  busy,
  onOpen,
  onShareAgain,
  onCopyLink,
  onCancel,
  onRematch,
}: {
  item: ChallengeListItem;
  busy: boolean;
  onOpen: () => void;
  onShareAgain: () => void;
  onCopyLink: () => void;
  onCancel: () => void;
  onRematch: () => void;
}) {
  const { user } = useCurrentUser();
  // Mi turno de verdad: acepté el desafío pero todavía no subí mi Scan --
  // mismo criterio que challengeService.countMyTurnChallenges (ver Home).
  const myTurn = item.status === 'accepted' && !item.isCreator && !item.myScanId;
  const result = resultLine(item, user?.id);

  return (
    <Card style={styles.row}>
      <Pressable onPress={onOpen} style={styles.rowHeader}>
        <Text style={styles.rivalAvatar}>{item.rival?.avatarEmoji ?? '⏳'}</Text>
        <View style={styles.rowHeaderInfo}>
          <Text style={styles.rivalName}>{item.rival ? `@${item.rival.username}` : 'Sin rival todavía'}</Text>
          <Text style={styles.date}>{formatRelativeTime(item.createdAt)}</Text>
        </View>
        <Text style={styles.stateLabel}>{myTurn ? 'Tu turno de escanear' : STATE_LABEL[item.status]}</Text>
      </Pressable>

      {(item.myAuraScore != null || item.rivalAuraScore != null) && (
        <View style={styles.scoreRow}>
          <Text style={styles.myScore}>{item.myAuraScore != null ? formatSignedXP(item.myAuraScore) : '···'}</Text>
          <Text style={styles.vsLabel}>VS</Text>
          <Text style={styles.rivalScore}>{item.rivalAuraScore != null ? formatSignedXP(item.rivalAuraScore) : '···'}</Text>
        </View>
      )}

      {result && <Text style={styles.resultLine}>{result}</Text>}
      {item.myXpAwarded != null && item.myXpAwarded > 0 && (
        <Text style={styles.xpLine}>+{item.myXpAwarded} XP de este desafío</Text>
      )}

      <View style={styles.actions}>
        {item.status === 'pending' && (
          <>
            <RowAction label={busy ? '...' : 'COMPARTIR'} disabled={busy} onPress={onShareAgain} />
            <RowAction label="COPIAR LINK" disabled={busy} onPress={onCopyLink} />
            <RowAction label="CANCELAR" disabled={busy} tone="danger" onPress={onCancel} />
          </>
        )}
        {myTurn && <RowAction label="CONTINUAR DESAFÍO" tone="accent" onPress={onOpen} />}
        {item.status === 'accepted' && !myTurn && <RowAction label="VER ESTADO" onPress={onOpen} />}
        {item.status === 'completed' && (
          <>
            <RowAction label="VER BATALLA" tone="accent" onPress={onOpen} />
            <RowAction label={busy ? '...' : 'REVANCHA'} disabled={busy} onPress={onRematch} />
          </>
        )}
        {(item.status === 'cancelled' || item.status === 'expired') && <RowAction label="VER" onPress={onOpen} />}
      </View>
    </Card>
  );
}

function RowAction({
  label,
  onPress,
  disabled,
  tone,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'accent' | 'danger';
}) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} hitSlop={6} style={styles.rowAction}>
      <Text
        style={[
          styles.rowActionText,
          tone === 'accent' && styles.rowActionAccent,
          tone === 'danger' && styles.rowActionDanger,
          disabled && styles.rowActionDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
  },
  notice: {
    ...typography.caption,
    color: colors.success,
    marginBottom: spacing.md,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xxl,
  },
  empty: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  emptyText: {
    ...typography.subtitle,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptySubtext: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  list: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  row: {
    gap: spacing.sm,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rivalAvatar: {
    fontSize: 28,
  },
  rowHeaderInfo: {
    flex: 1,
  },
  rivalName: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  date: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  stateLabel: {
    ...typography.caption,
    color: colors.secondary,
    textAlign: 'right',
    maxWidth: 110,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  myScore: {
    ...typography.title,
    color: colors.accent,
  },
  vsLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '800',
  },
  rivalScore: {
    ...typography.title,
    color: colors.secondary,
  },
  resultLine: {
    ...typography.subtitle,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  xpLine: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  rowAction: {
    paddingVertical: spacing.xs,
  },
  rowActionText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  rowActionAccent: {
    color: colors.accent,
  },
  rowActionDanger: {
    color: colors.danger,
  },
  rowActionDisabled: {
    opacity: 0.4,
  },
});
