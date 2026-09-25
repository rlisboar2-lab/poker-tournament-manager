-- 0014 — S25: ranking só de eventos concluídos, lançamentos na leitura admin,
-- alteração de ofertas/PIX depois de criar e cancelamento antes do início.
--
-- Plano: docs/superpowers/specs/2026-09-17-pagamentos-publicos-rebuys-implementation-plan.md (S25)
-- Contrato: docs/contracts/rpc-v1.md (registro S25; nenhum código de erro novo)
--
-- O que muda:
--   * player_leaderboard: considera só torneios legados (flow_version = 1) e torneios do fluxo 2
--     finalizados. Antes somava lançamentos de torneio do fluxo 2 ainda em andamento.
--   * get_operational_tournament: ganha `transactions` (lançamentos confirmados do torneio). O
--     cliente deriva pote, investimento e fichas de `amount`, `rebuy_units` e `chips_granted`.
--   * update_tournament_setup (admin): troca ofertas (rascunho, ou publicado sem nenhum pedido vivo)
--     e/ou PIX (qualquer estado antes do fim). Pedidos já feitos mantêm o snapshot.
--   * cancel_operational_tournament (admin): cancela antes do início (rascunho, publicado ou
--     inscrição fechada). Nunca há lançamento antes do início; PIX informado bloqueia.
--
-- O que NÃO muda: tabelas, colunas, constraints, policies e as RPCs da 0013 não citadas acima.
--
-- Depende de 0013.

do $$
begin
  if to_regprocedure('public.get_operational_tournament(uuid)') is null
     or to_regprocedure('private.transaction_json(uuid)') is null then
    raise exception 'Migração 0014 abortada: RPCs da 0013 ausentes. Rode a 0013 antes.';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 1. Ranking: só eventos concluídos
