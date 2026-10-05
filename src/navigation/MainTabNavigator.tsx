import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import ChatScreen from '../screens/ChatScreen';
import HomeScreen from '../screens/HomeScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ScanScreen from '../screens/ScanScreen';
import { consumePendingFirstScan } from '../services/pendingAcquisition';
import { colors, radius } from '../theme/colors';
import { MainTabParamList, RootStackParamList } from '../types';

const Tab = createBottomTabNavigator<MainTabParamList>();

const tabIcons: Record<keyof MainTabParamList, string> = {
  Home: '🏠',
  Scan: '🎯',
  Chat: '💬',
  Profile: '🦋',
};

const tabLabels: Record<keyof MainTabParamList, string> = {
  Home: 'Inicio',
  Scan: 'Scan',
  Chat: 'Chat',
  Profile: 'Perfil',
};

/** The always-visible bottom navigation: Home, Scan (primary action), Profile. */
export function MainTabNavigator() {
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // Paid acquisition promise: if the visitor tapped "Mide tu Aura" before
  // Auth, completing/signing into the account must continue that exact task
  // instead of dropping them on Home and asking them to find Scan again.
  useEffect(() => {
    let active = true;
    consumePendingFirstScan().then((pending) => {
      if (active && pending) rootNavigation.navigate('Upload');
    });
    return () => {
      active = false;
    };
  }, [rootNavigation]);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        tabBarLabel: tabLabels[route.name],
        tabBarIcon: () =>
          route.name === 'Scan' ? (
            <View style={styles.scanBadge}>
              <Text style={styles.scanIcon}>{tabIcons.Scan}</Text>
            </View>
          ) : (
            <Text style={styles.icon}>{tabIcons[route.name]}</Text>
          ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen
        name="Scan"
        component={ScanScreen}
        listeners={({ navigation }) => ({
          tabPress: (e) => {
            e.preventDefault();
            navigation.getParent<NativeStackNavigationProp<RootStackParamList>>()?.navigate('Upload');
          },
        })}
      />
      <Tab.Screen name="Chat" component={ChatScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  icon: {
    fontSize: 18,
  },
  scanIcon: {
    fontSize: 18,
  },
  scanBadge: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
});
