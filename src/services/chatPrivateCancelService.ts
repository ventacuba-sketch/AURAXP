import { supabase } from './supabaseClient';

export interface CancelPrivateRequestResult {
  ok: boolean;
  errorCode?: string;
}

/** Cancels only the caller's own still-pending invitation. */
export async function cancelPrivateChatRequest(targetUsername: string): Promise<CancelPrivateRequestResult> {
  if (!supabase) return { ok: false, errorCode: 'not_configured' };

  const { data, error } = await supabase.rpc('cancel_private_chat_request', {
    p_target_username: targetUsername,
  });

  if (error) return { ok: false, errorCode: 'rpc_error' };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: false, errorCode: 'rpc_error' };

  return {
    ok: Boolean(row.ok),
    errorCode: row.error_code ?? undefined,
  };
}
