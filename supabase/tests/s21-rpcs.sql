-- S21 — testes das RPCs do fluxo de pagamentos (migração 0013).
--
-- Rodar SOMENTE no stack local do Supabase CLI, nunca no banco em uso. Tudo acontece
-- dentro de uma transação revertida no fim.
--
--   docker exec -i supabase_db_poker-tournament-manager \
--     psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/s21-rpcs.sql
--
-- Saída esperada: uma linha "OK <n>" por bloco, nenhum ERROR e o ROLLBACK final.
-- As chamadas passam pelos papéis reais (anon / authenticated com JWT simulado).
-- Corridas com duas conexões ficam em s21-concurrency.sh.

\set ON_ERROR_STOP on

begin;

-- ── Infra de teste ──────────────────────────────────────────────────────
create temp table ctx (k text primary key, v text);

create function pg_temp.put(p_k text, p_v text) returns void language sql as $$
  insert into ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$$;
create function pg_temp.get(p_k text) returns text language sql as $$
  select v from ctx where k = p_k
$$;
create function pg_temp.uid(p_k text) returns uuid language sql as $$
  select v::uuid from ctx where k = p_k
$$;

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

-- Chamada como anon (sem JWT de usuário).
create function pg_temp.anon(p_call text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  execute 'select ' || p_call into r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;

-- Chamada como usuário autenticado (admin ou não, conforme app_admins).
create function pg_temp.as_user(p_uid uuid, p_call text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute 'select ' || p_call into r;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;

create function pg_temp.adm(p_call text) returns jsonb language sql as $$
  select pg_temp.as_user(pg_temp.uid('admin'), p_call)
$$;

create function pg_temp.ok(p jsonb, p_label text) returns jsonb language plpgsql as $$
begin
  if p is null or (p->>'ok') is distinct from 'true' then
    raise exception 'ESPERAVA ok em "%": %', p_label, p;
  end if;
  return p->'data';
end $$;

create function pg_temp.err(p jsonb, p_code text, p_label text) returns jsonb language plpgsql as $$
begin
  if p is null or (p->>'ok') is distinct from 'false' or (p->'error'->>'code') is distinct from p_code then
    raise exception 'ESPERAVA % em "%": %', p_code, p_label, p;
  end if;
  if not (p->'error' ? 'message' and p->'error' ? 'retryable' and p->'error' ? 'details') then
    raise exception 'envelope de erro incompleto em "%": %', p_label, p;
  end if;
  return p->'error'->'details';
end $$;

create function pg_temp.tok(p_name text) returns text language sql as $$
  select rpad('s21tok' || p_name, 43, 'x')
$$;

-- Atalhos das RPCs.
create function pg_temp.identify(p_name text, p_tok text, p_key uuid, p_pub text default null) returns jsonb language sql as $$
  select pg_temp.anon(format('public.identify_player(%L, %L, %L, %L)', p_pub, p_name, p_tok, p_key))
$$;
create function pg_temp.portal(p_tok text) returns jsonb language sql as $$
  select pg_temp.anon(format('public.get_player_portal(%L)', p_tok))
$$;
create function pg_temp.buyin(p_tok text, p_offer uuid, p_key uuid) returns jsonb language sql as $$
  select pg_temp.anon(format('public.request_buyin(%L, %L, %L)', p_tok, p_offer, p_key))
$$;
create function pg_temp.purchase(p_tok text, p_auth uuid, p_offer uuid, p_key uuid) returns jsonb language sql as $$
  select pg_temp.anon(format('public.request_purchase(%L, %L, %L, %L)', p_tok, p_auth, p_offer, p_key))
$$;
create function pg_temp.report(p_tok text, p_req uuid) returns jsonb language sql as $$
  select pg_temp.anon(format('public.report_payment(%L, %L)', p_tok, p_req))
$$;
create function pg_temp.cancel(p_tok text, p_req uuid) returns jsonb language sql as $$
  select pg_temp.anon(format('public.cancel_purchase_request(%L, %L)', p_tok, p_req))
$$;
create function pg_temp.authorize(p_part uuid, p_kind text, p_offers uuid[], p_exp timestamptz default null) returns jsonb language sql as $$
  select pg_temp.adm(format('public.authorize_purchase(%L, %L, %L::uuid[], %L)', p_part, p_kind, p_offers, p_exp))
$$;
create function pg_temp.confirm(p_req uuid, p_ver bigint) returns jsonb language sql as $$
  select pg_temp.adm(format('public.confirm_purchase(%L, %s)', p_req, p_ver))
$$;
create function pg_temp.rver(p_req uuid) returns bigint language sql as $$
  select version from public.purchase_requests where id = p_req
$$;
create function pg_temp.tver(p_tid uuid) returns bigint language sql as $$
  select state_version from public.base_tournaments where id = p_tid
$$;
create function pg_temp.offer(p_name text) returns uuid language sql as $$
  select id from public.purchase_offers where tournament_id = pg_temp.uid('t1') and name = p_name
$$;
create function pg_temp.part(p_name text) returns uuid language sql as $$
  select p.id from public.tournament_participants p join public.sub_players sp on sp.id = p.player_id
   where p.tournament_id = pg_temp.uid('t1') and sp.display_name = p_name
$$;
create function pg_temp.sess(p_tok text) returns uuid language sql as $$
  select id from public.player_device_sessions where token_hash = private.device_token_hash(p_tok)
$$;
create function pg_temp.pot() returns numeric language sql as $$
  select coalesce(sum(amount), 0) from public.transactions where tournament_id = pg_temp.uid('t1')
$$;
create function pg_temp.chips() returns bigint language sql as $$
  select coalesce(sum(chips_granted), 0) from public.transactions where tournament_id = pg_temp.uid('t1')
$$;
-- ids de ofertas de rebuy elegíveis no portal do jogador
create function pg_temp.eligible_rebuys(p_tok text) returns uuid[] language sql as $$
  select coalesce(array_agg(x::uuid order by x), '{}')
    from jsonb_array_elements_text(pg_temp.ok(pg_temp.portal(p_tok), 'portal')->'participant'->'eligible_offer_ids') x
   where x::uuid in (select id from public.purchase_offers where tournament_id = pg_temp.uid('t1') and kind = 'rebuy')
$$;

-- Usuários: um admin e um autenticado comum.
do $$
declare v_admin uuid := gen_random_uuid(); v_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email) values
    (v_admin, 'authenticated', 'authenticated', 's21-admin@example.invalid'),
    (v_user,  'authenticated', 'authenticated', 's21-user@example.invalid');
  insert into public.app_admins (user_id) values (v_admin);
  perform pg_temp.put('admin', v_admin::text);
  perform pg_temp.put('user', v_user::text);
  -- se o banco local tiver dados reais, nenhum torneio pode estar no /jogar durante o teste.
  update public.base_tournaments set is_public_current = false where is_public_current;
  insert into public.sub_players (display_name) values ('S21 Beto');
  insert into public.sub_players (display_name, is_active) values ('S21 Inativo', false);
end $$;

-- ── 1. Permissões, security definer e search_path ───────────────────────
do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('get_public_tournament', 'identify_player', 'get_player_portal', 'request_buyin',
                       'request_purchase', 'report_payment', 'cancel_purchase_request', 'revoke_device_session',
                       'create_operational_tournament', 'publish_tournament', 'resolve_player_claim',
                       'confirm_buyins_and_start', 'authorize_purchase', 'confirm_purchase', 'reject_purchase',
                       'revoke_purchase_authorization', 'update_tournament_runtime',
                       'finish_operational_tournament', 'get_operational_tournament')
     and not (p.prosecdef
              and 'search_path=""' = any (p.proconfig)
              -- 0015: anon só executa as 8 públicas; as administrativas ficam só com authenticated.
              and has_function_privilege('anon', p.oid, 'execute') = (p.proname in (
                    'get_public_tournament', 'identify_player', 'get_player_portal', 'request_buyin',
                    'request_purchase', 'report_payment', 'cancel_purchase_request', 'revoke_device_session'))
              and has_function_privilege('authenticated', p.oid, 'execute')
              and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0));
  assert v_bad is null, format('RPC sem security definer/search_path vazio/grant explícito: %s', v_bad);
  assert (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef and 'search_path=""' = any (p.proconfig)
             and p.proname in ('get_public_tournament', 'identify_player', 'get_player_portal', 'request_buyin',
                       'request_purchase', 'report_payment', 'cancel_purchase_request', 'revoke_device_session',
                       'create_operational_tournament', 'publish_tournament', 'resolve_player_claim',
                       'confirm_buyins_and_start', 'authorize_purchase', 'confirm_purchase', 'reject_purchase',
                       'revoke_purchase_authorization', 'update_tournament_runtime',
                       'finish_operational_tournament', 'get_operational_tournament')) = 19,
    'faltam RPCs da S21';

  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and (has_function_privilege('anon', p.oid, 'execute')
          -- 0015: is_admin() é o único helper que authenticated executa (usado nas policies).
          or (has_function_privilege('authenticated', p.oid, 'execute') and p.proname <> 'is_admin'));
  assert v_bad is null, format('helper privado executável por anon/authenticated: %s', v_bad);

  set local role anon;
  perform pg_temp.expect_error($q$select private.rpc_error('NOT_FOUND')$q$, '42501', 'anon chamando helper privado');
  reset role;

  perform pg_temp.expect_error($q$select private.rpc_error('CODIGO_INVENTADO')$q$, 'P0001', 'código fora do catálogo');
  assert private.rpc_error('VERSION_CONFLICT', '{"current_version":4}')
         = '{"ok":false,"error":{"code":"VERSION_CONFLICT","message":"O torneio mudou. Recarregue e revise antes de confirmar.","retryable":true,"details":{"current_version":4}}}'::jsonb,
    'envelope de erro diferente do contrato';
  raise notice 'OK 1 - 19 RPCs security definer, search_path vazio, grant explícito; helpers privados fechados; catálogo fechado';