-- ════════════════════════════════════════════════════════════════════════
-- Semântica da 0010 mantida (pontos, investido, ganhos, eventos, ROI, ordem, jogador inativo
-- fora). Único acréscimo: o filtro de torneio concluído, o mesmo do Histórico (listTournaments).
-- `amount` já é o valor real do pacote (duplo = uma linha de R$ 35).
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
  with done as (
    select t.*
      from transactions t
      join base_tournaments b on b.id = t.tournament_id
     where b.flow_version = 1 or b.public_status = 'finished'
  ),
  participants as (
    select tournament_id, count(distinct player_id) as n
      from done
     where not is_rebuy and not is_addon
     group by tournament_id
  ),
  placement as (
    select player_id, tournament_id, max(final_placement) as pl
      from done
     where final_placement is not null
     group by player_id, tournament_id
  ),
  per_player as (
    select player_id,
           sum(amount)                     as total_invested,
           sum(coalesce(payout_amount, 0)) as total_winnings,
           count(distinct tournament_id)   as events
      from done
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
  where sp.is_active
  order by coalesce(pts.points, 0) desc,
           (pp.total_winnings - pp.total_invested) desc,
           sp.display_name;
$$;

comment on function public.player_leaderboard() is
  'Ranking agregado no Postgres (S8). 0010: sem jogador inativo. S25: só torneios legados e do fluxo 2 finalizados.';

revoke execute on function public.player_leaderboard() from public, anon;
grant  execute on function public.player_leaderboard() to authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- 2. get_operational_tournament + transactions
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.get_operational_tournament(tournament_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_tid alias for $1;
  v_err jsonb; v_t public.base_tournaments;
begin
  v_err := private.admin_error();
  if v_err is not null then
    return v_err;
  end if;
  if p_tid is null then
    select * into v_t from public.base_tournaments
     where flow_version = 2 and public_status not in ('finished', 'cancelled')
     order by created_at desc, id limit 1;
  else
    select * into v_t from public.base_tournaments where id = p_tid and flow_version = 2;
  end if;
  if v_t.id is null then
    return private.rpc_error('NOT_FOUND');
  end if;

  return private.rpc_ok(jsonb_build_object(
    'tournament', private.tournament_json(v_t.id),
    'runtime', private.runtime_json(v_t.id),
    'payment', private.payment_json(v_t.id),
    'offers', private.offers_json(v_t.id),
    'participants', (select coalesce(jsonb_agg(private.participant_json(p.id) order by sp.display_name, p.id), '[]'::jsonb)
                       from public.tournament_participants p join public.sub_players sp on sp.id = p.player_id
                      where p.tournament_id = v_t.id),
    'pending_sessions', (select coalesce(jsonb_agg(private.session_json(s.id, true) order by s.created_at, s.id), '[]'::jsonb)
                           from public.player_device_sessions s
                          where s.claimed_in_tournament_id = v_t.id and s.status = 'pending' and s.expires_at > now()),
    'requests', (select coalesce(jsonb_agg(private.request_json(r.id, true) order by r.created_at, r.id), '[]'::jsonb)
                   from public.purchase_requests r where r.tournament_id = v_t.id),
    'authorizations', (select coalesce(jsonb_agg(private.authorization_json(a.id) order by a.created_at, a.id), '[]'::jsonb)
                         from public.purchase_authorizations a where a.tournament_id = v_t.id),
    'transactions', (select coalesce(jsonb_agg(private.transaction_json(t.request_id) order by t.confirmed_at, t.id), '[]'::jsonb)
                       from public.transactions t where t.tournament_id = v_t.id and t.request_id is not null)));
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 3. update_tournament_setup
-- ════════════════════════════════════════════════════════════════════════
-- payload = { offers?: [Offer de entrada, como na criação], payment?: {pix_key_type, pix_key,
-- receiver_name, instructions?} }; pelo menos um dos dois.
-- Ofertas: só em rascunho, ou publicado sem pedido vivo (requested/payment_reported/confirmed).
-- As antigas ficam inativas (pedidos encerrados continuam apontando para elas).
-- PIX: rascunho, publicado, inscrição fechada ou em andamento. Pedido já feito guarda o snapshot.
create or replace function public.update_tournament_setup(tournament_id uuid, expected_version bigint, payload jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_tid alias for $1; p_expected alias for $2; p_payload alias for $3;
  v_err jsonb; v_t public.base_tournaments; v_buyin numeric;
  v_has_offers boolean; v_has_payment boolean; v_state text; v_con text; v_col text;
begin
  v_err := private.admin_error();
  if v_err is not null then
    return v_err;
  end if;
  if p_tid is null or p_expected is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return private.rpc_error('INVALID_ARGUMENT');
  end if;
  v_has_offers := p_payload ? 'offers';
  v_has_payment := p_payload ? 'payment';
  if not v_has_offers and not v_has_payment then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'payload'));
  end if;
  if v_has_offers then
    if jsonb_typeof(p_payload->'offers') <> 'array' then
      return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'offers'));
    end if;
    if exists (select 1 from jsonb_array_elements(p_payload->'offers') x
                where jsonb_typeof(x) <> 'object'
                   or coalesce(x->>'price', '') !~ '^[0-9]{1,12}([.][0-9]{1,2})?$') then
      return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'offers.price'));
    end if;
    select (x->>'price')::numeric(14,2) into v_buyin
      from jsonb_array_elements(p_payload->'offers') with ordinality e(x, ord)
     where x->>'kind' = 'buyin'
     order by coalesce((x->>'sort_order')::int, e.ord::int), e.ord
     limit 1;
    if v_buyin is null then
      return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'offers', 'reason', 'buyin_required'));
    end if;
  end if;
  if v_has_payment and jsonb_typeof(p_payload->'payment') <> 'object' then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'payment'));
  end if;

  select * into v_t from public.base_tournaments where id = p_tid and flow_version = 2 for no key update;
  if v_t.id is null then
    return private.rpc_error('NOT_FOUND');
  end if;
  if v_t.state_version <> p_expected then
    return private.rpc_error('VERSION_CONFLICT', jsonb_build_object('current_version', v_t.state_version));
  end if;
  if v_t.public_status in ('finished', 'cancelled') then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT', jsonb_build_object('public_status', v_t.public_status));
  end if;
  if v_has_offers and (
       v_t.public_status not in ('draft', 'published')
       or exists (select 1 from public.purchase_requests r
                   where r.tournament_id = p_tid and r.status in ('requested', 'payment_reported', 'confirmed'))) then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT',
      jsonb_build_object('reason', 'offers_locked', 'public_status', v_t.public_status));
  end if;

  begin
    if v_has_offers then
      update public.purchase_offers
         set is_active = false, updated_at = now()
       where tournament_id = p_tid and is_active;
      insert into public.purchase_offers (
        tournament_id, kind, name, sort_order, price, chips_granted, rebuy_units, eligible_after_units, max_uses)
      select p_tid,
             x->>'kind',
             btrim(x->>'name'),
             coalesce((x->>'sort_order')::integer, e.ord::integer),
             (x->>'price')::numeric(14,2),
             (x->>'chips_granted')::integer,
             coalesce((x->>'rebuy_units')::integer, case when x->>'kind' = 'rebuy' then 1 else 0 end),
             case when x ? 'eligible_after_units'
                  then array(select v::integer from jsonb_array_elements_text(x->'eligible_after_units') v)
                  else '{0}'::integer[] end,
             (x->>'max_uses')::integer
        from jsonb_array_elements(p_payload->'offers') with ordinality e(x, ord);
      update public.base_tournaments set buy_in_value = v_buyin where id = p_tid;
    end if;

    if v_has_payment then
      update public.tournament_payment_settings
         set pix_key_type  = p_payload->'payment'->>'pix_key_type',
             pix_key       = btrim(p_payload->'payment'->>'pix_key'),
             receiver_name = btrim(p_payload->'payment'->>'receiver_name'),
             instructions  = nullif(btrim(p_payload->'payment'->>'instructions'), ''),
             version       = version + 1,
             updated_at    = now()
       where tournament_id = p_tid;
    end if;

    update public.base_tournaments set state_version = state_version + 1 where id = p_tid;
  exception when data_exception or integrity_constraint_violation then
    get stacked diagnostics v_state = returned_sqlstate, v_con = constraint_name, v_col = column_name;
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object(
      'sqlstate', v_state, 'constraint', nullif(v_con, ''), 'column', nullif(v_col, '')));
  end;

  return private.rpc_ok(jsonb_build_object(
    'tournament', private.tournament_json(p_tid),
    'offers', private.offers_json(p_tid),
    'payment', private.payment_json(p_tid)));
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 4. cancel_operational_tournament
-- ════════════════════════════════════════════════════════════════════════
-- Só antes do início: buy-in só vira lançamento em confirm_buyins_and_start, então aqui não há
-- dinheiro a desfazer. PIX informado bloqueia (o admin rejeita com motivo antes). Pedidos em
-- `requested` expiram, quem aguardava buy-in sai como `withdrawn`, o link /jogar deixa de apontar
-- para o torneio. O registro fica (auditoria) e some do Histórico e do ranking.
create or replace function public.cancel_operational_tournament(tournament_id uuid, expected_version bigint)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_tid alias for $1; p_expected alias for $2;
  v_err jsonb; v_t public.base_tournaments; v_pending jsonb;
