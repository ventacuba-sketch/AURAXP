import { Session } from '@supabase/supabase-js';
import { getAttributionMetadata } from './campaignService';
import { supabase } from './supabaseClient';

export type SignUpStatus = 'signedIn' | 'confirmationRequired' | 'alreadyRegistered';
export type SignUpResult = { status: SignUpStatus; userId: string | null };

export async function signUp(email:string,password:string):Promise<SignUpResult>{
  if(!supabase) throw new Error('Supabase no está configurado');
  const attribution=await getAttributionMetadata();
  const authMetadata=attribution?{
    campaign_visitor_id:attribution.visitor_id,
    acquisition_first_touch:{
      visitor_id:attribution.visitor_id,fbclid:attribution.fbclid??null,fbc:attribution.fbc??null,fbp:attribution.fbp??null,
      utm_source:attribution.utm_source??null,utm_medium:attribution.utm_medium??null,utm_campaign:attribution.utm_campaign??null,
      utm_content:attribution.utm_content??null,utm_term:attribution.utm_term??null,landing_ts:attribution.landing_ts??null,user_agent:attribution.user_agent??null,
    },
  }:undefined;
  const {data,error}=await supabase.auth.signUp({email,password,options:{...(authMetadata?{data:authMetadata}:{})}});
  if(error) throw error;
  if(data.user&&data.user.identities&&data.user.identities.length===0)return{status:'alreadyRegistered',userId:null};
  if(data.session)return{status:'signedIn',userId:data.user?.id??data.session.user.id};
  return{status:'confirmationRequired',userId:data.user?.id??null};
}
export async function signIn(email:string,password:string):Promise<void>{if(!supabase)throw new Error('Supabase no está configurado');const{error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;}
export async function signOut():Promise<void>{if(!supabase)throw new Error('Supabase no está configurado');const{error}=await supabase.auth.signOut();if(error)throw error;}
export async function getSession():Promise<Session|null>{if(!supabase)return null;const{data}=await supabase.auth.getSession();return data.session;}
export function onAuthStateChange(callback:(event:string,session:Session|null)=>void):()=>void{if(!supabase)return()=>{};const{data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>callback(event,session));return()=>subscription.unsubscribe();}
const PASSWORD_RESET_REDIRECT_URL='https://auravs.app';
export async function requestPasswordReset(email:string):Promise<void>{if(!supabase)throw new Error('Supabase no está configurado');const{error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:PASSWORD_RESET_REDIRECT_URL});if(error)throw error;}
export async function updatePassword(newPassword:string):Promise<void>{if(!supabase)throw new Error('Supabase no está configurado');const{error}=await supabase.auth.updateUser({password:newPassword});if(error)throw error;}
export function mapAuthError(error:unknown):string{const message=error instanceof Error?error.message:String(error);const lower=message.toLowerCase();if(lower.includes('email rate limit')||lower.includes('over_email_send_rate_limit'))return'Espera un momento e intenta nuevamente.';if(lower.includes('already registered')||lower.includes('already exists'))return'Este correo ya está registrado. Inicia sesión.';if(lower.includes('invalid login credentials')||lower.includes('invalid credentials'))return'Correo o contraseña incorrectos.';if(lower.includes('failed to fetch')||lower.includes('network request failed')||lower.includes('network error'))return'No pudimos conectar con el servidor. Intenta de nuevo.';if(lower.includes('password')&&(lower.includes('at least')||lower.includes('should be')||lower.includes('weak')))return'La contraseña debe tener al menos 8 caracteres.';if(lower.includes('same')&&lower.includes('password'))return'La nueva contraseña tiene que ser distinta de la actual.';return'Algo salió mal. Intenta de nuevo.';}
