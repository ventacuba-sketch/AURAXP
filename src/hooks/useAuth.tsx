import { Session } from '@supabase/supabase-js';
import React, { createContext, PropsWithChildren, useContext, useEffect, useState } from 'react';

import { getSession, onAuthStateChange } from '../services/authService';
import { isSupabaseConfigured } from '../services/supabaseClient';

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
  /** Llamado por ResetPasswordScreen después de updatePassword() exitoso. */
  clearPasswordRecovery: () => void;
}

const AuthContext = createContext<AuthState>({
  session: null,
  loading: false,
  passwordRecovery: false,
  clearPasswordRecovery: () => {},
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    getSession().then((s) => {
      setSession(s);
      setLoading(false);
    });

    return onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
    });
  }, []);

  const clearPasswordRecovery = () => setPasswordRecovery(false);

  return (
    <AuthContext.Provider value={{ session, loading, passwordRecovery, clearPasswordRecovery }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
