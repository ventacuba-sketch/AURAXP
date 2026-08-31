/**
 * Shared domain types for AURAXP.
 *
 * These describe the shape of data the UI expects. For this MVP everything
 * is backed by placeholder/mock data (see `src/services`) instead of a real
 * backend or AI API.
 */
import type { NavigatorScreenParams } from '@react-navigation/native';

/** Bottom tabs — always-available destinations. */
export type MainTabParamList = {
  Home: undefined;
  Scan: undefined;
  Profile: undefined;
};

/**
 * Root stack — hosts the tab navigator plus the flow screens that get
 * pushed on top of it: Home/Scan -> Upload/Capture -> Analyzing ->
 * ScanResult (Aura Replay) -> Challenge / Share.
 *
 * `challengeToken` rides along into Upload when the flow started from
 * accepting a shared challenge, so the finished scan can be linked back
 * to it. `scanId` is the real backend scan, created by Upload before it
 * navigates to Analyzing — when absent (Supabase not configured yet),
 * both Analyzing and ScanResult fall back to mock data.
 */
export type RootStackParamList = {
  /** `{ screen: 'Profile' }` etc. salta directo a un tab puntual (p. ej.
   * desde el link "Ver perfil" del XP en ScanResult) -- `undefined` cae
   * en el tab por default (Home). */
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  Upload:
    | {
        challengeToken?: string;
        /** Vuelta desde Record con un video recién grabado (ver RecordScreen). */
        recordedUri?: string;
        recordedDurationMs?: number;
      }
    | undefined;
  Record: { challengeToken?: string } | undefined;
  /** `challengeToken` viaja hasta acá para que Analyzing sepa, al terminar,
   * si tiene que resolver un Challenge en vez de ir al Aura Replay normal. */
  Analyzing: { scanId?: string; challengeToken?: string } | undefined;
  ScanResult: { scanId?: string } | undefined;
  /** Exactamente uno de los dos: `scanId` (creando un Challenge nuevo desde
   * tu propio scan) o `challengeToken` (viendo/esperando uno ya existente,
   * como oponente que ya aceptó o como creador que vuelve a chequear). */
  Challenge: { scanId?: string; challengeToken?: string } | undefined;
  ChallengeLanding: { token: string };
  /** Placeholder de beneficios PRO -- sin checkout todavía, ver DailyScanCounter. */
  Pro: undefined;
  /** Solo registrada en el navigator cuando no hay sesión — ver RootNavigator. */
  Auth: undefined;
  /** Solo registrada mientras useAuth().passwordRecovery es true (volviendo
   * del link de "olvidé mi contraseña") — ver RootNavigator. */
  ResetPassword: undefined;
  /** Historial paginado de Challenges del usuario -- ver MyChallengesScreen. */
  MyChallenges: undefined;
  /** Top XP + posición propia -- ver RankingScreen. */
  Ranking: undefined;
};

export interface User {
  id: string;
  username: string;
  avatarEmoji: string;
  bio: string | null;
  founderNumber: string; // e.g. "00428" -> shown as "FOUNDER #00428"
  level: number;
  xp: number;
  xpToNextLevel: number;
  streakDays: number;
  /** null = todavía no cambió el username desde que existe esta columna -> puede hacerlo ya. */
  usernameUpdatedAt: string | null;
}

/** A short, timestamped highlight surfaced on Home ("Latest Replay"). */
export interface ReplayHighlight {
  id: string;
  xpDelta: number;
  momentLabel: string; // "Cold entrance"
  timestamp: string; // relative time, e.g. "2h ago"
}

/** A friend's outstanding challenge — shown on Home and on the Challenge (versus) screen. */
export interface FriendChallenge {
  id: string;
  friendName: string;
  friendScore: number;
  prompt: string; // "Can you beat it?"
}

/** One scored beat inside a replay's breakdown timeline. */
export interface TimelineEvent {
  time: string; // "0:01"
  delta: number; // positive or negative XP
  label: string; // "COLD ENTRANCE"
}

