/**
 * Resuelve un Challenge cuando el scan del oponente termina `done`.
 *
 * Se llama desde process-scan, SIEMPRE con el cliente `admin`
 * (service_role) -- nunca desde el cliente. El ganador nunca lo decide el
 * frontend: esta es la única ruta que escribe winner_user_id/is_tie/
 * status/XP, y lo hace con una única UPDATE ... WHERE status = 'accepted'
 * que solo puede tener éxito una vez -- eso es lo que hace el pago de XP
 * idempotente frente a reintentos (un segundo scan que reintente linkear
 * el mismo challengeToken, un reprocesamiento, etc.).
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  CHALLENGE_PARTICIPATION_XP,
  CHALLENGE_TIE_BONUS_XP,
  CHALLENGE_WINNER_BONUS_XP,
  computeLevel,
} from './scoring.ts';

type AdminClient = ReturnType<typeof createClient>;

interface ResolveParams {
  admin: AdminClient;
  challengeToken: string;
  /** El usuario dueño del scan que acaba de terminar `done`. */
  opponentScanOwnerId: string;
  /** El scan que acaba de terminar `done`. */
  opponentScanId: string;
}

/**
 * Best-effort: nunca debe lanzar de forma que rompa el scan que ya se
 * guardó como `done` -- el caller la envuelve en try/catch y solo loguea.
 */
export async function resolveChallengeIfApplicable({
  admin,
  challengeToken,
  opponentScanOwnerId,
  opponentScanId,
}: ResolveParams): Promise<void> {
  const { data: challenge } = await admin
    .from('challenges')
    .select('id, from_user_id, opponent_user_id, source_scan_id, status, share_token')
    .eq('share_token', challengeToken)
    .single();

  if (!challenge) {
    console.log(JSON.stringify({ src: 'challengeResolution', event: 'no_challenge', challengeToken }));
    return;
  }

  // Defensa real, no solo UI: este scan solo puede resolver el challenge si
  // quien lo subió es EXACTAMENTE el oponente que aceptó -- un token
  // reusado por otra persona, o un scan de alguien que nunca aceptó, no
  // hace nada acá.
  if (challenge.opponent_user_id !== opponentScanOwnerId) {
    console.log(
      JSON.stringify({
        src: 'challengeResolution',
        event: 'owner_mismatch',
        challengeId: challenge.id,
        expected: challenge.opponent_user_id,
        actual: opponentScanOwnerId,
      }),
    );
    return;
  }

  if (challenge.status !== 'accepted') {
    // Ya resuelto (o cancelado/expirado) -- no hay nada que hacer. Este es
    // el caso normal en un reintento después de un resultado ya resuelto.
    console.log(
      JSON.stringify({ src: 'challengeResolution', event: 'not_acceptable_state', challengeId: challenge.id, status: challenge.status }),
    );
    return;
  }

  const [{ data: sourceScan }, { data: opponentScan }] = await Promise.all([
    admin.from('scans').select('aura_score, stats').eq('id', challenge.source_scan_id).single(),
    admin.from('scans').select('aura_score, stats').eq('id', opponentScanId).single(),
  ]);

  if (!sourceScan || !opponentScan) {
    console.log(JSON.stringify({ src: 'challengeResolution', event: 'missing_scan_data', challengeId: challenge.id }));
    return;
  }

  const { winnerUserId, isTie } = decideWinner(
    challenge.from_user_id,
    sourceScan,
    challenge.opponent_user_id,
    opponentScan,
  );

  const creatorXp = CHALLENGE_PARTICIPATION_XP + (isTie ? CHALLENGE_TIE_BONUS_XP : winnerUserId === challenge.from_user_id ? CHALLENGE_WINNER_BONUS_XP : 0);
  const opponentXp = CHALLENGE_PARTICIPATION_XP + (isTie ? CHALLENGE_TIE_BONUS_XP : winnerUserId === challenge.opponent_user_id ? CHALLENGE_WINNER_BONUS_XP : 0);

  // La única escritura que decide el resultado. El WHERE status='accepted'
  // es lo que hace esto idempotente: si por lo que sea esta función corre
  // dos veces para el mismo challenge, la segunda vez ya no encuentra la
  // fila en 'accepted' (ya está 'completed') y updated queda en 0 filas --
  // no se vuelve a pagar XP.
  const { data: updated, error: updateErr } = await admin
    .from('challenges')
    .update({
      target_scan_id: opponentScanId,
      status: 'completed',
      winner_user_id: winnerUserId,
      is_tie: isTie,
      resolved_at: new Date().toISOString(),
      creator_xp_awarded: creatorXp,
      opponent_xp_awarded: opponentXp,
    })
    .eq('id', challenge.id)
    .eq('status', 'accepted')
    .select('id');

  if (updateErr || !updated || updated.length === 0) {
    console.log(
      JSON.stringify({
        src: 'challengeResolution',
        event: 'resolve_update_no_op',
        challengeId: challenge.id,
        error: updateErr ? String(updateErr) : null,
      }),
    );
    return;
  }

  console.log(
    JSON.stringify({
      src: 'challengeResolution',
      event: 'resolved',
      challengeId: challenge.id,
      winnerUserId,
      isTie,
      creatorXp,
      opponentXp,
    }),
  );

  await Promise.all([
    awardXp(admin, challenge.from_user_id, creatorXp),
    awardXp(admin, challenge.opponent_user_id, opponentXp),
    notifyResult(admin, challenge.from_user_id, challenge.opponent_user_id, challenge.id, challenge.share_token, winnerUserId, isTie),
    // Analítica de funnel (L) -- server-side a propósito: es el único
    // lugar donde "se completó" es un hecho real y único, sin depender de
    // que cada cliente involucrado siga conectado en ese momento para
    // loguearlo él mismo.
    admin.from('analytics_events').insert([
      { event_name: 'challenge_completed', user_id: challenge.from_user_id, metadata: { challenge_id: challenge.id } },
      { event_name: 'challenge_completed', user_id: challenge.opponent_user_id, metadata: { challenge_id: challenge.id } },
    ]),
  ]);
}