end $$;

-- ── 2. Guarda administrativa ────────────────────────────────────────────
do $$
declare v_call text;
begin
  foreach v_call in array array[
    'public.create_operational_tournament(''{}''::jsonb)',
    format('public.publish_tournament(%L, 1)', gen_random_uuid()),
    format('public.resolve_player_claim(%L, null, %L)', gen_random_uuid(), 'x'),
    format('public.confirm_buyins_and_start(%L, 1, ''{}''::uuid[])', gen_random_uuid()),
    format('public.authorize_purchase(%L, ''rebuy'', array[%L]::uuid[], null)', gen_random_uuid(), gen_random_uuid()),
    format('public.confirm_purchase(%L, 1)', gen_random_uuid()),
    format('public.reject_purchase(%L, null)', gen_random_uuid()),
    format('public.revoke_purchase_authorization(%L, null)', gen_random_uuid()),
    format('public.update_tournament_runtime(%L, 1, ''{}''::jsonb)', gen_random_uuid()),
    format('public.finish_operational_tournament(%L, 1, ''[]''::jsonb)', gen_random_uuid()),
    'public.get_operational_tournament()'
  ] loop
    -- 0015: anon perdeu EXECUTE; o cliente traduz 42501 para AUTH_REQUIRED.
    perform pg_temp.expect_error(format('select pg_temp.anon(%L)', v_call), '42501', 'anon em ' || v_call);
    perform pg_temp.err(pg_temp.as_user(pg_temp.uid('user'), v_call), 'ADMIN_REQUIRED', 'não admin em ' || v_call);
  end loop;
  raise notice 'OK 2 - 11 RPCs administrativas: anon = permission denied, autenticado comum = ADMIN_REQUIRED';
end $$;

-- ── 3. create_operational_tournament ────────────────────────────────────
do $$
declare
  v_base jsonb := $j${
    "name": "S21 Teste", "initial_stack": 10000, "schedule": [{"nivel": 1}],
    "offers": [
      {"kind": "buyin", "name": "Buy-in",     "price": "10.00", "chips_granted": 10000},
      {"kind": "rebuy", "name": "1º simples", "price": "15.00", "chips_granted": 10000, "rebuy_units": 1, "eligible_after_units": [0], "max_uses": 1},
      {"kind": "rebuy", "name": "2º simples", "price": "20.00", "chips_granted": 10000, "rebuy_units": 1, "eligible_after_units": [1], "max_uses": 1},
      {"kind": "rebuy", "name": "Duplo",      "price": "35.00", "chips_granted": 20000, "rebuy_units": 2, "eligible_after_units": [0], "max_uses": 1},
      {"kind": "rebuy", "name": "Triplo",     "price": "45.00", "chips_granted": 30000, "rebuy_units": 3, "eligible_after_units": [0], "max_uses": 1},
      {"kind": "addon", "name": "Add-on",     "price": "25.00", "chips_granted": 15000}
    ],
    "payment": {"pix_key_type": "random", "pix_key": "chave-s21", "receiver_name": "Recebedor S21"}
  }$j$;
  v_data jsonb; v_before bigint;
begin
  select count(*) into v_before from public.base_tournaments where flow_version = 2;
  perform pg_temp.err(pg_temp.adm('public.create_operational_tournament(''[]''::jsonb)'), 'INVALID_ARGUMENT', 'payload array');
  perform pg_temp.err(pg_temp.adm(format('public.create_operational_tournament(%L::jsonb)',
    jsonb_set(v_base, '{offers}', (select jsonb_agg(x) from jsonb_array_elements(v_base->'offers') x where x->>'kind' <> 'buyin')))),
    'INVALID_ARGUMENT', 'sem oferta de buy-in');
  perform pg_temp.err(pg_temp.adm(format('public.create_operational_tournament(%L::jsonb)',
    jsonb_set(v_base, '{offers,1,price}', '"15.005"'))), 'INVALID_ARGUMENT', 'preço com 3 casas');
  perform pg_temp.err(pg_temp.adm(format('public.create_operational_tournament(%L::jsonb)',
    jsonb_set(v_base, '{offers,1,price}', '"-1"'))), 'INVALID_ARGUMENT', 'preço negativo');
  perform pg_temp.err(pg_temp.adm(format('public.create_operational_tournament(%L::jsonb)',
    jsonb_set(v_base, '{offers,1,rebuy_units}', '0'))), 'INVALID_ARGUMENT', 'rebuy sem unidade');
  perform pg_temp.err(pg_temp.adm(format('public.create_operational_tournament(%L::jsonb)',
    jsonb_set(v_base, '{offers,5,chips_granted}', '0'))), 'INVALID_ARGUMENT', 'fichas zero');
  perform pg_temp.err(pg_temp.adm(format('public.create_operational_tournament(%L::jsonb)',
    jsonb_set(v_base, '{offers,1,eligible_after_units}', '[]'))), 'INVALID_ARGUMENT', 'elegibilidade vazia');
  perform pg_temp.err(pg_temp.adm(format('public.create_operational_tournament(%L::jsonb)',
    jsonb_set(v_base, '{payment,pix_key_type}', '"boleto"'))), 'INVALID_ARGUMENT', 'tipo PIX inválido');
  perform pg_temp.err(pg_temp.adm(format('public.create_operational_tournament(%L::jsonb)',
    v_base - 'payment')), 'INVALID_ARGUMENT', 'sem PIX');
  assert (select count(*) from public.base_tournaments where flow_version = 2) = v_before,
    'payload inválido deixou torneio parcial';

  v_data := pg_temp.ok(pg_temp.adm(format('public.create_operational_tournament(%L::jsonb)', v_base)), 'criar T1');
  perform pg_temp.put('t1', v_data->'tournament'->>'id');
  assert v_data->'tournament'->>'public_status' = 'draft' and (v_data->'tournament'->>'state_version')::int = 1,
    'T1 não nasceu draft v1';
  assert jsonb_array_length(v_data->'offers') = 6 and (v_data->>'payment_version')::int = 1, 'ofertas/PIX de T1';
  assert v_data->'offers'->1->>'price' = '15.00', 'preço não cruzou como texto decimal';
  assert (select buy_in_value = 10 and flow_version = 2 and status = 'scheduled'
            from public.base_tournaments where id = pg_temp.uid('t1')), 'colunas legadas de T1';
  assert (select rebuy_units = 2 and eligible_after_units = '{0}' and price = 35
            from public.purchase_offers where id = pg_temp.offer('Duplo')), 'oferta Duplo';

  v_data := pg_temp.ok(pg_temp.adm(format('public.create_operational_tournament(%L::jsonb)',
    jsonb_set(v_base, '{name}', '"S21 Rascunho"'))), 'criar T2');
  perform pg_temp.put('t2', v_data->'tournament'->>'id');
  raise notice 'OK 3 - create_operational_tournament valida no banco e não deixa torneio parcial';
end $$;

