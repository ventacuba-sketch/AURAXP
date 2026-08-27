import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { RootStackParamList } from '../types';

type RootNav = NativeStackNavigationProp<RootStackParamList>;

/**
 * Navigation typed against the root stack, regardless of whether the
 * calling screen is nested inside the tab navigator (Home, Scan) or
 * already sits directly on the root stack (Upload, Analyzing, ScanResult,
 * Challenge). Every screen that needs to jump to a flow screen (Upload,
 * ScanResult, Challenge) shares this one lookup instead of each
 * reimplementing the getParent() fallback.
 */
export function useRootNavigation(): RootNav {
  const navigation = useNavigation();
  return navigation.getParent<RootNav>() ?? (navigation as unknown as RootNav);
}
