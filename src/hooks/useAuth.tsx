import { Session } from '@supabase/supabase-js';
import React, { createContext, PropsWithChildren, useContext, useEffect, useState } from 'react';

import { getSession, onAuthStateChange } from '../services/authService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { initialRecoveryLink } from '../services/recoveryLink';

interface AuthState {
  session: Session | null;
  loading: boolean;
  /**
   * true entre volver del link de "olvidé mi contraseña" (Supabase emite
   * el evento PASSWORD_RECOVERY, que además deja una sesión real
   * establecida) y terminar de fijar la contraseña nueva. RootNavigator
   * usa esto para mandar a ResetPasswordScreen en vez de la app normal --
   * sin esto, alguien recuperando su contraseña entraría derecho a Home
   * (o a un Challenge pendiente) sin haber llegado a cambiarla.
   */
  passwordRecovery: boolean;
  recoveryLinkError: string | null;
  clearRecoveryLinkError: () => void;
  /** Llamado por ResetPasswordScreen después de updatePassword() exitoso. */
  clearPasswordRecovery: () => void;
}

const AuthContext = createContext<AuthState>({
  session: null,
  loading: false,
  passwordRecovery: false,
  recoveryLinkError: null,
  clearRecoveryLinkError: () => {},
  clearPasswordRecovery: () => {},
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [passwordRecovery, setPasswordRecovery] = useState(initialRecoveryLink.recovery);
  const [recoveryLinkError, setRecoveryLinkError] = useState(initialRecoveryLink.error);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let active = true;
    const unsubscribe = onAuthStateChange((event, s) => {
      if (!active) return;
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      if (event === 'SIGNED_OUT') setPasswordRecovery(false);
    });
    // The callback can be processed before React mounts this provider. The
    // pre-client snapshot keeps recovery active even when that event was missed.
    getSession().then((s) => {
      if (!active) return;
      setSession(s);
      if (!s) {
        setPasswordRecovery(false);
        if (initialRecoveryLink.recovery) setRecoveryLinkError('session_unavailable');
      }
    }).catch(() => {
      if (!active) return;
      setSession(null);
      setPasswordRecovery(false);
      if (initialRecoveryLink.recovery) setRecoveryLinkError('session_unavailable');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; unsubscribe(); };
  }, []);

  const clearPasswordRecovery = () => setPasswordRecovery(false);

  return (
    <AuthContext.Provider value={{ session, loading, passwordRecovery, clearPasswordRecovery,
      recoveryLinkError, clearRecoveryLinkError: () => setRecoveryLinkError(null) }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
