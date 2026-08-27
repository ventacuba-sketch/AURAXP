import { useEffect, useState } from 'react';

import { fetchCurrentUser } from '../services/api';
import { User } from '../types';

/**
 * Loads the current user via the placeholder service layer.
 * Backed by mock data today; the loading contract stays the same once a
 * real API is wired in.
 */
export function useCurrentUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    fetchCurrentUser().then((result) => {
      if (mounted) {
        setUser(result);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  return { user, loading };
}
