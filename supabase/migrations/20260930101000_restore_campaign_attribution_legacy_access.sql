-- Compatibility with the currently deployed app while the analytics branch is reviewed.
grant execute on function public.capture_campaign_attribution(text,text,text,text,text,text,text) to anon, authenticated;
