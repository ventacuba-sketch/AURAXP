import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { useRootNavigation } from '../hooks/useRootNavigation';
import { getSession } from '../services/authService';
import {
  AdminDashboardData,
  DashboardDaily,
  DashboardKpis,
  DashboardRecommendation,
  getAdminDashboard,
} from '../services/adminAnalyticsService';
import { colors, radius, spacing, typography } from '../theme/colors';

type Preset = '24h' | '7d' | '30d' | '90d' | 'all';

const PRESETS: Array<{ key: Preset; label: string }> = [
  { key: '24h', label: '24 h' },
  { key: '7d', label: '7 días' },
  { key: '30d', label: '30 días' },
  { key: '90d', label: '90 días' },
  { key: 'all', label: 'Todo' },
];

function rangeForPreset(preset: Preset): [Date, Date] {
  const end = new Date();
  const start = new Date(end);

  if (preset === '24h') start.setHours(start.getHours() - 24);
  else if (preset === '7d') start.setDate(start.getDate() - 7);
  else if (preset === '30d') start.setDate(start.getDate() - 30);
  else if (preset === '90d') start.setDate(start.getDate() - 90);
  else start.setTime(Date.UTC(2020, 0, 1));

  return [start, end];
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-CL').format(value);
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toFixed(1).replace('.', ',') + '%';
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('es-CL', {
    day: '2-digit',
    month: '2-digit',
  });
}