-- ── 4. publish_tournament e get_public_tournament ───────────────────────
do $$
declare v_data jsonb; v_t1 uuid := pg_temp.uid('t1'); v_t2 uuid := pg_temp.uid('t2');
begin
  perform pg_temp.err(pg_temp.anon('public.get_public_tournament()'), 'NOT_FOUND', 'sem torneio atual');
  perform pg_temp.err(pg_temp.adm(format('public.publish_tournament(%L, 7)', v_t1)), 'VERSION_CONFLICT', 'versão errada');
  perform pg_temp.err(pg_temp.adm(format('public.publish_tournament(%L, 1)', gen_random_uuid())), 'NOT_FOUND', 'torneio inexistente');
  v_data := pg_temp.ok(pg_temp.adm(format('public.publish_tournament(%L, 1)', v_t1)), 'publicar T1');
  assert v_data->'tournament'->>'public_status' = 'published'
     and (v_data->'tournament'->>'state_version')::int = 2
     and v_data->'tournament'->>'public_id' ~ '^[a-z0-9-]{6,64}$'
     and (v_data->'tournament'->>'is_public_current')::boolean, 'T1 publicado';
  perform pg_temp.put('pub1', v_data->'tournament'->>'public_id');
  perform pg_temp.err(pg_temp.adm(format('public.publish_tournament(%L, 2)', v_t1)), 'TOURNAMENT_STATE_CONFLICT', 'publicar duas vezes');
  perform pg_temp.err(pg_temp.adm(format('public.publish_tournament(%L, 1)', v_t2)), 'TOURNAMENT_STATE_CONFLICT', 'segundo torneio no /jogar');

  v_data := pg_temp.ok(pg_temp.anon('public.get_public_tournament()'), 'público atual');
  assert v_data->'tournament'->>'id' = v_t1::text and jsonb_array_length(v_data->'offers') = 6
     and v_data->'payment'->>'pix_key' = 'chave-s21', 'projeção pública de T1';
  assert v_data::text not like '%' || pg_temp.get('admin') || '%', 'resposta pública com UUID de admin';
  v_data := pg_temp.ok(pg_temp.anon(format('public.get_public_tournament(%L)', pg_temp.get('pub1'))), 'público por id');
  assert v_data->'tournament'->>'id' = v_t1::text, 'rota direta';
  perform pg_temp.err(pg_temp.anon('public.get_public_tournament(''nao-existe'')'), 'NOT_FOUND', 'public_id inexistente');
  raise notice 'OK 4 - publicação com versão, um só torneio no /jogar e projeção pública sem dado administrativo';
end $$;

-- ── 5. identify_player ──────────────────────────────────────────────────
do $$
declare v_a text := pg_temp.tok('A'); v_k uuid := gen_random_uuid(); v1 jsonb; v2 jsonb; v_d jsonb; v_n text;
begin
  perform pg_temp.err(pg_temp.identify('S21 Ana', 'curto', v_k), 'INVALID_ARGUMENT', 'token curto');
  perform pg_temp.err(pg_temp.identify('   ', v_a, v_k), 'INVALID_ARGUMENT', 'nome vazio');
  perform pg_temp.err(pg_temp.identify('S21 Ana', v_a, null), 'INVALID_ARGUMENT', 'sem chave');
  perform pg_temp.err(pg_temp.identify('S21 Ana', v_a, v_k, 'nao-existe'), 'NOT_PUBLIC', 'public_id inexistente');

  v1 := pg_temp.identify('S21 Ana', v_a, v_k);
  v_d := pg_temp.ok(v1, 'identificar Ana');
  assert v_d->'session'->>'status' = 'pending' and v_d->>'next_action' = 'await_validation'
     and v_d->'session'->>'player_id' is null, 'Ana não ficou pendente';
  v2 := pg_temp.identify('S21 Ana', v_a, v_k);
  assert v1 = v2, 'repetição idempotente devolveu envelope diferente';
  perform pg_temp.err(pg_temp.identify('S21 Outra', v_a, v_k), 'IDEMPOTENCY_CONFLICT', 'mesma chave, outro nome');
  perform pg_temp.err(pg_temp.identify('S21 Outra', v_a, gen_random_uuid()), 'IDENTITY_CONFLICT', 'mesmo token, outro nome');
  v_d := pg_temp.ok(pg_temp.identify('  s21 ana ', v_a, gen_random_uuid()), 'mesmo nome, outra chave');
  assert v_d->'session'->>'id' = v1->'data'->'session'->>'id', 'recarga criou outra sessão';
  assert (select count(*) from public.player_device_sessions where token_hash = private.device_token_hash(v_a)) = 1,
    'mais de uma sessão por token';
  assert not exists (select 1 from public.rpc_idempotency where response::text like '%' || v_a || '%'),
    'token em texto puro gravado';

  perform pg_temp.ok(pg_temp.identify('S21 Ana', v_a, gen_random_uuid(), pg_temp.get('pub1')), 'rota direta');

  v_d := pg_temp.err(pg_temp.portal(v_a), 'SESSION_PENDING', 'portal pendente');
  assert v_d->'session'->>'status' = 'pending', 'detalhe do SESSION_PENDING';
  perform pg_temp.err(pg_temp.buyin(v_a, pg_temp.offer('Buy-in'), gen_random_uuid()), 'SESSION_PENDING', 'buy-in pendente');
  perform pg_temp.err(pg_temp.portal(pg_temp.tok('Z')), 'NOT_FOUND', 'token desconhecido');
  perform pg_temp.err(pg_temp.portal('x!'), 'INVALID_ARGUMENT', 'token adulterado');

  foreach v_n in array array['Beto', 'Carla', 'Duda', 'Eva', 'Fabio', 'Inativo'] loop
    perform pg_temp.ok(pg_temp.identify('S21 ' || v_n, pg_temp.tok(v_n), gen_random_uuid()), 'identificar ' || v_n);
  end loop;
  -- digitar nome de cadastro existente não concede a identidade
  assert (select player_id is null and status = 'pending' from public.player_device_sessions
           where id = pg_temp.sess(pg_temp.tok('Beto'))), 'nome existente virou identidade sem admin';
  raise notice 'OK 5 - identify_player: pendente, idempotente, sem assumir cadastro, token só como hash';
end $$;

-- ── 6. resolve_player_claim ─────────────────────────────────────────────
do $$
declare v_d jsonb; v_beto uuid; v_inat uuid; v_s uuid;
begin
  select id into v_beto from public.sub_players where display_name = 'S21 Beto';
  select id into v_inat from public.sub_players where display_name = 'S21 Inativo';
  v_s := pg_temp.sess(pg_temp.tok('A'));

  perform pg_temp.err(pg_temp.adm(format('public.resolve_player_claim(%L)', v_s)), 'INVALID_ARGUMENT', 'sem alvo');
  perform pg_temp.err(pg_temp.adm(format('public.resolve_player_claim(%L, %L, %L)', v_s, v_beto, 'x')), 'INVALID_ARGUMENT', 'dois alvos');
  perform pg_temp.err(pg_temp.adm(format('public.resolve_player_claim(%L, null, %L)', gen_random_uuid(), 'x')), 'NOT_FOUND', 'sessão inexistente');
  perform pg_temp.err(pg_temp.adm(format('public.resolve_player_claim(%L, null, %L)', v_s, ' s21 beto')),
    'IDENTITY_CONFLICT', 'nome novo já cadastrado');
  perform pg_temp.err(pg_temp.adm(format('public.resolve_player_claim(%L, %L)', pg_temp.sess(pg_temp.tok('Inativo')), v_inat)),
    'IDENTITY_CONFLICT', 'jogador inativo');
  perform pg_temp.err(pg_temp.adm(format('public.resolve_player_claim(%L, %L)', v_s, gen_random_uuid())), 'NOT_FOUND', 'jogador inexistente');

  v_d := pg_temp.ok(pg_temp.adm(format('public.resolve_player_claim(%L, null, %L)', v_s, 'S21 Ana')), 'validar Ana');
  assert v_d->'session'->>'status' = 'active' and v_d->'participant'->>'status' = 'pending_buyin', 'Ana validada';
  assert (select validated_by = pg_temp.uid('admin') from public.player_device_sessions where id = v_s), 'validated_by';
  perform pg_temp.err(pg_temp.adm(format('public.resolve_player_claim(%L, null, %L)', v_s, 'S21 Ana 2')),
    'IDENTITY_CONFLICT', 'sessão já ativa');
  perform pg_temp.ok(pg_temp.adm(format('public.resolve_player_claim(%L, %L)', v_s, (v_d->'session'->>'player_id')::uuid)),
    'validar de novo com o mesmo jogador');

  perform pg_temp.ok(pg_temp.adm(format('public.resolve_player_claim(%L, %L)', pg_temp.sess(pg_temp.tok('Beto')), v_beto)), 'validar Beto');
  perform pg_temp.ok(pg_temp.adm(format('public.resolve_player_claim(%L, null, %L)', pg_temp.sess(pg_temp.tok('Carla')), 'S21 Carla')), 'Carla');
  perform pg_temp.ok(pg_temp.adm(format('public.resolve_player_claim(%L, null, %L)', pg_temp.sess(pg_temp.tok('Duda')), 'S21 Duda')), 'Duda');
  perform pg_temp.ok(pg_temp.adm(format('public.resolve_player_claim(%L, null, %L)', pg_temp.sess(pg_temp.tok('Eva')), 'S21 Eva')), 'Eva');
  perform pg_temp.ok(pg_temp.adm(format('public.resolve_player_claim(%L, null, %L)', pg_temp.sess(pg_temp.tok('Fabio')), 'S21 Fabio')), 'Fabio');

  v_d := pg_temp.ok(pg_temp.portal(pg_temp.tok('A')), 'portal Ana');
  assert v_d->>'next_action' = 'request_buyin' and v_d->'participant'->>'status' = 'pending_buyin'
     and v_d->'participant'->'eligible_offer_ids' ? pg_temp.offer('Buy-in')::text, 'portal Ana antes do buy-in';
  assert (select count(*) from public.tournament_participants where tournament_id = pg_temp.uid('t1')) = 6, '6 participantes';

  v_d := pg_temp.ok(pg_temp.adm(format('public.get_operational_tournament(%L)', pg_temp.uid('t1'))), 'visão admin');
  assert jsonb_array_length(v_d->'pending_sessions') = 1
     and v_d->'pending_sessions'->0->>'claimed_name' = 'S21 Inativo', 'fila de claims do admin';
  raise notice 'OK 6 - resolve_player_claim: associação explícita, conflitos de nome/inativo e participante pendente';
