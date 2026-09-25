-- S26 — corte de segurança (migração 0015): anon, autenticado comum e admin.
--
-- Rodar SOMENTE no stack local do Supabase CLI, nunca no banco em uso. Tudo acontece
-- dentro de uma transação revertida no fim.
--
--   docker exec -i supabase_db_poker-tournament-manager \
--     psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/s26-security.sql
--
-- Saída esperada: uma linha "OK <n>" por bloco, nenhum ERROR e o ROLLBACK final.

\set ON_ERROR_STOP on

begin;

create temp table ctx (k text primary key, v text);
grant select on ctx to anon, authenticated;

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

-- Assume o papel da API: 'anon', 'user' (autenticado comum) ou 'admin'.
create function pg_temp.act(p_who text) returns void language plpgsql as $$
begin
  if p_who = 'anon' then
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
    set local role anon;
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', pg_temp.uid(p_who), 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
end $$;

create function pg_temp.back() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Dados: um admin, um autenticado comum e um torneio legado com ledger e live_state.
do $$
declare v_admin uuid := gen_random_uuid(); v_user uuid := gen_random_uuid(); v_t uuid; v_live uuid;
begin
  insert into auth.users (id, aud, role, email) values
    (v_admin, 'authenticated', 'authenticated', 's26-admin@example.invalid'),
    (v_user,  'authenticated', 'authenticated', 's26-user@example.invalid');
  insert into public.app_admins (user_id) values (v_admin);
  insert into ctx values ('admin', v_admin), ('user', v_user);

  perform pg_temp.act('admin');
  v_t := public.save_tournament(jsonb_build_object(
    'name', 'S26 legado', 'buy_in_value', 15, 'rebuy_value', 20, 'addon_value', 25,
    'level_duration_seconds', 900,
    'levels', jsonb_build_array(jsonb_build_object('nivel', 1, 'small_blind', 25, 'big_blind', 50)),
    'entries', jsonb_build_array(
      jsonb_build_object('name', 'S26 Ana', 'buyins', 1, 'final_placement', 1, 'payout_amount', 30),
      jsonb_build_object('name', 'S26 Beto', 'buyins', 1, 'final_placement', 2, 'payout_amount', 0))));
  insert into public.live_state (name) values ('S26 relógio') returning id into v_live;
  perform pg_temp.back();

  insert into ctx values ('t', v_t), ('live', v_live);
end $$;

