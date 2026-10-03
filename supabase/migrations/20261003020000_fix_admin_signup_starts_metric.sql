-- signup_started happens before a Supabase user exists, so user_id is normally null.
-- Count the actual start events instead of distinct authenticated user_ids.
do $fix$
declare
  v_def text;
  v_old text := 'count(distinct user_id) filter (where event_name = ''signup_started'' and user_id is not null) as signup_starts';
  v_new text := 'count(*) filter (where event_name = ''signup_started'') as signup_starts';
begin
  select pg_get_functiondef('public.get_admin_dashboard(timestamp with time zone,timestamp with time zone)'::regprocedure)
  into v_def;

  if position(v_old in v_def) = 0 then
    raise exception 'expected signup_starts expression not found';
  end if;

  execute replace(v_def, v_old, v_new);
end
$fix$;
