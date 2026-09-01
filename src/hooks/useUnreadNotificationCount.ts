import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';

import { fetchUnreadNotificationCount } from '../services/notificationService';

/** Badge real del 🔔 en Home -- mismo patrón de refresco por foco que el
 * resto de los contadores en tiempo real de la app (DailyScanCounter,
 * useMyTurnChallengeCount). */
export function useUnreadNotificationCount(): number {
  const [count, setCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchUnreadNotificationCount().then((result) => {
        if (!cancelled) setCount(result);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return count;
}
