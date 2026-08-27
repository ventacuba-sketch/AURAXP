import { useEffect, useState } from 'react';

import { fetchChallenges } from '../services/api';
import { Challenge } from '../types';

/** Loads the challenge list via the placeholder service layer. */
export function useChallenges() {
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchChallenges().then((result) => {
      if (mounted) {
        setChallenges(result);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  return { challenges, loading };
}
