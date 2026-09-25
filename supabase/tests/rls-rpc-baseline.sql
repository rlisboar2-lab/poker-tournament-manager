-- S19 — testes de RLS/RPC do corte legado (migrações 0001–0010), ajustados na S26 à 0015:
-- policies admin_all/live_admin_* e o JWT de um admin de teste para os blocos autenticados.
-- A matriz anon / autenticado comum / admin da 0015 fica em s26-security.sql.
--
-- Rodar SOMENTE em ambiente isolado (stack local do Supabase CLI), nunca no banco em uso.
-- Todo dado criado aqui vive dentro de uma transação revertida no fim (rollback), e cada
-- bloco aborta com `assert` na primeira divergência.
--
--   docker exec -i supabase_db_poker-tournament-manager \
--     psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/rls-rpc-baseline.sql
--
-- Saída esperada: uma linha "OK <n>" por bloco, nenhum ERROR e o ROLLBACK final.

\set ON_ERROR_STOP on

begin;

-- 0015: o RLS legado só aceita quem está em app_admins. Os blocos que usam
-- "set local role authenticated" rodam com o JWT deste admin de teste.
do $$
declare v_uid uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role, email) values (v_uid, 'authenticated', 'authenticated', 's19-baseline@example.invalid');
  insert into public.app_admins (user_id) values (v_uid);
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
end $$;

-- ── 1. RLS ligado nas cinco tabelas ─────────────────────────────────────
do $$
declare v_missing text;
begin
  select string_agg(c.relname, ', ')
    into v_missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('base_tournaments', 'sub_players', 'transactions',
                       'snapshot_blindstructures', 'live_state')
     and not c.relrowsecurity;
  assert v_missing is null, format('RLS desligado em: %s', v_missing);
  raise notice 'OK 1 - RLS ligado nas cinco tabelas';
end $$;

-- ── 2. Inventário de policies bate com o esperado pós-0015 ──────────────
do $$
declare v_found text;
begin
  select string_agg(tablename || ':' || policyname, ', ' order by tablename, policyname)
    into v_found
    from pg_policies
   where schemaname = 'public';
  assert v_found = 'base_tournaments:admin_all, live_state:live_admin_delete, '
                || 'live_state:live_admin_insert, live_state:live_admin_update, '
                || 'live_state:live_public_read, snapshot_blindstructures:admin_all, '
                || 'sub_players:admin_all, transactions:admin_all',
    format('policies divergentes do inventario logico: %s', v_found);
  raise notice 'OK 2 - policies conferem com o inventario logico';
end $$;

-- ── 3. Grants de execução das RPCs ──────────────────────────────────────
do $$
declare v_leak text; v_fn text;
begin
  select string_agg(grantee || '->' || routine_name, ', ')
    into v_leak
    from information_schema.routine_privileges
   where routine_schema = 'public'
     and privilege_type = 'EXECUTE'
     and grantee in ('PUBLIC', 'anon')
     and routine_name in ('save_tournament', 'update_tournament_results', 'player_leaderboard');
  assert v_leak is null, format('RPC exposta a public/anon: %s', v_leak);

  foreach v_fn in array array['save_tournament', 'update_tournament_results', 'player_leaderboard'] loop
    assert exists (
      select 1 from information_schema.routine_privileges
       where routine_schema = 'public' and routine_name = v_fn
         and grantee = 'authenticated' and privilege_type = 'EXECUTE'
    ), format('authenticated sem EXECUTE em %s', v_fn);
  end loop;
  raise notice 'OK 3 - RPCs revogadas de public/anon e concedidas a authenticated';
end $$;

-- ── 4. anon não lê nem escreve nas tabelas privadas ─────────────────────
-- Bloqueio vale tanto por falta de GRANT (insufficient_privilege) quanto por RLS
-- sem policy para anon (zero linhas). Os dois contam como bloqueado.
do $$
declare v_tab text; v_n integer;
begin
  set local role anon;
  foreach v_tab in array array['base_tournaments', 'sub_players', 'transactions',
                               'snapshot_blindstructures'] loop
    begin
      execute format('select count(*) from public.%I', v_tab) into v_n;
      assert v_n = 0, format('anon enxergou %s linhas em %s', v_n, v_tab);
    exception when insufficient_privilege then null;
    end;
  end loop;

  begin
    insert into public.base_tournaments (name) values ('anon nao pode');
    assert false, 'anon conseguiu inserir em base_tournaments';
  exception
    when insufficient_privilege then null;
    when others then
      assert sqlstate = '42501', format('erro inesperado no insert de anon: %s', sqlerrm);
  end;

  reset role;
  raise notice 'OK 4 - anon sem leitura e sem escrita nas tabelas privadas';
end $$;

-- ── 5. live_state: leitura pública, escrita só do admin ─────────────────
do $$
declare v_id uuid;
begin
  insert into public.live_state (name) values ('S19 baseline') returning id into v_id;

  set local role anon;
  assert exists (select 1 from public.live_state where id = v_id),
    'anon nao conseguiu ler live_state';
  begin
    insert into public.live_state (name) values ('anon nao pode');
    assert false, 'anon conseguiu escrever em live_state';
  exception
    when insufficient_privilege then null;
    when others then
      assert sqlstate = '42501', format('erro inesperado no insert de anon: %s', sqlerrm);
  end;

  set local role authenticated;
  update public.live_state set status = 'running' where id = v_id;
  assert (select status from public.live_state where id = v_id) = 'running',
    'admin nao conseguiu escrever em live_state';

  reset role;
  raise notice 'OK 5 - live_state com leitura publica e escrita do admin';