end $$;

-- ── 7. request_buyin, report_payment, cancel ────────────────────────────
do $$
declare v_a text := pg_temp.tok('A'); v_k uuid := gen_random_uuid(); v1 jsonb; v2 jsonb; v_req uuid; v_n text; v_d jsonb;
begin
  perform pg_temp.err(pg_temp.buyin(v_a, pg_temp.offer('1º simples'), gen_random_uuid()), 'OFFER_NOT_ELIGIBLE', 'rebuy como buy-in');
  perform pg_temp.err(pg_temp.buyin(v_a, gen_random_uuid(), gen_random_uuid()), 'OFFER_NOT_ELIGIBLE', 'oferta inexistente');
  perform pg_temp.err(pg_temp.buyin(v_a, pg_temp.offer('Buy-in'), null), 'INVALID_ARGUMENT', 'buy-in sem chave');

  v1 := pg_temp.buyin(v_a, pg_temp.offer('Buy-in'), v_k);
  v_req := (pg_temp.ok(v1, 'buy-in Ana')->'request'->>'id')::uuid;
  assert v1->'data'->'request'->>'status' = 'requested' and v1->'data'->'request'->>'price' = '10.00'
     and v1->'data'->'request'->'payment'->>'pix_key' = 'chave-s21', 'pedido de buy-in com snapshot';
  v2 := pg_temp.buyin(v_a, pg_temp.offer('Buy-in'), v_k);
  assert v1 = v2, 'repetição do buy-in devolveu outro envelope';
  assert (select count(*) from public.purchase_requests where participant_id = pg_temp.part('S21 Ana')) = 1, 'buy-in duplicado';
  perform pg_temp.err(pg_temp.buyin(v_a, pg_temp.offer('Buy-in'), gen_random_uuid()), 'PURCHASE_PENDING', 'segundo buy-in');
  perform pg_temp.err(pg_temp.identify('S21 Ana', v_a, v_k), 'IDEMPOTENCY_CONFLICT', 'chave do buy-in reusada em outro comando');
  perform pg_temp.put('req_buyin_A', v_req::text);

  foreach v_n in array array['Beto', 'Carla', 'Duda', 'Eva', 'Fabio'] loop
    v_d := pg_temp.ok(pg_temp.buyin(pg_temp.tok(v_n), pg_temp.offer('Buy-in'), gen_random_uuid()), 'buy-in ' || v_n);
    perform pg_temp.put('req_buyin_' || v_n, v_d->'request'->>'id');
  end loop;

  assert pg_temp.pot() = 0 and pg_temp.chips() = 0, 'pedido de buy-in alterou pote/fichas';

  v_d := pg_temp.ok(pg_temp.report(v_a, v_req), 'informar pagamento');
  assert v_d->'request'->>'status' = 'payment_reported' and v_d->'request'->>'payment_reported_at' is not null, 'declaração';
  perform pg_temp.ok(pg_temp.report(v_a, v_req), 'informar de novo');
  perform pg_temp.err(pg_temp.report(pg_temp.tok('Beto'), v_req), 'NOT_FOUND', 'Beto informando pedido da Ana');
  perform pg_temp.err(pg_temp.cancel(pg_temp.tok('Beto'), v_req), 'NOT_FOUND', 'Beto cancelando pedido da Ana');
  perform pg_temp.err(pg_temp.cancel(v_a, v_req), 'REQUEST_STATE_CONFLICT', 'cancelar após declarar');
  assert pg_temp.pot() = 0 and pg_temp.chips() = 0, 'declaração alterou pote/fichas';

  v_d := pg_temp.ok(pg_temp.portal(pg_temp.tok('Beto')), 'portal Beto');
  assert jsonb_array_length(v_d->'requests') = 1 and v_d->'requests'->0->>'id' = pg_temp.get('req_buyin_Beto'),
    'portal mostra pedido de outro jogador';
  assert v_d::text not like '%' || pg_temp.get('admin') || '%' and v_d::text not like '%token%', 'portal vaza dado interno';

  v_d := pg_temp.ok(pg_temp.cancel(pg_temp.tok('Fabio'), pg_temp.uid('req_buyin_Fabio')), 'Fabio cancela');
  assert v_d->'request'->>'status' = 'cancelled', 'cancelamento';
  perform pg_temp.ok(pg_temp.cancel(pg_temp.tok('Fabio'), pg_temp.uid('req_buyin_Fabio')), 'cancelar de novo');
  raise notice 'OK 7 - buy-in pendente e idempotente, declaração/cancelamento sem fichas nem dinheiro, isolamento por jogador';
end $$;

-- ── 8. Acesso direto e preço imposto pelo cliente ───────────────────────
do $$
declare
  v_role text;
  v_offer uuid := pg_temp.offer('Buy-in'); v_req uuid := pg_temp.uid('req_buyin_A');
  v_t1 uuid := pg_temp.uid('t1'); v_part uuid := pg_temp.part('S21 Ana');
begin
  foreach v_role in array array['anon', 'authenticated'] loop
    execute format('set local role %I', v_role);
    perform pg_temp.expect_error(format(
      'update public.purchase_offers set price = 0 where id = %L', v_offer), '42501', v_role || ' mudando preço');
    perform pg_temp.expect_error(format(
      'update public.purchase_requests set price = 0, status = ''confirmed'' where id = %L', v_req),
      '42501', v_role || ' mudando pedido');
    perform pg_temp.expect_error('select * from public.player_device_sessions', '42501', v_role || ' lendo sessões');
    perform pg_temp.expect_error(format(
      'insert into public.purchase_authorizations (tournament_id, participant_id, kind, created_by) values (%L, %L, ''rebuy'', gen_random_uuid())',
      v_t1, v_part), '42501', v_role || ' criando autorização');
    reset role;
  end loop;
  -- não há parâmetro de preço/fichas/unidades: a única entrada é o id da oferta.
  assert not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('request_buyin', 'request_purchase', 'identify_player', 'report_payment')
       and (p.proargnames && array['price', 'amount', 'chips_granted', 'rebuy_units', 'player_id', 'confirmed_by'])),
    'RPC pública aceita preço/fichas/unidades/identidade';
  assert (select price = 10 and chips_granted = 10000 from public.purchase_requests where id = pg_temp.uid('req_buyin_A')),
    'snapshot não veio da oferta';
  raise notice 'OK 8 - sem escrita direta de anon/authenticated; preço, fichas e unidades vêm só do servidor';
end $$;

-- ── 9. confirm_buyins_and_start ─────────────────────────────────────────
create function public.s21_test_fail_tx() returns trigger language plpgsql as $$
begin
  if new.request_id = (select v::uuid from pg_temp.ctx where k = 'fail_request') then
    raise exception using errcode = '23505', message = 'falha forçada pelo teste';
  end if;
  return new;
end $$;

do $$
declare
  v_t1 uuid := pg_temp.uid('t1'); v_set uuid[]; v_d jsonb; v_det jsonb;