begin
  v_err := private.admin_error();
  if v_err is not null then
    return v_err;
  end if;
  if p_tid is null or p_expected is null then
    return private.rpc_error('INVALID_ARGUMENT');
  end if;

  select * into v_t from public.base_tournaments where id = p_tid and flow_version = 2 for no key update;
  if v_t.id is null then
    return private.rpc_error('NOT_FOUND');
  end if;
  if v_t.state_version <> p_expected then
    return private.rpc_error('VERSION_CONFLICT', jsonb_build_object('current_version', v_t.state_version));
  end if;
  if v_t.public_status not in ('draft', 'published', 'registration_closed') then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT', jsonb_build_object('public_status', v_t.public_status));
  end if;
  if exists (select 1 from public.transactions t where t.tournament_id = p_tid) then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT', jsonb_build_object('reason', 'has_transactions'));
  end if;
  select jsonb_agg(r.id order by r.id) into v_pending
    from public.purchase_requests r
   where r.tournament_id = p_tid and r.status = 'payment_reported';
  if v_pending is not null then
    return private.rpc_error('PENDING_PAYMENT', jsonb_build_object('request_ids', v_pending));
  end if;

  perform 1 from public.tournament_participants where tournament_id = p_tid order by id for update;
  perform 1 from public.purchase_authorizations
   where tournament_id = p_tid and status = 'active' order by id for update;
  perform 1 from public.purchase_requests
   where tournament_id = p_tid and status = 'requested' order by id for update;

  update public.purchase_requests
     set status = 'expired', version = version + 1, updated_at = now()
   where tournament_id = p_tid and status = 'requested';
  update public.purchase_authorizations
     set status = 'expired', version = version + 1
   where tournament_id = p_tid and status = 'active';
  update public.tournament_participants
     set status = 'withdrawn', version = version + 1, updated_at = now()
   where tournament_id = p_tid and status = 'pending_buyin';
  update public.base_tournaments
     set public_status = 'cancelled', status = 'cancelled', is_public_current = false,
         state_version = state_version + 1
   where id = p_tid;

  return private.rpc_ok(jsonb_build_object('tournament', private.tournament_json(p_tid)));
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 5. Permissões (mesmo modelo da 0013)
-- ════════════════════════════════════════════════════════════════════════
do $$
declare f text;
begin
  foreach f in array array[
    'public.get_operational_tournament(uuid)',
    'public.update_tournament_setup(uuid, bigint, jsonb)',
    'public.cancel_operational_tournament(uuid, bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

comment on function public.get_operational_tournament(uuid) is
  'S21/S25. Leitura administrativa do torneio do fluxo 2, com lançamentos confirmados. Aditiva ao contrato v1.';
comment on function public.update_tournament_setup(uuid, bigint, jsonb) is
  'S25. Troca ofertas (rascunho/publicado sem pedido vivo) e PIX (até o fim). Aditiva ao contrato v1.';
comment on function public.cancel_operational_tournament(uuid, bigint) is
  'S25. Cancela torneio do fluxo 2 antes do início, sem lançamentos. Aditiva ao contrato v1.';
