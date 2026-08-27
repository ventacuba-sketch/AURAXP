import { useEffect, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
}

/**
 * Generic "load once on mount" hook for the placeholder service layer.
 * Screens call this directly with a fetch function (e.g. `useAsyncData(fetchLatestReplay)`)
 * instead of hand-rolling the same effect/state boilerplate per screen.
 */
export function useAsyncData<T>(loader: () => Promise<T>): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
    // Intentionally run once on mount — callers pass a stable loader reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, loading };
}
