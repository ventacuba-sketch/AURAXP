-- Reliable, low-payload sound signal for Sala Global.
-- The UI continues to render messages from its existing chat_messages
-- subscription; this broadcast carries no message body and is used only to
-- trigger the optional notification tone.

create or replace function public.broadcast_chat_global_sound()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(
    jsonb_build_object(
      'message_id', new.id,
      'user_id', new.user_id,
      'guest_id', new.guest_id,
      'created_at', new.created_at
    ),
    'message_created',
    'aura-chat-global-sound',
    false
  );
  return null;
end;
$$;

-- Trigger-only function: never expose it through the Data API.
revoke execute on function public.broadcast_chat_global_sound() from public, anon, authenticated;

drop trigger if exists chat_global_sound_broadcast_trigger on public.chat_messages;
create trigger chat_global_sound_broadcast_trigger
after insert on public.chat_messages
for each row
execute function public.broadcast_chat_global_sound();
