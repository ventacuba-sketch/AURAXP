// Capture before createClient starts consuming/removing the URL fragment.
export function readRecoveryLink(search: string, hash: string) {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const value = (key: string) => fragment.get(key) ?? query.get(key);
  const error = value('error_code') ?? value('error');
  return {
    error,
    recovery: !error && value('type') === 'recovery' && Boolean(value('access_token')),
  };
}

export const initialRecoveryLink = typeof window === 'undefined'
  ? { error: null, recovery: false }
  : readRecoveryLink(window.location.search, window.location.hash);
