create table if not exists public.user_attributions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  visitor_id text,
  fbclid text,
  fbc text,
  fbp text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  landing_ts timestamptz,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.user_attributions enable row level security;
revoke all on table public.user_attributions from public, anon, authenticated;

create or replace function public.link_campaign_attribution_on_signup()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_visitor_id text; v_touch jsonb;
begin
  begin
    v_visitor_id := new.raw_user_meta_data ->> 'campaign_visitor_id';
    v_touch := coalesce(new.raw_user_meta_data -> 'acquisition_first_touch', '{}'::jsonb);
    if v_visitor_id is null or length(v_visitor_id)<8 or length(v_visitor_id)>200 or v_visitor_id !~ '^[A-Za-z0-9_-]+$' then return new; end if;
    insert into public.user_attributions(user_id,visitor_id,fbclid,fbc,fbp,utm_source,utm_medium,utm_campaign,utm_content,utm_term,landing_ts,user_agent)
    values(new.id,v_visitor_id,nullif(v_touch->>'fbclid',''),nullif(v_touch->>'fbc',''),nullif(v_touch->>'fbp',''),nullif(v_touch->>'utm_source',''),nullif(v_touch->>'utm_medium',''),nullif(v_touch->>'utm_campaign',''),nullif(v_touch->>'utm_content',''),nullif(v_touch->>'utm_term',''),case when (v_touch->>'landing_ts') ~ '^\d{4}-\d{2}-\d{2}T' then (v_touch->>'landing_ts')::timestamptz else null end,left(nullif(v_touch->>'user_agent',''),1000))
    on conflict(user_id) do nothing;
    update public.campaign_attributions set user_id=new.id,last_seen_at=now() where visitor_id=v_visitor_id and user_id is null;
  exception when others then return new;
  end;
  return new;
end; $$;
revoke all on function public.link_campaign_attribution_on_signup() from public, anon, authenticated;
grant execute on function public.link_campaign_attribution_on_signup() to service_role;
