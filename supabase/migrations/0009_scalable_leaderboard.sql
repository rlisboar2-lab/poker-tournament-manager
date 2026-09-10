-- supabase/migrations/0009_scalable_leaderboard.sql
-- Auditoria S8 — ranking escalável.
--
-- 🔴 `playerLeaderboard` (src/services/tournaments.ts) fazia dois `select` sem
--    paginação (`sub_players` + `transactions` inteira) e agregava no cliente:
--    - o limite padrão do PostgREST (1000 linhas) truncava a tabela `transactions`
--      em silêncio → ranking errado assim que o histórico passa de ~1000 lançamentos;
--    - o cálculo era O(n²): um `filter` da lista inteira de transações por jogador,
--      dentro do laço de jogadores.
--    Fix: uma função Postgres que agrega tudo no banco e devolve só as linhas do ranking.
--
-- `security invoker`: as policies de 0003 continuam valendo para quem chama; a
-- função não escala privilégio. Idempotente: `create or replace`.
-- Semântica idêntica à do cliente antigo:
--   participantes de um torneio = jogadores com lançamento de buy-in (não rebuy/add-on);
--   pontos = Σ max(0, participantes − colocação + 1) sobre os torneios com colocação;
--   investido/ganhos = soma de `amount` / `payout_amount` de todos os lançamentos;
--   eventos = torneios distintos; ROI = (ganhos − investido) / investido (0 se investido 0);
--   ordem: pontos desc, desempate por líquido (ganhos − investido) desc.

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
    -- nº de participantes por torneio (só quem tem buy-in)
    select tournament_id, count(distinct player_id) as n
      from transactions
     where not is_rebuy and not is_addon
     group by tournament_id
  ),
  placement as (
    -- uma colocação por (jogador, torneio); as várias linhas de buy-in carregam a mesma
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
  select
    sp.display_name,
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
  order by coalesce(pts.points, 0) desc,
           (pp.total_winnings - pp.total_invested) desc,
           sp.display_name;
$$;

comment on function public.player_leaderboard() is
  'Ranking de jogadores agregado no Postgres (S8). Substitui o agregado no cliente, '
  'que truncava `transactions` em 1000 linhas (limite do PostgREST) e era O(n²).';

-- ── Permissões ─────────────────────────────────────────────────────────
-- Modelo de dono único (S5): só usuário autenticado lê o ranking (o app fica
-- atrás do gate de login; `anon` só enxerga `live_state`).
revoke execute on function public.player_leaderboard() from public, anon;
grant  execute on function public.player_leaderboard() to authenticated;
