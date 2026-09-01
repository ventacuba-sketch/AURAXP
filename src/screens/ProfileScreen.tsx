import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { DailyScanCounter } from '../components/DailyScanCounter';
import { InstallSheet } from '../components/InstallSheet';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { StatTile } from '../components/StatTile';
import { XPBar } from '../components/XPBar';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { signOut } from '../services/authService';
import { hasNativePrompt, isIOS, isStandalone, promptNativeInstall, requestInstallInvite } from '../services/installService';
import { clearPendingChallengeToken } from '../services/pendingChallenge';
import { disablePush, enablePush, getPermissionState, PushPermissionState } from '../services/pushService';
import { ProfileUpdateError, updateProfile, usernameCooldownDaysLeft } from '../services/profileService';
import { fetchDailyMissions, DailyMissions } from '../services/missionsService';
import { DailyScanStatus, fetchDailyScanStatus } from '../services/scanService';
import {
  ChallengeStats,
  fetchFrequentRivals,
  fetchMyChallengeStats,
  fetchMyStreak,
  FrequentRival,
  StreakInfo,
} from '../services/statsService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import {
  claimMissionReward,
  EquipSlot,
  fetchClaimedMissionsToday,
  fetchMyEquipped,
  fetchWallet,
  MISSION_COINS,
  MissionKey,
  PublicEquippedItem,
  Wallet,
} from '../services/walletService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { formatLevel, formatSignedXP } from '../utils/format';

// Foto de perfil real (imagen) queda para una tarea aparte -- por ahora el
// avatar sigue siendo un emoji, elegido de este set fijo.
const AVATAR_EMOJI_OPTIONS = [
  '🙂', '😎', '🔥', '🦋', '✨', '👾', '🐉', '🌈', '💀', '🎯', '🚀', '🍀',
];

