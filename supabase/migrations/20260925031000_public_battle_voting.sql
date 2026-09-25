-- Public voting for completed 1v1 Aura Battles.
create table if not exists public.challenge_public_votes (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  voter_key text not null,
  vote text not null check (vote in ('creator','opponent')),
  created_at timestamptz not null default now(),
  unique(challenge_id, voter_key)
);
alter table public.challenge_public_votes enable row level security;
create index if not exists challenge_public_votes_challenge_idx on public.challenge_public_votes(challenge_id);

create or replace function public.get_public_battle_result(p_token text)
returns table (challenge_id uuid,creator_username text,creator_avatar_emoji text,creator_score int,opponent_username text,opponent_avatar_emoji text,opponent_score int,ai_winner text,creator_votes bigint,opponent_votes bigint)
language sql security definer stable set search_path=public as $$
select c.id,p1.username,coalesce(p1.avatar_emoji,'⚡'),s1.aura_score,p2.username,coalesce(p2.avatar_emoji,'⚡'),s2.aura_score,
case when c.is_tie then 'tie' when c.winner_user_id=c.from_user_id then 'creator' when c.winner_user_id=c.opponent_user_id then 'opponent' else 'tie' end,
count(v.id) filter(where v.vote='creator'),count(v.id) filter(where v.vote='opponent')
from public.challenges c join public.public_profiles p1 on p1.id=c.from_user_id join public.public_profiles p2 on p2.id=c.opponent_user_id join public.scans s1 on s1.id=c.source_scan_id join public.scans s2 on s2.id=c.target_scan_id left join public.challenge_public_votes v on v.challenge_id=c.id
where c.share_token=p_token and c.status='completed' and s1.status='done' and s2.status='done'
group by c.id,p1.username,p1.avatar_emoji,s1.aura_score,p2.username,p2.avatar_emoji,s2.aura_score;
$$;
create or replace function public.vote_public_battle(p_token text,p_vote text,p_voter_key text)
returns table (creator_votes bigint,opponent_votes bigint)
language plpgsql security definer set search_path=public as $$
declare v_id uuid; begin
if p_vote not in ('creator','opponent') then raise exception 'invalid_vote'; end if;
if p_voter_key is null or length(p_voter_key)<8 or length(p_voter_key)>200 then raise exception 'invalid_voter_key'; end if;
select id into v_id from public.challenges where share_token=p_token and status='completed';
if v_id is null then raise exception 'battle_not_found'; end if;
insert into public.challenge_public_votes(challenge_id,voter_key,vote) values(v_id,p_voter_key,p_vote) on conflict(challenge_id,voter_key) do update set vote=excluded.vote;
return query select count(*) filter(where v.vote='creator'),count(*) filter(where v.vote='opponent') from public.challenge_public_votes v where v.challenge_id=v_id;
end; $$;
revoke all on function public.get_public_battle_result(text) from public;
revoke all on function public.vote_public_battle(text,text,text) from public;
grant execute on function public.get_public_battle_result(text) to anon,authenticated;
grant execute on function public.vote_public_battle(text,text,text) to anon,authenticated;
