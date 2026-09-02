import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { useSmartBack } from '../hooks/useSmartBack';
import { logEvent } from '../services/analyticsService';
import {
  buildChallengeResultShare,
  CHALLENGE_LIST_PAGE_SIZE,
  cancelChallenge,
  challengeShareUrl,
  ChallengeListFilter,
  listMyChallenges,
  respondDirectChallenge,
} from '../services/challengeService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { ChallengeListItem } from '../types';
import { formatRelativeTime, formatSignedXP } from '../utils/format';
import { copyLink, shareImage, shareText } from '../utils/share';
import { generateChallengeShareCardBlob } from '../utils/shareCard';

const TABS: { key: ChallengeListFilter; label: string }[] = [
  { key: 'received', label: 'RECIBIDOS' },
  { key: 'sent', label: 'ENVIADOS' },
  { key: 'completed', label: 'COMPLETADOS' },
];

const EMPTY_COPY: Record<ChallengeListFilter, string> = {
  received: 'Nadie te desafió todavía.',
  sent: 'No tienes desafíos esperando respuesta.',
  completed: 'Todavía no completaste ningún desafío.',
  all: 'Todavía no tienes desafíos.',
};

/**
 * "MIS DESAFÍOS ⚔️" -- inbox de Challenges del usuario, con 3 pestañas
 * (RECIBIDOS/ENVIADOS/COMPLETADOS -- item B) cada una con su propia
 * paginación (ver challengeService.listMyChallenges). Consulta la MISMA
 * tabla `challenges` que ya usa el Challenge real -- nada de esto duplica
 * esa tabla ni su RLS. Toda acción de acá reutiliza los flujos reales
 * existentes (createChallenge, cancelChallenge, respondDirectChallenge,
 * ChallengeScreen para el detalle completo) -- ver comentarios por acción
 * abajo.
 */
