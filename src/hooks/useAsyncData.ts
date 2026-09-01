import { useCallback, useEffect, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  /** Re-runs `loader` and updates `data` -- e.g. after Editar Perfil saves. */
  refetch: () => void;
}

/**
 * Generic "load once on mount" hook for the placeholder service layer.
 * Screens call this directly with a fetch function (e.g. `useAsyncData(fetchLatestReplay)`)
 * instead of hand-rolling the same effect/state boilerplate per screen.
 */
export function useAsyncData<T>(loader: () => Promise<T>): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let mounted = true;
    setLoading(true);
    loader().then((result) => {
      if (mounted) {
        setData(result);
        setLoading(false);
      }
    });
    return () => {
      mounted = false;
    };
    // Intentionally stable across renders — callers pass a stable loader reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => load(), [load]);

  return { data, loading, refetch: load };
}
