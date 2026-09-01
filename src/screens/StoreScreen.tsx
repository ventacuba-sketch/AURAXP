import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Crypto from 'expo-crypto';

import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useSmartBack } from '../hooks/useSmartBack';
import { logEvent } from '../services/analyticsService';
import {
  EquipSlot,
  equipItem,
  fetchInventory,
  fetchMyEquippedBySlot,
  fetchStoreItems,
  fetchWallet,
  InventoryItem,
  purchaseStoreItem,
  StoreItem,
  unequipItem,
} from '../services/walletService';
import { colors, radius, spacing, typography } from '../theme/colors';

const CATEGORY_LABEL: Record<StoreItem['category'], string> = {
  consumable: 'CONSUMIBLES',
  gift: 'REGALOS',
  effect: 'EFECTOS',
  cosmetic: 'COSMÉTICOS',
  aspirational: 'ASPIRACIONALES ✨',
};

type Tab = 'store' | 'inventory';

/** Tienda + Inventario en un solo screen con pestañas -- evita sumar una
 * pantalla más a la navegación para dos cosas que siempre se usan juntas
 * (comprar y después equipar). Los regalos NO aparecen acá para comprar
 * -- se compran/mandan en un solo paso desde el perfil del destinatario
 * (ver send_gift), nunca quedan en inventario propio. */
export default function StoreScreen() {
  const goBack = useSmartBack();
  const [tab, setTab] = useState<Tab>('store');
  const [items, setItems] = useState<StoreItem[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [equippedBySlot, setEquippedBySlot] = useState<Record<EquipSlot, string | null>>({
    profile_frame: null,
    result_effect: null,
    badge: null,
    vs_effect: null,
  });
  const [balance, setBalance] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([fetchStoreItems(), fetchInventory(), fetchMyEquippedBySlot(), fetchWallet()]).then(
      ([storeItems, inv, equipped, wallet]) => {
        setItems(storeItems);
        setInventory(inv);
        setEquippedBySlot(equipped);
        setBalance(wallet?.balance ?? null);
      },
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      logEvent('store_viewed');
      load();
    }, [load]),
  );

  async function handleBuy(item: StoreItem) {
    setBusyKey(item.itemKey);
    setNotice(null);
    try {
      const idempotencyKey = Crypto.randomUUID();
      const result = await purchaseStoreItem(item.itemKey, idempotencyKey);
      if (result.ok) {
        setNotice(`Compraste ${item.name} ✅`);
        load();
      } else if (result.errorCode === 'insufficient_funds') {
        setNotice('No te alcanzan los Coins para esto.');
      } else {
        setNotice('No pudimos completar la compra. Intenta de nuevo.');
      }
    } finally {
      setBusyKey(null);
    }
  }

  async function handleEquipToggle(inv: InventoryItem) {
    if (!inv.equipSlot) return;
    setBusyKey(inv.inventoryItemId);
    try {
      const isEquipped = equippedBySlot[inv.equipSlot] === inv.inventoryItemId;
      const ok = isEquipped ? await unequipItem(inv.equipSlot) : await equipItem(inv.inventoryItemId);
      if (ok) {
        if (!isEquipped) logEvent('item_equipped', { item_key: inv.itemKey });
        load();
      }
    } finally {
      setBusyKey(null);
    }
  }

  const itemsByCategory = items
    .filter((i) => i.category !== 'gift') // los regalos se mandan desde el perfil del destinatario, no se compran acá.
    .reduce<Record<string, StoreItem[]>>((acc, item) => {
      (acc[item.category] ??= []).push(item);
      return acc;
    }, {});

  return (
    <ScreenContainer scroll onBack={goBack}>
      <Text style={styles.title}>TIENDA</Text>
      {balance != null && <Text style={styles.balance}>Tu saldo: {balance.toLocaleString('es')} Coins</Text>}

      <View style={styles.tabs}>
        <Pressable onPress={() => setTab('store')} style={[styles.tab, tab === 'store' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'store' && styles.tabTextActive]}>TIENDA</Text>
        </Pressable>
        <Pressable onPress={() => setTab('inventory')} style={[styles.tab, tab === 'inventory' && styles.tabActive]}>
          <Text style={[styles.tabText, tab === 'inventory' && styles.tabTextActive]}>MIS ÍTEMS</Text>
        </Pressable>
      </View>

      {notice && <Text style={styles.notice}>{notice}</Text>}

      {tab === 'store' ? (
        Object.entries(itemsByCategory).map(([category, categoryItems]) => (
          <View key={category} style={styles.section}>
            <Text style={styles.sectionTitle}>{CATEGORY_LABEL[category as StoreItem['category']]}</Text>
            {categoryItems.map((item) => (
              <Card key={item.itemKey} style={styles.itemCard}>
                <Text style={styles.itemEmoji}>{item.assetRef}</Text>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  {item.description && <Text style={styles.itemDescription}>{item.description}</Text>}
                  <Text style={styles.itemPrice}>{item.priceCoins.toLocaleString('es')} Coins</Text>
                </View>
                <PrimaryButton
                  label={busyKey === item.itemKey ? '...' : 'COMPRAR'}
                  variant="ghost"
                  disabled={busyKey === item.itemKey}
                  onPress={() => handleBuy(item)}
                />
              </Card>
            ))}
          </View>
        ))
      ) : inventory.length === 0 ? (
        <Text style={styles.empty}>Todavía no compraste nada. Mirá la tienda.</Text>
      ) : (
        <View style={styles.section}>
          {inventory.map((inv) => {
            const isEquipped = inv.equipSlot != null && equippedBySlot[inv.equipSlot] === inv.inventoryItemId;
            return (
              <Card key={inv.inventoryItemId} style={styles.itemCard}>
                <Text style={styles.itemEmoji}>{inv.assetRef}</Text>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{inv.name}</Text>
                  {isEquipped && <Text style={styles.equippedTag}>EQUIPADO</Text>}
                </View>
                {inv.equipSlot && (
                  <PrimaryButton
                    label={busyKey === inv.inventoryItemId ? '...' : isEquipped ? 'QUITAR' : 'EQUIPAR'}
                    variant={isEquipped ? 'text' : 'ghost'}
                    disabled={busyKey === inv.inventoryItemId}
                    onPress={() => handleEquipToggle(inv)}
                  />
                )}
              </Card>
            );
          })}
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.title,
    color: colors.textPrimary,
    marginTop: spacing.xl,
  },
  balance: {
    ...typography.body,
    color: colors.accent,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    padding: 4,
    marginBottom: spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.pill,
  },
  tabActive: {
    backgroundColor: colors.surfaceRaised,
  },
  tabText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  tabTextActive: {
    color: colors.accent,
  },
  notice: {
    ...typography.body,
    color: colors.success,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  empty: {
    ...typography.body,
    color: colors.textSecondary,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  itemEmoji: {
    fontSize: 28,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    ...typography.subtitle,
    color: colors.textPrimary,
  },
  itemDescription: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  itemPrice: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
    marginTop: 2,
  },
  equippedTag: {
    ...typography.caption,
    color: colors.success,
    fontWeight: '700',
    marginTop: 2,
  },
});
