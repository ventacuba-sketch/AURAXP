import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { countMyTurnChallenges } from '../services/challengeService';

/**
 * Cuántos Challenges están genuinamente esperando que YO haga mi Scan ahora
 * mismo -- dato real (ver challengeService.countMyTurnChallenges), nunca
 * inventado. `null` mientras no hay nada que mostrar (sin sesión, sin
 * Supabase, o simplemente 0) -- Home/Profile deciden ocultar el badge en
 * vez de mostrar "0 desafíos pendientes".
 *
 * Mismo patrón que DailyScanCounter: refresca cada vez que la pantalla que
 * lo usa vuelve a foco (volver de hacer un Scan, de cancelar un desafío,
 * etc. siempre termina volviendo a un tab), sin necesitar un evento dedicado.
 */
export function useMyTurnChallengeCount(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      countMyTurnChallenges().then((result) => {
        if (!cancelled) setCount(result);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return count;
}