/** The four mini stats shown under a scored replay, each on a 0-100 scale. */
export interface AuraStats {
  confidence: number;
  style: number;
  timing: number;
  cringeRisk: number;
}

export type ScanVerdict = 'verified' | 'pending' | 'rejected';

/**
 * A scored "Aura Replay" — the result of running a moment through AURAXP.
 *
 * `auraScore` and `xpAwarded` are deliberately separate numbers: Aura
 * measures how good/bad THIS moment was (can be negative, is what gets
 * shared/challenged); XP is the small, always-positive amount that adds
 * to the user's lifetime progression. Never conflate the two.
 */
export interface ScanResult {
  id: string;
  verdict: ScanVerdict;
  verdictTag: string; // short, punchy verdict — "CASI LEGENDARIO"
  verdictHeadline: string; // one-line explanation — "Mirar atrás te costó llegar a los 10K."
  auraScore: number;
  xpAwarded: number;
  timeline: TimelineEvent[];
  stats: AuraStats;
  createdAt: string;
  /** Ruta del video en Supabase Storage (bucket "scans"), no una URL — el
   * bucket es privado, así que hace falta mintear una signed URL para
   * reproducirlo (ver getVideoPlaybackUrl en scanService.ts). null en modo
   * mock o si el scan no tiene video asociado. */
  videoPath: string | null;
}

/** A chain of friends who've passed a challenge along. */
export interface AuraChain {
  names: string[]; // ["You", "Carlos", "Ana", "Leo"]
}

export type ChallengeStatus = 'pending' | 'accepted' | 'completed' | 'cancelled' | 'expired';

/** Public preview of a shared challenge — served by get-challenge-preview, no auth needed. */
export interface ChallengePreview {
  fromUsername: string;
  fromAvatarEmoji: string;
  auraScore: number;
  verdictTag: string;
  status: ChallengeStatus;
}

/** One side of a real 1v1 Challenge — creator or opponent. */
export interface ChallengeParticipant {
  userId: string;
  username: string;
  avatarEmoji: string;
  /** null hasta que el scan de este participante exista y esté `done`. */
  auraScore: number | null;
  stats: AuraStats | null;
  verdictTag: string | null;
  videoPath: string | null;
  scanId: string | null;
  scanStatus: 'pending' | 'processing' | 'done' | 'failed' | 'rejected' | null;
}

/** Vista completa y autenticada de un Challenge — para el creador esperando
 * rival, el oponente ya aceptado, o cualquiera de los dos viendo el
 * resultado. Servida directo desde `challenges` vía RLS (challengeService). */
export interface Challenge {
  id: string;
  shareToken: string;
  status: ChallengeStatus;
  creator: ChallengeParticipant;
  /** null mientras nadie aceptó todavía. */
  opponent: ChallengeParticipant | null;
  winnerUserId: string | null;
  isTie: boolean;
  creatorXpAwarded: number | null;
  opponentXpAwarded: number | null;
  expiresAt: string;
}

/**
 * Una fila de "MIS DESAFÍOS" -- versión liviana de `Challenge` pensada para
 * listas paginadas: solo lo que la card compacta necesita mostrar, ya
 * resuelta desde el punto de vista de "quién soy yo" (así la pantalla no
 * tiene que repetir `isCreator ? ... : ...` en cada campo). Sale de la
 * MISMA tabla `challenges` -- no hay una tabla de historial separada, ver
 * challengeService.listMyChallenges.
 */
export interface ChallengeListItem {
  id: string;
  shareToken: string;
  status: ChallengeStatus;
  createdAt: string;
  isCreator: boolean;
  myScanId: string | null;
  myAuraScore: number | null;
  /** null mientras nadie aceptó todavía (challenge 'pending' del que soy creador). */
  rival: { userId: string; username: string; avatarEmoji: string } | null;
  rivalAuraScore: number | null;
  winnerUserId: string | null;
  isTie: boolean;
  myXpAwarded: number | null;
}