end $$;

-- ── 6. authenticated salva torneio pela RPC e o ledger fecha ────────────
do $$
declare v_id uuid; v_tx integer; v_amount numeric;
begin
  set local role authenticated;
  v_id := public.save_tournament(jsonb_build_object(
    'name', 'S19 baseline',
    'buy_in_value', 15,
    'rebuy_value', 20,
    'addon_value', 25,
    'level_duration_seconds', 900,
    'levels', jsonb_build_array(jsonb_build_object('nivel', 1, 'small_blind', 25, 'big_blind', 50)),
    'entries', jsonb_build_array(
      jsonb_build_object('name', 'Alice', 'buyins', 1, 'rebuys', 2, 'addons', 1,
                         'final_placement', 1, 'payout_amount', 100),
      jsonb_build_object('name', 'Bruno', 'buyins', 1, 'rebuys', 0, 'addons', 0,
                         'final_placement', 2, 'payout_amount', 0)
    )
  ));
  assert v_id is not null, 'save_tournament nao devolveu id';

  select count(*), sum(amount) into v_tx, v_amount
    from public.transactions where tournament_id = v_id;
  -- Alice: 1 buy-in + 2 rebuys + 1 add-on = 4 linhas; Bruno: 1 buy-in.
  assert v_tx = 5, format('esperado 5 transacoes, veio %s', v_tx);
  -- 15 + 20 + 20 + 25 + 15 = 95
  assert v_amount = 95, format('esperado 95 de volume, veio %s', v_amount);
  assert (select count(*) from public.snapshot_blindstructures where tournament_id = v_id) = 1,
    'snapshot de blinds nao foi gravado';

  reset role;
  raise notice 'OK 6 - save_tournament grava torneio, niveis e ledger na mesma transacao';
end $$;

-- ── 7. Payload inválido aborta tudo, sem deixar torneio órfão ───────────
do $$
declare v_before integer; v_after integer;
begin
  set local role authenticated;
  select count(*) into v_before from public.base_tournaments;

  begin
    perform public.save_tournament(jsonb_build_object('name', '   ', 'entries', '[]'::jsonb));
    assert false, 'save_tournament aceitou torneio sem nome';
  exception when raise_exception then null;
  end;

  begin
    perform public.save_tournament(jsonb_build_object(
      'name', 'sem nome de jogador',
      'entries', jsonb_build_array(jsonb_build_object('name', '  ', 'buyins', 1))));
    assert false, 'save_tournament aceitou entrada sem nome de jogador';
  exception when raise_exception then null;
  end;

  select count(*) into v_after from public.base_tournaments;
  assert v_before = v_after,
    format('save_tournament deixou torneio orfao: %s -> %s', v_before, v_after);

  reset role;
  raise notice 'OK 7 - payload invalido aborta a transacao inteira';
end $$;

-- ── 8. Jogador inativo bloqueado na RPC e fora do ranking (0010) ────────
do $$
declare v_before integer; v_after integer;
begin
  set local role authenticated;
  update public.sub_players set is_active = false where display_name_norm = 'bruno';
  assert (select not is_active from public.sub_players where display_name_norm = 'bruno'),
    'nao foi possivel inativar o jogador de teste';

  select count(*) into v_before from public.base_tournaments;
  begin
    perform public.save_tournament(jsonb_build_object(
      'name', 'torneio com inativo',
      'buy_in_value', 15,
      'entries', jsonb_build_array(jsonb_build_object('name', 'Bruno', 'buyins', 1))));
    assert false, 'save_tournament aceitou jogador inativo';
  exception when raise_exception then null;
  end;
  select count(*) into v_after from public.base_tournaments;
  assert v_before = v_after, 'torneio com inativo deixou linha orfa';

  assert not exists (select 1 from public.player_leaderboard() where display_name = 'Bruno'),
    'jogador inativo apareceu no ranking';
  assert exists (select 1 from public.player_leaderboard() where display_name = 'Alice'),
    'jogador ativo sumiu do ranking';

  reset role;
  raise notice 'OK 8 - inativo bloqueado na RPC e fora do ranking';
end $$;

-- ── 9. Ranking: pontos = participantes - colocação + 1 ──────────────────
do $$
declare v_points bigint; v_invested numeric; v_events bigint;
begin
  set local role authenticated;
  update public.sub_players set is_active = true where display_name_norm = 'bruno';

  select points, total_invested, events into v_points, v_invested, v_events
    from public.player_leaderboard() where display_name = 'Alice';
  -- 2 participantes, 1o lugar => 2 - 1 + 1 = 2 pontos.
  assert v_points = 2, format('esperado 2 pontos para Alice, veio %s', v_points);
  -- 15 (buy-in) + 20 + 20 (rebuys) + 25 (add-on) = 80
  assert v_invested = 80, format('esperado 80 investidos por Alice, veio %s', v_invested);
  assert v_events = 1, format('esperado 1 evento para Alice, veio %s', v_events);

  reset role;
  raise notice 'OK 9 - pontos, investimento e eventos do ranking conferem';
end $$;

-- ── 10. Nome duplicado ignorando caixa e espaços (0006) ─────────────────
do $$
begin
  set local role authenticated;
  begin
    insert into public.sub_players (display_name) values ('  alice ');
    assert false, 'unique de nome normalizado nao bloqueou duplicata';
  exception when unique_violation then null;
  end;
  reset role;
  raise notice 'OK 10 - display_name_norm rejeita nome duplicado';
end $$;

rollback;
