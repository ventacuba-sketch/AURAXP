import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useRootNavigation } from '../hooks/useRootNavigation';
import { getSession } from '../services/authService';
import {
  FunnelStage,
  RecoveryFilters,
  RecoveryKpis,
  RecoveryListRow,
  RecoverySegment,
  RecoveryUserDetail,
  SourceGroup,
  getUserRecoveryDetail,
  getUserRecoveryKpis,
  listUserRecovery,
  recoverUserAccess,
} from '../services/adminUserRecoveryService';
import { colors, radius, spacing, typography } from '../theme/colors';

type Preset = '7d' | '30d' | '90d' | 'all';

const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' },
  { key: '90d', label: '90 días' },
  { key: 'all', label: 'Todo' },
];

const SEGMENTS: Array<{ key: RecoverySegment | 'all'; label: string }> = [
  { key: 'all', label: 'Todos' },
  { key: 'unconfirmed', label: 'No confirmados (legacy)' },
  { key: 'no_first_scan', label: 'Sin primer Scan' },
];

const SOURCE_GROUPS: Array<{ key: SourceGroup | 'all'; label: string }> = [
  { key: 'all', label: 'Todas las fuentes' },
  { key: 'meta', label: 'Meta' },
  { key: 'organic', label: 'Orgánico' },
  { key: 'other', label: 'Otro' },
];

const FUNNEL_LABELS: Record<FunnelStage, string> = {
  registered_only: 'Registrado',
  viewed_upload: 'Vio Upload',
  selected_video: 'Video seleccionado',
  attempted_submit: 'Scan enviado/fallido',
  completed_first_scan: 'Primer Scan completado',
};

