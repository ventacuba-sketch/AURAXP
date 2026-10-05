import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';

import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenContainer } from '../components/ScreenContainer';
import { useRootNavigation } from '../hooks/useRootNavigation';
import { logEvent } from '../services/analyticsService';
import { mapAuthError, requestPasswordReset, resendConfirmationEmail, signIn, signUp, verifySignupOtp } from '../services/authService';
import { hasReferralCodeInUrl } from '../services/referralService';
import { colors, radius, spacing, typography } from '../theme/colors';
import { RootStackParamList } from '../types';

type Mode = 'signIn' | 'signUp' | 'forgotPassword';
type AuthRouteProp = RouteProp<RootStackParamList, 'Auth'>;
const RESET_COOLDOWN_MS = 30000;

export default function AuthScreen() {
  const navigation = useRootNavigation();
  const { params } = useRoute<AuthRouteProp>();
  const canGoBack = navigation.canGoBack();
  const isAuraAcquisition = params?.context === 'measure_aura';
  const [mode, setMode] = useState<Mode>(() => params?.initialMode ?? (hasReferralCodeInUrl() ? 'signUp' : 'signIn'));
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [otp, setOtp] = useState('');
  const [awaitingOtp, setAwaitingOtp] = useState(false); const [showPassword, setShowPassword] = useState(false); const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null); const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showAlreadyRegistered, setShowAlreadyRegistered] = useState(false); const [showLoginRecoveryHint, setShowLoginRecoveryHint] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null); const [resending, setResending] = useState(false); const [resetCooldownActive, setResetCooldownActive] = useState(false);

  useEffect(() => { if (mode === 'signUp') logEvent('signup_viewed', { context: params?.context ?? null }); }, [mode, params?.context]);
  function resetTransientState(){setError(null);setSuccessMessage(null);setShowAlreadyRegistered(false);setShowLoginRecoveryHint(false);setResendNotice(null);}
  function switchMode(next:Mode){resetTransientState();setPassword('');setOtp('');setAwaitingOtp(false);setMode(next);}

  async function handleSubmit(){resetTransientState();setLoading(true);try{
    if(mode==='signIn'){await signIn(email.trim(),password);logEvent('login');}
    else {if(password.length<8){setError('Usa una contraseña de al menos 8 caracteres.');return;}logEvent('signup_started',{context:params?.context??null});const{status,userId}=await signUp(email.trim(),password);
      if(status==='confirmationRequired'){setAwaitingOtp(true);logEvent('signup_completed',{context:params?.context??null},userId);}
      else if(status==='alreadyRegistered')setShowAlreadyRegistered(true);else if(status==='signedIn')logEvent('signup_completed',{context:params?.context??null},userId);
    }
  }catch(e){const message=mapAuthError(e);setError(message);if(mode==='signIn'&&message==='Correo o contraseña incorrectos.')setShowLoginRecoveryHint(true);}finally{setLoading(false);}}

  async function handleVerifyOtp(){if(otp.length!==6)return;setError(null);setLoading(true);try{await verifySignupOtp(email,otp);logEvent('signup_email_confirmed',{context:params?.context??null});}catch(e){setError(mapAuthError(e));}finally{setLoading(false);}}
  async function handleResendConfirmation(){setResending(true);setResendNotice(null);try{await resendConfirmationEmail(email.trim());setResendNotice('Te enviamos un nuevo código.');}catch(e){setResendNotice(mapAuthError(e));}finally{setResending(false);}}
  async function handleRequestReset(){if(resetCooldownActive)return;resetTransientState();setLoading(true);try{await requestPasswordReset(email.trim());setSuccessMessage('Si el correo existe, te enviamos un enlace para recuperar tu contraseña.');setResetCooldownActive(true);setTimeout(()=>setResetCooldownActive(false),RESET_COOLDOWN_MS);}catch(e){setError(mapAuthError(e));}finally{setLoading(false);}}

  if(awaitingOtp)return <ScreenContainer style={styles.container}><View style={styles.header}><Text style={styles.wordmark}>AURA VS</Text><Text style={styles.successText}>REVISA TU EMAIL ⚡</Text><Text style={styles.subtitle}>Enviamos un código de 6 dígitos a {email.trim()}.</Text><Text style={styles.microcopy}>Escríbelo aquí para continuar directo a medir tu Aura.</Text></View><View style={styles.form}><TextInput style={[styles.input,styles.otpInput]} placeholder="000000" placeholderTextColor={colors.textMuted} keyboardType="number-pad" autoFocus maxLength={6} value={otp} onChangeText={(v)=>setOtp(v.replace(/\D/g,'').slice(0,6))} />{error&&<Text style={styles.error}>{error}</Text>}{resendNotice&&<Text style={styles.resendNotice}>{resendNotice}</Text>}</View><View style={styles.actions}><PrimaryButton label={loading?'VERIFICANDO...':'⚡ CONFIRMAR Y MEDIR MI AURA'} disabled={loading||otp.length!==6} onPress={handleVerifyOtp}/><PrimaryButton variant="ghost" label={resending?'REENVIANDO...':'REENVIAR CÓDIGO'} disabled={resending} onPress={handleResendConfirmation}/><PrimaryButton variant="text" label="CAMBIAR EMAIL" onPress={()=>{setAwaitingOtp(false);setOtp('');setError(null);}}/></View></ScreenContainer>;

  if(showAlreadyRegistered)return <ScreenContainer style={styles.container} onBack={canGoBack?()=>navigation.goBack():undefined}><View style={styles.header}><Text style={styles.wordmark}>AURA VS</Text><Text style={styles.successText}>Esta cuenta ya existe o está pendiente de confirmación.</Text></View>{resendNotice&&<Text style={styles.resendNotice}>{resendNotice}</Text>}<View style={styles.actions}><PrimaryButton label="INICIAR SESIÓN" onPress={()=>switchMode('signIn')}/><PrimaryButton variant="ghost" label={resending?'REENVIANDO...':'REENVIAR CÓDIGO'} disabled={resending} onPress={handleResendConfirmation}/><PrimaryButton variant="text" label="RECUPERAR CONTRASEÑA" onPress={()=>switchMode('forgotPassword')}/></View></ScreenContainer>;
  if(successMessage)return <ScreenContainer style={styles.container} onBack={canGoBack?()=>navigation.goBack():undefined}><View style={styles.header}><Text style={styles.wordmark}>AURA VS</Text><Text style={styles.successText}>{successMessage}</Text></View><PrimaryButton label="VOLVER" onPress={()=>switchMode('signIn')}/></ScreenContainer>;
  if(mode==='forgotPassword')return <ScreenContainer style={styles.container} onBack={canGoBack?()=>navigation.goBack():undefined}><View style={styles.header}><Text style={styles.wordmark}>AURA VS</Text><Text style={styles.subtitle}>Te mandamos un link para elegir una contraseña nueva.</Text></View><View style={styles.form}><TextInput style={styles.input} placeholder="Email" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail}/>{error&&<Text style={styles.error}>{error}</Text>}</View><View style={styles.actions}><PrimaryButton label={loading?'ENVIANDO...':resetCooldownActive?'YA LO ENVIAMOS -- ESPERA UN MOMENTO':'ENVIAR ENLACE'} disabled={loading||!email||resetCooldownActive} onPress={handleRequestReset}/><PrimaryButton variant="text" label="Volver a iniciar sesión" onPress={()=>switchMode('signIn')}/></View></ScreenContainer>;

  return <ScreenContainer style={styles.container} onBack={canGoBack?()=>navigation.goBack():undefined}><View style={styles.header}><Text style={styles.wordmark}>AURA VS</Text><Text style={styles.subtitle}>{mode==='signIn'?'Entra a tu cuenta.':isAuraAcquisition?'Crea tu cuenta gratis para guardar tu resultado.':'Crea tu cuenta.'}</Text>{mode==='signUp'&&isAuraAcquisition&&<Text style={styles.microcopy}>Solo email + contraseña · después vas directo al Scan</Text>}</View><View style={styles.form}><TextInput style={styles.input} placeholder="Tu email" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" value={email} onChangeText={setEmail}/><View style={styles.passwordRow}><TextInput style={styles.passwordInput} placeholder="Contraseña (8+ caracteres)" placeholderTextColor={colors.textMuted} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} spellCheck={false} value={password} onChangeText={setPassword}/><Pressable onPress={()=>setShowPassword(v=>!v)} hitSlop={10} style={styles.toggle}><Text style={styles.toggleText}>{showPassword?'OCULTAR':'MOSTRAR'}</Text></Pressable></View>{mode==='signIn'&&<Pressable onPress={()=>switchMode('forgotPassword')} hitSlop={6}><Text style={styles.forgotLink}>¿Olvidaste tu contraseña?</Text></Pressable>}{error&&<Text style={styles.error}>{error}</Text>}{showLoginRecoveryHint&&<PrimaryButton variant="ghost" label="RECUPERAR CONTRASEÑA" onPress={()=>switchMode('forgotPassword')}/>}</View><View style={styles.actions}><PrimaryButton label={loading?'...':mode==='signIn'?'ENTRAR':isAuraAcquisition?'⚡ CONTINUAR Y MEDIR MI AURA':'CREAR CUENTA'} disabled={loading||!email||!password} onPress={handleSubmit}/><PrimaryButton variant="text" label={mode==='signIn'?'¿No tienes cuenta? Regístrate':'¿Ya tienes cuenta? Entra'} onPress={()=>switchMode(mode==='signIn'?'signUp':'signIn')}/></View></ScreenContainer>;
}