export default function ProfileScreen() {
  const { user, refetch } = useCurrentUser();
  const navigation = useRootNavigation();
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatarEmoji, setAvatarEmoji] = useState('🙂');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Mismo dato real que ya usa DailyScanCounter (get-daily-scan-status) --
  // se reconsulta acá en vez de intentar compartir estado con ese
  // componente hermano, mismo patrón que useCurrentUser en varias
  // pantallas. Solo se usa `plan`, así que un fetch extra liviano es mejor
  // que acoplar dos componentes que hoy son independientes.
  const [planStatus, setPlanStatus] = useState<DailyScanStatus | null>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  // Perfil social mínimo (F) -- null mientras carga o sin sesión real;
  // ProfileScreen decide ocultar la sección entera en vez de mostrar ceros
  // que podrían confundirse con "0 Challenges jugados" real.
  const [challengeStats, setChallengeStats] = useState<ChallengeStats | null>(null);
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [topRival, setTopRival] = useState<FrequentRival | null>(null);
  const [missions, setMissions] = useState<DailyMissions | null>(null);
  // Coins/Wallet (bloque economía) -- saldo cacheado solo para mostrar acá;
  // el número real y auditable siempre es WalletScreen (historial completo).
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [claimedMissions, setClaimedMissions] = useState<Record<MissionKey, boolean>>({
    scan: false,
    challenge: false,
    share: false,
    streak: false,
  });
  const [claimingKey, setClaimingKey] = useState<MissionKey | null>(null);
  const [equippedBySlot, setEquippedBySlot] = useState<Partial<Record<EquipSlot, PublicEquippedItem>>>({});
  // Card fija "📲 Instalar AURAXP" (N) -- null si ya está instalada o no
  // hay ninguna acción real posible (nunca un botón muerto). Se recalcula
  // en cada foco: `beforeinstallprompt` puede llegar mientras el usuario
  // estaba en otra pantalla, y una instalación real (Ajustes del OS,
  // otra pestaña) puede haber pasado mientras tanto también.
  const [installVariant, setInstallVariant] = useState<'ios' | 'android' | null>(null);
  const [showInstallSheet, setShowInstallSheet] = useState(false);
  // Fila fija "NOTIFICACIONES" en AJUSTES (F) -- estado real del browser,
  // recalculado en cada foco por la misma razón que installVariant (el
  // permiso pudo cambiar desde el propio pre-prompt, o desde los ajustes
  // del sistema operativo mientras el usuario estaba en otra pantalla).
  const [pushState, setPushState] = useState<PushPermissionState>('unsupported');
  const [pushBusy, setPushBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (isStandalone()) {
        setInstallVariant(null);
      } else if (isIOS()) {
        setInstallVariant('ios');
      } else if (hasNativePrompt()) {
        setInstallVariant('android');
      } else {
        setInstallVariant(null);
      }
      setPushState(getPermissionState());
      // Checkpoint "profile_open" (A) -- de los checkpoints, el de menor
      // prioridad a propósito (el usuario ya está buscando algo puntual
      // acá, no es el mejor momento para una interrupción) -- la política
      // central ya lo trata igual que cualquier otro, solo se llama desde
      // más lugares para darle más oportunidades de aparecer en un
      // momento razonable sin mostrarse en todos a la vez (N2: esto es
      // independiente de la card fija de abajo, que no pasa por la
      // política -- son dos mecanismos complementarios).
      requestInstallInvite('profile_open');
      fetchDailyScanStatus().then((result) => {
        if (!cancelled && result) setPlanStatus(result);
      });
      fetchMyChallengeStats().then((result) => {
        if (!cancelled) setChallengeStats(result);
      });
      fetchMyStreak().then((result) => {
        if (!cancelled) setStreak(result);
      });
      fetchFrequentRivals(1).then((result) => {
        if (!cancelled) setTopRival(result[0] ?? null);
      });
      fetchDailyMissions().then((result) => {
        if (!cancelled) setMissions(result);
      });
      fetchWallet().then((result) => {
        if (!cancelled) setWallet(result);
      });
      fetchClaimedMissionsToday().then((result) => {
        if (!cancelled) setClaimedMissions(result);
      });
      fetchMyEquipped().then((result) => {
        if (cancelled) return;
        const bySlot: Partial<Record<EquipSlot, PublicEquippedItem>> = {};
        for (const item of result) bySlot[item.slot] = item;
        setEquippedBySlot(bySlot);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  /** Reclamar una misión (o la racha) -- re-valida todo server-side (ver
   * claim_mission_reward), esto solo dispara el RPC y refleja el resultado
   * real devuelto: nunca asume localmente cuántos Coins ganó. */
  async function handleClaimMission(key: MissionKey) {
    setClaimingKey(key);
    try {
      const result = await claimMissionReward(key);
      if (result.ok) {
        setClaimedMissions((prev) => ({ ...prev, [key]: true }));
        setWallet((prev) => (prev ? { balance: prev.balance + result.coinsAwarded } : prev));
      }
    } finally {
      setClaimingKey(null);
    }
  }

  // Reset the form to the current profile every time edit mode opens (not
  // on every render) so a discarded edit never leaks into the next one.
  useEffect(() => {
    if (editing && user) {
      setUsername(user.username);
      setBio(user.bio ?? '');
      setAvatarEmoji(user.avatarEmoji);
      setErrorMessage(null);
    }
  }, [editing, user]);

  const cooldownDaysLeft = usernameCooldownDaysLeft(user?.usernameUpdatedAt ?? null);
  const usernameLocked = cooldownDaysLeft > 0;

  /**
   * Cierra sesión de verdad -- ver auditoría de "Cerrar sesión":
   * - `signOut()` limpia la sesión real de Supabase (su propio storage);
   *   `onAuthStateChange` dispara solo, RootNavigator desmonta TODO el
   *   árbol autenticado y vuelve a `<Auth/>` -- ahí se pierde, por
   *   desmontaje normal de React, cualquier estado en memoria (user, XP,
   *   lo que sea) sin necesitar limpiarlo a mano acá.
   * - `clearPendingChallengeToken()` es el único estado que sobrevive en
   *   AsyncStorage por fuera de la sesión de Supabase -- sin esto, un
   *   token pendiente de una visita SIN cuenta de antes de este login
   *   quedaría para el próximo que use el mismo dispositivo (ver ese
   *   archivo para el detalle completo del riesgo A->B).
   * - NUNCA toca cuenta/XP/Challenges/Profile/PRO/Scans -- todo eso vive
   *   en el backend, cerrar sesión no borra ni modifica ninguna fila.
   */
  async function handleLogout() {
    setLoggingOut(true);
    try {
      await clearPendingChallengeToken();
      await signOut();
    } catch (e) {
      console.warn('signOut failed', e);
    } finally {
      setLoggingOut(false);
      setConfirmingLogout(false);
    }
  }

  // N: acceso fijo, independiente del recordatorio automático -- "quien
  // declinó al principio" (o nunca lo vio) puede volver más tarde a
  // buscarlo acá, sin depender de que aparezca un popup (N2).
  async function handleManualInstall() {
    if (installVariant === 'android') {
      await promptNativeInstall();
      setInstallVariant(hasNativePrompt() ? 'android' : null);
    } else {
      setShowInstallSheet(true);
    }
  }

  async function handleInstallSheetInstall() {
    await promptNativeInstall();
    setShowInstallSheet(false);
    setInstallVariant(hasNativePrompt() ? 'android' : null);
  }

  // F: toggle real de NOTIFICACIONES -- ACTIVAR pide el permiso nativo Y
  // se suscribe de verdad (ver pushService.enablePush); DESACTIVAR
  // desuscribe del browser Y revoca la fila server-side. Un 'denied' del
  // browser no tiene botón de "activar" acá -- solo el propio usuario
  // puede revertirlo desde los ajustes del sistema operativo, cualquier
  // botón nuestro ahí sería un botón que no puede hacer nada.
  async function handleTogglePush() {
    setPushBusy(true);
    try {
      if (pushState === 'granted') {
        await disablePush();
      } else if (pushState === 'default') {
        await enablePush();
      }
      setPushState(getPermissionState());
    } finally {
      setPushBusy(false);
    }
  }

  async function handleSave() {
    if (!username.trim()) {
      setErrorMessage('El username no puede estar vacío.');
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    try {
      await updateProfile({ username: username.trim(), avatarEmoji, bio: bio.trim() });
      refetch();
      setEditing(false);
    } catch (e) {
      setErrorMessage(e instanceof ProfileUpdateError ? e.message : 'No pudimos guardar los cambios.');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <ScreenContainer scroll style={styles.editContainer}>
        <Text style={styles.editTitle}>EDITAR PERFIL</Text>

        <Text style={styles.label}>AVATAR</Text>
        <View style={styles.emojiGrid}>
          {AVATAR_EMOJI_OPTIONS.map((emoji) => (
            <Pressable
              key={emoji}
              onPress={() => setAvatarEmoji(emoji)}
              style={[styles.emojiOption, emoji === avatarEmoji && styles.emojiOptionSelected]}
            >
              <Text style={styles.emojiOptionText}>{emoji}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>USERNAME</Text>
        <TextInput
          style={[styles.input, usernameLocked && styles.inputDisabled]}
          value={username}
          onChangeText={setUsername}
          editable={!usernameLocked}
          autoCapitalize="none"
          placeholder="username"
          placeholderTextColor={colors.textMuted}
        />
        <Text style={usernameLocked ? styles.cooldownLocked : styles.cooldownFree}>
          {usernameLocked
            ? `Podrás cambiar tu username nuevamente en ${cooldownDaysLeft} día${cooldownDaysLeft === 1 ? '' : 's'}`
            : 'Puedes cambiar tu username ahora'}
        </Text>

        <Text style={styles.label}>BIO</Text>
        <TextInput
          style={[styles.input, styles.bioInput]}
          value={bio}
          onChangeText={setBio}
          placeholder="Cuéntanos algo sobre ti"
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={160}
        />

        {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

        <View style={styles.editActions}>
          <PrimaryButton
            label={saving ? 'GUARDANDO...' : 'GUARDAR'}
            disabled={saving}
            onPress={handleSave}
          />
          <PrimaryButton
            variant="text"
            label="CANCELAR"
            disabled={saving}
            onPress={() => setEditing(false)}
          />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <>
      <InstallSheet
        visible={showInstallSheet}
        variant={installVariant ?? 'ios'}
        onInstall={handleInstallSheetInstall}
        onDismiss={() => setShowInstallSheet(false)}
      />
      <ScreenContainer scroll>
      <View style={styles.avatarBlock}>
        {/* Cosméticos equipados (bloque cosméticos) -- profile_frame como
            anillo real alrededor del avatar (no solo un texto en algún
            lado): ver equippedBySlot, viene de public_equipped_items. */}
        <View style={[styles.avatarRing, equippedBySlot.profile_frame && styles.avatarRingEquipped]}>
          <Text style={styles.avatar}>{user?.avatarEmoji ?? '🙂'}</Text>
          {equippedBySlot.profile_frame && (
            <Text style={styles.avatarFrameTag}>{equippedBySlot.profile_frame.assetRef}</Text>
          )}
        </View>
        <Text style={styles.username}>@{user?.username ?? 'you'}</Text>
        <View style={styles.badgeRow}>
          {user && <Badge label={`FOUNDER #${user.founderNumber}`} tone="accent" />}
          {equippedBySlot.badge && (
            <Badge label={`${equippedBySlot.badge.assetRef} ${equippedBySlot.badge.name}`} tone="secondary" />
          )}
        </View>
        {user?.bio && <Text style={styles.bio}>{user.bio}</Text>}
        <PrimaryButton variant="ghost" label="EDITAR PERFIL" onPress={() => setEditing(true)} />
      </View>

      <Card style={styles.card}>
        <XPBar xp={user?.xp ?? 0} xpToNextLevel={user?.xpToNextLevel ?? 1} level={user?.level ?? 1} />
      </Card>

      {/* Saldo de Coins (bloque Wallet/Economía) -- tarjeta propia bien
          visible, arriba de todo lo demás: es la puerta de entrada a
          Wallet/Tienda, no un dato escondido en Ajustes. */}
      <Pressable onPress={() => navigation.navigate('Wallet')}>
        <Card style={styles.coinsCard}>
          <View>
            <Text style={styles.coinsLabel}>💰 MIS COINS</Text>
            <Text style={styles.coinsValue}>{wallet ? wallet.balance.toLocaleString('es') : '···'}</Text>
          </View>
          <Text style={styles.linkCardArrow}>›</Text>
        </Card>
      </Pressable>

      <View style={styles.statsRow}>
        {/* Racha real (H) -- reemplaza el `streakDays` de User, que
            siempre era 0 (nunca hubo tracking real, ver api.ts). Ahora
            sale de get_my_streak (server-side, cuenta días distintos con
            al menos un Scan `done`). */}
        <StatTile label="RACHA 🔥" value={String(streak?.currentStreak ?? 0)} />
        <StatTile label="NIVEL" value={formatLevel(user?.level ?? 0)} />
      </View>
      {streak && streak.bestStreak > streak.currentStreak && (
        <Text style={styles.bestStreakText}>Mejor racha: {streak.bestStreak} días</Text>
      )}

      <DailyScanCounter />

      {/* Misiones diarias con premio real en Coins (bloque misiones+Coins) --
          cada check sigue saliendo de un evento real ya existente (ver
          missionsService.ts); el premio se reclama con claim_mission_reward,
          que vuelve a validar la condición server-side (nunca confía en
          este estado del cliente) y es idempotente por día (mission_claims). */}
      {missions && (
        <View style={styles.socialStatsSection}>
          <Text style={styles.settingsTitle}>MISIONES DE HOY</Text>
          <MissionRow
            done={missions.scanDone}
            claimed={claimedMissions.scan}
            busy={claimingKey === 'scan'}
            label="Hacé 1 Scan"
            coins={MISSION_COINS.scan}
            onClaim={() => handleClaimMission('scan')}
          />
          <MissionRow
            done={missions.challengeCompletedToday}
            claimed={claimedMissions.challenge}
            busy={claimingKey === 'challenge'}
            label="Completa 1 Challenge"
            coins={MISSION_COINS.challenge}
            onClaim={() => handleClaimMission('challenge')}
          />
          <MissionRow
            done={missions.sharedToday}
            claimed={claimedMissions.share}
            busy={claimingKey === 'share'}
            label="Comparte 1 resultado"
            coins={MISSION_COINS.share}
            onClaim={() => handleClaimMission('share')}
          />
          {streak && streak.currentStreak > 0 && (
            <MissionRow
              done
              claimed={claimedMissions.streak}
              busy={claimingKey === 'streak'}
              label={`Bono de racha (${streak.currentStreak} día${streak.currentStreak === 1 ? '' : 's'})`}
              coins={Math.min(streak.currentStreak, 5) * 10}
              onClaim={() => handleClaimMission('streak')}
            />
          )}
          <Text style={styles.missionCap}>Hasta ~400 Coins por día.</Text>
        </View>
      )}

      {/* Rivales frecuentes (G) -- derivado de `challenges`, sin tabla
          nueva (ver get_frequent_rivals). Solo el más frecuente acá --
          la vista completa (si algún día hace falta) sería su propia
          pantalla, no corresponde inflar Profile con eso todavía. */}
      {topRival && (
        <Pressable onPress={() => navigation.navigate('PublicProfile', { username: topRival.username })}>
          <Card style={styles.linkCard}>
            <Text style={styles.rivalCardAvatar}>{topRival.avatarEmoji}</Text>
            <View style={styles.rivalCardInfo}>
              <Text style={styles.linkCardLabel}>Rival frecuente: @{topRival.username}</Text>
              <Text style={styles.winRateText}>
                {topRival.myWins}–{topRival.rivalWins}
                {topRival.ties > 0 ? `–${topRival.ties}` : ''} entre ustedes
              </Text>
            </View>
            <Text style={styles.linkCardArrow}>›</Text>
          </Card>
        </Pressable>
      )}

      {/* Perfil social mínimo (F) -- calculado server-side (get_my_challenge_
          stats), nunca inventado ni derivado de listas parciales en el
          cliente. Oculto si todavía no se pudo consultar (sin sesión real). */}
      {challengeStats && (
        <View style={styles.socialStatsSection}>
          <Text style={styles.settingsTitle}>ESTADÍSTICAS DE CHALLENGE</Text>
          <View style={styles.socialStatsGrid}>
            <StatTile label="CHALLENGES" value={String(challengeStats.challengesCompleted)} />
            <StatTile label="GANADOS" value={String(challengeStats.wins)} />
            <StatTile label="PERDIDOS" value={String(challengeStats.losses)} />
            <StatTile label="EMPATES" value={String(challengeStats.ties)} />
          </View>
          {challengeStats.challengesCompleted > 0 && (
            <Text style={styles.winRateText}>
              Win rate: {Math.round((challengeStats.wins / challengeStats.challengesCompleted) * 100)}%
            </Text>
          )}
          {challengeStats.bestAuraScore != null && (
            <Text style={styles.winRateText}>Mejor Aura: {formatSignedXP(challengeStats.bestAuraScore)}</Text>
          )}
        </View>
      )}

      <Pressable onPress={() => navigation.navigate('MyChallenges')}>
        <Card style={styles.linkCard}>
          <Text style={styles.linkCardLabel}>MIS DESAFÍOS ⚔️</Text>
          <Text style={styles.linkCardArrow}>›</Text>
        </Card>
      </Pressable>

      <Pressable onPress={() => navigation.navigate('Ranking')}>
        <Card style={styles.linkCard}>
          <Text style={styles.linkCardLabel}>TOP AURA 🏆</Text>
          <Text style={styles.linkCardArrow}>›</Text>
        </Card>
      </Pressable>

      <Pressable onPress={() => navigation.navigate('Store')}>
        <Card style={styles.linkCard}>
          <Text style={styles.linkCardLabel}>TIENDA 🛍️</Text>
          <Text style={styles.linkCardArrow}>›</Text>
        </Card>
      </Pressable>

      <Pressable onPress={() => navigation.navigate('Invite')}>
        <Card style={styles.linkCard}>
          <Text style={styles.linkCardLabel}>INVITAR AMIGOS 🎉</Text>
          <Text style={styles.linkCardArrow}>›</Text>
        </Card>
      </Pressable>

      <Pressable onPress={() => navigation.navigate('Help')}>
        <Card style={styles.linkCard}>
          <Text style={styles.linkCardLabel}>AYUDA ❓</Text>
          <Text style={styles.linkCardArrow}>›</Text>
        </Card>
      </Pressable>

      {/* Acceso fijo a instalar (N) -- deliberadamente FUERA del gate de
          isSupabaseConfigured de abajo: instalar la PWA no depende del
          backend para nada, a diferencia de plan/logout. Chica, propia,
          sin competir con Editar perfil/Mis desafíos/Plan/Cerrar sesión
          (N3) -- mismo estilo que las otras link cards, nunca una
          pantalla aparte. Oculta entera si ya está instalada o si no hay
          ninguna acción real posible (N1/nunca un botón muerto). */}
      {installVariant && (
        <Pressable onPress={handleManualInstall}>
          <Card style={styles.linkCard}>
            <View style={styles.installCardInfo}>
              <Text style={styles.linkCardLabel}>📲 Instalar AURAXP</Text>
              <Text style={styles.installCardSubtitle}>Acceso directo en tu teléfono</Text>
            </View>
            <Text style={styles.linkCardArrow}>›</Text>
          </Card>
        </Pressable>
      )}

      {/* Sin Supabase configurado (modo mock/dev) ni plan ni cerrar sesión
          significan algo real -- se oculta entero en vez de mostrar un
          "FREE" inventado o un botón que no puede hacer nada. */}
      {isSupabaseConfigured && (
        <View style={styles.settingsSection}>
          <Text style={styles.settingsTitle}>AJUSTES</Text>

          {planStatus && (
            <View style={styles.planRow}>
              <Text style={styles.planLabel}>
                Plan actual: {planStatus.unlimited ? 'PRUEBA (ilimitado)' : planStatus.plan === 'pro' ? 'PRO' : 'FREE'}
              </Text>
              {!planStatus.unlimited && planStatus.plan !== 'pro' && (
                <PrimaryButton variant="text" label="Ver PRO" onPress={() => navigation.navigate('Pro')} />
              )}
            </View>
          )}

          {/* F: fila fija NOTIFICACIONES -- estado real del browser, no
              inventado. 'denied' sin botón a propósito: revertirlo es
              cosa de los ajustes del navegador/SO, un botón nuestro ahí
              no podría hacer nada real. */}
          <View style={styles.planRow}>
            <Text style={styles.planLabel}>
              Notificaciones:{' '}
              {pushState === 'granted' ? 'ACTIVADAS' : pushState === 'unsupported' ? 'NO DISPONIBLES' : 'DESACTIVADAS'}
            </Text>
            {(pushState === 'granted' || pushState === 'default') && (
              <PrimaryButton
                variant="text"
                label={pushBusy ? '...' : pushState === 'granted' ? 'Desactivar' : 'Activar'}
                disabled={pushBusy}
                onPress={handleTogglePush}
              />
            )}
          </View>
          {pushState === 'denied' && (
            <Text style={styles.installCardSubtitle}>Actívalas desde los ajustes de notificaciones de tu navegador.</Text>
          )}

          {confirmingLogout ? (
            <View style={styles.logoutConfirm}>
              <Text style={styles.logoutConfirmText}>¿Cerrar sesión?</Text>
              <View style={styles.logoutConfirmActions}>
                <View style={styles.logoutConfirmButton}>
                  <PrimaryButton
                    variant="ghost"
                    label="CANCELAR"
                    disabled={loggingOut}
                    onPress={() => setConfirmingLogout(false)}
                  />
                </View>
                <View style={styles.logoutConfirmButton}>
                  <PrimaryButton
                    label={loggingOut ? 'CERRANDO...' : 'CERRAR SESIÓN'}
                    disabled={loggingOut}
                    onPress={handleLogout}
                  />
                </View>
              </View>
            </View>
          ) : (
            <PrimaryButton variant="text" label="CERRAR SESIÓN" onPress={() => setConfirmingLogout(true)} />
          )}
        </View>
      )}
      </ScreenContainer>
    </>
  );
}

function MissionRow({
  done,
  claimed,
  busy,
  label,
  coins,
  onClaim,
}: {
  done: boolean;
  claimed: boolean;
  busy: boolean;
  label: string;
  coins: number;
  onClaim: () => void;
}) {
  return (
    <View style={styles.missionRow}>
      <Text style={[styles.missionCheck, done && styles.missionCheckDone]}>{done ? '✅' : '⬜'}</Text>
      <View style={styles.missionInfo}>
        <Text style={[styles.missionLabel, done && styles.missionLabelDone]}>{label}</Text>
        <Text style={styles.missionCoins}>+{coins} Coins</Text>
      </View>
      {done && !claimed && (
        <PrimaryButton variant="ghost" label={busy ? '...' : 'RECLAMAR'} disabled={busy} onPress={onClaim} />
      )}
      {claimed && <Text style={styles.missionClaimedTag}>COBRADO ✅</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  avatarBlock: {
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  avatar: {
    fontSize: 56,
  },
  avatarRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarRingEquipped: {
    borderColor: colors.accent,
    borderWidth: 3,
  },
  avatarFrameTag: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    fontSize: 20,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  username: {
    ...typography.title,
    color: colors.textPrimary,
  },
  bio: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  card: {
    marginBottom: spacing.lg,
  },
  coinsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    borderColor: colors.accent,
  },
  coinsLabel: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  coinsValue: {
    ...typography.title,
    color: colors.accent,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  bestStreakText: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  missionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  missionCheck: {
    fontSize: 16,
  },
  missionCheckDone: {
    opacity: 1,
  },
  missionInfo: {
    flex: 1,
  },
  missionLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  missionLabelDone: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  missionCoins: {
    ...typography.caption,
    color: colors.accent,
    marginTop: 1,
  },
  missionClaimedTag: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '700',
  },
  missionCap: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  rivalCardAvatar: {
    fontSize: 28,
  },
  rivalCardInfo: {
    flex: 1,
  },
  socialStatsSection: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  socialStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  winRateText: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    borderColor: colors.secondary,
  },
  linkCardLabel: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  linkCardArrow: {
    ...typography.title,
    color: colors.textMuted,
  },
  installCardInfo: {
    flex: 1,
  },
  installCardSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  settingsSection: {
    marginTop: spacing.xl,
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  settingsTitle: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  logoutConfirm: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  logoutConfirmText: {
    ...typography.subtitle,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  logoutConfirmActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  logoutConfirmButton: {
    flex: 1,
  },
  editContainer: {
    paddingTop: spacing.xl,
  },
  editTitle: {
    ...typography.title,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1,
    marginBottom: spacing.xs,
    marginTop: spacing.md,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  emojiOption: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiOptionSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.surfaceAlt,
  },
  emojiOptionText: {
    fontSize: 24,
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
  },
  inputDisabled: {
    opacity: 0.5,
  },
  bioInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  cooldownLocked: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  cooldownFree: {
    ...typography.caption,
    color: colors.success,
    marginTop: spacing.xs,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.md,
  },
  editActions: {
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
});
