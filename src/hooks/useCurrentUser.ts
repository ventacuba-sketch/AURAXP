import { fetchCurrentUser } from '../services/api';
import { useAsyncData } from './useAsyncData';

/**
 * Loads the current user via the placeholder service layer.
 * Backed by mock data today; the loading contract stays the same once a
 * real API is wired in.
 */
export function useCurrentUser() {
  const { data: user, loading, refetch } = useAsyncData(fetchCurrentUser);
  return { user, loading, refetch };
}
