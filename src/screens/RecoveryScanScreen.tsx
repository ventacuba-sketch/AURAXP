import React, { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { recordRecoveryOpen } from '../services/recoveryService';
import { colors, typography } from '../theme/colors';
export default function RecoveryScanScreen(){const nav=useRootNavigation();useEffect(()=>{void recordRecoveryOpen('magic_link').finally(()=>nav.replace('Upload'));},[nav]);return <View style={s.c}><ActivityIndicator color={colors.accent}/><Text style={s.t}>Preparando tu Scan…</Text></View>}
const s=StyleSheet.create({c:{flex:1,alignItems:'center',justifyContent:'center',gap:12,backgroundColor:colors.background},t:{...typography.body,color:colors.textSecondary}});
