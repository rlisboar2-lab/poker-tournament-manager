-- S20 — testes do schema aditivo (migrações 0011 e 0012).
--
-- Rodar SOMENTE no stack local do Supabase CLI, nunca no banco em uso. Tudo acontece
-- dentro de uma transação revertida no fim.
--
--   docker exec -i supabase_db_poker-tournament-manager \
--     psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/s20-schema.sql
--
-- Saída esperada: uma linha "OK <n>" por bloco, nenhum ERROR e o ROLLBACK final.
-- Rodar também rls-rpc-baseline.sql: o legado precisa continuar com 10/10.

\set ON_ERROR_STOP on

begin;

-- 0015: o RLS legado só aceita quem está em app_admins. Os blocos que usam
-- "set local role authenticated" rodam com o JWT deste admin de teste (o bloco 12 limpa).
do $$
declare v_uid uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email) values (v_uid, 'authenticated', 'authenticated', 's20-setup@example.invalid');
  insert into public.app_admins (user_id) values (v_uid);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
end $$;

-- Executa um comando que DEVE falhar com o SQLSTATE indicado.
create function pg_temp.expect_error(p_sql text, p_state text, p_label text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'ESPERAVA ERRO % e passou: %', p_state, p_label;
exception when others then
  if sqlerrm like 'ESPERAVA ERRO%' then raise; end if;
  if sqlstate <> p_state then
    raise exception 'ERRO ERRADO em "%": esperado %, veio % (%)', p_label, p_state, sqlstate, sqlerrm;
  end if;
end $$;

-- Dados-base: dois torneios do fluxo 2, dois jogadores, uma sessão.
create temp table ids as
select gen_random_uuid() as t1, gen_random_uuid() as t2,
       gen_random_uuid() as p1, gen_random_uuid() as p2, gen_random_uuid() as p_inativo,
       gen_random_uuid() as part1, gen_random_uuid() as part2_t2,
       gen_random_uuid() as sess,
       gen_random_uuid() as o_buyin, gen_random_uuid() as o_s1, gen_random_uuid() as o_s2,
       gen_random_uuid() as o_duplo, gen_random_uuid() as o_addon, gen_random_uuid() as o_t2,
       gen_random_uuid() as auth1;

do $$
declare i ids;
begin
  select * into i from ids;
  insert into public.base_tournaments (id, name, flow_version, public_status)
  values (i.t1, 'S20 T1', 2, 'draft'), (i.t2, 'S20 T2', 2, 'draft');
  insert into public.sub_players (id, display_name) values
    (i.p1, 'S20 Ana'), (i.p2, 'S20 Beto');
  insert into public.sub_players (id, display_name, is_active) values (i.p_inativo, 'S20 Inativo', false);
  insert into public.tournament_participants (id, tournament_id, player_id) values
    (i.part1, i.t1, i.p1), (i.part2_t2, i.t2, i.p2);
  insert into public.player_device_sessions (id, token_hash, player_id, claimed_name, status, validated_at, expires_at)
  values (i.sess, private.device_token_hash(repeat('a', 43)), i.p1, 'Ana', 'active', now(), now() + interval '30 days');
  insert into public.purchase_offers (id, tournament_id, kind, name, price, chips_granted, rebuy_units, eligible_after_units) values
    (i.o_buyin, i.t1, 'buyin', 'Buy-in',     10, 10000, 0, '{0}'),
    (i.o_s1,    i.t1, 'rebuy', '1º simples', 15, 10000, 1, '{0}'),
    (i.o_s2,    i.t1, 'rebuy', '2º simples', 20, 10000, 1, '{1}'),
    (i.o_duplo, i.t1, 'rebuy', 'Duplo',      35, 20000, 2, '{0}'),
    (i.o_addon, i.t1, 'addon', 'Add-on',     25, 15000, 0, '{0}'),
    (i.o_t2,    i.t2, 'rebuy', 'T2 simples', 15, 10000, 1, '{0}');
end $$;

-- ── 1. Objetos, RLS e ausência de policies ──────────────────────────────
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('app_admins', 'tournament_payment_settings', 'tournament_runtime',
                       'tournament_participants', 'player_device_sessions', 'purchase_offers',
                       'purchase_authorizations', 'purchase_authorization_offers',
                       'purchase_requests', 'rpc_idempotency')
     and not c.relrowsecurity;
  assert v_bad is null, format('RLS desligado em: %s', v_bad);

  assert (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public'
             and c.relname in ('app_admins', 'tournament_payment_settings', 'tournament_runtime',
                               'tournament_participants', 'player_device_sessions', 'purchase_offers',
                               'purchase_authorizations', 'purchase_authorization_offers',
                               'purchase_requests', 'rpc_idempotency')) = 10,
    'faltam tabelas novas';

  select string_agg(tablename || ':' || policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public'
     and tablename not in ('base_tournaments', 'sub_players', 'transactions',
                           'snapshot_blindstructures', 'live_state');
  assert v_bad is null, format('tabela nova com policy: %s', v_bad);

  assert exists (select 1 from pg_event_trigger
                  where evtname = 'ensure_rls' and evtenabled = 'O'
                    and evtfoid = 'public.rls_auto_enable'::regproc),
    'event trigger ensure_rls ausente ou desligado';
  raise notice 'OK 1 - tabelas novas com RLS, sem policy, e ensure_rls ativo';
end $$;

-- ── 2. anon e authenticated sem acesso direto ───────────────────────────
do $$
declare v_tab text; v_role text;
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    execute format('set local role %I', v_role);
    foreach v_tab in array array['app_admins', 'tournament_payment_settings', 'tournament_runtime',
                                 'tournament_participants', 'player_device_sessions', 'purchase_offers',
                                 'purchase_authorizations', 'purchase_authorization_offers',
                                 'purchase_requests', 'rpc_idempotency'] loop
      perform pg_temp.expect_error(format('select 1 from public.%I limit 1', v_tab), '42501',
                                   v_role || ' lendo ' || v_tab);
    end loop;
    -- 0015: authenticated executa is_admin() (as policies precisam); anon continua barrado.
    if v_role = 'anon' then
      perform pg_temp.expect_error('select private.is_admin()', '42501', v_role || ' chamando private.is_admin');
    end if;
    perform pg_temp.expect_error($q$select private.device_token_hash('x')$q$, '42501',
                                 v_role || ' chamando private.device_token_hash');
    reset role;
  end loop;
  raise notice 'OK 2 - anon/authenticated sem leitura das tabelas novas nem dos helpers privados';
end $$;

-- ── 3. Legado: save_tournament continua e preenche kind/rebuy_units ─────
do $$
declare v_id uuid; v_bad integer;
begin
  set local role authenticated;
  v_id := public.save_tournament(jsonb_build_object(
    'name', 'S20 legado', 'buy_in_value', 15, 'rebuy_value', 20, 'addon_value', 25,
    'level_duration_seconds', 900, 'levels', '[]'::jsonb,
    'entries', jsonb_build_array(
      jsonb_build_object('name', 'S20 Carla', 'buyins', 1, 'rebuys', 2, 'addons', 1,
                         'final_placement', 1, 'payout_amount', 50))));
  reset role;

  select count(*) into v_bad from public.transactions
   where tournament_id = v_id
     and not ((kind = 'buyin' and not is_rebuy and not is_addon and rebuy_units = 0)
           or (kind = 'rebuy' and is_rebuy and rebuy_units = 1)
           or (kind = 'addon' and is_addon and rebuy_units = 0));
  assert v_bad = 0, format('%s transacao(oes) legada(s) com kind/rebuy_units errados', v_bad);
  assert (select count(*) from public.transactions where tournament_id = v_id and kind = 'rebuy') = 2,
    'esperado 2 rebuys legados';
  assert (select flow_version = 1 and public_status is null and state_version = 1
            from public.base_tournaments where id = v_id),
    'torneio legado nao ficou em flow_version 1';
  raise notice 'OK 3 - save_tournament legado grava kind e 1 unidade por rebuy';
end $$;

-- ── 4. transactions: constraints de tipo e unidades ─────────────────────
do $$
declare i ids;
begin
  select * into i from ids;
  perform pg_temp.expect_error(format(
    'insert into public.transactions (tournament_id, player_id, amount, is_rebuy, is_addon) values (%L, %L, 10, true, true)',
    i.t1, i.p1), '23514', 'rebuy e addon juntos');
  perform pg_temp.expect_error(format(
    'insert into public.transactions (tournament_id, player_id, amount, is_rebuy, rebuy_units) values (%L, %L, 10, true, 0)',
    i.t1, i.p1), '23514', 'rebuy com zero unidades');
  perform pg_temp.expect_error(format(
    'insert into public.transactions (tournament_id, player_id, amount, rebuy_units) values (%L, %L, 10, 2)',
    i.t1, i.p1), '23514', 'buy-in com unidades');
  perform pg_temp.expect_error(format(
    'insert into public.transactions (tournament_id, player_id, amount, chips_granted) values (%L, %L, 10, 0)',
    i.t1, i.p1), '23514', 'fichas zero');
  perform pg_temp.expect_error(
    'update public.transactions set kind = ''addon'' where false', '428C9', 'escrever na coluna gerada kind');
  raise notice 'OK 4 - transactions rejeita tipo duplo, unidades e fichas invalidas';
end $$;

-- ── 5. base_tournaments: fluxo, estado público e link global único ──────
do $$
declare i ids;
begin
  select * into i from ids;
  perform pg_temp.expect_error(
    'insert into public.base_tournaments (name, public_status) values (''x'', ''draft'')',
    '23514', 'legado com public_status');
  perform pg_temp.expect_error(
    'insert into public.base_tournaments (name, flow_version) values (''x'', 2)',
    '23514', 'fluxo 2 sem public_status');
  perform pg_temp.expect_error(
    'insert into public.base_tournaments (name, flow_version) values (''x'', 3)',
    '23514', 'flow_version invalido');
  perform pg_temp.expect_error(
    'insert into public.base_tournaments (name, flow_version, public_status, public_id) values (''x'', 2, ''published'', ''Maiuscula'')',
    '23514', 'public_id fora do formato');
  perform pg_temp.expect_error(
    'insert into public.base_tournaments (name, flow_version, public_status, public_id, is_public_current) values (''x'', 2, ''draft'', ''rascunho-1'', true)',
    '23514', 'rascunho como link atual');

  update public.base_tournaments set public_status = 'published', public_id = 's20-t1', is_public_current = true
   where id = i.t1;
  perform pg_temp.expect_error(format(
    'update public.base_tournaments set public_status = ''published'', public_id = ''s20-t2'', is_public_current = true where id = %L',
    i.t2), '23505', 'dois torneios no link global');
  perform pg_temp.expect_error(format(
    'update public.base_tournaments set public_status = ''published'', public_id = ''s20-t1'' where id = %L',
    i.t2), '23505', 'public_id repetido');
  raise notice 'OK 5 - base_tournaments: fluxo, formato do public_id e um so torneio no /jogar';
end $$;

-- ── 6. Participantes: duplicata e jogador inativo ───────────────────────
do $$
declare i ids;
begin
  select * into i from ids;
  perform pg_temp.expect_error(format(
    'insert into public.tournament_participants (tournament_id, player_id) values (%L, %L)', i.t1, i.p1),
    '23505', 'participante duplicado');
  perform pg_temp.expect_error(format(
    'insert into public.tournament_participants (tournament_id, player_id) values (%L, %L)', i.t1, i.p_inativo),
    '23514', 'jogador inativo');
  perform pg_temp.expect_error(format(
    'update public.tournament_participants set status = ''eliminated'' where id = %L', i.part1),
    '23514', 'eliminado sem eliminated_at');
  raise notice 'OK 6 - participante unico por torneio e inativo bloqueado';
end $$;

-- ── 7. Ofertas: unidades e elegibilidade ────────────────────────────────
do $$
declare i ids;
begin
  select * into i from ids;
  perform pg_temp.expect_error(format(
    'insert into public.purchase_offers (tournament_id, kind, name, price, chips_granted, rebuy_units) values (%L, ''rebuy'', ''x'', 15, 100, 0)',
    i.t1), '23514', 'rebuy sem unidade');
  perform pg_temp.expect_error(format(
    'insert into public.purchase_offers (tournament_id, kind, name, price, chips_granted, rebuy_units) values (%L, ''addon'', ''x'', 15, 100, 1)',
    i.t1), '23514', 'addon consumindo rebuy');
  perform pg_temp.expect_error(format(
    'insert into public.purchase_offers (tournament_id, kind, name, price, chips_granted, eligible_after_units) values (%L, ''buyin'', ''x'', 15, 100, ''{-1}'')',
    i.t1), '23514', 'elegibilidade negativa');
  perform pg_temp.expect_error(format(
    'insert into public.purchase_offers (tournament_id, kind, name, price, chips_granted, eligible_after_units) values (%L, ''buyin'', ''x'', 15, 100, ''{}'')',
    i.t1), '23514', 'elegibilidade vazia');
  perform pg_temp.expect_error(format(
    'insert into public.purchase_offers (tournament_id, kind, name, price, chips_granted) values (%L, ''buyin'', ''x'', -1, 100)',
    i.t1), '23514', 'preco negativo');
  raise notice 'OK 7 - ofertas rejeitam unidades, elegibilidade e preco invalidos';
end $$;

-- ── 8. Autorizações e pedidos não cruzam torneio, tipo ou oferta ────────
do $$
declare i ids;
begin
  select * into i from ids;
  -- autorização de T1 apontando participante de T2
  perform pg_temp.expect_error(format(
    'insert into public.purchase_authorizations (tournament_id, participant_id, kind, created_by) values (%L, %L, ''rebuy'', gen_random_uuid())',
    i.t1, i.part2_t2), '23503', 'autorizacao com participante de outro torneio');

  insert into public.purchase_authorizations (id, tournament_id, participant_id, kind, created_by)
  values (i.auth1, i.t1, i.part1, 'rebuy', gen_random_uuid());
  insert into public.purchase_authorization_offers (authorization_id, offer_id, tournament_id, kind)
  values (i.auth1, i.o_s1, i.t1, 'rebuy'), (i.auth1, i.o_duplo, i.t1, 'rebuy');

  perform pg_temp.expect_error(format(
    'insert into public.purchase_authorization_offers (authorization_id, offer_id, tournament_id, kind) values (%L, %L, %L, ''rebuy'')',
    i.auth1, i.o_t2, i.t1), '23503', 'autorizacao liberando oferta de outro torneio');
  perform pg_temp.expect_error(format(
    'insert into public.purchase_authorization_offers (authorization_id, offer_id, tournament_id, kind) values (%L, %L, %L, ''addon'')',
    i.auth1, i.o_addon, i.t1), '23503', 'autorizacao de rebuy liberando addon');
  perform pg_temp.expect_error(format(
    'insert into public.purchase_authorizations (tournament_id, participant_id, kind, created_by) values (%L, %L, ''rebuy'', gen_random_uuid())',
    i.t1, i.part1), '23505', 'segunda autorizacao ativa do mesmo tipo');

  -- pedido com oferta não liberada pela autorização (2º simples)
  perform pg_temp.expect_error(format(
    'insert into public.purchase_requests (tournament_id, participant_id, player_id, session_id, authorization_id, offer_id, kind, idempotency_key, offer_name, price, chips_granted, rebuy_units)
     values (%L, %L, %L, %L, %L, %L, ''rebuy'', gen_random_uuid(), ''2º simples'', 20, 10000, 1)',
    i.t1, i.part1, i.p1, i.sess, i.auth1, i.o_s2), '23503', 'oferta fora da autorizacao');
  -- pedido com player_id que não é o do participante
  perform pg_temp.expect_error(format(
    'insert into public.purchase_requests (tournament_id, participant_id, player_id, session_id, authorization_id, offer_id, kind, idempotency_key, offer_name, price, chips_granted, rebuy_units)
     values (%L, %L, %L, %L, %L, %L, ''rebuy'', gen_random_uuid(), ''1º simples'', 15, 10000, 1)',
    i.t1, i.part1, i.p2, i.sess, i.auth1, i.o_s1), '23503', 'pedido com jogador trocado');
  -- tipo do pedido diferente do tipo da oferta
  perform pg_temp.expect_error(format(
    'insert into public.purchase_requests (tournament_id, participant_id, player_id, session_id, offer_id, kind, idempotency_key, offer_name, price, chips_granted, rebuy_units)
     values (%L, %L, %L, %L, %L, ''buyin'', gen_random_uuid(), ''x'', 15, 10000, 0)',
    i.t1, i.part1, i.p1, i.sess, i.o_s1), '23503', 'buy-in apontando oferta de rebuy');
  -- rebuy sem autorização
  perform pg_temp.expect_error(format(
    'insert into public.purchase_requests (tournament_id, participant_id, player_id, session_id, offer_id, kind, idempotency_key, offer_name, price, chips_granted, rebuy_units)
     values (%L, %L, %L, %L, %L, ''rebuy'', gen_random_uuid(), ''x'', 15, 10000, 1)',
    i.t1, i.part1, i.p1, i.sess, i.o_s1), '23514', 'rebuy sem autorizacao');
  raise notice 'OK 8 - autorizacoes e pedidos presos ao mesmo torneio, jogador, tipo e oferta liberada';
end $$;

-- ── 9. Um buy-in vivo e uma compra adicional aberta por participante ────
do $$
declare i ids; v_req uuid;
begin
  select * into i from ids;
  insert into public.purchase_requests (tournament_id, participant_id, player_id, session_id, offer_id, kind,
                                        idempotency_key, offer_name, price, chips_granted, rebuy_units)
  values (i.t1, i.part1, i.p1, i.sess, i.o_buyin, 'buyin', gen_random_uuid(), 'Buy-in', 10, 10000, 0);
  perform pg_temp.expect_error(format(
    'insert into public.purchase_requests (tournament_id, participant_id, player_id, session_id, offer_id, kind, idempotency_key, offer_name, price, chips_granted, rebuy_units)
     values (%L, %L, %L, %L, %L, ''buyin'', gen_random_uuid(), ''Buy-in'', 10, 10000, 0)',
    i.t1, i.part1, i.p1, i.sess, i.o_buyin), '23505', 'segundo buy-in vivo');

  insert into public.purchase_requests (id, tournament_id, participant_id, player_id, session_id, authorization_id,
                                        offer_id, kind, idempotency_key, offer_name, price, chips_granted, rebuy_units)
  values (gen_random_uuid(), i.t1, i.part1, i.p1, i.sess, i.auth1, i.o_s1, 'rebuy', gen_random_uuid(),
          '1º simples', 15, 10000, 1)
  returning id into v_req;
  perform pg_temp.expect_error(format(
    'insert into public.purchase_requests (tournament_id, participant_id, player_id, session_id, authorization_id, offer_id, kind, idempotency_key, offer_name, price, chips_granted, rebuy_units)
     values (%L, %L, %L, %L, %L, %L, ''rebuy'', gen_random_uuid(), ''Duplo'', 35, 20000, 2)',
    i.t1, i.part1, i.p1, i.sess, i.auth1, i.o_duplo), '23505', 'simples pendente bloqueia duplo');

  -- cancelar libera a vaga
  update public.purchase_requests set status = 'cancelled' where id = v_req;
  insert into public.purchase_requests (tournament_id, participant_id, player_id, session_id, authorization_id,
                                        offer_id, kind, idempotency_key, offer_name, price, chips_granted, rebuy_units)
  values (i.t1, i.part1, i.p1, i.sess, i.auth1, i.o_duplo, 'rebuy', gen_random_uuid(), 'Duplo', 35, 20000, 2);

  perform pg_temp.expect_error(format(
    'update public.purchase_requests set status = ''payment_reported'' where participant_id = %L and status = ''requested'' and kind = ''rebuy''',
    i.part1), '23514', 'payment_reported sem data');
  perform pg_temp.expect_error(format(
    'update public.purchase_requests set status = ''confirmed'' where participant_id = %L and status = ''requested'' and kind = ''rebuy''',
    i.part1), '23514', 'confirmed sem resolved_at');
  raise notice 'OK 9 - um buy-in vivo, uma compra extra aberta, cancelamento libera reserva';
end $$;

-- ── 10. Duplo confirmado: uma transação, R$ 35, duas unidades ───────────
do $$
declare i ids; v_req uuid; v_other uuid;
begin
  select * into i from ids;
  select id into v_req from public.purchase_requests
   where participant_id = i.part1 and kind = 'rebuy' and status = 'requested';
  update public.purchase_requests set status = 'confirmed', resolved_at = now() where id = v_req;

  insert into public.transactions (tournament_id, player_id, amount, is_rebuy, rebuy_units, chips_granted,
                                   request_id, confirmed_at)
  values (i.t1, i.p1, 35, true, 2, 20000, v_req, now());

  assert (select count(*) = 1 and sum(amount) = 35 and sum(rebuy_units) = 2 and sum(chips_granted) = 20000
            from public.transactions where request_id = v_req),
    'duplo nao virou uma transacao de 35 com 2 unidades e 20000 fichas';

  perform pg_temp.expect_error(format(
    'insert into public.transactions (tournament_id, player_id, amount, is_rebuy, rebuy_units, request_id, confirmed_at) values (%L, %L, 35, true, 2, %L, now())',
    i.t1, i.p1, v_req), '23505', 'mesmo pedido confirmado duas vezes');

  select id into v_other from public.purchase_requests where participant_id = i.part1 and kind = 'buyin';
  perform pg_temp.expect_error(format(
    'insert into public.transactions (tournament_id, player_id, amount, request_id, confirmed_at) values (%L, %L, 10, %L, now())',
    i.t1, i.p2, v_other), '23503', 'transacao com jogador diferente do pedido');
  perform pg_temp.expect_error(format(
    'insert into public.transactions (tournament_id, player_id, amount, is_addon, request_id, confirmed_at) values (%L, %L, 10, true, %L, now())',
    i.t1, i.p1, v_other), '23503', 'transacao com tipo diferente do pedido');
  perform pg_temp.expect_error(format(
    'insert into public.transactions (tournament_id, player_id, amount, request_id) values (%L, %L, 10, %L)',
    i.t1, i.p1, v_other), '23514', 'transacao de pedido sem confirmed_at');
  raise notice 'OK 10 - duplo = 1 transacao de 35, 2 unidades; request_id unico e preso ao pedido';
end $$;

-- ── 11. Token do dispositivo e sessões ──────────────────────────────────
do $$
declare i ids; v_h bytea;
begin
  select * into i from ids;
  v_h := private.device_token_hash(repeat('b', 43));
  assert octet_length(v_h) = 32, 'hash nao tem 32 bytes';
  assert v_h = private.device_token_hash(repeat('b', 43)), 'hash nao e deterministico';
  assert v_h <> private.device_token_hash(repeat('c', 43)), 'tokens diferentes com mesmo hash';
  perform pg_temp.expect_error($q$select private.device_token_hash('curto')$q$, '22023', 'token curto');
  perform pg_temp.expect_error($q$select private.device_token_hash(repeat('a', 42) || '!')$q$, '22023', 'token com caractere invalido');

  perform pg_temp.expect_error(
    'insert into public.player_device_sessions (token_hash, claimed_name, status, expires_at) values (private.device_token_hash(repeat(''d'', 43)), ''x'', ''active'', now() + interval ''1 day'')',
    '23514', 'sessao ativa sem jogador validado');
  perform pg_temp.expect_error(
    'insert into public.player_device_sessions (token_hash, claimed_name, expires_at) values (private.device_token_hash(repeat(''a'', 43)), ''x'', now() + interval ''1 day'')',
    '23505', 'token repetido');
  perform pg_temp.expect_error(
    'insert into public.player_device_sessions (token_hash, claimed_name, expires_at) values (''\x00''::bytea, ''x'', now() + interval ''1 day'')',
    '23514', 'hash com tamanho errado');
  raise notice 'OK 11 - token vira hash SHA-256 de 32 bytes; sessao ativa exige jogador';
end $$;

-- ── 12. private.is_admin() segue app_admins ─────────────────────────────
do $$
declare v_uid uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email) values (v_uid, 'authenticated', 'authenticated', 's20-admin@example.invalid');
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  assert not private.is_admin(), 'usuario fora de app_admins virou admin';
  insert into public.app_admins (user_id) values (v_uid);
  assert private.is_admin(), 'usuario em app_admins nao virou admin';
  perform set_config('request.jwt.claims', '', true);
  assert not private.is_admin(), 'sem JWT virou admin';
  raise notice 'OK 12 - private.is_admin segue app_admins e auth.uid()';
end $$;

-- ── 13. Apagar torneio do fluxo 2 limpa tudo em cascata ─────────────────
do $$
declare i ids;
begin
  select * into i from ids;
  insert into public.tournament_payment_settings (tournament_id, pix_key_type, pix_key, receiver_name)
  values (i.t1, 'random', 'chave-teste', 'Recebedor Teste');
  insert into public.tournament_runtime (tournament_id) values (i.t1);
  perform pg_temp.expect_error(format(
    'delete from public.purchase_offers where id = %L', i.o_duplo),
    '23503', 'oferta com pedido ainda nao pode ser apagada isoladamente');
  delete from public.base_tournaments where id = i.t1;
  assert not exists (select 1 from public.purchase_requests where tournament_id = i.t1), 'pedidos sobraram';
  assert not exists (select 1 from public.purchase_offers where tournament_id = i.t1), 'ofertas sobraram';
  assert not exists (select 1 from public.transactions where tournament_id = i.t1), 'transacoes sobraram';
  assert exists (select 1 from public.player_device_sessions where id = i.sess), 'sessao global foi apagada junto';
  assert exists (select 1 from public.base_tournaments where id = i.t2), 'outro torneio foi apagado';
  assert exists (select 1 from public.purchase_offers where id = i.o_t2), 'oferta de outro torneio foi apagada';
  raise notice 'OK 13 - excluir torneio do fluxo 2 limpa dependentes, preserva outro torneio e mantem FK imediata';
end $$;

rollback;
