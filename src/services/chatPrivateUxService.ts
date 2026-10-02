import { supabase } from './supabaseClient';

/**
 * Small UX helpers for Chat V2 private invitations.
 * The database RPCs remain the source of truth; these helpers only expose
 * pending state and Realtime changes so the UI can make consent visible.
 */
export async function fetchOutgoingPendingPrivateUsernames(myUserId: string): Promise<string[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('chat_private_requests')
    .select('recipient_id')
    .eq('requester_id', myUserId)
    .eq('status', 'pending');

  if (error || !data?.length) return [];

  const recipientIds = [...new Set(data.map((row) => row.recipient_id))];
  const { data: profiles, error: profileError } = await supabase
    .from('chat_public_profiles')
    .select('id, username')
    .in('id', recipientIds);

  if (profileError || !profiles) return [];
  return profiles.map((profile) => profile.username).filter(Boolean);
}

/**
 * Keeps both sides of the consent flow current:
 * - recipient sees a new invitation immediately;
 * - requester sees pending state disappear after accept/reject/block.
 */
export function subscribeToPrivateRequestChanges(myUserId: string, onChange: () => void): () => void {
  if (!supabase) return () => {};

  const channel = supabase
    .channel(`chat-private-request-ux-${myUserId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_private_requests', filter: `recipient_id=eq.${myUserId}` },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'chat_private_requests', filter: `recipient_id=eq.${myUserId}` },
      onChange,
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'chat_private_requests', filter: `requester_id=eq.${myUserId}` },
      onChange,
    )
    .subscribe();

  return () => {
    supabase?.removeChannel(channel);
  };
}
