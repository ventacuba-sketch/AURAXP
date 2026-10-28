-- Run after the tracking migration. All fixture changes are rolled back.
begin;

do $$ begin
  begin perform public.admin_reactivation_overview(); raise exception 'TEST: anonymous accepted'; exception when others then if sqlerrm <> 'not_authorized' then raise; end if; end;
  if has_function_privilege('anon','public.admin_reactivation_overview()','execute') or has_function_privilege('authenticated','public.reserve_reactivation_contact(text,uuid)','execute') then raise exception 'TEST: grants'; end if;
  begin perform public.reserve_reactivation_contact('aura-return-a-20261028',(select id from auth.users limit 1)); raise exception 'TEST: draft accepted'; exception when others then if sqlerrm <> 'campaign_not_validated' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub',(select id::text from public.profiles where is_admin=true limit 1),true);
select set_config('request.jwt.claim.sub','',true);

do $test$
declare uid uuid; cid uuid;
begin
 select u.id into uid from auth.users u join public.profiles p on p.id=u.id where not coalesce(p.is_admin,false) and not coalesce(p.is_unlimited_tester,false) and not exists(select 1 from public.scans s where s.user_id=u.id and s.status='done') limit 1;
 update public.reactivation_campaigns set status='validated' where id='aura-return-a-20261028';
 begin perform public.reserve_reactivation_contact('aura-return-a-20261028',uid); raise exception 'TEST: missing consent accepted'; exception when others then if sqlerrm<>'recipient_not_eligible' then raise; end if; end;
 insert into public.reactivation_preferences(user_id,consent_at,consent_evidence) values(uid,now(),'ROLLBACK ONLY test fixture');
 cid:=public.reserve_reactivation_contact('aura-return-a-20261028',uid);
 if cid is null then raise exception 'TEST: reservation missing'; end if;
 begin perform public.reserve_reactivation_contact('aura-return-a-20261028',uid); raise exception 'TEST: duplicate accepted'; exception when others then if sqlerrm<>'frequency_limit' then raise; end if; end;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 perform public.unsubscribe_reactivation();
 begin perform public.reserve_reactivation_contact('aura-return-a-20261028',uid); raise exception 'TEST: unsubscribe accepted'; exception when others then if sqlerrm<>'recipient_not_eligible' then raise; end if; end;
 begin perform public.admin_reactivation_overview(); raise exception 'TEST: nonadmin accepted'; exception when others then if sqlerrm<>'not_authorized' then raise; end if; end;
end $test$;
select 'PASS consent, reservation, deduplication, frequency, unsubscribe, nonadmin rejection' tests;

rollback;

