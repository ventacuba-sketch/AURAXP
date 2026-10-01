import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getRecoveryUsers, generateRecoveryLink, RecoveryDashboard, RecoveryUser } from '../services/recoveryService';
import { colors, radius, spacing, typography } from '../theme/colors';

export default function AdminRecoveryScreen() {
 const [data,setData]=useState<RecoveryDashboard|null>(null); const [error,setError]=useState<string|null>(null);
 const [busy,setBusy]=useState<string|null>(null); const [generated,setGenerated]=useState<{email:string;message:string}|null>(null);
 const load=()=>{setError(null);getRecoveryUsers().then(setData).catch(e=>setError(e instanceof Error?e.message:String(e)));};
 useEffect(load,[]);
 const pending=useMemo(()=>data?.users.filter(u=>!u.has_scan)??[],[data]);
 async function make(u:RecoveryUser){setBusy(u.user_id);setGenerated(null);try{const r=await generateRecoveryLink(u.user_id);setGenerated({email:r.email,message:r.message});load();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(null);}}
 if(!data&&!error)return <SafeAreaView style={s.safe}><View style={s.center}><ActivityIndicator color={colors.accent}/><Text style={s.muted}>Cargando recuperación…</Text></View></SafeAreaView>;
 return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.content}>
  <Text style={s.logo}>AURA VS · ADMIN</Text><Text style={s.title}>Recuperación de usuarios</Text>
  <Text style={s.muted}>Registrados que todavía no completan su primer Scan.</Text>
  {error&&<Text style={s.error}>{error}</Text>}
  {data&&<View style={s.stats}>
   <Stat label="Registrados" n={data.summary.registered}/><Stat label="Por recuperar" n={data.summary.needs_recovery}/>
   <Stat label="Con Scan" n={data.summary.scanned}/><Stat label="WhatsApp" n={data.summary.whatsapp_opted_in}/>
  </View>}
  {generated&&<View style={s.generated}><Text style={s.cardTitle}>RECUPERACIÓN LISTA · {generated.email}</Text><Text selectable style={s.message}>{generated.message}</Text><Text style={s.hint}>Copia este mensaje y envíalo. El enlace inicia sesión y lleva al usuario al Scan.</Text></View>}
  <Text style={s.section}>Pendientes ({pending.length})</Text>
  {pending.map(u=><View key={u.user_id} style={s.card}>
    <View style={s.grow}><Text style={s.email}>{u.email}</Text><Text style={s.meta}>Registro: {new Date(u.registered_at).toLocaleString('es-CL')} · {u.email_confirmed?'confirmado':'sin confirmar'}</Text>
    <Text style={s.meta}>{u.source?u.source+' · '+(u.campaign??'sin campaña'):'sin atribución'} · intentos: {u.recovery_attempts}</Text>
    {u.whatsapp_opt_in&&u.whatsapp_phone?<Text style={s.whatsapp}>WhatsApp: {u.whatsapp_phone}</Text>:null}</View>
    <Pressable style={s.button} disabled={busy===u.user_id} onPress={()=>void make(u)}><Text style={s.buttonText}>{busy===u.user_id?'…':'GENERAR MAGIC LINK'}</Text></Pressable>
  </View>)}
  {!pending.length&&<Text style={s.muted}>No hay usuarios pendientes.</Text>}
 </ScrollView></SafeAreaView>;
}
function Stat({label,n}:{label:string;n:number}){return <View style={s.stat}><Text style={s.statN}>{n}</Text><Text style={s.meta}>{label}</Text></View>}
const s=StyleSheet.create({safe:{flex:1,backgroundColor:colors.background},content:{padding:24,maxWidth:1300,width:'100%',alignSelf:'center'},center:{flex:1,alignItems:'center',justifyContent:'center',gap:12},logo:{...typography.eyebrow,color:colors.secondary},title:{...typography.hero,color:colors.textPrimary,marginTop:6},muted:{...typography.body,color:colors.textSecondary,marginTop:6},error:{...typography.body,color:colors.danger,marginVertical:12},stats:{flexDirection:'row',flexWrap:'wrap',gap:10,marginTop:20},stat:{minWidth:150,padding:14,borderRadius:radius.lg,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},statN:{...typography.display,color:colors.accent},section:{...typography.title,color:colors.textPrimary,marginTop:28,marginBottom:10},card:{flexDirection:'row',flexWrap:'wrap',gap:12,alignItems:'center',padding:14,marginBottom:8,borderRadius:radius.lg,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},grow:{flex:1,minWidth:260},email:{...typography.subtitle,color:colors.textPrimary},meta:{...typography.caption,color:colors.textMuted,marginTop:4},whatsapp:{...typography.caption,color:colors.success,marginTop:5},button:{paddingHorizontal:14,paddingVertical:11,borderRadius:radius.pill,backgroundColor:colors.accent},buttonText:{...typography.caption,color:colors.onAccent,fontWeight:'900'},generated:{padding:16,marginTop:18,borderRadius:radius.lg,borderWidth:1,borderColor:colors.accent,backgroundColor:colors.surface},cardTitle:{...typography.subtitle,color:colors.textPrimary},message:{...typography.body,color:colors.textPrimary,marginTop:10,lineHeight:21},hint:{...typography.caption,color:colors.textMuted,marginTop:10}});
