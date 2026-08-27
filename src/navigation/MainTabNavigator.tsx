import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';

import HomeScreen from '../screens/HomeScreen';
import ProfileScreen from '../screens/ProfileScreen';
import ScanScreen from '../screens/ScanScreen';
import { colors, radius } from '../theme/colors';
import { MainTabParamList, RootStackParamList } from '../types';

const Tab = createBottomTabNavigator<MainTabParamList>();

const tabIcons: Record<keyof MainTabParamList, string> = {
  Home: '🏠',
  Scan: '🎯',
  Profile: '🦋',
};

/** The always-visible bottom navigation: Home, Scan (primary action), Profile. */
export function MainTabNavigator() {
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
          // "Scan" is an entry point into the capture flow, not a tab you
          // land on — swallow the normal tab-switch and immediately push
          // Upload/Capture onto the root stack instead.
          tabPress: (e) => {
            e.preventDefault();
            navigation.getParent<NativeStackNavigationProp<RootStackParamList>>()?.navigate('Upload');
          },
        })}
      />
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
  // Central "Scan" tab gets a filled accent badge to read as the primary action.
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
