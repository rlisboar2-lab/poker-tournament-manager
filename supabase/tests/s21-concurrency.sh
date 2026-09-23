#!/usr/bin/env bash
# S21 — corridas reais do concurrency-cases.json com conexões psql paralelas.
#
# Rodar SOMENTE no stack local do Supabase CLI, nunca no banco em uso:
#
#   bash supabase/tests/s21-concurrency.sh
#
# Diferente de s21-rpcs.sql, aqui os dados precisam ser COMMITADOS para a segunda conexão
# enxergar. Tudo fica em um torneio descartável e no schema s21c, apagados no fim (trap).
#
# Técnica: a conexão A chama a RPC dentro de uma transação e segura os locks com
# pg_sleep(2). Quando A aparece dormindo em pg_stat_activity, as conexões B disparam.
# Cada B só pode terminar depois do commit de A — o script confere isso pelo relógio
# (B.at - A.at >= 1,9 s) — e o resultado de B precisa refletir o estado já commitado.
#
# Saída esperada: uma linha "OK <caso>" por caso e "OK concorrência: 8/8".

set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-supabase_db_poker-tournament-manager}"
PSQL=(docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -q -At -U postgres -d postgres)
TMP="$(mktemp -d)"

sql() { "${PSQL[@]}"; }
q() { printf '%s\n' "$1" | sql; }
id() { q "select v from s21c.ids where k = '$1'"; }