const styles=StyleSheet.create({container:{justifyContent:'center'},header:{marginBottom:spacing.xl,alignItems:'center'},wordmark:{...typography.hero,color:colors.textPrimary,letterSpacing:1},subtitle:{...typography.body,color:colors.textSecondary,marginTop:spacing.xs,textAlign:'center'},microcopy:{...typography.caption,color:colors.accent,marginTop:spacing.sm,textAlign:'center'},successText:{...typography.body,color:colors.textPrimary,textAlign:'center',marginTop:spacing.sm},resendNotice:{...typography.caption,color:colors.success,textAlign:'center',marginBottom:spacing.md},form:{gap:spacing.md,marginBottom:spacing.xl},input:{borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,borderRadius:radius.md,paddingHorizontal:spacing.md,paddingVertical:spacing.md,color:colors.textPrimary,...typography.body},otpInput:{fontSize:28,textAlign:'center',letterSpacing:10,fontWeight:'800'},passwordRow:{flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,borderRadius:radius.md,paddingRight:spacing.sm},passwordInput:{flex:1,paddingHorizontal:spacing.md,paddingVertical:spacing.md,color:colors.textPrimary,...typography.body},toggle:{paddingHorizontal:spacing.sm,paddingVertical:spacing.xs},toggleText:{...typography.caption,color:colors.accent,fontWeight:'700'},forgotLink:{...typography.caption,color:colors.textSecondary,textAlign:'right'},error:{...typography.caption,color:colors.danger},actions:{gap:spacing.sm}});