-- ── 1. Grants de tabela ─────────────────────────────────────────────────
do $$
declare v_bad text;
begin
  -- anon: só SELECT em live_state.
  select string_agg(table_name || ':' || privilege_type, ', ' order by table_name, privilege_type) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'PUBLIC')
     and not (grantee = 'anon' and table_name = 'live_state' and privilege_type = 'SELECT');
  assert v_bad is null, format('anon/PUBLIC com grant além de SELECT em live_state: %s', v_bad);

  -- authenticated: nada de TRUNCATE/REFERENCES/TRIGGER; CRUD só nas tabelas legadas e live_state.
  select string_agg(table_name || ':' || privilege_type, ', ' order by table_name, privilege_type) into v_bad
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated'
     and not (table_name in ('base_tournaments', 'sub_players', 'transactions', 'snapshot_blindstructures', 'live_state')
              and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'));
  assert v_bad is null, format('authenticated com grant fora do esperado: %s', v_bad);
  raise notice 'OK 1 - anon só lê live_state; authenticated sem TRUNCATE e sem grant nas tabelas novas';
end $$;

-- ── 2. Policies: nenhuma concede escrita sem app_admins ─────────────────
do $$
declare v_bad text;
begin
  select string_agg(tablename || ':' || policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public'
     and cmd <> 'SELECT'
     and ((cmd <> 'INSERT' and coalesce(qual, '') not like '%is_admin()%')
          or (cmd <> 'DELETE' and coalesce(with_check, '') not like '%is_admin()%'));
  assert v_bad is null, format('policy de escrita sem checagem de admin: %s', v_bad);

  select string_agg(tablename || ':' || policyname, ', ') into v_bad
    from pg_policies
   where schemaname = 'public' and cmd = 'SELECT' and tablename <> 'live_state';
  assert v_bad is null, format('policy de leitura pública fora de live_state: %s', v_bad);
  raise notice 'OK 2 - policies de escrita exigem is_admin(); leitura aberta só em live_state';
end $$;

-- ── 3. Funções: anon só executa as 8 RPCs públicas ──────────────────────
do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in ('get_public_tournament', 'identify_player', 'get_player_portal', 'request_buyin',
                           'request_purchase', 'report_payment', 'cancel_purchase_request', 'revoke_device_session');
  assert v_bad is null, format('anon executa função fora das públicas: %s', v_bad);

  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0);
  assert v_bad is null, format('função executável por PUBLIC: %s', v_bad);

  -- authenticated tem USAGE em private só por causa de is_admin() (policies).
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname <> 'is_admin'
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'));
  assert v_bad is null, format('helper privado executável pela API: %s', v_bad);
  assert not has_schema_privilege('anon', 'private', 'usage'), 'anon com USAGE em private';

  assert not has_function_privilege('authenticated', 'public.rls_auto_enable()', 'execute'),
    'authenticated executa rls_auto_enable';
  raise notice 'OK 3 - anon executa só as 8 públicas; nada executável por PUBLIC; rls_auto_enable fechada';
end $$;

-- ── 4. anon ─────────────────────────────────────────────────────────────
do $$
declare v_tab text; v_live uuid := pg_temp.uid('live'); v_r jsonb;
begin
  perform pg_temp.act('anon');
  foreach v_tab in array array['base_tournaments', 'sub_players', 'transactions', 'snapshot_blindstructures',
                               'app_admins', 'purchase_requests'] loop
    perform pg_temp.expect_error(format('select 1 from public.%I limit 1', v_tab), '42501', 'anon lendo ' || v_tab);
  end loop;
  perform pg_temp.expect_error('truncate public.transactions', '42501', 'anon truncando transactions');
  perform pg_temp.expect_error($q$insert into public.live_state (name) values ('x')$q$, '42501', 'anon escrevendo live_state');
  perform pg_temp.expect_error(format('update public.live_state set status = %L where id = %L', 'x', v_live),
                               '42501', 'anon alterando live_state');
  assert exists (select 1 from public.live_state where id = v_live), 'anon não lê live_state';

  perform pg_temp.expect_error('select public.get_operational_tournament()', '42501', 'anon em RPC admin');
  perform pg_temp.expect_error($q$select public.save_tournament('{}'::jsonb)$q$, '42501', 'anon em save_tournament');
  perform pg_temp.expect_error('select * from public.player_leaderboard()', '42501', 'anon em player_leaderboard');
  v_r := public.get_public_tournament();
  assert v_r ? 'ok', 'RPC pública não devolveu envelope para anon';
  perform pg_temp.back();
  raise notice 'OK 4 - anon: só live_state (leitura) e RPCs públicas';
end $$;

-- ── 5. Autenticado fora de app_admins ───────────────────────────────────
do $$
declare v_tab text; v_n integer; v_t uuid := pg_temp.uid('t'); v_live uuid := pg_temp.uid('live'); v_r jsonb;
begin
  perform pg_temp.act('user');
  assert not (select private.is_admin()), 'usuário comum virou admin';

  foreach v_tab in array array['base_tournaments', 'sub_players', 'transactions', 'snapshot_blindstructures'] loop
    execute format('select count(*) from public.%I', v_tab) into v_n;
    assert v_n = 0, format('usuário comum leu %s linhas de %s', v_n, v_tab);
  end loop;

  perform pg_temp.expect_error($q$insert into public.base_tournaments (name) values ('intruso')$q$,
                               '42501', 'usuário comum criando torneio');
  perform pg_temp.expect_error($q$insert into public.sub_players (display_name) values ('intruso')$q$,
                               '42501', 'usuário comum criando jogador');
  update public.transactions set amount = 0 where tournament_id = v_t;
  get diagnostics v_n = row_count;
  assert v_n = 0, 'usuário comum alterou transactions';
  delete from public.base_tournaments where id = v_t;
  get diagnostics v_n = row_count;
  assert v_n = 0, 'usuário comum apagou torneio';
  perform pg_temp.expect_error('truncate public.transactions', '42501', 'usuário comum truncando transactions');

  assert exists (select 1 from public.live_state where id = v_live), 'usuário comum não lê live_state';
  perform pg_temp.expect_error($q$insert into public.live_state (name) values ('x')$q$, '42501',
                               'usuário comum escrevendo live_state');
  update public.live_state set status = 'hackeado' where id = v_live;
  get diagnostics v_n = row_count;
  assert v_n = 0, 'usuário comum alterou live_state';

  perform pg_temp.expect_error($q$select public.save_tournament(jsonb_build_object('name', 'intruso', 'entries', '[]'::jsonb))$q$,
                               '42501', 'usuário comum em save_tournament');
  assert not exists (select 1 from public.player_leaderboard()), 'usuário comum viu o ranking';
  v_r := public.get_operational_tournament();
  assert v_r->'error'->>'code' = 'ADMIN_REQUIRED', format('RPC admin para usuário comum: %s', v_r);
  perform pg_temp.back();

  assert (select count(*) from public.transactions where tournament_id = v_t and amount > 0) = 2,
    'ledger mudou pelas tentativas do usuário comum';
  raise notice 'OK 5 - autenticado comum: nenhuma leitura/escrita direta, RPC admin = ADMIN_REQUIRED';
end $$;

-- ── 6. Admin preserva as funções do torneio ─────────────────────────────
do $$
declare v_t uuid := pg_temp.uid('t'); v_live uuid := pg_temp.uid('live'); v_n integer; v_r jsonb; v_p uuid;
begin
  perform pg_temp.act('admin');
  assert (select private.is_admin()), 'admin não reconhecido';
  assert (select count(*) from public.transactions where tournament_id = v_t) = 2, 'admin não lê transactions';
  assert exists (select 1 from public.snapshot_blindstructures where tournament_id = v_t), 'admin não lê blinds';

  update public.base_tournaments set name = 'S26 renomeado' where id = v_t;
  get diagnostics v_n = row_count;
  assert v_n = 1, 'admin não renomeou torneio';
  insert into public.sub_players (display_name) values ('S26 Carla') returning id into v_p;
  update public.sub_players set is_active = false where id = v_p;
  get diagnostics v_n = row_count;
  assert v_n = 1, 'admin não inativou jogador';

  update public.live_state set status = 'running' where id = v_live;
  assert (select status from public.live_state where id = v_live) = 'running', 'admin não escreveu live_state';
  delete from public.live_state where id = v_live;

  perform public.update_tournament_results(v_t, (
    select jsonb_agg(jsonb_build_object('player_id', id,
             'final_placement', case display_name when 'S26 Beto' then 1 else 2 end,
             'payout_amount',   case display_name when 'S26 Beto' then 30 else 0 end))
      from public.sub_players where display_name in ('S26 Ana', 'S26 Beto')));
  assert (select final_placement from public.transactions t join public.sub_players p on p.id = t.player_id
           where t.tournament_id = v_t and p.display_name = 'S26 Beto' limit 1) = 1,
    'admin não gravou resultado pelo update_tournament_results';
  assert (select points from public.player_leaderboard() where display_name = 'S26 Beto') = 2,
    'ranking do admin não refletiu o resultado';
  v_r := public.get_operational_tournament();
  assert (v_r->>'ok')::boolean or v_r->'error'->>'code' = 'NOT_FOUND', format('RPC admin falhou: %s', v_r);

  delete from public.base_tournaments where id = v_t;
  get diagnostics v_n = row_count;
  assert v_n = 1, 'admin não apagou torneio';
  perform pg_temp.back();
  raise notice 'OK 6 - admin lê, escreve, apaga, usa RPCs legadas e administrativas';
end $$;

rollback;