begin
  v_set := array(select r.id from public.purchase_requests r
                  where r.tournament_id = v_t1 and r.kind = 'buyin' and r.status in ('requested', 'payment_reported')
                  order by r.id);
  assert cardinality(v_set) = 5, 'lote esperado com 5 buy-ins';

  v_det := pg_temp.err(pg_temp.adm(format('public.confirm_buyins_and_start(%L, 2, %L::uuid[])', v_t1,
             array_remove(v_set, pg_temp.uid('req_buyin_Eva')))), 'REQUEST_SET_CHANGED', 'lote sem Eva');
  assert v_det->'added' = jsonb_build_array(pg_temp.get('req_buyin_Eva')), 'detalhe added';
  v_det := pg_temp.err(pg_temp.adm(format('public.confirm_buyins_and_start(%L, 2, %L::uuid[])', v_t1,
             v_set || pg_temp.uid('req_buyin_Fabio'))), 'REQUEST_SET_CHANGED', 'lote com cancelado');
  assert v_det->'removed' = jsonb_build_array(pg_temp.get('req_buyin_Fabio')), 'detalhe removed';
  perform pg_temp.err(pg_temp.adm(format('public.confirm_buyins_and_start(%L, 1, %L::uuid[])', v_t1, v_set)),
    'VERSION_CONFLICT', 'versão velha');

  -- rollback integral: falha no meio do lote não deixa nada confirmado.
  perform pg_temp.put('fail_request', pg_temp.get('req_buyin_Duda'));
  create trigger s21_test_fail_tx before insert on public.transactions
    for each row execute function public.s21_test_fail_tx();
  perform pg_temp.err(pg_temp.adm(format('public.confirm_buyins_and_start(%L, 2, %L::uuid[])', v_t1, v_set)),
    'DUPLICATE_TRANSACTION', 'falha no meio do lote');
  drop trigger s21_test_fail_tx on public.transactions;
  assert pg_temp.tver(v_t1) = 2 and (select public_status from public.base_tournaments where id = v_t1) = 'published',
    'torneio mudou apesar da falha';
  assert not exists (select 1 from public.purchase_requests where tournament_id = v_t1 and status = 'confirmed'),
    'pedido confirmado apesar da falha';
  assert not exists (select 1 from public.transactions where tournament_id = v_t1), 'transação sobrou da falha';
  assert (select clock_status from public.tournament_runtime where tournament_id = v_t1) = 'idle', 'relógio andou na falha';

  v_d := pg_temp.ok(pg_temp.adm(format('public.confirm_buyins_and_start(%L, 2, %L::uuid[])', v_t1, v_set)), 'iniciar');
  assert v_d->'tournament'->>'public_status' = 'running' and (v_d->'tournament'->>'state_version')::int = 3
     and v_d->'runtime'->>'clock_status' = 'running' and (v_d->'runtime'->>'anchor_ms')::bigint > 0
     and jsonb_array_length(v_d->'confirmed_requests') = 5 and jsonb_array_length(v_d->'transactions') = 5,
    'resposta do início';
  assert pg_temp.pot() = 50 and pg_temp.chips() = 50000, 'pote/fichas após lote';
  assert (select count(*) from public.transactions where tournament_id = v_t1
           and kind = 'buyin' and request_id is not null and confirmed_by = pg_temp.uid('admin')) = 5, 'transações do lote';
  assert (select status from public.tournament_participants where id = pg_temp.part('S21 Fabio')) = 'withdrawn', 'Fabio saiu';
  assert (select count(*) from public.tournament_participants where tournament_id = v_t1 and status = 'active') = 5, '5 ativos';
  assert (select registration_closed_at is not null and started_at is not null from public.base_tournaments where id = v_t1),
    'inscrição fechada junto com o início';

  perform pg_temp.err(pg_temp.adm(format('public.confirm_buyins_and_start(%L, 2, %L::uuid[])', v_t1, v_set)),
    'VERSION_CONFLICT', 'duplo clique');
  assert pg_temp.pot() = 50, 'duplo clique duplicou';
  perform pg_temp.err(pg_temp.buyin(pg_temp.tok('Fabio'), pg_temp.offer('Buy-in'), gen_random_uuid()),
    'REGISTRATION_CLOSED', 'buy-in após início');
  perform pg_temp.err(pg_temp.identify('S21 Tardio', pg_temp.tok('Tardio'), gen_random_uuid()),
    'REGISTRATION_CLOSED', 'nome novo após início');
  v_d := pg_temp.ok(pg_temp.identify('S21 Ana', pg_temp.tok('A2'), gen_random_uuid()), 'Ana em outro navegador');
  assert v_d->'session'->>'status' = 'pending', 'segundo navegador herdou a identidade';
  assert (pg_temp.ok(pg_temp.portal(pg_temp.tok('A')), 'portal Ana')->>'next_action') = 'open_portal', 'next_action após início';
  raise notice 'OK 9 - lote exato, versão, rollback integral, início atômico e inscrição fechada';
end $$;

-- ── 10. Rebuys: dois simples, duplo, reserva e add-on (two-rebuys.json) ─
do $$
declare
  v_a text := pg_temp.tok('A'); v_d jsonb; v_auth uuid; v_req uuid; v_tx uuid; v_pot numeric; v_chips bigint;
  v_ver bigint; v1 jsonb; v2 jsonb;
