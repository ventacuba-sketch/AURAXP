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

import { ChatDashboardData, getAdminChatDashboard } from '../services/adminAnalyticsService';
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

function n(value: number | null | undefined): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 }).format(value);
}

function pct(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toFixed(1).replace('.', ',')}%`;
}

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
}

export default function AdminChatDashboardScreen() {
  const { width } = useWindowDimensions();
  const [preset, setPreset] = useState<Preset>('30d');
  const [startText, setStartText] = useState('');
  const [endText, setEndText] = useState('');
  const [data, setData] = useState<ChatDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const columns = width >= 1200 ? 5 : width >= 800 ? 4 : 2;
  const usableWidth = Math.min(width, 1600) - 48;
  const cardWidth = Math.max(145, (usableWidth - (columns - 1) * 12) / columns);

  const loadRange = useCallback(async (start: Date, end: Date) => {
    setError(null);
    try {
      const result = await getAdminChatDashboard(start, end);
      setData(result);
    } catch (e) {
      const message = e instanceof Error ? e.message.toLowerCase() : '';
      setError(message.includes('not_authorized') ? 'Esta cuenta no tiene acceso a estas estadísticas.' : 'No pudimos cargar las estadísticas del chat.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadPreset = useCallback((next: Preset) => {
    const [start, end] = rangeForPreset(next);
    return loadRange(start, end);
  }, [loadRange]);

  useEffect(() => {
    void loadPreset('30d');
  }, [loadPreset]);

  function applyPreset(next: Preset) {
    setPreset(next);
    setStartText('');
    setEndText('');
    setRefreshing(true);
    void loadPreset(next);
  }

  function applyCustomRange() {
    const start = new Date(`${startText}T00:00:00`);
    const end = new Date(`${endText}T23:59:59.999`);
    if (!startText || !endText || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setError('Usa fechas válidas en formato AAAA-MM-DD.');
      return;
    }
    setRefreshing(true);
    void loadRange(start, end);
  }

  const rangeLabel = useMemo(() => {
    if (!data) return '';
    return `${new Date(data.range.start).toLocaleDateString('es-CL')} → ${new Date(data.range.end).toLocaleDateString('es-CL')}`;
  }, [data]);

  if (loading && !data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={styles.muted}>Cargando estadísticas del chat…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!data) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <Text style={styles.title}>Chat Analytics</Text>
          <Text style={styles.error}>{error ?? 'Sin datos.'}</Text>
          <Pressable style={styles.primaryButton} onPress={() => { setLoading(true); void loadPreset(preset); }}>
            <Text style={styles.primaryButtonText}>REINTENTAR</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const k = data.kpis;
  const r = data.rates;
  const hourlyRank = [...data.hourly]
    .map((row) => ({ label: `${String(row.hour).padStart(2, '0')}:00`, value: row.views + row.global_messages + row.private_messages }))
    .sort((a, b) => b.value - a.value);

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.logo}>SALA DEL AURA</Text>
            <Text style={styles.title}>Estadísticas del Chat</Text>
            <Text style={styles.muted}>{rangeLabel} · horario Chile</Text>
          </View>
          <Pressable style={styles.refreshButton} onPress={() => { setRefreshing(true); void loadPreset(preset); }}>
            <Text style={styles.refreshText}>{refreshing ? '…' : '↻ Actualizar'}</Text>
          </Pressable>
        </View>

        <View style={styles.filterRow}>
          {PRESETS.map((item) => (
            <Pressable key={item.key} style={[styles.preset, preset === item.key && styles.presetActive]} onPress={() => applyPreset(item.key)}>
              <Text style={[styles.presetText, preset === item.key && styles.presetTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.customRow}>
          <TextInput value={startText} onChangeText={setStartText} placeholder="Desde AAAA-MM-DD" placeholderTextColor={colors.textMuted} style={styles.dateInput} />
          <TextInput value={endText} onChangeText={setEndText} placeholder="Hasta AAAA-MM-DD" placeholderTextColor={colors.textMuted} style={styles.dateInput} />
          <Pressable style={styles.secondaryButton} onPress={applyCustomRange}><Text style={styles.secondaryButtonText}>APLICAR</Text></Pressable>
        </View>
        {error && <Text style={styles.inlineError}>{error}</Text>}

        <Section title="Audiencia y retención" subtitle="Quién entra a la Sala del Aura y cuántos regresan." />
        <View style={styles.cardGrid}>
          <Metric width={cardWidth} label="Entradas al chat" value={n(k.chat_views)} detail="aperturas totales" accent />
          <Metric width={cardWidth} label="Visitantes únicos" value={n(k.unique_chat_visitors)} detail={`${n(k.registered_chat_viewers)} registrados`} />
          <Metric width={cardWidth} label="Visitantes que regresan" value={n(k.returning_chat_visitors)} detail={`${pct(r.returning_visitor_rate)} de los únicos`} />
          <Metric width={cardWidth} label="Invitados creados" value={n(k.guest_created)} detail="identidades guest" />
          <Metric width={cardWidth} label="Miembros abierto" value={n(k.members_opens)} detail={`${n(k.profile_opens)} perfiles abiertos`} />
        </View>

        <Section title="Sala Global" subtitle="Actividad real de mensajes y reacciones." />
        <View style={styles.cardGrid}>
          <Metric width={cardWidth} label="Mensajes globales" value={n(k.global_messages)} detail={`${n(k.global_unique_senders)} emisores`} accent />
          <Metric width={cardWidth} label="Mensajes por emisor" value={n(r.messages_per_sender)} detail="promedio del periodo" />
          <Metric width={cardWidth} label="Emisores registrados" value={n(k.registered_global_senders)} detail={`${n(k.guest_global_senders)} invitados`} />
          <Metric width={cardWidth} label="Reacciones" value={n(k.reactions)} detail={`${n(k.unique_reactors)} personas · ${n(r.reactions_per_100_messages)}/100 mensajes`} />
          <Metric width={cardWidth} label="Largo promedio" value={k.avg_global_message_length == null ? '—' : `${n(k.avg_global_message_length)} car.`} detail="texto por mensaje" />
          <Metric width={cardWidth} label="Ocultados/moderados" value={n(k.hidden_global_messages)} detail="mensajes globales" />
        </View>

        <Section title="Conversión desde el Chat" subtitle="Mide si el chat convierte invitados en cuentas y luego en usuarios del producto." />
        <View style={styles.funnel}>
          <Funnel label="Prompt de registro" value={k.signup_prompted} />
          <Funnel label="Registro iniciado" value={k.signup_started_visitors} />
          <Funnel label="Registro completado" value={k.signup_completed_visitors} rate={r.chat_signup_completion_rate} />
          <Funnel label="Primer Scan" value={k.first_scan_visitors} rate={r.chat_signup_to_first_scan_rate} />
        </View>
        <View style={[styles.cardGrid, styles.topGap]}>
          <Metric width={cardWidth} label="CTA Scan" value={n(k.scan_cta_clicks)} detail="clics desde chat" />
          <Metric width={cardWidth} label="Invitar amigos" value={n(k.invite_clicks)} detail="clics de invitación" />
          <Metric width={cardWidth} label="Follow" value={n(k.follow_clicks)} detail="intentos desde chat" />
          <Metric width={cardWidth} label="Perfiles abiertos" value={n(k.profile_opens)} detail="desde sala/miembros" />
        </View>

        <Section title="Recompensa de invitados" subtitle="Control de los 200 Coins entregados por entrar como invitado y luego registrarse." />
        <View style={styles.cardGrid}>
          <Metric width={cardWidth} label="Recompensas emitidas" value={n(k.guest_rewards_issued)} detail={`${n(k.guest_reward_coins_issued)} Coins comprometidos`} />
          <Metric width={cardWidth} label="Recompensas cobradas" value={n(k.guest_rewards_claimed)} detail={`${n(k.guest_reward_coins_claimed)} Coins entregados`} accent />
          <Metric width={cardWidth} label="Tasa de cobro" value={pct(r.guest_reward_claim_rate)} detail="emitidas → cobradas" />
        </View>

        <Section title="Chats privados" subtitle="Solicitudes, aceptación y actividad. Nunca se muestran contenidos de mensajes privados." />
        <View style={styles.cardGrid}>
          <Metric width={cardWidth} label="Privados abierto" value={n(k.private_inbox_opens)} detail={`${n(k.private_conversation_opens)} conversaciones abiertas`} />
          <Metric width={cardWidth} label="Solicitudes" value={n(k.private_requests)} detail={`${n(k.private_requests_pending)} pendientes`} />
          <Metric width={cardWidth} label="Aceptadas" value={n(k.private_requests_accepted)} detail={`${pct(r.private_accept_rate)} de solicitudes`} accent />
          <Metric width={cardWidth} label="Respondidas" value={pct(r.private_response_rate)} detail={`${n(k.private_requests_rejected)} rechazadas · ${n(k.private_requests_cancelled)} canceladas`} />
          <Metric width={cardWidth} label="Conversaciones creadas" value={n(k.private_conversations_created)} detail={`${n(k.private_active_conversations)} con mensajes`} />
          <Metric width={cardWidth} label="Activación privado" value={pct(r.private_conversation_activation_rate)} detail="conversación → mensajes" />
          <Metric width={cardWidth} label="Mensajes privados" value={n(k.private_messages)} detail={`${n(k.private_unique_senders)} emisores`} accent />
          <Metric width={cardWidth} label="Mensajes / conversación" value={n(r.private_messages_per_active_conversation)} detail="solo conversaciones activas" />
          <Metric width={cardWidth} label="Largo promedio privado" value={k.avg_private_message_length == null ? '—' : `${n(k.avg_private_message_length)} car.`} detail="sin exponer contenido" />
          <Metric width={cardWidth} label="Bloqueos" value={n(k.blocks)} detail={`${n(k.hidden_private_messages)} mensajes privados ocultos`} />
        </View>

        <Section title="Evolución diaria" subtitle="Tendencia de uso y conversación." />
        <ChatChart title="Entradas al chat" data={data.daily} field="views" />
        <ChatChart title="Mensajes Sala Global" data={data.daily} field="global_messages" />
        <ChatChart title="Mensajes privados" data={data.daily} field="private_messages" />
        <ChatChart title="Reacciones" data={data.daily} field="reactions" />
        <ChatChart title="Registros completados desde Chat" data={data.daily} field="signup_completions" />
        <ChatChart title="Primer Scan desde Chat" data={data.daily} field="first_scans" />

        <Section title="Horas de mayor actividad" subtitle="Suma de entradas + mensajes globales + mensajes privados por hora local de Chile." />
        <Breakdown rows={hourlyRank} />

        <View style={styles.twoColumns}>
          <View style={styles.half}>
            <Section title="Usuarios más activos" subtitle="Solo Sala Global; no se rankea el contenido privado." compact />
            <Breakdown rows={data.top_global_users.map((row) => ({ label: `@${row.username}`, value: row.messages, note: row.hidden_messages ? `${row.hidden_messages} ocultos` : undefined }))} />
          </View>
          <View style={styles.half}>
            <Section title="Reacciones más usadas" subtitle="Emojis usados en la Sala Global." compact />
            <Breakdown rows={data.emojis.map((row) => ({ label: row.emoji, value: row.count }))} />
          </View>
        </View>

        <Section title="Qué provoca el registro" subtitle="Motivo por el que un invitado recibió el prompt de crear cuenta." />
        <Breakdown rows={data.signup_prompt_reasons.map((row) => ({ label: reasonLabel(row.reason), value: row.count }))} />

        <View style={styles.footer}>
          <Text style={styles.muted}>Privacidad: este panel usa métricas agregadas. No muestra emails ni el texto de conversaciones privadas.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function reasonLabel(reason: string): string {
  if (reason === 'privateMessage') return 'Enviar mensaje privado';
  if (reason === 'invite') return 'Invitar amigos';
  if (reason === 'reward') return 'Cobrar recompensa';
  if (reason === 'scan') return 'Hacer Scan';
  return reason === 'sin_dato' ? 'Sin dato' : reason;
}

function Section({ title, subtitle, compact }: { title: string; subtitle?: string; compact?: boolean }) {
  return (
    <View style={[styles.sectionHeader, compact && styles.sectionHeaderCompact]}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function Metric({ width, label, value, detail, accent }: { width: number; label: string; value: string; detail: string; accent?: boolean }) {
  return (
    <View style={[styles.metricCard, { width }]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, accent && styles.metricAccent]}>{value}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </View>
  );
}

function Funnel({ label, value, rate }: { label: string; value: number; rate?: number }) {
  return (
    <View style={styles.funnelStep}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.funnelValue}>{n(value)}</Text>
      {rate != null ? <Text style={styles.funnelRate}>{pct(rate)}</Text> : null}
    </View>
  );
}

type DailyField = 'views' | 'unique_visitors' | 'global_messages' | 'private_messages' | 'reactions' | 'signup_completions' | 'first_scans' | 'private_requests';

function ChatChart({ title, data, field }: { title: string; data: ChatDashboardData['daily']; field: DailyField }) {
  const values = data.map((row) => Number(row[field] ?? 0));
  const max = Math.max(1, ...values);
  return (
    <View style={styles.chartCard}>
      <View style={styles.chartHeader}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.chartTotal}>{n(values.reduce((sum, value) => sum + value, 0))}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chart}>
          {data.map((row) => {
            const value = Number(row[field] ?? 0);
            const height = Math.max(value ? 4 : 1, Math.round((value / max) * 120));
            return (
              <View key={`${field}-${row.day}`} style={styles.barColumn}>
                <Text style={styles.barValue}>{value || ''}</Text>
                <View style={styles.barTrack}><View style={[styles.bar, { height }]} /></View>
                <Text style={styles.barLabel}>{shortDate(row.day)}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function Breakdown({ rows }: { rows: Array<{ label: string; value: number; note?: string }> }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <View style={styles.breakdownCard}>
      {rows.length ? rows.map((row, index) => (
        <View key={`${row.label}-${index}`} style={styles.breakdownRow}>
          <View style={styles.breakdownText}>
            <Text style={styles.cellMain}>{row.label}</Text>
            <Text style={styles.cellSub}>{n(row.value)}{row.note ? ` · ${row.note}` : ''}</Text>
          </View>
          <View style={styles.breakdownTrack}><View style={[styles.breakdownFill, { width: `${Math.max(2, (row.value / max) * 100)}%` }]} /></View>
        </View>
      )) : <Text style={styles.muted}>Sin datos en este periodo.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 72, maxWidth: 1600, width: '100%', alignSelf: 'center' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18 },
  headerText: { flex: 1 },
  logo: { ...typography.eyebrow, color: colors.secondary, marginBottom: 6 },
  title: { ...typography.hero, color: colors.textPrimary },
  muted: { ...typography.body, color: colors.textSecondary, marginTop: 6 },
  error: { ...typography.body, color: colors.danger, textAlign: 'center', marginTop: 10 },
  inlineError: { ...typography.caption, color: colors.danger, marginBottom: 12 },
  refreshButton: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.surface },
  refreshText: { ...typography.caption, color: colors.textPrimary, fontWeight: '800' },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  preset: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.surface },
  presetActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  presetText: { ...typography.caption, color: colors.textSecondary, fontWeight: '800' },
  presetTextActive: { color: colors.onAccent },
  customRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  dateInput: { minWidth: 160, flexGrow: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface, color: colors.textPrimary, paddingHorizontal: 12, paddingVertical: 10, ...typography.caption },
  secondaryButton: { borderRadius: radius.md, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 16, justifyContent: 'center' },
  secondaryButtonText: { ...typography.caption, color: colors.textPrimary, fontWeight: '900' },
  primaryButton: { marginTop: 14, borderRadius: radius.pill, backgroundColor: colors.accent, paddingHorizontal: 22, paddingVertical: 13 },
  primaryButtonText: { ...typography.caption, color: colors.onAccent, fontWeight: '900' },
  sectionHeader: { marginTop: 28, marginBottom: 12 },
  sectionHeaderCompact: { marginTop: 18 },
  sectionTitle: { ...typography.title, color: colors.textPrimary },
  sectionSubtitle: { ...typography.caption, color: colors.textMuted, marginTop: 4, maxWidth: 760 },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  topGap: { marginTop: 12 },
  metricCard: { minHeight: 116, padding: 16, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  metricLabel: { ...typography.caption, color: colors.textSecondary, fontWeight: '700' },
  metricValue: { ...typography.display, fontSize: 30, color: colors.textPrimary, marginTop: 8 },
  metricAccent: { color: colors.accent },
  metricDetail: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
  funnel: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 14, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  funnelStep: { flex: 1, minWidth: 150, padding: 12, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  funnelValue: { ...typography.title, color: colors.textPrimary, marginTop: 6 },
  funnelRate: { ...typography.caption, color: colors.accent, fontWeight: '800', marginTop: 4 },
  chartCard: { padding: 16, marginBottom: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  cardTitle: { ...typography.subtitle, color: colors.textPrimary },
  chartTotal: { ...typography.caption, color: colors.accent, fontWeight: '800' },
  chart: { minHeight: 158, flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 12, paddingBottom: 4 },
  barColumn: { width: 32, height: 150, alignItems: 'center', justifyContent: 'flex-end' },
  barValue: { ...typography.caption, color: colors.textMuted, fontSize: 9, height: 16 },
  barTrack: { width: 14, height: 120, justifyContent: 'flex-end', backgroundColor: colors.surfaceAlt, borderRadius: radius.sm, overflow: 'hidden' },
  bar: { width: '100%', backgroundColor: colors.accent, borderRadius: radius.sm },
  barLabel: { ...typography.caption, color: colors.textMuted, fontSize: 9, marginTop: 5 },
  breakdownCard: { flex: 1, padding: 16, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  breakdownRow: { marginBottom: 13 },
  breakdownText: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  cellMain: { ...typography.body, color: colors.textPrimary, fontWeight: '700' },
  cellSub: { ...typography.caption, color: colors.textMuted },
  breakdownTrack: { height: 6, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, overflow: 'hidden', marginTop: 6 },
  breakdownFill: { height: '100%', backgroundColor: colors.secondary, borderRadius: radius.pill },
  twoColumns: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  half: { flex: 1, minWidth: 300 },
  footer: { marginTop: 30, paddingTop: 18, borderTopWidth: 1, borderTopColor: colors.border },
});
