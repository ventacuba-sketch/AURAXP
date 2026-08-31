import { Platform } from 'react-native';

import { colors } from '../theme/colors';

/**
 * Todo lo que la card necesita para dibujarse -- deliberadamente NO es el
 * `Challenge`/`ChallengeListItem` completo: cada caller arma este objeto a
 * mano desde datos que YA tiene en memoria, así que acá nunca puede colarse
 * un user id, un scan path ni ningún otro dato que no sea explícitamente
 * apto para compartir en público (ver auditoría de seguridad -- L). Nada
 * de esto se sube a ningún lado: la imagen se genera y se comparte/
 * descarga enteramente en el dispositivo de quien comparte.
 */
export interface ShareCardData {
  meUsername: string;
  meAvatarEmoji: string;
  meScore: number;
  rivalUsername: string;
  rivalAvatarEmoji: string;
  rivalScore: number;
  isTie: boolean;
  /** Ignorado si `isTie` es true. */
  iWon: boolean;
}

const CARD_W = 1080;
const CARD_H = 1350;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function drawPlayerColumn(
  ctx: CanvasRenderingContext2D,
  x: number,
  username: string,
  avatarEmoji: string,
  score: number,
  isWinner: boolean,
  isMe: boolean,
) {
  const scoreColor = isMe ? colors.accent : colors.secondary;

  if (isWinner) {
    ctx.save();
    ctx.shadowColor = colors.accent;
    ctx.shadowBlur = 40;
  }
  ctx.font = '160px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(avatarEmoji || '🙂', x, 560);
  if (isWinner) ctx.restore();

  ctx.font = '700 40px sans-serif';
  ctx.fillStyle = isWinner ? colors.accent : colors.textSecondary;
  ctx.fillText(`${isWinner ? '🏆 ' : ''}@${truncate(username, 14)}`, x, 660);

  ctx.font = '800 76px sans-serif';
  ctx.fillStyle = scoreColor;
  ctx.fillText(`${score >= 0 ? '+' : ''}${score.toLocaleString()}`, x, 760);

  ctx.font = '600 28px sans-serif';
  ctx.fillStyle = colors.textMuted;
  ctx.fillText('AURA', x, 800);
}

/**
 * Dibuja la result card en un <canvas> real (drawing API estándar del
 * navegador -- cero dependencias nuevas, cero costo, cero servicio
 * externo) y devuelve un PNG como Blob. Solo web: en nativo, `<canvas>` no
 * existe sin una librería adicional (react-native-skia / expo-gl) que
 * implicaría un cambio de dependencias nativas + rebuild que este sandbox
 * no puede compilar ni probar en un dispositivo real -- ver el fallback de
 * solo-texto en shareChallengeResult (services/challengeService.ts) para
 * ese caso. `null` en nativo o si algo falla generando el canvas.
 */
export async function generateChallengeShareCardBlob(data: ShareCardData): Promise<Blob | null> {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Fondo: gradiente oscuro con un toque de los dos acentos de marca --
    // mismo lenguaje visual que el resto de la app (theme/colors.ts), no
    // una paleta inventada para esta pieza.
    const bg = ctx.createLinearGradient(0, 0, 0, CARD_H);
    bg.addColorStop(0, '#14101F');
    bg.addColorStop(0.5, colors.background);
    bg.addColorStop(1, '#0F1512');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    // Glow sutil violeta arriba / lima abajo -- da profundidad sin
    // saturar, legible igual en la miniatura chica que arma WhatsApp.
    const glowTop = ctx.createRadialGradient(CARD_W / 2, 40, 20, CARD_W / 2, 40, 500);
    glowTop.addColorStop(0, 'rgba(177,140,255,0.25)');
    glowTop.addColorStop(1, 'rgba(177,140,255,0)');
    ctx.fillStyle = glowTop;
    ctx.fillRect(0, 0, CARD_W, 600);

    const glowBottom = ctx.createRadialGradient(CARD_W / 2, CARD_H, 20, CARD_W / 2, CARD_H, 600);
    glowBottom.addColorStop(0, 'rgba(198,255,61,0.15)');
    glowBottom.addColorStop(1, 'rgba(198,255,61,0)');
    ctx.fillStyle = glowBottom;
    ctx.fillRect(0, CARD_H - 700, CARD_W, 700);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // Wordmark
    ctx.font = '800 72px sans-serif';
    ctx.fillStyle = colors.textPrimary;
    ctx.fillText('AURA VS', CARD_W / 2, 190);
    ctx.font = '800 56px sans-serif';
    ctx.fillStyle = colors.accent;
    ctx.fillText('⚡', CARD_W / 2 + 260, 190);

    const meIsWinner = !data.isTie && data.iWon;
    const rivalIsWinner = !data.isTie && !data.iWon;

    drawPlayerColumn(ctx, CARD_W * 0.27, data.meUsername, data.meAvatarEmoji, data.meScore, meIsWinner, true);
    drawPlayerColumn(ctx, CARD_W * 0.73, data.rivalUsername, data.rivalAvatarEmoji, data.rivalScore, rivalIsWinner, false);

    // Badge "VS" central
    ctx.beginPath();
    ctx.arc(CARD_W / 2, 560, 74, 0, Math.PI * 2);
    ctx.strokeStyle = colors.borderStrong;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = '800 44px sans-serif';
    ctx.fillStyle = colors.textMuted;
    ctx.fillText('VS', CARD_W / 2, 578);

    // Línea de resultado
    ctx.font = '800 60px sans-serif';
    ctx.fillStyle = colors.textPrimary;
    const resultText = data.isTie
      ? '🤝 EMPATE'
      : `🏆 ${truncate((meIsWinner ? data.meUsername : data.rivalUsername).toUpperCase(), 16)} GANA`;
    ctx.fillText(resultText, CARD_W / 2, 1020);

    // Footer / CTA
    ctx.font = '600 40px sans-serif';
    ctx.fillStyle = colors.textSecondary;
    ctx.fillText('¿TIENES MÁS AURA?', CARD_W / 2, 1210);
    ctx.font = '800 52px sans-serif';
    ctx.fillStyle = colors.accent;
    ctx.fillText('auravs.app', CARD_W / 2, 1270);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/png', 0.95);
    });
  } catch (e) {
    console.warn('generateChallengeShareCardBlob failed', e);
    return null;
  }
}
