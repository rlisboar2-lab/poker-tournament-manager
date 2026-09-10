-- supabase/migrations/0008_transactional_persistence.sql
-- Auditoria S7 — persistência transacional.
--
-- 🔴 `saveTournament` (src/services/tournaments.ts) fazia 3 inserts sequenciais
--    (torneio → blinds → transações, com um upsert de jogador por entry no meio).
--    Cada chamada era a sua própria transação: falha no 3º passo deixava o torneio
--    gravado com 0 participantes, e o ranking (derivado de `transactions`) passava
--    a contar um evento fantasma. Fix: uma função Postgres, uma transação.
--
-- 🟡 `updateTournamentResults` fazia N+1 queries — 2 updates por jogador, em laço
--    sequencial no cliente. Fix: dois comandos conjunto-a-conjunto na mesma função.
--
-- Depende de 0006 (índice único `sub_players.display_name_norm`, alvo do ON CONFLICT).
-- `security invoker`: as policies de 0003 continuam valendo para quem chama; a função
-- não escala privilégio. Idempotente: `create or replace`.

-- ── 0. Pré-requisito: a 0006 precisa estar aplicada ─────────────────────
do $$ begin
  if to_regclass('public.sub_players_display_name_norm_uidx') is null then
    raise exception using
      message = 'Migração 0008 abortada: índice sub_players_display_name_norm_uidx ausente.',
      hint    = 'Rode a migração 0006 antes desta — o ON CONFLICT do upsert de jogador infere por ela.';
  end if;
end $$;

-- ── 1. save_tournament(payload jsonb) → uuid ────────────────────────────
-- Espelha `SaveTournamentInput` do cliente. Formato esperado:
--
--   {
--     "name": "...", "start_time": "...", "end_time_projected": "..."|null,
--     "total_prize_pool": 0, "buy_in_value": 0, "rebuy_value": 0, "addon_value": 0,
--     "initial_stack": 3750, "curve_params": {...}, "payout_structure": [...],
--     "status": "finished", "level_duration_seconds": 1200,
--     "levels":  [{ "nivel": 1, "small_blind": 25, "big_blind": 50 }, ...],
--     "entries": [{ "name": "Ana", "nickname": null, "buyins": 1, "rebuys": 0,
--                   "addons": 0, "final_placement": 3, "payout_amount": 0 }, ...]
--   }
--
-- Chaves extras do cliente (`eliminated`, `table`, `seat`) são ignoradas.
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

  -- Entrada sem nome de jogador: falha alto. Antes virava um jogador de nome
  -- vazio em sub_players, silenciosamente.
  if exists (
    select 1
      from jsonb_array_elements(coalesce(payload->'entries', '[]'::jsonb)) x
     where coalesce(btrim(x->>'name'), '') = ''
  ) then
    raise exception 'save_tournament: há entrada sem nome de jogador.';
  end if;

  -- 1.1 Torneio
  insert into base_tournaments (
    name, start_time, end_time_projected, end_time_actual,
    total_prize_pool, buy_in_value, initial_stack,
    curve_params, payout_structure, status
  )
  values (
    btrim(payload->>'name'),
    coalesce((payload->>'start_time')::timestamptz, now()),
    (payload->>'end_time_projected')::timestamptz,
    -- relógio do servidor (o cliente mandava `new Date()` do PC)
    coalesce(
      (payload->>'end_time_actual')::timestamptz,
      case when v_status = 'finished' then now() end
    ),
    coalesce((payload->>'total_prize_pool')::numeric, 0),
    v_buy_in,
    coalesce((payload->>'initial_stack')::int, 0),
    coalesce(payload->'curve_params', '{}'::jsonb),
    coalesce(payload->'payout_structure', '[]'::jsonb),
    v_status
  )
  returning id into v_tournament_id;

  -- 1.2 Snapshot da escada de blinds
  insert into snapshot_blindstructures (
    tournament_id, level_index, small_blind_val, big_blind_val, duration_seconds
  )
  select v_tournament_id,
         (l->>'nivel')::int,
         (l->>'small_blind')::int,
         (l->>'big_blind')::int,
         v_dur
    from jsonb_array_elements(coalesce(payload->'levels', '[]'::jsonb)) l;

  -- 1.3 Jogadores: uma linha por nome normalizado distinto.
  -- O `distinct on` é obrigatório — com o mesmo nome duas vezes no array o
  -- ON CONFLICT atingiria a mesma linha duas vezes e o Postgres aborta.
  -- Diferente do upsert antigo do PostgREST, aqui NÃO reescrevemos
  -- `display_name` (a caixa cadastrada manda; renomear é via renamePlayer) e o
  -- `nickname` existente não é apagado por uma entrada sem apelido.
  with candidatos as (
    select distinct on (lower(btrim(x->>'name')))
           btrim(x->>'name')                                  as display_name,
           nullif(btrim(coalesce(x->>'nickname', '')), '')    as nickname
      from jsonb_array_elements(coalesce(payload->'entries', '[]'::jsonb))
           with ordinality as e(x, ord)
     order by lower(btrim(x->>'name')), e.ord
  )
  insert into sub_players (display_name, nickname)
  select display_name, nickname from candidatos
      on conflict (display_name_norm) do update
         set nickname = coalesce(excluded.nickname, sub_players.nickname)
       where sub_players.nickname is distinct from
             coalesce(excluded.nickname, sub_players.nickname);

  -- 1.4 Ledger: explode cada entry em transações atômicas.
  -- `generate_series(1, 0)` devolve zero linhas, então entry sem buy-in/rebuy/
  -- add-on simplesmente não gera linha. Prêmio e colocação seguem o cliente
  -- antigo: colocação nas linhas de buy-in, prêmio só na primeira delas.
  with entradas as (
    select btrim(x->>'name')                                      as nome,
           greatest(coalesce((x->>'buyins')::int, 0), 0)           as buyins,
           greatest(coalesce((x->>'rebuys')::int, 0), 0)           as rebuys,
           greatest(coalesce((x->>'addons')::int, 0), 0)           as addons,
           nullif(x->>'final_placement', '')::int                  as final_placement,
           coalesce((x->>'payout_amount')::numeric, 0)             as payout_amount
      from jsonb_array_elements(coalesce(payload->'entries', '[]'::jsonb)) x
  ),
  resolvidas as (
    select e.*, p.id as player_id
      from entradas e
      join sub_players p on p.display_name_norm = lower(btrim(e.nome))
  )
  insert into transactions (
    tournament_id, player_id, amount, is_rebuy, is_addon, final_placement, payout_amount
  )
  select v_tournament_id, r.player_id, v_buy_in, false, false, r.final_placement,
         case when g.i = 1 then r.payout_amount else 0 end
    from resolvidas r, generate_series(1, r.buyins) g(i)
  union all
  select v_tournament_id, r.player_id, v_rebuy, true, false, null, 0
    from resolvidas r, generate_series(1, r.rebuys) g(i)
  union all
  select v_tournament_id, r.player_id, v_addon, false, true, null, 0
    from resolvidas r, generate_series(1, r.addons) g(i);

  return v_tournament_id;