begin
  perform pg_temp.err(pg_temp.purchase(v_a, gen_random_uuid(), pg_temp.offer('1º simples'), gen_random_uuid()),
    'AUTHORIZATION_REQUIRED', 'rebuy sem autorização');
  perform pg_temp.err(pg_temp.authorize(pg_temp.part('S21 Ana'), 'rebuy', array[pg_temp.offer('2º simples')]),
    'OFFER_NOT_ELIGIBLE', '2º simples com zero unidades');
  perform pg_temp.err(pg_temp.authorize(pg_temp.part('S21 Ana'), 'rebuy', array[pg_temp.offer('Add-on')]),
    'OFFER_NOT_ELIGIBLE', 'add-on em autorização de rebuy');
  perform pg_temp.err(pg_temp.authorize(pg_temp.part('S21 Ana'), 'bonus', array[pg_temp.offer('1º simples')]),
    'INVALID_ARGUMENT', 'tipo inválido');
  perform pg_temp.err(pg_temp.authorize(pg_temp.part('S21 Ana'), 'rebuy', '{}'::uuid[]), 'INVALID_ARGUMENT', 'sem ofertas');
  perform pg_temp.err(pg_temp.authorize(pg_temp.part('S21 Ana'), 'rebuy', array[pg_temp.offer('1º simples')], now() - interval '1 minute'),
    'INVALID_ARGUMENT', 'validade no passado');
  perform pg_temp.err(pg_temp.authorize(pg_temp.part('S21 Fabio'), 'rebuy', array[pg_temp.offer('1º simples')]),
    'TOURNAMENT_STATE_CONFLICT', 'participante desistente');

  -- Cenário "dois simples confirmados"
  v_d := pg_temp.ok(pg_temp.authorize(pg_temp.part('S21 Ana'), 'rebuy',
           array[pg_temp.offer('1º simples'), pg_temp.offer('Duplo')], now() + interval '1 hour'), 'liberar Ana');
  v_auth := (v_d->'authorization'->>'id')::uuid;
  perform pg_temp.err(pg_temp.purchase(pg_temp.tok('Beto'), v_auth, pg_temp.offer('1º simples'), gen_random_uuid()),
    'AUTHORIZATION_REQUIRED', 'Beto usando autorização da Ana');
  perform pg_temp.err(pg_temp.purchase(v_a, v_auth, pg_temp.offer('2º simples'), gen_random_uuid()),
    'OFFER_NOT_ELIGIBLE', 'oferta fora da autorização');

  v_pot := pg_temp.pot(); v_chips := pg_temp.chips();
  v1 := pg_temp.purchase(v_a, v_auth, pg_temp.offer('1º simples'), '00000000-0000-4000-8000-0000000000a1');
  v_req := (pg_temp.ok(v1, 'pedir 1º simples')->'request'->>'id')::uuid;
  assert v1->'data'->'request'->>'price' = '15.00' and (v1->'data'->'request'->>'rebuy_units')::int = 1, 'snapshot 1º simples';
  v2 := pg_temp.purchase(v_a, v_auth, pg_temp.offer('1º simples'), '00000000-0000-4000-8000-0000000000a1');
  assert v1 = v2, 'repetição de request_purchase devolveu outro envelope';
  v_d := pg_temp.ok(pg_temp.portal(v_a), 'portal com reserva');
  assert (v_d->'participant'->>'reserved_rebuy_units')::int = 1 and (v_d->'participant'->>'confirmed_rebuy_units')::int = 0
     and not (v_d->'participant'->'eligible_offer_ids' ? pg_temp.offer('Duplo')::text), 'simples pendente reserva uma unidade';
  assert pg_temp.pot() = v_pot and pg_temp.chips() = v_chips, 'pedido de rebuy alterou pote/fichas';
  perform pg_temp.err(pg_temp.purchase(v_a, v_auth, pg_temp.offer('Duplo'), gen_random_uuid()), 'PURCHASE_PENDING', 'duplo com simples pendente');
  perform pg_temp.err(pg_temp.authorize(pg_temp.part('S21 Ana'), 'rebuy', array[pg_temp.offer('Duplo')]), 'PURCHASE_PENDING', 'liberar com pedido aberto');

  perform pg_temp.ok(pg_temp.report(v_a, v_req), 'Ana informa rebuy');
  v_ver := pg_temp.rver(v_req);
  perform pg_temp.err(pg_temp.confirm(v_req, v_ver - 1), 'VERSION_CONFLICT', 'confirmar versão velha');
  v_d := pg_temp.ok(pg_temp.confirm(v_req, v_ver), 'confirmar 1º simples');
  v_tx := (v_d->'transaction'->>'id')::uuid;
  assert v_d->'transaction'->>'amount' = '15.00' and (v_d->'transaction'->>'rebuy_units')::int = 1
     and (v_d->'transaction'->>'chips_granted')::int = 10000 and v_d->'transaction'->>'kind' = 'rebuy', 'transação 1º simples';
  v_d := pg_temp.ok(pg_temp.confirm(v_req, v_ver), 'confirmar de novo (resposta perdida)');
  assert (v_d->'transaction'->>'id')::uuid = v_tx, 'repetição criou outra transação';
  assert (select count(*) from public.transactions where request_id = v_req) = 1, 'concessão duplicada';
  perform pg_temp.err(pg_temp.purchase(v_a, v_auth, pg_temp.offer('Duplo'), gen_random_uuid()), 'AUTHORIZATION_CONSUMED', 'autorização de uso único');

  v_d := pg_temp.ok(pg_temp.authorize(pg_temp.part('S21 Ana'), 'rebuy', array[pg_temp.offer('2º simples')]), 'liberar 2º simples');
  v_d := pg_temp.ok(pg_temp.purchase(v_a, (v_d->'authorization'->>'id')::uuid, pg_temp.offer('2º simples'), gen_random_uuid()), 'pedir 2º simples');
  v_req := (v_d->'request'->>'id')::uuid;
  perform pg_temp.ok(pg_temp.confirm(v_req, pg_temp.rver(v_req)), 'confirmar sem declaração (admin viu o PIX)');
  assert (select count(*) = 2 and sum(amount) = 35 and sum(rebuy_units) = 2 and sum(chips_granted) = 20000
            from public.transactions t join public.sub_players sp on sp.id = t.player_id
           where t.tournament_id = pg_temp.uid('t1') and sp.display_name = 'S21 Ana' and t.kind = 'rebuy'),
    'dois simples = 2 transações, R$ 35, 2 unidades, 20000 fichas';
  assert pg_temp.eligible_rebuys(v_a) = '{}', 'rebuy elegível após duas unidades';

  -- Cenário "duplo confirmado"
  v_d := pg_temp.ok(pg_temp.authorize(pg_temp.part('S21 Beto'), 'rebuy', array[pg_temp.offer('Duplo')]), 'liberar duplo');
  v_d := pg_temp.ok(pg_temp.purchase(pg_temp.tok('Beto'), (v_d->'authorization'->>'id')::uuid, pg_temp.offer('Duplo'), gen_random_uuid()), 'pedir duplo');
  v_req := (v_d->'request'->>'id')::uuid;
  perform pg_temp.ok(pg_temp.report(pg_temp.tok('Beto'), v_req), 'Beto informa');
  perform pg_temp.ok(pg_temp.confirm(v_req, pg_temp.rver(v_req)), 'confirmar duplo');
  assert (select count(*) = 1 and sum(amount) = 35 and sum(rebuy_units) = 2 and sum(chips_granted) = 20000
            from public.transactions t join public.sub_players sp on sp.id = t.player_id
           where t.tournament_id = pg_temp.uid('t1') and sp.display_name = 'S21 Beto' and t.kind = 'rebuy'),
    'duplo = 1 transação de R$ 35, 2 unidades, 20000 fichas';
  assert pg_temp.eligible_rebuys(pg_temp.tok('Beto')) = '{}', 'rebuy elegível após duplo';

  -- Cenários "simples pendente reserva" e "cancelar libera reserva" + triplo
  v_d := pg_temp.ok(pg_temp.authorize(pg_temp.part('S21 Carla'), 'rebuy',
           array[pg_temp.offer('1º simples'), pg_temp.offer('Duplo'), pg_temp.offer('Triplo')]), 'liberar Carla');
  v_pot := pg_temp.pot(); v_chips := pg_temp.chips();
  v_d := pg_temp.ok(pg_temp.purchase(pg_temp.tok('Carla'), (v_d->'authorization'->>'id')::uuid, pg_temp.offer('1º simples'), gen_random_uuid()), 'Carla pede simples');
  v_req := (v_d->'request'->>'id')::uuid;
  assert not (pg_temp.offer('Duplo') = any (pg_temp.eligible_rebuys(pg_temp.tok('Carla')))), 'duplo elegível com simples pendente';
  perform pg_temp.ok(pg_temp.cancel(pg_temp.tok('Carla'), v_req), 'Carla cancela');
  v_d := pg_temp.ok(pg_temp.portal(pg_temp.tok('Carla')), 'portal Carla');
  assert (v_d->'participant'->>'reserved_rebuy_units')::int = 0 and (v_d->'participant'->>'confirmed_rebuy_units')::int = 0
     and pg_temp.offer('Duplo') = any (pg_temp.eligible_rebuys(pg_temp.tok('Carla')))
     and pg_temp.offer('Triplo') = any (pg_temp.eligible_rebuys(pg_temp.tok('Carla'))), 'cancelar libera reserva';
  assert pg_temp.pot() = v_pot and pg_temp.chips() = v_chips, 'pedir/cancelar alterou pote/fichas';

  -- triplo exige três unidades restantes: com uma usada, deixa de valer
  v_d := pg_temp.ok(pg_temp.authorize(pg_temp.part('S21 Duda'), 'rebuy', array[pg_temp.offer('1º simples')]), 'liberar Duda');
  v_d := pg_temp.ok(pg_temp.purchase(pg_temp.tok('Duda'), (v_d->'authorization'->>'id')::uuid, pg_temp.offer('1º simples'), gen_random_uuid()), 'Duda pede');
  v_req := (v_d->'request'->>'id')::uuid;
  perform pg_temp.ok(pg_temp.confirm(v_req, pg_temp.rver(v_req)), 'confirmar Duda');
  perform pg_temp.err(pg_temp.authorize(pg_temp.part('S21 Duda'), 'rebuy', array[pg_temp.offer('Triplo')]), 'OFFER_NOT_ELIGIBLE', 'triplo após simples');
  perform pg_temp.err(pg_temp.authorize(pg_temp.part('S21 Duda'), 'rebuy', array[pg_temp.offer('Duplo')]), 'OFFER_NOT_ELIGIBLE', 'duplo após simples');

  -- add-on não consome rebuy
  v_d := pg_temp.ok(pg_temp.authorize(pg_temp.part('S21 Eva'), 'addon', array[pg_temp.offer('Add-on')]), 'liberar add-on');
  v_d := pg_temp.ok(pg_temp.purchase(pg_temp.tok('Eva'), (v_d->'authorization'->>'id')::uuid, pg_temp.offer('Add-on'), gen_random_uuid()), 'Eva pede add-on');
  v_req := (v_d->'request'->>'id')::uuid;
  v_d := pg_temp.ok(pg_temp.confirm(v_req, pg_temp.rver(v_req)), 'confirmar add-on');
  assert v_d->'transaction'->>'kind' = 'addon' and (v_d->'transaction'->>'rebuy_units')::int = 0
     and (v_d->'participant'->>'confirmed_rebuy_units')::int = 0 and (v_d->'participant'->>'confirmed_addons')::int = 1, 'add-on';
  assert (select is_addon and not is_rebuy from public.transactions where request_id = v_req), 'booleanos legados do add-on';
  assert pg_temp.offer('1º simples') = any (pg_temp.eligible_rebuys(pg_temp.tok('Eva'))), 'add-on consumiu rebuy';

  -- confirmação muda o torneio: versão sobe
  assert pg_temp.tver(pg_temp.uid('t1')) = 3 + 5, 'state_version não subiu uma vez por confirmação';
  raise notice 'OK 10 - two-rebuys.json: dois simples = R$ 35, duplo = R$ 35 em uma linha, reserva, triplo e add-on';
end $$;

