-- 0017 — Rebuy duplo no save_tournament (fluxo local/legado).
-- Até a 0016, save_tournament gravava uma linha de R$ rebuy_value por rebuy. Um
-- rebuy duplo (2 rebuys por double_rebuy_value, ex.: R$ 50 em vez de 2 × R$ 30)
-- ficava registrado como R$ 60 investidos, distorcendo total_invested/ROI no
-- ranking. O pote (total_prize_pool) já vinha certo do cliente.
--
-- Agora o payload pode trazer:
--   * double_rebuy_value (raiz)    — preço do pacote; ausente/0 = 2 × rebuy_value;
--   * entries[].double_rebuys      — pacotes duplos do jogador (cada um já conta 2
--                                    em entries[].rebuys).
-- Cada pacote vira UMA transação (amount = preço do pacote, rebuy_units = 2), igual
-- ao fluxo persistente; os rebuys avulsos seguem uma linha por unidade
-- (rebuy_units = 1). Payload antigo (sem os campos) grava exatamente como antes.
-- Só a função muda: sem alteração de tabela. CREATE OR REPLACE preserva dono e
-- grants (corte de segurança da 0015 intacto). Torneios já salvos não são tocados.

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
  v_double numeric(14,2) := coalesce(nullif((payload->>'double_rebuy_value')::numeric, 0),
                                     2 * coalesce((payload->>'rebuy_value')::numeric, 0));
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
           greatest(coalesce((x->>'double_rebuys')::int, 0), 0) as double_rebuys_raw,
           greatest(coalesce((x->>'addons')::int, 0), 0) as addons,
           nullif(x->>'final_placement', '')::int as final_placement,
           coalesce((x->>'payout_amount')::numeric, 0) as payout_amount
      from jsonb_array_elements(coalesce(payload->'entries', '[]'::jsonb)) x
  ), resolvidas as (
    -- Pacote duplo nunca passa de rebuys/2 (mesma trava do cliente em legacyInvested).
    select e.*, least(e.double_rebuys_raw, e.rebuys / 2) as doubles, p.id as player_id
      from entradas e join sub_players p on p.display_name_norm = lower(btrim(e.nome))
  )
  insert into transactions (tournament_id, player_id, amount, is_rebuy, is_addon, rebuy_units, final_placement, payout_amount)
  select v_tournament_id, r.player_id, v_buy_in, false, false, 0, r.final_placement,
         case when g.i = 1 then r.payout_amount else 0 end from resolvidas r, generate_series(1, r.buyins) g(i)
  union all
  select v_tournament_id, r.player_id, v_rebuy, true, false, 1, null, 0
    from resolvidas r, generate_series(1, r.rebuys - 2 * r.doubles) g(i)
  union all
  select v_tournament_id, r.player_id, v_double, true, false, 2, null, 0
    from resolvidas r, generate_series(1, r.doubles) g(i)
  union all
  select v_tournament_id, r.player_id, v_addon, false, true, 0, null, 0 from resolvidas r, generate_series(1, r.addons) g(i);

  return v_tournament_id;
end $$;

comment on function public.save_tournament(jsonb) is
  'Grava torneio avulso (fluxo local) numa transação. Rebuy duplo: entries[].double_rebuys + double_rebuy_value viram uma transação por pacote (rebuy_units = 2). Ver 0017.';