end $$;

comment on function public.save_tournament(jsonb) is
  'Grava torneio + escada de blinds + jogadores + ledger numa única transação (S7). '
  'Substitui os 3 inserts sequenciais do cliente, que podiam deixar torneio órfão sem participantes.';

-- ── 2. update_tournament_results(uuid, jsonb) → void ────────────────────
-- `p_results`: [{ "player_id": uuid, "final_placement": 3|null, "payout_amount": 0 }, ...]
-- Aplica colocação em todas as linhas do jogador no torneio e concentra o prêmio
-- numa linha só (a de buy-in, quando existe). Dois comandos no total, não 2×N.
create or replace function public.update_tournament_results(
  p_tournament_id uuid,
  p_results       jsonb
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if p_tournament_id is null then
    raise exception 'update_tournament_results: tournament_id nulo.';
  end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' then
    raise exception 'update_tournament_results: results precisa ser um array JSON.';
  end if;

  with r as (
    -- Um registro por jogador. Repetido no array, vence o último — igual ao
    -- laço sequencial que isto substitui.
    select distinct on ((x->>'player_id')::uuid)
           (x->>'player_id')::uuid                      as player_id,
           nullif(x->>'final_placement', '')::int       as final_placement,
           coalesce((x->>'payout_amount')::numeric, 0)  as payout_amount
      from jsonb_array_elements(p_results) with ordinality as e(x, ord)
     where x->>'player_id' is not null
     order by (x->>'player_id')::uuid, e.ord desc
  ),
  alvo as (
    -- Linha que recebe o prêmio: buy-in primeiro (false ordena antes de true),
    -- desempate determinístico por created_at/id.
    select distinct on (t.player_id) t.id, t.player_id
      from transactions t
      join r on r.player_id = t.player_id
     where t.tournament_id = p_tournament_id
     order by t.player_id, (t.is_rebuy or t.is_addon), t.created_at, t.id
  )
  update transactions t
     set final_placement = r.final_placement,
         payout_amount   = case when t.id = a.id then r.payout_amount else 0 end
    from r left join alvo a on a.player_id = r.player_id
   where t.tournament_id = p_tournament_id
     and t.player_id = r.player_id;
end $$;

comment on function public.update_tournament_results(uuid, jsonb) is
  'Atualiza colocação e prêmio de todos os jogadores de um torneio em 1 comando (S7). '
  'Substitui o laço de 2 updates por jogador no cliente.';

-- ── 3. Permissões ───────────────────────────────────────────────────────
-- Por padrão o Postgres concede EXECUTE a PUBLIC (o que inclui `anon`).
-- Modelo de dono único (S5): só usuário autenticado escreve.
revoke execute on function public.save_tournament(jsonb) from public, anon;
revoke execute on function public.update_tournament_results(uuid, jsonb) from public, anon;
grant  execute on function public.save_tournament(jsonb) to authenticated;
grant  execute on function public.update_tournament_results(uuid, jsonb) to authenticated;
