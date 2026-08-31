import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { countReceivedChallenges } from '../services/challengeService';

/** Cuántos Challenges DIRIGIDOS me llegaron y esperan mi ACEPTAR/RECHAZAR
 * -- real, ver challengeService.countReceivedChallenges. Mismo patrón de
 * refresco por foco que useMyTurnChallengeCount. */
export function useReceivedChallengeCount(): number | null {
  const [count, setCount] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      countReceivedChallenges().then((result) => {
        if (!cancelled) setCount(result);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return count;
}
