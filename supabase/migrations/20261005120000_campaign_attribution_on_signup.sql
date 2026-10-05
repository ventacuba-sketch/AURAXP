-- Paid acquisition attribution must not wait for an authenticated session.
-- signUp stores the stable campaign visitor id in raw_user_meta_data; this
-- auth trigger links the already-captured visitor row to the newly-created
-- auth user immediately, including projects that require email confirmation.

create or replace function public.link_campaign_attribution_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_visitor_id text;
begin
  v_visitor_id := new.raw_user_meta_data ->> 'campaign_visitor_id';

  if v_visitor_id is null
     or length(v_visitor_id) < 8
     or length(v_visitor_id) > 200 then
    return new;
  end if;

  update public.campaign_attributions
     set user_id = new.id,
         last_seen_at = now()
   where visitor_id = v_visitor_id
     and user_id is null;

  return new;
end;
$$;

revoke all on function public.link_campaign_attribution_on_signup() from public, anon, authenticated;

drop trigger if exists link_campaign_attribution_on_signup on auth.users;
create trigger link_campaign_attribution_on_signup
after insert on auth.users
for each row execute function public.link_campaign_attribution_on_signup();
