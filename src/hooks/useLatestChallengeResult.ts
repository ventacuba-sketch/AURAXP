import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { ChallengeResultEvent, getLatestChallengeResultEvent } from '../services/challengeService';

/**
 * Notificación in-app mínima (I): el resultado de Challenge más reciente
 * que me involucra, si hay uno -- ver challengeService.getLatestChallenge
 * ResultEvent para por qué es solo esto y no un inbox completo con leído/
 * no-leído (necesitaría una tabla nueva, no implementada todavía).
 */
export function useLatestChallengeResult(): ChallengeResultEvent | null {
  const [event, setEvent] = useState<ChallengeResultEvent | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getLatestChallengeResultEvent().then((result) => {
        if (!cancelled) setEvent(result);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return event;
}
