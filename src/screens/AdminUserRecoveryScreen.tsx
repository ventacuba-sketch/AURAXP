import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useRootNavigation } from '../hooks/useRootNavigation';
import { getSession } from '../services/authService';
import {
  RecoveryKpis,
  RecoveryListRow,
  RecoveryUserDetail,
  getUserRecoveryDetail,
  getUserRecoveryKpis,
  listUserRecovery,
  recoverUserAccess,
} from '../services/adminUserRecoveryService';
import { colors, radius, spacing, typography } from '../theme/colors';

type Segment = 'all' | 'unconfirmed' | 'no_first_scan';
type BulkState = 'idle' | 'confirm' | 'running' | 'paused' | 'done';
type BulkItem = { userId: string; email: string; status: 'pending' | 'ok' | 'partial' | 'error'; message?: string };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const fmt = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('es-CL').format(n);
const dt = (value: string | null) => value ? new Date(value).toLocaleString('es-CL') : '—';

export default function AdminUserRecoveryScreen() {
  const navigation = useRootNavigation();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [segment, setSegment] = useState<Segment>('all');
  const [kpis, setKpis] = useState<RecoveryKpis | null>(null);
  const [rows, setRows] = useState<RecoveryListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RecoveryUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [bulkState, setBulkState] = useState<BulkState>('idle');
  const [bulkItems, setBulkItems] = useState<BulkItem[]>([]);
  const [bulkIndex, setBulkIndex] = useState(0);
  const pauseRef = useRef(false);
  const stopRef = useRef(false);

  const range = useMemo(() => ({ start: new Date(Date.UTC(2020, 0, 1)), end: new Date() }), []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const session = await getSession();
      setSignedIn(Boolean(session));
      if (!session) return;
      const [nextKpis, nextRows] = await Promise.all([
        getUserRecoveryKpis({ ...range }),
        listUserRecovery({ ...range, segment: segment === 'all' ? null : segment, limit: 200, offset: 0 }),
      ]);
      setKpis(nextKpis);
      setRows(nextRows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No pudimos cargar los datos de recuperación.');
    } finally {
      setLoading(false);
    }
  }, [range, segment]);

  useEffect(() => { setLoading(true); void load(); }, [load]);
  useEffect(() => () => { stopRef.current = true; }, []);

  async function openDetail(userId: string) {
    setDetailLoading(true);
    try { setSelected(await getUserRecoveryDetail(userId)); }
    catch { setSelected(null); }
    finally { setDetailLoading(false); }
  }

  async function recoverOne(userId: string) {
    if (selected?.user.user_id === userId && selected.recovery_actions.length > 0) return;
    const result = await recoverUserAccess(userId);
    await load();
    if (selected?.user.user_id === userId) await openDetail(userId);
    return result;
  }

  function prepareBulk() {
    const candidates = rows.filter((r) => !r.confirmed && !r.recovered);
    setBulkItems(candidates.map((r) => ({ userId: r.user_id, email: r.email, status: 'pending' })));
    setBulkIndex(0);
    setBulkState('confirm');
  }

  async function startBulk() {
    const candidates = rows.filter((r) => !r.confirmed && !r.recovered);
    const items = candidates.map((r) => ({ userId: r.user_id, email: r.email, status: 'pending' as const }));
    setBulkItems(items);
    setBulkIndex(0);
    setBulkState('running');
    pauseRef.current = false;
    stopRef.current = false;

    for (let i = 0; i < candidates.length; i += 1) {
      if (stopRef.current) break;
      while (pauseRef.current && !stopRef.current) await sleep(500);
      if (stopRef.current) break;

      const user = candidates[i];
      setBulkIndex(i + 1);
      try {
        const result = await recoverUserAccess(user.user_id);
        const status: BulkItem['status'] = result.status === 'recovered' && result.passwordResetSent
          ? 'ok'
          : result.status === 'partial_success'
            ? 'partial'
            : 'error';
        setBulkItems((prev) => prev.map((item, idx) => idx === i ? {
          ...item,
          status,
          message: status === 'ok' ? 'Recuperado + correo enviado' : status === 'partial' ? 'Confirmado; correo no enviado' : (result.error ?? 'Error'),
        } : item));
      } catch (e) {
        setBulkItems((prev) => prev.map((item, idx) => idx === i ? {
          ...item, status: 'error', message: e instanceof Error ? e.message : 'Error',
        } : item));
      }

      if (i < candidates.length - 1) await sleep(7000);
    }

    setBulkState('done');
    pauseRef.current = false;
    await load();
  }

  function togglePause() {
    if (bulkState === 'running') {
      pauseRef.current = true;
      setBulkState('paused');
    } else if (bulkState === 'paused') {
      pauseRef.current = false;
      setBulkState('running');
    }
  }

  if (signedIn === false) return (
    <SafeAreaView style={styles.safe}><View style={styles.center}>
      <Text style={styles.logo}>AURA VS</Text><Text style={styles.title}>Recuperación de usuarios</Text>
      <Text style={styles.muted}>Inicia sesión con la cuenta administradora.</Text>
      <Pressable style={styles.primary} onPress={() => navigation.navigate('Auth')}><Text style={styles.primaryText}>INICIAR SESIÓN</Text></Pressable>
    </View></SafeAreaView>
  );

  if (loading && !kpis) return <SafeAreaView style={styles.safe}><View style={styles.center}><ActivityIndicator color={colors.accent} size="large" /></View></SafeAreaView>;

  const bulkOk = bulkItems.filter((x) => x.status === 'ok').length;
  const bulkPartial = bulkItems.filter((x) => x.status === 'partial').length;
  const bulkErrors = bulkItems.filter((x) => x.status === 'error').length;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View><Text style={styles.logo}>AURA VS · ADMIN</Text><Text style={styles.title}>Recuperación de usuarios</Text><Text style={styles.muted}>Recupera cuentas legacy bloqueadas y revisa usuarios sin primer Scan.</Text></View>
          <Pressable style={styles.secondary} onPress={() => navigation.navigate('AdminDashboard')}><Text style={styles.secondaryText}>← DASHBOARD</Text></Pressable>
        </View>

        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.chips}>
          {([['all','Todos'],['unconfirmed','No confirmados (legacy)'],['no_first_scan','Sin primer Scan']] as const).map(([key,label]) => (
            <Pressable key={key} style={[styles.chip, segment === key && styles.chipActive]} onPress={() => setSegment(key)} disabled={bulkState === 'running' || bulkState === 'paused'}>
              <Text style={[styles.chipText, segment === key && styles.chipTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {kpis && <View style={styles.metrics}>
          <Metric label="Registrados" value={fmt(kpis.registered)} />
          <Metric label="No confirmados (legacy)" value={fmt(kpis.unconfirmed_legacy)} />
          <Metric label="Sin primer Scan" value={fmt(kpis.no_first_scan)} />
          <Metric label="Recuperados" value={fmt(kpis.recovered)} accent />
          <Metric label="% Recuperación" value={`${kpis.recovery_rate_pct}%`} accent />
        </View>}

        {segment === 'unconfirmed' && bulkState === 'idle' && rows.some((r) => !r.confirmed && !r.recovered) && (
          <View style={styles.bulkCard}>
            <Text style={styles.cardTitle}>Recuperación lenta por lote</Text>
            <Text style={styles.muted}>Procesará {rows.filter((r) => !r.confirmed && !r.recovered).length} cuentas, una cada ~7 segundos. Cada cuenta se audita por separado. Los errores no detienen el lote.</Text>
            <Pressable style={styles.primary} onPress={prepareBulk}><Text style={styles.primaryText}>RECUPERAR TODOS LOS NO CONFIRMADOS</Text></Pressable>
          </View>
        )}

        {segment === 'unconfirmed' && bulkState === 'confirm' && (
          <View style={styles.bulkCardDanger}>
            <Text style={styles.cardTitle}>Confirmar recuperación por lote</Text>
            <Text style={styles.muted}>Vas a confirmar {bulkItems.length} cuentas legacy y enviar un correo de restablecimiento a cada propietario. El proceso será lento y podrás pausarlo.</Text>
            <View style={styles.actions}>
              <Pressable style={styles.secondary} onPress={() => setBulkState('idle')}><Text style={styles.secondaryText}>CANCELAR</Text></Pressable>
              <Pressable style={styles.dangerButton} onPress={() => void startBulk()}><Text style={styles.primaryText}>SÍ, INICIAR LOTE</Text></Pressable>
            </View>
          </View>
        )}

        {(bulkState === 'running' || bulkState === 'paused' || bulkState === 'done') && (
          <View style={styles.bulkCard}>
            <Text style={styles.cardTitle}>{bulkState === 'done' ? 'Lote terminado' : bulkState === 'paused' ? 'Lote pausado' : 'Recuperando cuentas…'}</Text>
            <Text style={styles.progress}>{Math.min(bulkIndex, bulkItems.length)} / {bulkItems.length}</Text>
            <Text style={styles.muted}>Correctas: {bulkOk} · Parciales: {bulkPartial} · Errores: {bulkErrors}</Text>
            {(bulkState === 'running' || bulkState === 'paused') && <Pressable style={styles.secondary} onPress={togglePause}><Text style={styles.secondaryText}>{bulkState === 'paused' ? 'CONTINUAR' : 'PAUSAR'}</Text></Pressable>}
            {bulkState === 'done' && <Pressable style={styles.primary} onPress={() => { setBulkState('idle'); setBulkItems([]); }}><Text style={styles.primaryText}>CERRAR RESULTADO</Text></Pressable>}
            <View style={styles.bulkList}>{bulkItems.map((item, i) => <Text key={item.userId} style={styles.bulkLine}>{i + 1}. {item.email} · {item.status === 'pending' ? 'pendiente' : item.message}</Text>)}</View>
          </View>
        )}

        <Text style={styles.sectionTitle}>Usuarios ({fmt(rows[0]?.total_count ?? rows.length)})</Text>
        <View style={styles.tableCard}>
          {rows.map((row) => (
            <Pressable key={row.user_id} style={styles.row} onPress={() => void openDetail(row.user_id)}>
              <View style={styles.emailCol}><Text style={styles.rowMain} numberOfLines={1}>{row.email}</Text><Text style={styles.rowSub}>{dt(row.registered_at)}</Text></View>
              <Text style={[styles.status, row.confirmed ? styles.ok : styles.warn]}>{row.confirmed ? 'Confirmado' : 'No confirmado'}</Text>
              <Text style={styles.status}>{row.source_group}</Text>
              <Text style={[styles.status, row.recovered && styles.ok]}>{row.recovered ? 'Recuperado' : '—'}</Text>
              <Text style={styles.link}>VER →</Text>
            </Pressable>
          ))}
        </View>

        {detailLoading && <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />}
        {selected && !detailLoading && (
          <View style={styles.detail}>
            <View style={styles.header}><View><Text style={styles.cardTitle}>Detalle</Text><Text style={styles.detailEmail}>{selected.user.email}</Text></View><Pressable onPress={() => setSelected(null)}><Text style={styles.secondaryText}>CERRAR ✕</Text></Pressable></View>
            <Text style={styles.muted}>Registrado: {dt(selected.user.registered_at)}</Text>
            <Text style={styles.muted}>Email confirmado: {dt(selected.user.email_confirmed_at)}</Text>
            <Text style={styles.muted}>Scans: {selected.scans.length} · Acciones de recuperación: {selected.recovery_actions.length}</Text>
            {selected.recovery_actions.length > 0 ? (
              <Pressable style={[styles.primary, styles.recoveredButton]} disabled accessibilityState={{ disabled: true }}>
                <Text style={styles.recoveredButtonText}>✓ CUENTA RECUPERADA</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.primary} onPress={() => void recoverOne(selected.user.user_id)}><Text style={styles.primaryText}>RECUPERAR ESTA CUENTA</Text></Pressable>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={[styles.metricValue, accent && styles.accent]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 64, maxWidth: 1600, width: '100%', alignSelf: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 },
  logo: { ...typography.eyebrow, color: colors.secondary, marginBottom: 6 },
  title: { ...typography.hero, color: colors.textPrimary },
  muted: { ...typography.body, color: colors.textSecondary, marginTop: 6 },
  error: { ...typography.body, color: colors.danger, marginBottom: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '800' },
  chipTextActive: { color: colors.onAccent },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  metric: { minWidth: 170, flexGrow: 1, padding: 16, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  metricLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  metricValue: { ...typography.display, fontSize: 26, color: colors.textPrimary, marginTop: 8 },
  accent: { color: colors.accent },
  sectionTitle: { ...typography.title, color: colors.textPrimary, marginTop: 24, marginBottom: 12 },
  cardTitle: { ...typography.subtitle, color: colors.textPrimary, fontWeight: '900' },
  bulkCard: { marginTop: 20, padding: 18, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceRaised },
  bulkCardDanger: { marginTop: 20, padding: 18, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.danger, backgroundColor: colors.surfaceRaised },
  progress: { ...typography.display, color: colors.accent, fontSize: 30, marginTop: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  primary: { marginTop: 16, borderRadius: radius.pill, backgroundColor: colors.accent, paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center' },
  dangerButton: { marginTop: 16, borderRadius: radius.pill, backgroundColor: colors.danger, paddingHorizontal: 20, paddingVertical: 12, alignItems: 'center' },
  primaryText: { ...typography.caption, color: colors.onAccent, fontWeight: '900' },
  recoveredButton: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.success, opacity: 0.9 },
  recoveredButtonText: { ...typography.caption, color: colors.success, fontWeight: '900' },
  secondary: { borderRadius: radius.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 14, paddingVertical: 9, alignSelf: 'flex-start', marginTop: 10 },
  secondaryText: { ...typography.caption, color: colors.textPrimary, fontWeight: '900' },
  bulkList: { marginTop: 12, gap: 3 },
  bulkLine: { ...typography.caption, color: colors.textSecondary },
  tableCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 12 },
  emailCol: { flex: 1, minWidth: 220 },
  rowMain: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  rowSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  status: { width: 110, ...typography.caption, color: colors.textSecondary, fontWeight: '800' },
  ok: { color: colors.success },
  warn: { color: colors.danger },
  link: { width: 70, ...typography.caption, color: colors.accent, fontWeight: '900' },
  detail: { marginTop: 24, padding: 20, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceRaised },
  detailEmail: { ...typography.title, color: colors.textPrimary, marginTop: 6 },
});