export default function AdminDashboardScreen() {
  const navigation = useRootNavigation();
  const { width } = useWindowDimensions();

  const [preset, setPreset] = useState<Preset>('30d');
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  const columns = width >= 1200 ? 5 : width >= 800 ? 4 : 2;
  const cardWidth = Math.max(150, (width - 48 - (columns - 1) * 12) / columns);

  const load = useCallback(async (nextPreset = preset) => {
    setError(null);
    const [start, end] = rangeForPreset(nextPreset);

    try {
      const session = await getSession();
      setSignedIn(Boolean(session));
      if (!session) {
        setData(null);
        return;
      }

      const result = await getAdminDashboard(start, end);
      setData(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(
        message.toLowerCase().includes('not_authorized')
          ? 'Esta cuenta no tiene acceso al dashboard.'
          : 'No pudimos cargar las estadísticas. Revisa la conexión y vuelve a intentar.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [preset]);

  useEffect(() => {
    void load();
  }, [load]);

  function applyPreset(next: Preset) {
    setPreset(next);
    setStartText('');
    setEndText('');
    setLoading(true);
    void load(next);
  }

  function applyCustomRange() {
    const start = new Date(startText + 'T00:00:00');
    const end = new Date(endText + 'T23:59:59.999');

    if (!startText || !endText || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setError('Usa fechas válidas en formato AAAA-MM-DD.');
      return;
    }

    setError(null);
    setRefreshing(true);
    getAdminDashboard(start, end)
      .then(setData)
      .catch(() => setError('No pudimos cargar ese rango de fechas.'))
      .finally(() => setRefreshing(false));
  }

  const rangeLabel = useMemo(() => {
    if (!data) return '';
    return `${new Date(data.range.start).toLocaleDateString('es-CL')} → ${new Date(data.range.end).toLocaleDateString('es-CL')}`;
  }, [data]);

  if (signedIn === false) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.gate}>
          <Text style={styles.logo}>AURA VS</Text>
          <Text style={styles.title}>Dashboard de estadísticas</Text>
          <Text style={styles.muted}>Inicia sesión con la cuenta administradora para continuar.</Text>
          <Pressable style={styles.primaryButton} onPress={() => navigation.navigate('Auth')}>
            <Text style={styles.primaryButtonText}>INICIAR SESIÓN</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.muted}>Cargando métricas…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.gate}>
          <Text style={styles.logo}>AURA VS</Text>
          <Text style={styles.title}>Acceso al dashboard</Text>
          <Text style={styles.error}>{error}</Text>
          <Pressable style={styles.primaryButton} onPress={() => { setLoading(true); void load(); }}>
            <Text style={styles.primaryButtonText}>REINTENTAR</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const kpis = data!.kpis;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.logo}>AURA VS</Text>
            <Text style={styles.title}>Analytics Dashboard</Text>
            <Text style={styles.muted}>{rangeLabel}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable style={styles.refreshButton} onPress={() => navigation.navigate('AdminRecovery')}>
              <Text style={styles.refreshText}>↗ Recuperación</Text>
            </Pressable>
            <Pressable
              style={styles.refreshButton}
              onPress={() => {
                setRefreshing(true);
                void load();
              }}
            >
              <Text style={styles.refreshText}>{refreshing ? '…' : '↻ Actualizar'}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.filterRow}>
          {PRESETS.map((item) => (
            <Pressable
              key={item.key}
              style={[styles.preset, preset === item.key && styles.presetActive]}
              onPress={() => applyPreset(item.key)}
            >
              <Text style={[styles.presetText, preset === item.key && styles.presetTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.customRow}>
          <TextInput
            value={startText}
            onChangeText={setStartText}
            placeholder="Desde AAAA-MM-DD"
            placeholderTextColor={colors.textMuted}
            style={styles.dateInput}
            autoCapitalize="none"
          />
          <TextInput
            value={endText}
            onChangeText={setEndText}
            placeholder="Hasta AAAA-MM-DD"
            placeholderTextColor={colors.textMuted}
            style={styles.dateInput}
            autoCapitalize="none"
          />
          <Pressable style={styles.secondaryButton} onPress={applyCustomRange}>
            <Text style={styles.secondaryButtonText}>APLICAR</Text>
          </Pressable>
        </View>

        {error && <Text style={styles.inlineError}>{error}</Text>}

        <SectionTitle title="Tráfico y adquisición" />
        <View style={styles.cardGrid}>
          <MetricCard width={cardWidth} label="Visitas web" value={formatNumber(kpis.web_visits)} detail={`${formatNumber(kpis.web_unique_visitors)} únicas`} />
          <MetricCard width={cardWidth} label="Landing" value={formatNumber(kpis.landing_views)} detail={`${formatNumber(kpis.landing_unique_visitors)} visitantes`} />
          <MetricCard width={cardWidth} label="CTR landing → CTA" value={formatPercent(data!.rates.landing_ctr)} detail={`${formatNumber(kpis.landing_cta_clicks)} clics`} />
          <MetricCard width={cardWidth} label="Registros" value={formatNumber(kpis.signup_completions)} detail={`${formatNumber(kpis.new_users)} usuarios nuevos`} />
          <MetricCard width={cardWidth} label="Primer Scan" value={formatNumber(kpis.first_scan_users)} detail={`${formatPercent(data!.rates.signup_to_scan_rate)} de registros`} />
        </View>

        <SectionTitle title="Embudo principal" />
        <View style={styles.funnel}>
          <FunnelStep label="Visitas web" value={kpis.web_unique_visitors} />
          <FunnelStep label="Landing" value={kpis.landing_unique_visitors} />
          <FunnelStep label="CTA" value={kpis.landing_cta_clicks} rate={data!.rates.landing_ctr} />
          <FunnelStep label="Registro" value={kpis.signup_completions} rate={data!.rates.signup_completion_rate} />
          <FunnelStep label="Primer Scan" value={kpis.first_scan_users} rate={data!.rates.signup_to_scan_rate} />
        </View>

        <SectionTitle title="Scanner / IA" />
        <View style={styles.cardGrid}>
          <MetricCard width={cardWidth} label="Scans completados" value={formatNumber(kpis.done_scans)} detail={`${formatPercent(data!.rates.scan_completion_rate)} de los iniciados`} />
          <MetricCard width={cardWidth} label="Usuarios que escanearon" value={formatNumber(kpis.unique_scanners)} detail={`${formatNumber(kpis.first_scan_users)} primer Scan`} />
          <MetricCard width={cardWidth} label="Aura promedio" value={kpis.avg_aura == null ? '—' : String(kpis.avg_aura)} detail={`Máxima: ${formatNumber(kpis.best_aura)}`} accent />
          <MetricCard width={cardWidth} label="Tiempo medio" value={kpis.avg_scan_seconds == null ? '—' : `${kpis.avg_scan_seconds}s`} detail="crear → analizar" />
          <MetricCard width={cardWidth} label="Fallos / rechazados" value={formatNumber(kpis.failed_scans + kpis.rejected_scans)} detail={`${formatNumber(kpis.analytics_errors)} errores de telemetría`} />
        </View>

        <SectionTitle title="Engagement y viralidad" />
        <View style={styles.cardGrid}>
          <MetricCard width={cardWidth} label="Usuarios activos" value={formatNumber(kpis.active_users)} detail="con eventos en el periodo" />
          <MetricCard width={cardWidth} label="Shares" value={formatNumber(kpis.shares)} detail={`${formatPercent(data!.rates.share_rate)} de usuarios con Scan`} />
          <MetricCard width={cardWidth} label="Challenges creados" value={formatNumber(kpis.challenge_creations)} detail={`${formatPercent(data!.rates.challenge_accept_rate)} aceptados`} />
          <MetricCard width={cardWidth} label="Challenges completados" value={formatNumber(kpis.challenge_completions)} detail={`${formatNumber(kpis.follows)} follows`} />
          <MetricCard width={cardWidth} label="Referidos activados" value={formatNumber(kpis.referrals_activated)} detail={`${formatNumber(kpis.gifts_sent)} regalos enviados`} />
        </View>

        <SectionTitle title="Coins, tienda y PRO" />
        <View style={styles.cardGrid}>
          <MetricCard width={cardWidth} label="Coins ganados" value={formatNumber(kpis.coins_earned)} detail={`${formatNumber(kpis.coins_spent)} gastados`} />
          <MetricCard width={cardWidth} label="Compras tienda" value={formatNumber(kpis.item_purchases)} detail={`${formatNumber(kpis.missions_completed)} misiones`} />
          <MetricCard width={cardWidth} label="PRO activo" value={formatNumber(kpis.active_pro_users)} detail={`${formatNumber(kpis.new_pro_users)} nuevos`} accent />
          <MetricCard width={cardWidth} label="Checkout PRO" value={formatNumber(kpis.pro_checkout_opens)} detail="intenciones de compra" />
          <MetricCard width={cardWidth} label="PWA / Push" value={formatNumber(kpis.pwa_installs)} detail={`${formatNumber(kpis.push_subscriptions)} suscripciones push`} />
        </View>

        <SectionTitle title="Evolución diaria" />
        <ChartCard title="Visitas web" data={data!.daily} field="web_visits" />
        <ChartCard title="Registros" data={data!.daily} field="registrations" />
        <ChartCard title="Scans" data={data!.daily} field="scans" />

        <SectionTitle title="De dónde viene el usuario" />
        <SourceTable sources={data!.sources} />

        <View style={styles.twoColumns}>
          <Breakdown title="Dispositivo" rows={data!.devices.map((x) => ({ label: x.device, value: x.visitors }))} />
          <Breakdown title="Navegador" rows={data!.browsers.map((x) => ({ label: x.browser, value: x.visitors }))} />
        </View>

        <SectionTitle title="Recomendaciones automáticas" />
        {data!.recommendations.map((recommendation, index) => (
          <RecommendationCard key={index} recommendation={recommendation} />
        ))}

        <SectionTitle title="Eventos más frecuentes" />
        <Breakdown
          title="Telemetría"
          rows={data!.events.slice(0, 12).map((x) => ({ label: x.event_name, value: x.count }))}
        />

        <View style={styles.footer}>
          <Text style={styles.muted}>
            Dashboard agregado. No expone emails, videos ni filas individuales al navegador; las métricas se calculan en Supabase.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function MetricCard({
  width,
  label,
  value,
  detail,
  accent,
}: {
  width: number;
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <View style={[styles.metricCard, { width }]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, accent && styles.metricAccent]}>{value}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </View>
  );
}

function FunnelStep({ label, value, rate }: { label: string; value: number; rate?: number }) {
  return (
    <View style={styles.funnelStep}>
      <Text style={styles.funnelLabel}>{label}</Text>
      <Text style={styles.funnelValue}>{formatNumber(value)}</Text>
      {rate != null && <Text style={styles.funnelRate}>{formatPercent(rate)}</Text>}
    </View>
  );
}

function ChartCard({
  title,
  data,
  field,
}: {
  title: string;
  data: DashboardDaily[];
  field: keyof DashboardDaily;
}) {
  const values = data.map((row) => Number(row[field] ?? 0));
  const max = Math.max(1, ...values);

  return (
    <View style={styles.chartCard}>
      <View style={styles.chartHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.chartTotal}>{formatNumber(values.reduce((sum, value) => sum + value, 0))}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chart}>
          {data.map((row, index) => {
            const value = Number(row[field] ?? 0);
            const height = Math.max(value ? 4 : 1, Math.round((value / max) * 120));
            return (
              <View key={row.day} style={styles.barColumn}>
                <Text style={styles.barValue}>{value || ''}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.bar, { height }]} />
                </View>
                <Text style={styles.barLabel}>{formatDate(row.day)}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function SourceTable({ sources }: { sources: AdminDashboardData['sources'] }) {
  if (!sources.length) {
    return <View style={styles.emptyCard}><Text style={styles.muted}>Todavía no hay atribuciones registradas.</Text></View>;
  }

  return (
    <View style={styles.tableCard}>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.cell, styles.sourceCell]}>FUENTE</Text>
            <Text style={styles.cell}>VISITAS</Text>
            <Text style={styles.cell}>REGISTROS</Text>
            <Text style={styles.cell}>1º SCAN</Text>
            <Text style={styles.cell}>SHARES</Text>
          </View>
          {sources.map((source, index) => (
            <View key={`${source.source}-${source.medium}-${source.campaign}-${index}`} style={styles.tableRow}>
              <View style={styles.cellView}>
                <Text style={styles.cellMain}>{source.source}</Text>
                <Text style={styles.cellSub}>{source.medium} · {source.campaign}</Text>
              </View>
              <Text style={styles.cell}>{formatNumber(source.visitors)}</Text>
              <Text style={styles.cell}>{formatNumber(source.signups)}</Text>
              <Text style={styles.cell}>{formatNumber(source.first_scanners)}</Text>
              <Text style={styles.cell}>{formatNumber(source.sharers)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: number }>;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));

  return (
    <View style={styles.breakdownCard}>
      <Text style={styles.cardTitle}>{title}</Text>
      {rows.length ? rows.map((row) => (
        <View key={row.label} style={styles.breakdownRow}>
          <View style={styles.breakdownText}>
            <Text style={styles.cellMain}>{row.label}</Text>
            <Text style={styles.cellSub}>{formatNumber(row.value)}</Text>
          </View>
          <View style={styles.breakdownTrack}>
            <View style={[styles.breakdownFill, { width: `${Math.max(3, (row.value / max) * 100)}%` }]} />
          </View>
        </View>
      )) : <Text style={styles.muted}>Sin datos.</Text>}
    </View>
  );
}

function RecommendationCard({ recommendation }: { recommendation: DashboardRecommendation }) {
  const isHigh = recommendation.priority === 'high';
  const isMedium = recommendation.priority === 'medium';

  return (
    <View style={[styles.recommendation, isHigh && styles.recommendationHigh, isMedium && styles.recommendationMedium]}>
      <View style={styles.recommendationBadge}>
        <Text style={styles.recommendationBadgeText}>
          {isHigh ? 'ALTA' : isMedium ? 'MEDIA' : recommendation.priority === 'ok' ? 'OK' : 'INFO'}
        </Text>
      </View>
      <View style={styles.recommendationBody}>
        <Text style={styles.recommendationTitle}>{recommendation.title}</Text>
        <Text style={styles.recommendationDetail}>{recommendation.detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 64,
    maxWidth: 1600,
    width: '100%',
    alignSelf: 'center',
  },
  gate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 20,
  },
  logo: {
    ...typography.eyebrow,
    color: colors.secondary,
    marginBottom: 6,
  },
  title: {
    ...typography.hero,
    color: colors.textPrimary,
  },
  muted: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 6,
  },
  error: {
    ...typography.body,
    color: colors.danger,
    textAlign: 'center',
    marginVertical: 16,
  },
  inlineError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: -8,
    marginBottom: 12,
  },
  refreshButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  refreshText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '800',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  preset: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.surface,
  },
  presetActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  presetText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '800',
  },
  presetTextActive: {
    color: colors.onAccent,
  },
  customRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
  },
  dateInput: {
    minWidth: 160,
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
  primaryButton: {
    marginTop: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    paddingHorizontal: 22,
    paddingVertical: 13,
  },
  primaryButtonText: {
    ...typography.caption,
    color: colors.onAccent,
    fontWeight: '900',
  },
  secondaryButton: {
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  secondaryButtonText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '900',
  },
  sectionTitle: {
    ...typography.title,
    color: colors.textPrimary,
    marginTop: 26,
    marginBottom: 12,
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metricCard: {
    minHeight: 116,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  metricLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  metricValue: {
    ...typography.display,
    fontSize: 30,
    color: colors.textPrimary,
    marginTop: 8,
  },
  metricAccent: {
    color: colors.accent,
  },
  metricDetail: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 4,
  },
  funnel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  funnelStep: {
    flex: 1,
    minWidth: 120,
    padding: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  funnelLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  funnelValue: {
    ...typography.title,
    color: colors.textPrimary,
    marginTop: 6,
  },
  funnelRate: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '800',
    marginTop: 4,
  },
  chartCard: {
    padding: 16,
    marginBottom: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardTitle: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  chartTotal: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '800',
  },
  chart: {
    minHeight: 158,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingTop: 12,
    paddingBottom: 4,
  },
  barColumn: {
    width: 32,
    height: 150,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  barValue: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 9,
    height: 16,
  },
  barTrack: {
    width: 14,
    height: 120,
    justifyContent: 'flex-end',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  bar: {
    width: '100%',
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
  },
  barLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 9,
    marginTop: 5,
  },
  tableCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  table: {
    minWidth: 760,
  },
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
  cellView: {
    width: 280,
    paddingRight: 14,
  },
  cell: {
    width: 110,
    color: colors.textSecondary,
    ...typography.caption,
    fontWeight: '800',
    textAlign: 'right',
  },
  sourceCell: {
    textAlign: 'left',
  },
  cellMain: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  cellSub: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  twoColumns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  breakdownCard: {
    flex: 1,
    minWidth: 280,
    padding: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  breakdownRow: {
    marginTop: 14,
  },
  breakdownText: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  breakdownTrack: {
    height: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginTop: 6,
  },
  breakdownFill: {
    height: '100%',
    backgroundColor: colors.secondary,
    borderRadius: radius.pill,
  },
  emptyCard: {
    padding: 24,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  recommendation: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    marginBottom: 10,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  recommendationHigh: {
    borderColor: colors.danger,
  },
  recommendationMedium: {
    borderColor: colors.secondary,
  },
  recommendationBadge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  recommendationBadgeText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '900',
  },
  recommendationBody: {
    flex: 1,
  },
  recommendationTitle: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  recommendationDetail: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 20,
  },
  footer: {
    marginTop: 28,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});