export default function MyChallengesScreen() {
  const navigation = useRootNavigation();
  const goBack = useSmartBack();
  const { user } = useCurrentUser();

  const [tab, setTab] = useState<ChallengeListFilter>('received');
  const [items, setItems] = useState<ChallengeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadFirstPage = useCallback(() => {
    setLoading(true);
    listMyChallenges(0, CHALLENGE_LIST_PAGE_SIZE, tab).then((page) => {
      setItems(page.items);
      setHasMore(page.hasMore);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Refresca cada vez que se vuelve a esta pantalla (volver de cancelar,
  // de aceptar/rechazar, de hacer el Scan de un desafío aceptado, o de
  // ver un resultado recién completado) Y cada vez que se cambia de
  // pestaña -- ambos casos deben resetear la paginación desde offset 0.
  useFocusEffect(loadFirstPage);

  function handleLoadMore() {
    setLoadingMore(true);
    listMyChallenges(items.length, CHALLENGE_LIST_PAGE_SIZE, tab).then((page) => {
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

  // ACEPTAR/RECHAZAR un Challenge dirigido (A/C) -- vía
  // respondDirectChallenge, que hace cumplir server-side que solo YO (el
  // target) puedo responder. Aceptar deja el Challenge en 'accepted' --
  // openChallenge() de acá abajo, o la siguiente visita a la pestaña
  // ENVIADOS/pendientes, ya lo muestra igual que cualquier otro aceptado.
  async function handleAccept(item: ChallengeListItem) {
    setBusyId(item.id);
    const result = await respondDirectChallenge(item.id, true);
    setBusyId(null);
    if (result.ok) {
      openChallenge(item);
    } else {
      setNotice('No pudimos aceptar el desafío. Puede que ya haya expirado.');
      loadFirstPage();
    }
  }

  async function handleReject(item: ChallengeListItem) {
    setBusyId(item.id);
    const result = await respondDirectChallenge(item.id, false);
    setBusyId(null);
    if (result.ok) {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } else {
      setNotice('No pudimos rechazar el desafío.');
      loadFirstPage();
    }
  }

  // CORRECCIÓN (auditoría post-iPhone, punto 9): ver la misma corrección
  // en ChallengeScreen.handleRematch -- ya no reusa `item.myScanId` (el
  // scan de la batalla anterior), exige un Scan nuevo antes de crear el
  // Challenge.
  function handleRematch(item: ChallengeListItem) {
    if (!item.rival?.username) return;
    navigation.navigate('Upload', { rematchTargetUsername: item.rival.username });
  }

  // COMPARTIR RESULTADO de un Challenge completado -- mismo generador de
  // texto+card que usa ChallengeScreen (buildChallengeResultShare +
  // generateChallengeShareCardBlob), nunca una segunda versión del texto.
  async function handleShareResult(item: ChallengeListItem) {
    if (!user || !item.rival) return;
    const iWon = item.winnerUserId === user.id;
    const { text, card } = buildChallengeResultShare({
      meUsername: user.username,
      meAvatarEmoji: user.avatarEmoji,
      meScore: item.myAuraScore ?? 0,
      rivalUsername: item.rival.username,
      rivalAvatarEmoji: item.rival.avatarEmoji,
      rivalScore: item.rivalAuraScore ?? 0,
      isTie: item.isTie,
      iWon,
    });

    setBusyId(item.id);
    try {
      logEvent('result_shared');
      const blob = await generateChallengeShareCardBlob(card);
      const result = await shareImage(blob, `aura-vs-${item.shareToken}.png`, text, challengeShareUrl(item.shareToken));
      if (result === 'copied') setNotice('Enlace copiado');
      else if (result === 'downloaded') setNotice('Imagen descargada y enlace copiado');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScreenContainer scroll onBack={goBack}>
      <Text style={styles.title}>MIS DESAFÍOS ⚔️</Text>

      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {notice && <Text style={styles.notice}>{notice}</Text>}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{EMPTY_COPY[tab]}</Text>
          {tab !== 'received' && (
            <>
              <Text style={styles.emptySubtext}>Desafía a un amigo desde tu próximo Scan.</Text>
              <PrimaryButton label="ESCANEAR MI AURA" onPress={() => navigation.navigate('Upload')} />
            </>
          )}
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
                onShareResult={() => handleShareResult(item)}
                onAccept={() => handleAccept(item)}
                onReject={() => handleReject(item)}
                onOpenRivalProfile={() => item.rival && navigation.navigate('PublicProfile', { username: item.rival.username })}
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
  rejected: 'Rechazado',
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
  onShareResult,
  onAccept,
  onReject,
  onOpenRivalProfile,
}: {
  item: ChallengeListItem;
  busy: boolean;
  onOpen: () => void;
  onShareAgain: () => void;
  onCopyLink: () => void;
  onCancel: () => void;
  onRematch: () => void;
  onShareResult: () => void;
  onAccept: () => void;
  onReject: () => void;
  onOpenRivalProfile: () => void;
}) {
  const { user } = useCurrentUser();
  // Mi turno de verdad: acepté el desafío pero todavía no subí mi Scan --
  // mismo criterio que challengeService.countMyTurnChallenges (ver Home).
  const myTurn = item.status === 'accepted' && !item.isCreator && !item.myScanId;
  // Recibí este Challenge DIRIGIDO y todavía no respondí (A/C) -- distinto
  // de un pending clásico por link, que nadie tomó todavía.
  const awaitingMyResponse = item.status === 'pending' && item.isDirectedToMe;
  const result = resultLine(item, user?.id);

  return (
    <Card style={styles.row}>
      <View style={styles.rowHeader}>
        {/* Pressable ANIDADO a propósito -- tocar el avatar/nombre va al
            perfil público del rival, tocar el resto de la fila (fecha,
            estado, espacio vacío) abre el Challenge como antes. RN
            resuelve el toque al Pressable más interno, así que ambos
            conviven sin interferirse. */}
        <Pressable onPress={onOpenRivalProfile} style={styles.rowHeaderIdentity} disabled={!item.rival}>
          <Text style={styles.rivalAvatar}>{item.rival?.avatarEmoji ?? '⏳'}</Text>
          <View style={styles.rowHeaderInfo}>
            <Text style={styles.rivalName}>{item.rival ? `@${item.rival.username}` : 'Sin rival todavía'}</Text>
            <Text style={styles.date}>{formatRelativeTime(item.createdAt)}</Text>
          </View>
        </Pressable>
        <Pressable onPress={onOpen} style={styles.rowHeaderState} hitSlop={6}>
          <Text style={styles.stateLabel}>
            {awaitingMyResponse ? 'Te desafiaron' : myTurn ? 'Tu turno de escanear' : STATE_LABEL[item.status]}
          </Text>
        </Pressable>
      </View>

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
        {awaitingMyResponse ? (
          // Me desafiaron DIRECTO -- solo yo puedo responder esto (lo hace
          // cumplir respond_direct_challenge server-side, no esta pantalla).
          <>
            <RowAction label={busy ? '...' : 'ACEPTAR'} disabled={busy} tone="accent" onPress={onAccept} />
            <RowAction label={busy ? '...' : 'RECHAZAR'} disabled={busy} tone="danger" onPress={onReject} />
          </>
        ) : (
          item.status === 'pending' &&
          item.isCreator && (
            <>
              <RowAction label={busy ? '...' : 'COMPARTIR'} disabled={busy} onPress={onShareAgain} />
              <RowAction label="COPIAR LINK" disabled={busy} onPress={onCopyLink} />
              <RowAction label="CANCELAR" disabled={busy} tone="danger" onPress={onCancel} />
            </>
          )
        )}
        {myTurn && <RowAction label="CONTINUAR DESAFÍO" tone="accent" onPress={onOpen} />}
        {item.status === 'accepted' && !myTurn && <RowAction label="VER ESTADO" onPress={onOpen} />}
        {item.status === 'completed' && (
          <>
            {/* VER BATALLA lleva al ChallengeScreen completo, que ya
                muestra REPLAY MÍO/REPLAY RIVAL con su propio player --
                no se duplica esa lógica acá en la lista. */}
            <RowAction label="VER BATALLA" tone="accent" onPress={onOpen} />
            <RowAction label={busy ? '...' : 'COMPARTIR RESULTADO'} disabled={busy} onPress={onShareResult} />
            <RowAction label={busy ? '...' : 'REVANCHA'} disabled={busy} onPress={onRematch} />
          </>
        )}
        {(item.status === 'cancelled' || item.status === 'expired' || item.status === 'rejected') && (
          <RowAction label="VER" onPress={onOpen} />
        )}
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
    marginBottom: spacing.md,
  },
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  tabActive: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  tabText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '800',
  },
  tabTextActive: {
    color: colors.accent,
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
  },
  rowHeaderIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  rowHeaderState: {
    paddingLeft: spacing.sm,
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