-- ── 11. Autorização revogada, vencida e já usada ────────────────────────
do $$
declare v_c text := pg_temp.tok('Carla'); v_d jsonb; v_auth uuid; v_req uuid;
begin
  -- a última autorização de Carla (simples/duplo/triplo) foi consumida pelo pedido cancelado.
  v_d := pg_temp.ok(pg_temp.authorize(pg_temp.part('S21 Carla'), 'rebuy', array[pg_temp.offer('Duplo')]), 'liberar Carla');
  v_auth := (v_d->'authorization'->>'id')::uuid;
  v_d := pg_temp.ok(pg_temp.adm(format('public.revoke_purchase_authorization(%L, %L)', v_auth, 'teste')), 'revogar');
  assert v_d->'authorization'->>'status' = 'revoked' and v_d->'authorization'->>'revoke_reason' = 'teste', 'revogação';
  perform pg_temp.err(pg_temp.purchase(v_c, v_auth, pg_temp.offer('Duplo'), gen_random_uuid()), 'AUTHORIZATION_REVOKED', 'usar revogada');
  perform pg_temp.ok(pg_temp.adm(format('public.revoke_purchase_authorization(%L, null)', v_auth)), 'revogar de novo');
  perform pg_temp.err(pg_temp.adm(format('public.revoke_purchase_authorization(%L, null)', gen_random_uuid())), 'NOT_FOUND', 'autorização inexistente');

  v_d := pg_temp.ok(pg_temp.authorize(pg_temp.part('S21 Carla'), 'rebuy', array[pg_temp.offer('Duplo')], now() + interval '1 hour'), 'liberar com validade');
  v_auth := (v_d->'authorization'->>'id')::uuid;
  update public.purchase_authorizations set expires_at = now() - interval '1 second' where id = v_auth;
  perform pg_temp.err(pg_temp.purchase(v_c, v_auth, pg_temp.offer('Duplo'), gen_random_uuid()), 'AUTHORIZATION_EXPIRED', 'usar vencida');
  assert (select status from public.purchase_authorizations where id = v_auth) = 'expired', 'vencida não foi marcada';

  v_d := pg_temp.ok(pg_temp.authorize(pg_temp.part('S21 Carla'), 'rebuy', array[pg_temp.offer('Duplo')]), 'liberar de novo');
  v_auth := (v_d->'authorization'->>'id')::uuid;
  v_d := pg_temp.ok(pg_temp.purchase(v_c, v_auth, pg_temp.offer('Duplo'), gen_random_uuid()), 'Carla pede duplo');
  v_req := (v_d->'request'->>'id')::uuid;
  perform pg_temp.err(pg_temp.adm(format('public.revoke_purchase_authorization(%L, null)', v_auth)), 'REQUEST_STATE_CONFLICT', 'revogar com pedido aberto');
  v_d := pg_temp.ok(pg_temp.adm(format('public.reject_purchase(%L, %L)', v_req, 'PIX não chegou')), 'rejeitar');
  assert v_d->'request'->>'status' = 'rejected' and v_d->'request'->>'rejection_reason' = 'PIX não chegou', 'rejeição';
  perform pg_temp.ok(pg_temp.adm(format('public.reject_purchase(%L, null)', v_req)), 'rejeitar de novo');
  perform pg_temp.err(pg_temp.confirm(v_req, pg_temp.rver(v_req)), 'REQUEST_STATE_CONFLICT', 'confirmar rejeitado');
  perform pg_temp.err(pg_temp.cancel(v_c, v_req), 'REQUEST_STATE_CONFLICT', 'cancelar rejeitado');
  perform pg_temp.err(pg_temp.adm(format('public.revoke_purchase_authorization(%L, null)', v_auth)), 'AUTHORIZATION_CONSUMED', 'revogar consumida');
  assert (pg_temp.ok(pg_temp.portal(v_c), 'portal')->'participant'->>'reserved_rebuy_units')::int = 0, 'rejeição não liberou reserva';
  raise notice 'OK 11 - autorização revogada, vencida e consumida; rejeição libera reserva';
end $$;

-- ── 12. Runtime e janela fechada ────────────────────────────────────────
do $$
declare v_t1 uuid := pg_temp.uid('t1'); v_c text := pg_temp.tok('Carla'); v_d jsonb; v_auth uuid; v_ver bigint;
begin
  v_ver := pg_temp.tver(v_t1);
  perform pg_temp.err(pg_temp.adm(format('public.update_tournament_runtime(%L, %s, %L::jsonb)', v_t1, v_ver, '{"preco": 1}')),
    'INVALID_ARGUMENT', 'chave desconhecida');
  perform pg_temp.err(pg_temp.adm(format('public.update_tournament_runtime(%L, %s, %L::jsonb)', v_t1, v_ver, '{"clock_status": "finished"}')),
    'INVALID_ARGUMENT', 'finalizar pelo runtime');
  perform pg_temp.err(pg_temp.adm(format('public.update_tournament_runtime(%L, %s, %L::jsonb)', v_t1, v_ver, '{"anchor_ms": "abc"}')),
    'INVALID_ARGUMENT', 'âncora inválida');
  perform pg_temp.err(pg_temp.adm(format('public.update_tournament_runtime(%L, %s, %L::jsonb)', v_t1, v_ver, '{"paused_elapsed_ms": -5}')),
    'INVALID_ARGUMENT', 'pausa negativa');
  perform pg_temp.err(pg_temp.adm(format('public.update_tournament_runtime(%L, %s, %L::jsonb)', v_t1, v_ver - 1, '{}')),
    'VERSION_CONFLICT', 'runtime versão velha');
  perform pg_temp.err(pg_temp.adm(format('public.update_tournament_runtime(%L, 1, %L::jsonb)', pg_temp.uid('t2'), '{"clock_status": "running"}')),
    'TOURNAMENT_STATE_CONFLICT', 'relógio antes do início');

  -- autorização concedida com janela aberta; janela fecha antes do pedido.
  v_d := pg_temp.ok(pg_temp.authorize(pg_temp.part('S21 Carla'), 'rebuy', array[pg_temp.offer('Duplo')]), 'liberar antes de fechar');
  v_auth := (v_d->'authorization'->>'id')::uuid;
  v_ver := pg_temp.tver(v_t1);
  v_d := pg_temp.ok(pg_temp.adm(format('public.update_tournament_runtime(%L, %s, %L::jsonb)', v_t1, v_ver,
           jsonb_build_object('clock_status', 'paused', 'paused_elapsed_ms', 1234, 'rebuy_closes_at', now() - interval '1 minute'))),
         'fechar rebuy');
  assert v_d->'runtime'->>'clock_status' = 'paused' and (v_d->'runtime'->>'paused_elapsed_ms')::int = 1234
     and (v_d->'tournament'->>'state_version')::bigint = v_ver + 1, 'runtime atualizado';
  perform pg_temp.err(pg_temp.purchase(v_c, v_auth, pg_temp.offer('Duplo'), gen_random_uuid()), 'OFFER_NOT_ELIGIBLE', 'pedido com janela fechada');
  perform pg_temp.err(pg_temp.authorize(pg_temp.part('S21 Carla'), 'rebuy', array[pg_temp.offer('Duplo')]), 'OFFER_NOT_ELIGIBLE', 'liberar com janela fechada');
  assert not (pg_temp.offer('Duplo') = any (pg_temp.eligible_rebuys(v_c))), 'portal ofereceu rebuy com janela fechada';

  v_ver := pg_temp.tver(v_t1);
  perform pg_temp.ok(pg_temp.adm(format('public.update_tournament_runtime(%L, %s, %L::jsonb)', v_t1, v_ver,
    '{"clock_status": "running", "rebuy_closes_at": null}')), 'reabrir rebuy');
  perform pg_temp.ok(pg_temp.adm(format('public.revoke_purchase_authorization(%L, null)', v_auth)), 'limpar autorização');
  raise notice 'OK 12 - runtime com versão e validação; janela fechada decidida pelo servidor';
end $$;

-- ── 13. Rollback integral de confirm_purchase ───────────────────────────
do $$
declare v_c text := pg_temp.tok('Carla'); v_d jsonb; v_req uuid; v_rv bigint; v_tv bigint; v_pot numeric; v_pv bigint;
begin
  v_d := pg_temp.ok(pg_temp.authorize(pg_temp.part('S21 Carla'), 'rebuy', array[pg_temp.offer('Duplo')]), 'liberar');
  v_d := pg_temp.ok(pg_temp.purchase(v_c, (v_d->'authorization'->>'id')::uuid, pg_temp.offer('Duplo'), gen_random_uuid()), 'pedir');
  v_req := (v_d->'request'->>'id')::uuid;
  perform pg_temp.ok(pg_temp.report(v_c, v_req), 'informar');
  perform pg_temp.put('req_pending_C', v_req::text);

  v_rv := pg_temp.rver(v_req); v_tv := pg_temp.tver(pg_temp.uid('t1')); v_pot := pg_temp.pot();
  select version into v_pv from public.tournament_participants where id = pg_temp.part('S21 Carla');
  perform pg_temp.put('fail_request', v_req::text);
  create trigger s21_test_fail_tx before insert on public.transactions
    for each row execute function public.s21_test_fail_tx();
  perform pg_temp.err(pg_temp.confirm(v_req, v_rv), 'DUPLICATE_TRANSACTION', 'falha na confirmação');
  drop trigger s21_test_fail_tx on public.transactions;
  assert pg_temp.rver(v_req) = v_rv and (select status from public.purchase_requests where id = v_req) = 'payment_reported',
    'pedido mudou apesar da falha';
  assert pg_temp.tver(pg_temp.uid('t1')) = v_tv and pg_temp.pot() = v_pot, 'torneio/pote mudou apesar da falha';
  assert (select version from public.tournament_participants where id = pg_temp.part('S21 Carla')) = v_pv, 'participante mudou';

  -- transação órfã com o mesmo request_id: checagem antes de escrever
  insert into public.transactions (tournament_id, player_id, amount, is_rebuy, rebuy_units, request_id, confirmed_at)
  select tournament_id, player_id, 1, true, 2, id, now() from public.purchase_requests where id = v_req;
  perform pg_temp.err(pg_temp.confirm(v_req, v_rv), 'DUPLICATE_TRANSACTION', 'request_id já consumido');
  delete from public.transactions where request_id = v_req;
  raise notice 'OK 13 - confirm_purchase: falha no meio desfaz tudo; request_id consumido = DUPLICATE_TRANSACTION';
end $$;

