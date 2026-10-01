import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ScreenContainer } from '../components/ScreenContainer';
import { PrimaryButton } from '../components/PrimaryButton';
import { setWhatsAppRecovery } from '../services/recoveryService';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { colors, spacing, typography } from '../theme/colors';

export default function RecoveryContactScreen(){
 const nav=useRootNavigation(); const [phone,setPhone]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState<string|null>(null);
 async function save(optIn:boolean){setBusy(true);setError(null);try{await setWhatsAppRecovery(phone,optIn);nav.replace('Upload');}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
 return <ScreenContainer style={s.container}>
  <View style={s.header}><Text style={s.emoji}>💬</Text><Text style={s.title}>¿Te recordamos tu Aura?</Text>
  <Text style={s.body}>WhatsApp es opcional. Si no puedes hacer tu Scan ahora, podremos enviarte un recordatorio. Puedes dejar de recibirlos cuando quieras.</Text></View>
  <TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+56 9 1234 5678" placeholderTextColor={colors.textMuted}/>
  {error&&<Text style={s.error}>{error}</Text>}
  <View style={s.actions}><PrimaryButton label={busy?'…':'ACTIVAR WHATSAPP'} disabled={busy||phone.trim().length<8} onPress={()=>void save(true)}/>
  <PrimaryButton variant="text" label="Ahora no · medir mi Aura" disabled={busy} onPress={()=>void save(false)}/></View>
  <Text style={s.legal}>Al activar aceptas recibir recordatorios de actividad de AURA VS por WhatsApp. No es obligatorio para usar la app.</Text>
 </ScreenContainer>;
}
const s=StyleSheet.create({container:{justifyContent:'center'},header:{alignItems:'center',marginBottom:spacing.xl},emoji:{fontSize:42},title:{...typography.title,color:colors.textPrimary,textAlign:'center',marginTop:spacing.md},body:{...typography.body,color:colors.textSecondary,textAlign:'center',marginTop:spacing.sm,lineHeight:21},input:{borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,color:colors.textPrimary,padding:14,borderRadius:12,...typography.body},actions:{gap:spacing.sm,marginTop:spacing.lg},legal:{...typography.caption,color:colors.textMuted,textAlign:'center',marginTop:spacing.lg},error:{...typography.caption,color:colors.danger,marginTop:spacing.sm}});
