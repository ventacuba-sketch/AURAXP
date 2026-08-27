import { useEffect } from 'react';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { RootStackParamList } from '../types';

/**
 * The "Scan" tab is an action, not a content screen — it should never be
 * seen. `MainTabNavigator` intercepts the tab press and pushes straight
 * into the Upload/Capture flow before this ever mounts.
 *
 * This redirect is a fallback for the rare path that bypasses that
 * interception (e.g. a programmatic `navigate('Scan')` or restored nav
 * state) so the tab still can't be lingered on as a normal screen.
 */
export default function ScanScreen() {
  const navigation = useNavigation();
  const isFocused = useIsFocused();

  useEffect(() => {
    if (isFocused) {
      navigation.getParent<NativeStackNavigationProp<RootStackParamList>>()?.navigate('Upload');
    }
  }, [isFocused, navigation]);

  return null;
}