/** Notificaciones in-app (ver migración notifications) -- una fila por
 * participante, cada una con SU PROPIO resultado ('won'/'lost'/'tie')
 * desde su punto de vista. Best-effort: un fallo acá nunca debe afectar
 * el pago de XP ya hecho arriba, así que solo se loguea. */
async function notifyResult(
  admin: AdminClient,
  fromUserId: string,
  opponentUserId: string,
  challengeId: string,
  shareToken: string,
  winnerUserId: string | null,
  isTie: boolean,
): Promise<void> {
  const resultFor = (userId: string) => (isTie ? 'tie' : winnerUserId === userId ? 'won' : 'lost');

  const { error } = await admin.from('notifications').insert([
    {
      user_id: fromUserId,
      kind: 'challenge_completed',
      challenge_id: challengeId,
      challenge_share_token: shareToken,
      rival_user_id: opponentUserId,
      result: resultFor(fromUserId),
    },
    {
      user_id: opponentUserId,
      kind: 'challenge_completed',
      challenge_id: challengeId,
      challenge_share_token: shareToken,
      rival_user_id: fromUserId,
      result: resultFor(opponentUserId),
    },
  ]);

  if (error) {
    console.log(JSON.stringify({ src: 'challengeResolution', event: 'notify_failed', challengeId, error: String(error) }));
  }
}

function decideWinner(
  fromUserId: string,
  fromScan: { aura_score: number | null; stats: Record<string, number> | null },
  opponentUserId: string,
  opponentScan: { aura_score: number | null; stats: Record<string, number> | null },
): { winnerUserId: string | null; isTie: boolean } {
  const fromScore = fromScan.aura_score ?? 0;
  const opponentScore = opponentScan.aura_score ?? 0;

  if (fromScore !== opponentScore) {
    return { winnerUserId: fromScore > opponentScore ? fromUserId : opponentUserId, isTie: false };
  }

  // Empate en aura_score -- desempate determinístico, en este orden fijo:
  // confidence, después timing, después style (las tres son "más alto
  // mejor", a diferencia de cringeRisk -- se deja afuera a propósito para
  // no mezclar signos en el desempate).
  const tieBreakOrder: Array<'confidence' | 'timing' | 'style'> = ['confidence', 'timing', 'style'];
  for (const key of tieBreakOrder) {
    const a = fromScan.stats?.[key] ?? 0;
    const b = opponentScan.stats?.[key] ?? 0;
    if (a !== b) return { winnerUserId: a > b ? fromUserId : opponentUserId, isTie: false };
  }

  // Empate real en todo -- se permite, tal como pide el spec.
  return { winnerUserId: null, isTie: true };
}

async function awardXp(admin: AdminClient, userId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  const { data: profile } = await admin.from('profiles').select('xp').eq('id', userId).single();
  const newXp = (profile?.xp ?? 0) + amount;
  await admin.from('profiles').update({ xp: newXp, level: computeLevel(newXp) }).eq('id', userId);
}
