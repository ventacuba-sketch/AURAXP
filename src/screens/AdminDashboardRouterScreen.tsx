import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme/colors';
import AdminChatDashboardScreen from './AdminChatDashboardScreen';
import AdminDashboardScreen from './AdminDashboardScreen';

type Tab = 'general' | 'chat';

export default function AdminDashboardRouterScreen() {
  const [tab, setTab] = useState<Tab>('general');

  return (
    <View style={styles.shell}>
      <View style={styles.tabs}>
        <Pressable style={[styles.tab, tab === 'general' && styles.tabActive]} onPress={() => setTab('general')}>
          <Text style={[styles.tabText, tab === 'general' && styles.tabTextActive]}>GENERAL</Text>
        </Pressable>
        <Pressable style={[styles.tab, tab === 'chat' && styles.tabActive]} onPress={() => setTab('chat')}>
          <Text style={[styles.tabText, tab === 'chat' && styles.tabTextActive]}>💬 CHAT</Text>
        </Pressable>
      </View>
      <View style={styles.body}>{tab === 'general' ? <AdminDashboardScreen /> : <AdminChatDashboardScreen />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.background },
  tabs: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  tab: {
    minWidth: 110,
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  tabActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabText: { ...typography.caption, color: colors.textSecondary, fontWeight: '900' },
  tabTextActive: { color: colors.onAccent },
  body: { flex: 1 },
});