-- ── 14. Sessão revogada e vencida ───────────────────────────────────────
do $$
declare v_dt text := pg_temp.tok('Duda'); v_e text := pg_temp.tok('Eva'); v_d jsonb;
begin
  perform pg_temp.err(pg_temp.anon('public.revoke_device_session(''x'')'), 'INVALID_ARGUMENT', 'revogar token inválido');
  perform pg_temp.err(pg_temp.anon(format('public.revoke_device_session(%L)', pg_temp.tok('Ninguem'))), 'NOT_FOUND', 'revogar desconhecido');
  v_d := pg_temp.ok(pg_temp.anon(format('public.revoke_device_session(%L)', v_dt)), 'trocar de jogador');
  assert v_d->>'revoked_at' is not null, 'revoked_at';
  perform pg_temp.err(pg_temp.portal(v_dt), 'SESSION_REVOKED', 'portal revogado');
  perform pg_temp.err(pg_temp.anon(format('public.revoke_device_session(%L)', v_dt)), 'SESSION_REVOKED', 'revogar de novo');
  perform pg_temp.err(pg_temp.identify('S21 Duda', v_dt, gen_random_uuid()), 'SESSION_REVOKED', 'reusar token revogado');
  perform pg_temp.err(pg_temp.purchase(v_dt, gen_random_uuid(), pg_temp.offer('1º simples'), gen_random_uuid()),
    'SESSION_REVOKED', 'comprar com token revogado');

  update public.player_device_sessions
     set created_at = now() - interval '200 days', expires_at = now() - interval '1 day'
   where id = pg_temp.sess(v_e);
  perform pg_temp.err(pg_temp.portal(v_e), 'SESSION_EXPIRED', 'portal vencido');
  assert (select status from public.player_device_sessions where id = pg_temp.sess(v_e)) = 'expired', 'vencida não marcada';
  perform pg_temp.err(pg_temp.report(v_e, gen_random_uuid()), 'SESSION_EXPIRED', 'ação com sessão vencida');
  raise notice 'OK 14 - troca de jogador revoga o token; sessão vencida é marcada e bloqueada';
end $$;

-- ── 15. finish_operational_tournament ───────────────────────────────────
do $$
declare
  v_t1 uuid := pg_temp.uid('t1'); v_d jsonb; v_ver bigint; v_results jsonb; v_addon uuid;
begin
  v_ver := pg_temp.tver(v_t1);
  v_d := pg_temp.err(pg_temp.adm(format('public.finish_operational_tournament(%L, %s, ''[]''::jsonb)', v_t1, v_ver)),
    'PENDING_PAYMENT', 'finalizar com PIX declarado');
  assert v_d->'request_ids' = jsonb_build_array(pg_temp.get('req_pending_C')), 'detalhe PENDING_PAYMENT';
  perform pg_temp.ok(pg_temp.adm(format('public.reject_purchase(%L, null)', pg_temp.uid('req_pending_C'))), 'rejeitar pendente');

  -- pedido não declarado: expira no fim
  v_d := pg_temp.ok(pg_temp.authorize(pg_temp.part('S21 Beto'), 'addon', array[pg_temp.offer('Add-on')]), 'liberar add-on Beto');
  v_d := pg_temp.ok(pg_temp.purchase(pg_temp.tok('Beto'), (v_d->'authorization'->>'id')::uuid, pg_temp.offer('Add-on'), gen_random_uuid()), 'Beto pede');
  v_addon := (v_d->'request'->>'id')::uuid;

  v_results := jsonb_build_array(
    jsonb_build_object('participant_id', pg_temp.part('S21 Ana'),   'final_placement', 1, 'payout_amount', '60.00'),
    jsonb_build_object('participant_id', pg_temp.part('S21 Beto'),  'final_placement', 2, 'payout_amount', 40),
    jsonb_build_object('participant_id', pg_temp.part('S21 Carla'), 'final_placement', 3));
  perform pg_temp.err(pg_temp.adm(format('public.finish_operational_tournament(%L, %s, %L::jsonb)', v_t1, v_ver - 1, v_results)),
    'VERSION_CONFLICT', 'finalizar versão velha');
  perform pg_temp.err(pg_temp.adm(format('public.finish_operational_tournament(%L, %s, %L::jsonb)', v_t1, v_ver,
    v_results || jsonb_build_array(jsonb_build_object('participant_id', pg_temp.part('S21 Fabio'), 'final_placement', 4)))),
    'INVALID_ARGUMENT', 'desistente no resultado');
  perform pg_temp.err(pg_temp.adm(format('public.finish_operational_tournament(%L, %s, %L::jsonb)', v_t1, v_ver,
    v_results || jsonb_build_array(jsonb_build_object('participant_id', pg_temp.part('S21 Duda'), 'final_placement', 1)))),
    'INVALID_ARGUMENT', 'colocação repetida');
  perform pg_temp.err(pg_temp.adm(format('public.finish_operational_tournament(%L, %s, %L::jsonb)', v_t1, v_ver,
    jsonb_set(v_results, '{0,payout_amount}', '"1.005"'))), 'INVALID_ARGUMENT', 'prêmio com 3 casas');
  perform pg_temp.err(pg_temp.adm(format('public.finish_operational_tournament(%L, %s, %L::jsonb)', v_t1, v_ver,
    jsonb_set(v_results, '{0,participant_id}', '"nao-e-uuid"'))), 'INVALID_ARGUMENT', 'id malformado');
  assert (select status from public.purchase_requests where id = v_addon) = 'requested', 'erro de validação mexeu em pedido';

  v_d := pg_temp.ok(pg_temp.adm(format('public.finish_operational_tournament(%L, %s, %L::jsonb)', v_t1, v_ver, v_results)), 'finalizar');
  assert v_d->'tournament'->>'public_status' = 'finished' and not (v_d->'tournament'->>'is_public_current')::boolean, 'fim do torneio';
  assert (select status from public.purchase_requests where id = v_addon) = 'expired', 'pedido aberto não expirou';
  assert not exists (select 1 from public.purchase_authorizations where tournament_id = v_t1 and status = 'active'), 'autorização ativa após o fim';
  assert (select total_prize_pool = pg_temp.pot() and status = 'finished' and end_time_actual is not null
            from public.base_tournaments where id = v_t1), 'colunas legadas do fim';
  assert (select clock_status from public.tournament_runtime where tournament_id = v_t1) = 'finished', 'relógio finalizado';
  assert (select sum(payout_amount) = 60 and bool_and(final_placement = 1) and count(*) = 3
            from public.transactions t join public.sub_players sp on sp.id = t.player_id
           where t.tournament_id = v_t1 and sp.display_name = 'S21 Ana'), 'colocação/prêmio da Ana';
  assert (select payout_amount from public.transactions t join public.sub_players sp on sp.id = t.player_id
           where t.tournament_id = v_t1 and sp.display_name = 'S21 Ana' and t.kind = 'buyin') = 60, 'prêmio na linha de buy-in';

  perform pg_temp.err(pg_temp.adm(format('public.finish_operational_tournament(%L, %s, %L::jsonb)', v_t1, v_ver + 1, v_results)),
    'TOURNAMENT_STATE_CONFLICT', 'finalizar duas vezes');
  perform pg_temp.err(pg_temp.anon('public.get_public_tournament()'), 'NOT_FOUND', '/jogar após o fim');
  v_d := pg_temp.ok(pg_temp.anon(format('public.get_public_tournament(%L)', pg_temp.get('pub1'))), 'rota direta após o fim');
  assert v_d->'payment' = 'null'::jsonb and v_d->'tournament'->>'public_status' = 'finished', 'PIX exposto após o fim';

  assert (select total_invested = 45 and total_winnings = 60 from public.player_leaderboard() where display_name = 'S21 Ana'),
    'ranking não reflete as transações confirmadas';
  raise notice 'OK 15 - finalização: PIX declarado bloqueia, pendência expira, prêmio e colocação no ledger';
end $$;

-- ── 16. Leitura admin e vazamento ───────────────────────────────────────
do $$
declare v_d jsonb; v_text text;
begin
  v_d := pg_temp.ok(pg_temp.adm('public.get_operational_tournament()'), 'torneio operacional atual');
  assert v_d->'tournament'->>'id' = pg_temp.get('t2'), 'sem argumento devolve o draft aberto';
  v_d := pg_temp.ok(pg_temp.adm(format('public.get_operational_tournament(%L)', pg_temp.get('t1'))), 'T1 admin');
  assert jsonb_array_length(v_d->'participants') = 6 and v_d->'requests'->0 ? 'display_name', 'visão admin completa';

  select string_agg(r::text, ' ') into v_text
    from (select pg_temp.portal(pg_temp.tok('A')) r
          union all select pg_temp.anon(format('public.get_public_tournament(%L)', pg_temp.get('pub1')))
          union all select response from public.rpc_idempotency) z;
  assert v_text not like '%' || pg_temp.get('admin') || '%', 'resposta pública com UUID de admin';
  assert v_text not like '%' || pg_temp.tok('A') || '%' and v_text not like '%token_hash%', 'resposta pública com token';
  raise notice 'OK 16 - leitura admin; respostas públicas sem UUID administrativo nem token';
end $$;

rollback;
