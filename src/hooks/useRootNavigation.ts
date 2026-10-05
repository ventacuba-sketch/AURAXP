import { useMemo } from 'react';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { useAuth } from './useAuth';
import { RootStackParamList } from '../types';

type RootNav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Navigation typed against the root stack, regardless of whether the
 * calling screen is nested inside the tab navigator (Home, Scan) or
 * already sits directly on the root stack (Upload, Analyzing, ScanResult,
 * Challenge). Every screen that needs to jump to a flow screen (Upload,
 * ScanResult, Challenge) shares this one lookup instead of each
 * reimplementing the getParent() fallback.
 *
 * `Auth` is intentionally absent from the authenticated navigator. Some
 * public conversion CTAs use `Auth { context: 'measure_aura' }` so guests
 * can register first. If that same CTA is rendered after the user is
 * already signed in (for example, when a host ends an AURA LIVE), trying
 * to navigate to Auth is a no-op because that route no longer exists.
 * Intercept only that semantic CTA and send authenticated users directly
 * into the real Scan capture flow. Guests keep the existing Auth flow.
 */
export function useRootNavigation(): RootNav {
  const navigation = useNavigation();
  const { session } = useAuth();
  const root = navigation.getParent<RootNav>() ?? (navigation as unknown as RootNav);

  return useMemo(() => {
    if (!session) return root;

    return new Proxy(root, {
      get(target, property, receiver) {
        if (property === 'navigate') {
          return ((name: keyof RootStackParamList, params?: unknown) => {
            if (
              name === 'Auth' &&
              params &&
              typeof params === 'object' &&
              'context' in params &&
              (params as { context?: string }).context === 'measure_aura'
            ) {
              return target.navigate('Upload');
            }
            return (target.navigate as (...args: unknown[]) => unknown)(name, params);
          }) as RootNav['navigate'];
        }

        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }, [root, session?.user.id]);
}