cleanup() {
  q "do \$\$
     declare v_t uuid; v_admin uuid;
     begin
       if to_regclass('s21c.ids') is null then return; end if;
       select v::uuid into v_t from s21c.ids where k = 'tid';
       select v::uuid into v_admin from s21c.ids where k = 'admin';
       delete from public.rpc_idempotency where actor_id in (
         select id from public.player_device_sessions where claimed_name like 'S21C %');
       delete from public.base_tournaments where id = v_t;
       delete from public.player_device_sessions where claimed_name like 'S21C %';
       delete from public.sub_players where display_name like 'S21C %';
       delete from auth.users where id = v_admin;
     end \$\$;
     drop schema if exists s21c cascade;" >/dev/null 2>&1 || echo "AVISO: limpeza falhou; confira o schema s21c" >&2
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() { echo "FALHOU: $*" >&2; for f in "$TMP"/*.log; do echo "--- $f" >&2; cat "$f" >&2; done; exit 1; }

# ── Setup commitado ─────────────────────────────────────────────────────
sql <<'SQL' >/dev/null
drop schema if exists s21c cascade;
create schema s21c;
create table s21c.ids (k text primary key, v text);
create table s21c.results (case_id text, who text, result jsonb, at timestamptz not null default clock_timestamp());
grant usage on schema s21c to anon, authenticated;
grant select, insert on s21c.results to anon, authenticated;

do $$
declare
  v_admin uuid := gen_random_uuid(); v_t uuid; v_d jsonb; v_tok text; v_sess uuid; v_buyin uuid; i int;
begin
  if exists (select 1 from public.base_tournaments where is_public_current) then
    raise exception 'há torneio no /jogar: rode em banco local limpo';
  end if;
  insert into auth.users (id, aud, role, email) values (v_admin, 'authenticated', 'authenticated', 's21c-admin@example.invalid');
  insert into public.app_admins (user_id) values (v_admin);
  insert into s21c.ids values ('admin', v_admin::text);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  v_d := public.create_operational_tournament($j${
    "name": "S21C Corridas",
    "offers": [
      {"kind": "buyin", "name": "Buy-in",     "price": "10.00", "chips_granted": 10000},
      {"kind": "rebuy", "name": "1º simples", "price": "15.00", "chips_granted": 10000, "rebuy_units": 1, "eligible_after_units": [0], "max_uses": 1},
      {"kind": "rebuy", "name": "2º simples", "price": "20.00", "chips_granted": 10000, "rebuy_units": 1, "eligible_after_units": [1], "max_uses": 1},
      {"kind": "rebuy", "name": "Duplo",      "price": "35.00", "chips_granted": 20000, "rebuy_units": 2, "eligible_after_units": [0], "max_uses": 1}
    ],
    "payment": {"pix_key_type": "random", "pix_key": "chave-s21c", "receiver_name": "Recebedor S21C"}
  }$j$);
  assert v_d->>'ok' = 'true', v_d::text;
  v_t := (v_d->'data'->'tournament'->>'id')::uuid;
  v_d := public.publish_tournament(v_t, 1);
  assert v_d->>'ok' = 'true', v_d::text;
  insert into s21c.ids values ('tid', v_t::text);
  select id into v_buyin from public.purchase_offers where tournament_id = v_t and kind = 'buyin';
  insert into s21c.ids select 'o_buyin', v_buyin::text;
  insert into s21c.ids select 'o_s1', id::text from public.purchase_offers where tournament_id = v_t and name = '1º simples';
  insert into s21c.ids select 'o_duplo', id::text from public.purchase_offers where tournament_id = v_t and name = 'Duplo';

  for i in 1..8 loop
    v_tok := rpad('s21ctok' || i, 43, 'x');
    v_d := public.identify_player(null, 'S21C Jogador ' || i, v_tok, gen_random_uuid());
    assert v_d->>'ok' = 'true', v_d::text;
    v_sess := (v_d->'data'->'session'->>'id')::uuid;
    v_d := public.resolve_player_claim(v_sess, null, 'S21C Jogador ' || i);
    assert v_d->>'ok' = 'true', v_d::text;
    insert into s21c.ids values ('part' || i, v_d->'data'->'participant'->>'id');
    if i <= 6 then
      v_d := public.request_buyin(v_tok, v_buyin, gen_random_uuid());
      assert v_d->>'ok' = 'true', v_d::text;
    end if;
  end loop;
end $$;
SQL

ADMIN="$(id admin)"; TID="$(id tid)"; O_BUYIN="$(id o_buyin)"; O_S1="$(id o_s1)"; O_DUPLO="$(id o_duplo)"
tok() { printf 's21ctok%s%s' "$1" "$(printf 'x%.0s' $(seq 1 $((43 - 7 - ${#1}))))"; }
AS_ADMIN="select set_config('request.jwt.claims', '{\"sub\":\"$ADMIN\",\"role\":\"authenticated\"}', false); set role authenticated;"
AS_ANON="select set_config('request.jwt.claims', '{\"role\":\"anon\"}', false); set role anon;"
admin_sql() { q "select set_config('request.jwt.claims', '{\"sub\":\"$ADMIN\",\"role\":\"authenticated\"}', false); $1"; }
rec() { printf "insert into s21c.results (case_id, who, result) select '%s', '%s', %s;" "$1" "$2" "$3"; }
tver() { q "select state_version from public.base_tournaments where id = '$TID'"; }
buyin_set() { q "select array_agg(id order by id) from public.purchase_requests where tournament_id = '$TID' and kind = 'buyin' and status in ('requested', 'payment_reported')"; }

# A segura os locks; Bs disparam quando A está dormindo.
race() {
  local case_id=$1 a=$2; shift 2
  printf '%s\n' "begin;" "$a" "select pg_sleep(2);" "commit;" | sql >"$TMP/$case_id.A.log" 2>&1 &
  local pa=$! n=0
  for _ in $(seq 1 100); do
    n=$(q "select count(*) from pg_stat_activity where pid <> pg_backend_pid() and query like 'select pg_sleep(2)%'")
    [ "$n" -ge 1 ] && break
    sleep 0.1
  done
  [ "$n" -ge 1 ] || fail "$case_id: conexão A não chegou ao pg_sleep"
  local pids=() i=0 b
  for b in "$@"; do
    i=$((i + 1))
    printf '%s\n' "$b" | sql >"$TMP/$case_id.B$i.log" 2>&1 &
    pids+=($!)
  done
  wait "$pa" || fail "$case_id: conexão A falhou"
  for p in "${pids[@]}"; do wait "$p" || fail "$case_id: conexão B falhou"; done
}

# Disparo simultâneo, sem ordem garantida.
simul() {
  local case_id=$1 i=0 pids=() s; shift
  for s in "$@"; do
    i=$((i + 1))
    printf '%s\n' "$s" | sql >"$TMP/$case_id.S$i.log" 2>&1 &
    pids+=($!)
  done
  for p in "${pids[@]}"; do wait "$p" || fail "$case_id: conexão falhou"; done
}

check() { q "do \$\$ begin $2 end \$\$;" >"$TMP/check.log" 2>&1 || fail "$1"; echo "OK $1"; }
code() { printf "(select coalesce(result->'error'->>'code', 'OK') from s21c.results where case_id = '%s' and who = '%s')" "$1" "$2"; }
waited() { printf "(select b.at - a.at >= interval '1.9 seconds' from s21c.results a, s21c.results b where a.case_id = '%s' and a.who = 'A' and b.case_id = '%s' and b.who = '%s')" "$1" "$1" "$2"; }

# ── buyin-arrives-during-start (1): buy-in segura o lock, início revisou lote antigo ─
SET6="$(buyin_set)"; V="$(tver)"
race start-late-buyin \
  "$AS_ANON $(rec start-late-buyin A "public.request_buyin('$(tok 7)', '$O_BUYIN', gen_random_uuid())")" \
  "$AS_ADMIN $(rec start-late-buyin B1 "public.confirm_buyins_and_start('$TID', $V, '$SET6'::uuid[])")"
check "buyin-arrives-during-start (buy-in primeiro): início devolve REQUEST_SET_CHANGED" "
  assert $(code start-late-buyin A) = 'OK', 'buy-in tardio falhou';
  assert $(code start-late-buyin B1) = 'REQUEST_SET_CHANGED', 'início ignorou o buy-in novo';
  assert $(waited start-late-buyin B1), 'início não esperou o lock do torneio';
  assert (select public_status from public.base_tournaments where id = '$TID') = 'published', 'torneio iniciou';
  assert not exists (select 1 from public.transactions where tournament_id = '$TID'), 'transação sem revisão';"

# ── start-double-click + buyin-arrives-during-start (2) ─────────────────
SET7="$(buyin_set)"; V="$(tver)"
race start-double \
  "$AS_ADMIN $(rec start-double A "public.confirm_buyins_and_start('$TID', $V, '$SET7'::uuid[])")" \
  "$AS_ADMIN $(rec start-double B1 "public.confirm_buyins_and_start('$TID', $V, '$SET7'::uuid[])")" \
  "$AS_ANON $(rec start-double B2 "public.request_buyin('$(tok 8)', '$O_BUYIN', gen_random_uuid())")"
check "start-double-click: um início, um VERSION_CONFLICT; buy-in no meio = REGISTRATION_CLOSED" "
  assert $(code start-double A) = 'OK', 'primeiro clique falhou';
  assert $(code start-double B1) = 'VERSION_CONFLICT', 'segundo clique não deu VERSION_CONFLICT';
  assert $(code start-double B2) = 'REGISTRATION_CLOSED', 'buy-in entrou depois do início';
  assert $(waited start-double B1) and $(waited start-double B2), 'B não esperou o lock';
  assert (select count(*) from public.transactions where tournament_id = '$TID') = 7, 'transações != lote revisado';
  assert (select count(distinct request_id) from public.transactions where tournament_id = '$TID') = 7, 'request_id repetido';
  assert (select version from public.tournament_runtime where tournament_id = '$TID') = 2, 'relógio iniciou mais de uma vez';
  assert (select state_version from public.base_tournaments where id = '$TID') = 3, 'versão do torneio';"

# ── two-admins-confirm-purchase + response-lost-after-commit ────────────
admin_sql "select public.authorize_purchase('$(id part1)', 'rebuy', array['$O_S1', '$O_DUPLO']::uuid[], null);" >/dev/null
AUTH1="$(q "select id from public.purchase_authorizations where participant_id = '$(id part1)' and status = 'active'")"
REQ_X="$(q "select public.request_purchase('$(tok 1)', '$AUTH1', '$O_S1', gen_random_uuid())->'data'->'request'->>'id'")"
q "select public.report_payment('$(tok 1)', '$REQ_X')" >/dev/null
RV="$(q "select version from public.purchase_requests where id = '$REQ_X'")"
race two-admins \
  "$AS_ADMIN $(rec two-admins A "public.confirm_purchase('$REQ_X', $RV)")" \
  "$AS_ADMIN $(rec two-admins B1 "public.confirm_purchase('$REQ_X', $RV)")"
check "two-admins-confirm-purchase: os dois recebem o mesmo resultado confirmado" "
  assert $(code two-admins A) = 'OK' and $(code two-admins B1) = 'OK', 'confirmação concorrente falhou';
  assert $(waited two-admins B1), 'segundo admin não esperou o lock';
  assert (select count(distinct result->'data'->'transaction'->>'id') from s21c.results where case_id = 'two-admins') = 1,
    'duas transações diferentes';
  assert (select count(*) = 1 and sum(chips_granted) = 10000 and sum(amount) = 15
            from public.transactions where request_id = '$REQ_X'), 'fichas/dinheiro mais de uma vez';"

q "$AS_ADMIN $(rec lost A "public.confirm_purchase('$REQ_X', $RV)")" >/dev/null
check "response-lost-after-commit: repetição recupera a mesma transação" "
  assert $(code lost A) = 'OK', 'repetição falhou';
  assert (select result->'data'->'transaction'->>'id' from s21c.results where case_id = 'lost')
       = (select result->'data'->'transaction'->>'id' from s21c.results where case_id = 'two-admins' and who = 'A'),
    'repetição devolveu outra transação';
  assert (select count(*) from public.transactions where request_id = '$REQ_X') = 1, 'repetição concedeu de novo';"

# ── same-idempotency-key-same-command (lock + simultâneo) ──────────────
admin_sql "select public.authorize_purchase('$(id part2)', 'rebuy', array['$O_S1', '$O_DUPLO']::uuid[], null);" >/dev/null
AUTH2="$(q "select id from public.purchase_authorizations where participant_id = '$(id part2)' and status = 'active'")"
K2="$(q "select gen_random_uuid()")"
race same-key \
  "$AS_ANON $(rec same-key A "public.request_purchase('$(tok 2)', '$AUTH2', '$O_S1', '$K2')")" \
  "$AS_ANON $(rec same-key B1 "public.request_purchase('$(tok 2)', '$AUTH2', '$O_S1', '$K2')")"
admin_sql "select public.authorize_purchase('$(id part3)', 'rebuy', array['$O_S1', '$O_DUPLO']::uuid[], null);" >/dev/null
AUTH3="$(q "select id from public.purchase_authorizations where participant_id = '$(id part3)' and status = 'active'")"
K3="$(q "select gen_random_uuid()")"
simul same-key-simul \
  "$AS_ANON $(rec same-key-simul S1 "public.request_purchase('$(tok 3)', '$AUTH3', '$O_S1', '$K3')")" \
  "$AS_ANON $(rec same-key-simul S2 "public.request_purchase('$(tok 3)', '$AUTH3', '$O_S1', '$K3')")"
check "same-idempotency-key-same-command: mesmo envelope duas vezes, uma linha, uma reserva" "
  assert (select count(*) = 2 and count(distinct result) = 1 and bool_and(result->>'ok' = 'true')
            from s21c.results where case_id = 'same-key'), 'envelopes diferentes (com lock)';
  assert $(waited same-key B1), 'repetição não esperou o lock';
  assert (select count(*) = 2 and count(distinct result) = 1 and bool_and(result->>'ok' = 'true')
            from s21c.results where case_id = 'same-key-simul'), 'envelopes diferentes (simultâneo)';
  assert (select count(*) from public.purchase_requests where participant_id in ('$(id part2)', '$(id part3)') and kind = 'rebuy') = 2,
    'mais de um pedido por chave';
  assert (select sum(rebuy_units) from public.purchase_requests where participant_id = '$(id part2)'
            and status in ('requested', 'payment_reported')) = 1, 'reserva duplicada';"

# ── same-idempotency-key-different-command ──────────────────────────────
admin_sql "select public.authorize_purchase('$(id part4)', 'rebuy', array['$O_S1', '$O_DUPLO']::uuid[], null);" >/dev/null
AUTH4="$(q "select id from public.purchase_authorizations where participant_id = '$(id part4)' and status = 'active'")"
K4="$(q "select gen_random_uuid()")"
race diff-cmd \
  "$AS_ANON $(rec diff-cmd A "public.request_purchase('$(tok 4)', '$AUTH4', '$O_S1', '$K4')")" \
  "$AS_ANON $(rec diff-cmd B1 "public.request_purchase('$(tok 4)', '$AUTH4', '$O_DUPLO', '$K4')")"
check "same-idempotency-key-different-command: um sucesso, um IDEMPOTENCY_CONFLICT, sem snapshot misto" "
  assert $(code diff-cmd A) = 'OK' and $(code diff-cmd B1) = 'IDEMPOTENCY_CONFLICT', 'resultado';
  assert (select count(*) = 1 and min(offer_name) = '1º simples' and min(price) = 15 and min(rebuy_units) = 1
            from public.purchase_requests where participant_id = '$(id part4)' and kind = 'rebuy'), 'pedido misturado';"

# ── simple-versus-double ────────────────────────────────────────────────
admin_sql "select public.authorize_purchase('$(id part5)', 'rebuy', array['$O_S1', '$O_DUPLO']::uuid[], null);" >/dev/null
AUTH5="$(q "select id from public.purchase_authorizations where participant_id = '$(id part5)' and status = 'active'")"
race simple-double \
  "$AS_ANON $(rec simple-double A "public.request_purchase('$(tok 5)', '$AUTH5', '$O_S1', gen_random_uuid())")" \
  "$AS_ANON $(rec simple-double B1 "public.request_purchase('$(tok 5)', '$AUTH5', '$O_DUPLO', gen_random_uuid())")"
check "simple-versus-double: um pedido, outro PURCHASE_PENDING; reserva <= 2" "
  assert $(code simple-double A) = 'OK', 'simples falhou';
  assert $(code simple-double B1) in ('PURCHASE_PENDING', 'OFFER_NOT_ELIGIBLE'), 'duplo não foi barrado';
  assert (select count(*) from public.purchase_requests where participant_id = '$(id part5)'
            and kind <> 'buyin' and status in ('requested', 'payment_reported')) = 1, 'mais de um pedido aberto';
  assert (select sum(rebuy_units) from public.purchase_requests where participant_id = '$(id part5)'
            and kind = 'rebuy' and status in ('requested', 'payment_reported', 'confirmed')) <= 2, 'reserva passou de 2';"

# ── revoke-during-use (nas duas ordens) ─────────────────────────────────
admin_sql "select public.authorize_purchase('$(id part6)', 'rebuy', array['$O_S1']::uuid[], null);" >/dev/null
AUTH6="$(q "select id from public.purchase_authorizations where participant_id = '$(id part6)' and status = 'active'")"
race revoke-after \
  "$AS_ANON $(rec revoke-after A "public.request_purchase('$(tok 6)', '$AUTH6', '$O_S1', gen_random_uuid())")" \
  "$AS_ADMIN $(rec revoke-after B1 "public.revoke_purchase_authorization('$AUTH6', 'corrida')")"
admin_sql "select public.authorize_purchase('$(id part7)', 'rebuy', array['$O_S1']::uuid[], null);" >/dev/null
AUTH7="$(q "select id from public.purchase_authorizations where participant_id = '$(id part7)' and status = 'active'")"
race revoke-first \
  "$AS_ADMIN $(rec revoke-first A "public.revoke_purchase_authorization('$AUTH7', 'corrida')")" \
  "$AS_ANON $(rec revoke-first B1 "public.request_purchase('$(tok 7)', '$AUTH7', '$O_S1', gen_random_uuid())")"
check "revoke-during-use: resultado serializável; nada nasce de autorização revogada" "
  assert $(code revoke-after A) = 'OK' and $(code revoke-after B1) = 'REQUEST_STATE_CONFLICT', 'pedido antes da revogação';
  assert $(code revoke-first A) = 'OK' and $(code revoke-first B1) = 'AUTHORIZATION_REVOKED', 'revogação antes do pedido';
  assert $(waited revoke-after B1) and $(waited revoke-first B1), 'B não esperou o lock';
  assert not exists (select 1 from public.purchase_requests r join public.purchase_authorizations a on a.id = r.authorization_id
                      where a.tournament_id = '$TID' and a.status = 'revoked'), 'pedido de autorização revogada';"

echo "OK concorrência: 8/8"