function rangeForPreset(preset: Preset): [Date, Date] {
  const end = new Date();
  const start = new Date(end);
  if (preset === '7d') start.setDate(start.getDate() - 7);
  else if (preset === '30d') start.setDate(start.getDate() - 30);
  else if (preset === '90d') start.setDate(start.getDate() - 90);
  else start.setTime(Date.UTC(2020, 0, 1));
  return [start, end];
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-CL').format(value);
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AdminUserRecoveryScreen() {
  const navigation = useRootNavigation();

  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [preset, setPreset] = useState<Preset>('all');
  const [segment, setSegment] = useState<RecoverySegment | 'all'>('all');
  const [sourceGroup, setSourceGroup] = useState<SourceGroup | 'all'>('all');
  const [campaign, setCampaign] = useState('');
  const [creative, setCreative] = useState('');
  const [search, setSearch] = useState('');

  const [kpis, setKpis] = useState<RecoveryKpis | null>(null);
  const [rows, setRows] = useState<RecoveryListRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RecoveryUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [confirmingRecover, setConfirmingRecover] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoverResult, setRecoverResult] = useState<string | null>(null);
  const [recoverResultKind, setRecoverResultKind] = useState<'ok' | 'warning' | 'error'>('ok');

  const filters = useMemo<RecoveryFilters>(() => {
    const [start, end] = rangeForPreset(preset);
    return {
      start,
      end,
      segment: segment === 'all' ? null : segment,
      sourceGroup: sourceGroup === 'all' ? null : sourceGroup,
      campaign: campaign.trim() || null,
      creative: creative.trim() || null,
      search: search.trim() || null,
      limit,
      offset,
    };
  }, [preset, segment, sourceGroup, campaign, creative, search, offset]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const session = await getSession();
      setSignedIn(Boolean(session));
      if (!session) return;

      const [kpisResult, listResult] = await Promise.all([
        getUserRecoveryKpis(filters),
        listUserRecovery(filters),
      ]);
      setKpis(kpisResult);
      setRows(listResult);
      setTotalCount(listResult[0]?.total_count ?? 0);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(
        message.toLowerCase().includes('not_authorized')
          ? 'Esta cuenta no tiene acceso a Recuperación de usuarios.'
          : 'No pudimos cargar los datos de recuperación.',
      );
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  function applyFilterChange(fn: () => void) {
    fn();
    setOffset(0);
  }

  async function openDetail(userId: string) {
    setSelectedUserId(userId);
    setDetail(null);
    setDetailLoading(true);
    setConfirmingRecover(false);
    setRecoverResult(null);
    try {
      const result = await getUserRecoveryDetail(userId);
      setDetail(result);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleRecover(userId: string) {
    if (!confirmingRecover) {
      setConfirmingRecover(true);
      return;
    }
    setRecovering(true);
    setRecoverResult(null);
    try {
      const result = await recoverUserAccess(userId);
      // `passwordResetSent` es la única fuente de verdad sobre si el correo
      // salió -- nunca se infiere de `ok` ni de `status` por separado, para
      // que sea imposible afirmar "correo enviado" cuando no lo fue.
      if (result.status === 'recovered' && result.passwordResetSent) {
        setRecoverResultKind('ok');
        setRecoverResult(
          result.alreadyConfirmed
            ? 'El email ya estaba confirmado. Se reenvió el correo de restablecimiento de contraseña.'
            : 'Email confirmado y correo de restablecimiento de contraseña enviado.',
        );
        void load();
        void openDetail(userId);
      } else if (result.status === 'partial_success') {
        setRecoverResultKind('warning');
        setRecoverResult(
          (result.alreadyConfirmed
            ? 'El email ya estaba confirmado, pero '
            : 'El email quedó confirmado, pero ') +
            'NO se pudo enviar el correo de restablecimiento de contraseña. El usuario todavía no puede entrar por su cuenta: vuelve a intentar la recuperación en unos minutos o contáctalo por otro medio.',
        );
        void load();
        void openDetail(userId);
      } else if (result.error === 'recovery_cooldown') {
        setRecoverResultKind('warning');
        setRecoverResult('Ya se intentó recuperar esta cuenta hace poco. Espera unos minutos antes de reintentar.');
      } else {
        setRecoverResultKind('error');
        setRecoverResult(`No se pudo recuperar el acceso (${result.error ?? 'error desconocido'}).`);
      }
    } catch (e) {
      setRecoverResultKind('error');
      setRecoverResult(e instanceof Error ? e.message : 'Error al recuperar el acceso.');
    } finally {
      setRecovering(false);
      setConfirmingRecover(false);
    }
  }

  if (signedIn === false) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.gate}>
          <Text style={styles.logo}>AURA VS</Text>
          <Text style={styles.title}>Recuperación de usuarios</Text>
          <Text style={styles.muted}>Inicia sesión con la cuenta administradora para continuar.</Text>
          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Auth')}>
            <Text style={styles.primaryButtonText}>INICIAR SESIÓN</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loading && !kpis) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.muted}>Cargando recuperación de usuarios…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !kpis) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.gate}>
          <Text style={styles.logo}>AURA VS</Text>
          <Text style={styles.title}>Recuperación de usuarios</Text>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.primaryButton} onPress={() => { setLoading(true); void load(); }}>
            <Text style={styles.primaryButtonText}>REINTENTAR</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.logo}>AURA VS · ADMIN</Text>
            <Text style={styles.title}>Recuperación de usuarios</Text>
            <Text style={styles.muted}>
              Usuarios atrapados por los sistemas de confirmación antiguos y usuarios registrados sin primer Scan.
            </Text>
          </View>
          <Pressable style={styles.secondaryButtonSmall} onPress={() => navigation.navigate('AdminDashboard')}>
            <Text style={styles.secondaryButtonText}>← DASHBOARD</Text>
          </Pressable>
        </View>

        {error && <Text style={styles.inlineError}>{error}</Text>}

        <View style={styles.filterRow}>
          {PRESETS.map((item) => (
            <Pressable
              key={item.key}
              style={[styles.chip, preset === item.key && styles.chipActive]}
              onPress={() => applyFilterChange(() => setPreset(item.key))}
            >
              <Text style={[styles.chipText, preset === item.key && styles.chipTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.filterRow}>
          {SEGMENTS.map((item) => (
            <Pressable
              key={item.key}
              style={[styles.chip, segment === item.key && styles.chipActive]}
              onPress={() => applyFilterChange(() => setSegment(item.key))}
            >
              <Text style={[styles.chipText, segment === item.key && styles.chipTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.filterRow}>
          {SOURCE_GROUPS.map((item) => (
            <Pressable
              key={item.key}
              style={[styles.chip, sourceGroup === item.key && styles.chipActive]}
              onPress={() => applyFilterChange(() => setSourceGroup(item.key))}
            >
              <Text style={[styles.chipText, sourceGroup === item.key && styles.chipTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.customRow}>
          <TextInput
            value={campaign}
            onChangeText={(v) => applyFilterChange(() => setCampaign(v))}
            placeholder="Campaña (utm_campaign)"
            placeholderTextColor={colors.textMuted}
            style={styles.textInput}
            autoCapitalize="none"
          />
          <TextInput
            value={creative}
            onChangeText={(v) => applyFilterChange(() => setCreative(v))}
            placeholder="Creativo / A-B (utm_content)"
            placeholderTextColor={colors.textMuted}
            style={styles.textInput}
            autoCapitalize="none"
          />
          <TextInput
            value={search}
            onChangeText={(v) => applyFilterChange(() => setSearch(v))}
            placeholder="Buscar por email o user_id"
            placeholderTextColor={colors.textMuted}
            style={styles.textInput}
            autoCapitalize="none"
          />
        </View>

        {kpis && (
          <>
            <Text style={styles.sectionTitle}>KPIs del periodo</Text>
            <View style={styles.cardGrid}>
              <MetricCard label="Registrados" value={formatNumber(kpis.registered)} />
              <MetricCard label="No confirmados (legacy)" value={formatNumber(kpis.unconfirmed_legacy)} />
              <MetricCard label="Sin primer Scan" value={formatNumber(kpis.no_first_scan)} />
              <MetricCard label="Llegaron a Upload y abandonaron" value={formatNumber(kpis.reached_upload_abandoned)} />
              <MetricCard label="Intentaron Scan y falló" value={formatNumber(kpis.attempted_scan_failed)} />
              <MetricCard label="Recuperados" value={formatNumber(kpis.recovered)} accent />
              <MetricCard label="% Recuperación" value={`${kpis.recovery_rate_pct}%`} accent />
            </View>
          </>
        )}

        <Text style={styles.sectionTitle}>Usuarios ({formatNumber(totalCount)})</Text>
        <View style={styles.tableCard}>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={[styles.cell, styles.emailCell]}>EMAIL</Text>
                <Text style={styles.cell}>REGISTRO</Text>
                <Text style={styles.cell}>CONFIRMADO</Text>
                <Text style={styles.cell}>FUENTE</Text>
                <Text style={styles.cell}>CAMPAÑA</Text>
                <Text style={styles.cell}>ETAPA FUNNEL</Text>
                <Text style={styles.cell}>RECUPERADO</Text>
                <Text style={styles.cell}></Text>
              </View>
              {rows.length === 0 && (
                <View style={styles.tableRow}>
                  <Text style={styles.muted}>Sin usuarios para estos filtros.</Text>
                </View>
              )}
              {rows.map((row) => (
                <Pressable key={row.user_id} style={styles.tableRow} onPress={() => openDetail(row.user_id)}>
                  <View style={[styles.cellView, styles.emailCell]}>
                    <Text style={styles.cellMain} numberOfLines={1}>{row.email}</Text>
                    <Text style={styles.cellSub}>{row.username ?? 'sin username'}</Text>
                  </View>
                  <Text style={styles.cell}>{formatDateTime(row.registered_at)}</Text>
                  <Text style={[styles.cell, row.confirmed ? styles.badgeOk : styles.badgeWarn]}>
                    {row.confirmed ? 'Sí' : 'No'}
                  </Text>
                  <Text style={styles.cell}>{row.has_attribution ? row.source_group : 'Sin atribución'}</Text>
                  <Text style={styles.cell} numberOfLines={1}>{row.utm_campaign ?? '—'}</Text>
                  <Text style={styles.cell}>{FUNNEL_LABELS[row.funnel_stage]}</Text>
                  <Text style={[styles.cell, row.recovered && styles.badgeOk]}>{row.recovered ? 'Sí' : '—'}</Text>
                  <Text style={[styles.cell, styles.linkCell]}>VER →</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>

        <View style={styles.pagination}>
          <Pressable
            disabled={offset === 0}
            style={[styles.secondaryButtonSmall, offset === 0 && styles.disabled]}
            onPress={() => setOffset(Math.max(0, offset - limit))}
          >
            <Text style={styles.secondaryButtonText}>← ANTERIOR</Text>
          </Pressable>
          <Text style={styles.muted}>
            {totalCount === 0 ? '0 resultados' : `${offset + 1}–${Math.min(offset + limit, totalCount)} de ${totalCount}`}
          </Text>
          <Pressable
            disabled={offset + limit >= totalCount}
            style={[styles.secondaryButtonSmall, offset + limit >= totalCount && styles.disabled]}
            onPress={() => setOffset(offset + limit)}
          >
            <Text style={styles.secondaryButtonText}>SIGUIENTE →</Text>
          </Pressable>
        </View>

        {selectedUserId && (
          <View style={styles.detailPanel}>
            <View style={styles.detailHeader}>
              <Text style={styles.cardTitle}>Detalle del usuario</Text>
              <Pressable onPress={() => setSelectedUserId(null)}>
                <Text style={styles.secondaryButtonText}>CERRAR ✕</Text>
              </Pressable>
            </View>

            {detailLoading && <ActivityIndicator color={colors.accent} style={{ marginVertical: 20 }} />}

            {!detailLoading && detail && (
              <>
                <Text style={styles.detailEmail}>{detail.user.email}</Text>
                <View style={styles.detailGrid}>
                  <DetailRow label="user_id" value={detail.user.user_id} />
                  <DetailRow label="Registrado" value={formatDateTime(detail.user.registered_at)} />
                  <DetailRow label="Email confirmado" value={formatDateTime(detail.user.email_confirmed_at)} />
                  <DetailRow label="Confirmación enviada" value={formatDateTime(detail.user.confirmation_sent_at)} />
                  <DetailRow label="Último login" value={formatDateTime(detail.user.last_sign_in_at)} />
                  <DetailRow label="visitor_id" value={detail.user.visitor_id ?? 'Sin atribución'} />
                  <DetailRow label="Fuente" value={detail.user.utm_source ?? 'Sin atribución'} />
                  <DetailRow label="Medio" value={detail.user.utm_medium ?? '—'} />
                  <DetailRow label="Campaña" value={detail.user.utm_campaign ?? '—'} />
                  <DetailRow label="Creativo (A/B)" value={detail.user.utm_content ?? '—'} />
                  <DetailRow label="fbclid / fbc" value={detail.user.fbclid || detail.user.fbc ? 'Presente (Meta Ads)' : 'Ausente'} />
                </View>

                <Text style={styles.cardTitle}>Scans ({detail.scans.length})</Text>
                {detail.scans.length === 0 ? (
                  <Text style={styles.muted}>Sin Scans registrados.</Text>
                ) : detail.scans.map((scan) => (
                  <Text key={scan.id} style={styles.listLine}>
                    {formatDateTime(scan.created_at)} · {scan.status} · aura: {scan.aura_score ?? '—'}
                  </Text>
                ))}

                <Text style={styles.cardTitle}>Últimos eventos ({detail.events.length})</Text>
                {detail.events.slice(0, 15).map((ev, index) => (
                  <Text key={index} style={styles.listLine}>{formatDateTime(ev.created_at)} · {ev.event_name}</Text>
                ))}

                <Text style={styles.cardTitle}>Historial de recuperación</Text>
                {detail.recovery_actions.length === 0 ? (
                  <Text style={styles.muted}>Ninguna acción de recuperación registrada.</Text>
                ) : detail.recovery_actions.map((action) => (
                  <Text key={action.id} style={styles.listLine}>
                    {formatDateTime(action.created_at)} · confirmó email: {action.email_confirmed ? 'sí' : 'no'} · reset enviado: {action.password_reset_sent ? 'sí' : 'no'}
                  </Text>
                ))}

                {recoverResult && (
                  <Text
                    style={[
                      styles.recoverResult,
                      recoverResultKind === 'warning' && styles.recoverResultWarning,
                      recoverResultKind === 'error' && styles.recoverResultError,
                    ]}
                  >
                    {recoverResult}
                  </Text>
                )}

                <Pressable
                  style={[styles.primaryButton, confirmingRecover && styles.primaryButtonConfirm]}
                  disabled={recovering}
                  onPress={() => handleRecover(detail.user.user_id)}
                >
                  <Text style={styles.primaryButtonText}>
                    {recovering
                      ? 'PROCESANDO…'
                      : confirmingRecover
                        ? 'TOCA DE NUEVO PARA CONFIRMAR'
                        : 'RECUPERAR ACCESO'}
                  </Text>
                </Pressable>
                <Text style={styles.muted}>
                  Confirma el email (si estaba pendiente por los sistemas antiguos de OTP/confirmación) y envía el
                  correo normal de restablecimiento de contraseña al dueño real de la cuenta. Nunca entrega un enlace
                  de acceso al administrador. Queda auditado con fecha y usuario que ejecutó la acción.
                </Text>
              </>
            )}
          </View>
        )}

        <View style={styles.footer}>
          <Text style={styles.muted}>
            Exclusivo para administradores. No expone auth.users ni emails a clientes normales: todo pasa por RPCs
            SECURITY DEFINER con verificación fail-closed de profiles.is_admin.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function MetricCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, accent && styles.metricAccent]}>{value}</Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 64,
    maxWidth: 1600,
    width: '100%',
    alignSelf: 'center',
  },
  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 16,
  },
  logo: { ...typography.eyebrow, color: colors.secondary, marginBottom: 6 },
  title: { ...typography.hero, color: colors.textPrimary },
  muted: { ...typography.body, color: colors.textSecondary, marginTop: 6 },
  error: { ...typography.body, color: colors.danger, textAlign: 'center', marginVertical: 16 },
  inlineError: { ...typography.caption, color: colors.danger, marginBottom: 12 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '800' },
  chipTextActive: { color: colors.onAccent },
  customRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  textInput: {
    minWidth: 200,
    flexGrow: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...typography.caption,
  },
  sectionTitle: { ...typography.title, color: colors.textPrimary, marginTop: 20, marginBottom: 12 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metricCard: {
    minWidth: 150,
    flexGrow: 1,
    minHeight: 92,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  metricLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  metricValue: { ...typography.display, fontSize: 26, color: colors.textPrimary, marginTop: 8 },
  metricAccent: { color: colors.accent },
  tableCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  table: { minWidth: 1000 },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 11,
    paddingHorizontal: 12,
    backgroundColor: colors.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  emailCell: { width: 220 },
  cellView: { paddingRight: 14 },
  cell: {
    width: 110,
    color: colors.textSecondary,
    ...typography.caption,
    fontWeight: '800',
  },
  linkCell: { color: colors.accent, textAlign: 'right' },
  cellMain: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  cellSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  badgeOk: { color: colors.success },
  badgeWarn: { color: colors.danger },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  secondaryButtonSmall: {
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  secondaryButtonText: { ...typography.caption, color: colors.textPrimary, fontWeight: '900' },
  disabled: { opacity: 0.4 },
  detailPanel: {
    marginTop: 24,
    padding: 20,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  detailHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  detailEmail: { ...typography.title, color: colors.textPrimary, marginBottom: 12 },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 18 },
  detailRow: { minWidth: 220 },
  detailLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700' },
  detailValue: { ...typography.body, color: colors.textPrimary, marginTop: 2 },
  cardTitle: { ...typography.subtitle, color: colors.textPrimary, marginTop: 16, marginBottom: 6 },
  listLine: { ...typography.caption, color: colors.textSecondary, marginBottom: 3 },
  recoverResult: { ...typography.body, color: colors.accent, marginTop: 16, marginBottom: 4 },
  recoverResultWarning: { color: colors.secondary },
  recoverResultError: { color: colors.danger },
  primaryButton: {
    marginTop: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    paddingHorizontal: 22,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryButtonConfirm: { backgroundColor: colors.danger },
  primaryButtonText: { ...typography.caption, color: colors.onAccent, fontWeight: '900' },
  footer: { marginTop: 28, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.border },
});
