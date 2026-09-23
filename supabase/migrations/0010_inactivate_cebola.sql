-- Remove Cebola do ranking sem apagar histórico ou transações e impede
-- participações futuras. O bloqueio é reforçado em `save_tournament`.

alter table public.sub_players
  add column if not exists is_active boolean not null default true;

update public.sub_players
   set is_active = false
 where display_name_norm = lower(btrim('Cebola'));

create or replace function public.player_leaderboard()
returns table (
  display_name   text,
  points         bigint,
  total_winnings numeric,
  total_invested numeric,
  roi            numeric,
  events         bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with participants as (
    select tournament_id, count(distinct player_id) as n
      from transactions
     where not is_rebuy and not is_addon
     group by tournament_id
  ),
  placement as (
    select player_id, tournament_id, max(final_placement) as pl
      from transactions
     where final_placement is not null
     group by player_id, tournament_id
  ),
  per_player as (
    select player_id,
           sum(amount)                     as total_invested,
           sum(coalesce(payout_amount, 0)) as total_winnings,
           count(distinct tournament_id)   as events
      from transactions
     group by player_id
  ),
  pts as (
    select pl.player_id,
           coalesce(sum(greatest(0, pa.n - pl.pl + 1)), 0) as points
      from placement pl
      join participants pa on pa.tournament_id = pl.tournament_id
     group by pl.player_id
  )
  select sp.display_name,
         coalesce(pts.points, 0)::bigint,
         pp.total_winnings,
         pp.total_invested,
         case when pp.total_invested > 0
              then (pp.total_winnings - pp.total_invested) / pp.total_invested
              else 0 end,
         pp.events
    from per_player pp
    join sub_players sp on sp.id = pp.player_id
    left join pts on pts.player_id = pp.player_id
   where sp.is_active
   order by coalesce(pts.points, 0) desc,
            (pp.total_winnings - pp.total_invested) desc,
            sp.display_name;
$$;

create or replace function public.save_tournament(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_tournament_id uuid;
  v_buy_in numeric(14,2) := coalesce((payload->>'buy_in_value')::numeric, 0);
  v_rebuy  numeric(14,2) := coalesce((payload->>'rebuy_value')::numeric, 0);
  v_addon  numeric(14,2) := coalesce((payload->>'addon_value')::numeric, 0);
  v_dur    integer       := coalesce((payload->>'level_duration_seconds')::int, 0);
  v_status tournament_status := coalesce((payload->>'status')::tournament_status, 'scheduled');
begin
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'save_tournament: payload precisa ser um objeto JSON.';
  end if;
  if coalesce(btrim(payload->>'name'), '') = '' then
    raise exception 'save_tournament: torneio sem nome.';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(coalesce(payload->'entries', '[]'::jsonb)) x
     where coalesce(btrim(x->>'name'), '') = ''
  ) then
    raise exception 'save_tournament: há entrada sem nome de jogador.';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(coalesce(payload->'entries', '[]'::jsonb)) x
      join sub_players p on p.display_name_norm = lower(btrim(x->>'name'))
     where not p.is_active
  ) then
    raise exception 'save_tournament: há jogador inativo na lista.';
  end if;

  insert into base_tournaments (
    name, start_time, end_time_projected, end_time_actual,
    total_prize_pool, buy_in_value, initial_stack,
    curve_params, payout_structure, status
  )
  values (
    btrim(payload->>'name'), coalesce((payload->>'start_time')::timestamptz, now()),
    (payload->>'end_time_projected')::timestamptz,
    coalesce((payload->>'end_time_actual')::timestamptz, case when v_status = 'finished' then now() end),
    coalesce((payload->>'total_prize_pool')::numeric, 0), v_buy_in,
    coalesce((payload->>'initial_stack')::int, 0),
    coalesce(payload->'curve_params', '{}'::jsonb), coalesce(payload->'payout_structure', '[]'::jsonb), v_status
  ) returning id into v_tournament_id;

  insert into snapshot_blindstructures (tournament_id, level_index, small_blind_val, big_blind_val, duration_seconds)
  select v_tournament_id, (l->>'nivel')::int, (l->>'small_blind')::int, (l->>'big_blind')::int, v_dur
    from jsonb_array_elements(coalesce(payload->'levels', '[]'::jsonb)) l;

  with candidatos as (
    select distinct on (lower(btrim(x->>'name')))
           btrim(x->>'name') as display_name,
           nullif(btrim(coalesce(x->>'nickname', '')), '') as nickname
      from jsonb_array_elements(coalesce(payload->'entries', '[]'::jsonb)) with ordinality as e(x, ord)
     order by lower(btrim(x->>'name')), e.ord
  )
  insert into sub_players (display_name, nickname)
  select display_name, nickname from candidatos
  on conflict (display_name_norm) do update
     set nickname = coalesce(excluded.nickname, sub_players.nickname)
   where sub_players.nickname is distinct from coalesce(excluded.nickname, sub_players.nickname);

  with entradas as (
    select btrim(x->>'name') as nome,
           greatest(coalesce((x->>'buyins')::int, 0), 0) as buyins,
           greatest(coalesce((x->>'rebuys')::int, 0), 0) as rebuys,
           greatest(coalesce((x->>'addons')::int, 0), 0) as addons,
           nullif(x->>'final_placement', '')::int as final_placement,
           coalesce((x->>'payout_amount')::numeric, 0) as payout_amount
      from jsonb_array_elements(coalesce(payload->'entries', '[]'::jsonb)) x
  ), resolvidas as (
    select e.*, p.id as player_id from entradas e join sub_players p on p.display_name_norm = lower(btrim(e.nome))
  )
  insert into transactions (tournament_id, player_id, amount, is_rebuy, is_addon, final_placement, payout_amount)
  select v_tournament_id, r.player_id, v_buy_in, false, false, r.final_placement,
         case when g.i = 1 then r.payout_amount else 0 end from resolvidas r, generate_series(1, r.buyins) g(i)
  union all
  select v_tournament_id, r.player_id, v_rebuy, true, false, null, 0 from resolvidas r, generate_series(1, r.rebuys) g(i)
  union all
  select v_tournament_id, r.player_id, v_addon, false, true, null, 0 from resolvidas r, generate_series(1, r.addons) g(i);

  return v_tournament_id;
end $$;
