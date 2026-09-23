


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."tournament_status" AS ENUM (
    'scheduled',
    'running',
    'paused',
    'finished',
    'cancelled'
);


ALTER TYPE "public"."tournament_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."player_leaderboard"() RETURNS TABLE("display_name" "text", "points" bigint, "total_winnings" numeric, "total_invested" numeric, "roi" numeric, "events" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."player_leaderboard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."player_leaderboard"() IS 'Ranking de jogadores agregado no Postgres (S8). Substitui o agregado no cliente, que truncava `transactions` em 1000 linhas (limite do PostgREST) e era O(n²).';



CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_tournament"("payload" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."save_tournament"("payload" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."save_tournament"("payload" "jsonb") IS 'Grava torneio + escada de blinds + jogadores + ledger numa única transação (S7). Substitui os 3 inserts sequenciais do cliente, que podiam deixar torneio órfão sem participantes.';



CREATE OR REPLACE FUNCTION "public"."update_tournament_results"("p_tournament_id" "uuid", "p_results" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
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


ALTER FUNCTION "public"."update_tournament_results"("p_tournament_id" "uuid", "p_results" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_tournament_results"("p_tournament_id" "uuid", "p_results" "jsonb") IS 'Atualiza colocação e prêmio de todos os jogadores de um torneio em 1 comando (S7). Substitui o laço de 2 updates por jogador no cliente.';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."base_tournaments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "start_time" timestamp with time zone DEFAULT "now"() NOT NULL,
    "end_time_projected" timestamp with time zone,
    "end_time_actual" timestamp with time zone,
    "total_prize_pool" numeric(14,2) DEFAULT 0 NOT NULL,
    "buy_in_value" numeric(14,2) DEFAULT 0 NOT NULL,
    "initial_stack" integer DEFAULT 3750 NOT NULL,
    "curve_params" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "payout_structure" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "public"."tournament_status" DEFAULT 'scheduled'::"public"."tournament_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."base_tournaments" OWNER TO "postgres";


COMMENT ON TABLE "public"."base_tournaments" IS 'Torneios. RLS: acesso total a qualquer usuário autenticado (modelo de dono único, S5). Sem owner_id — depende de existir só uma conta no projeto.';



CREATE TABLE IF NOT EXISTS "public"."live_state" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "schedule" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'idle'::"text" NOT NULL,
    "anchor_ms" bigint DEFAULT 0 NOT NULL,
    "paused_elapsed_ms" bigint DEFAULT 0 NOT NULL,
    "players_remaining" integer DEFAULT 1 NOT NULL,
    "total_chips" numeric DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."live_state" OWNER TO "postgres";


COMMENT ON TABLE "public"."live_state" IS 'Estado do relógio para o link público /watch/:id. Leitura anônima por desenho; escrita para qualquer autenticado, sem dono (modelo de dono único, S5) — qualquer conta autenticada pode sobrescrever ou apagar qualquer transmissão.';



CREATE TABLE IF NOT EXISTS "public"."snapshot_blindstructures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tournament_id" "uuid" NOT NULL,
    "level_index" integer NOT NULL,
    "small_blind_val" integer NOT NULL,
    "big_blind_val" integer NOT NULL,
    "duration_seconds" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."snapshot_blindstructures" OWNER TO "postgres";


COMMENT ON TABLE "public"."snapshot_blindstructures" IS 'Snapshot da escada de blinds do torneio. RLS: acesso total a qualquer autenticado (dono único, S5).';



CREATE TABLE IF NOT EXISTS "public"."sub_players" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "display_name" "text" NOT NULL,
    "nickname" "text",
    "total_winnings" numeric(14,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "total_points" integer DEFAULT 0 NOT NULL,
    "display_name_norm" "text" GENERATED ALWAYS AS ("lower"("btrim"("display_name"))) STORED,
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."sub_players" OWNER TO "postgres";


COMMENT ON TABLE "public"."sub_players" IS 'Jogadores. RLS: acesso total a qualquer usuário autenticado (modelo de dono único, S5).';



COMMENT ON COLUMN "public"."sub_players"."total_winnings" IS 'OBSOLETA (S5). Nunca escrita pelo app — ganhos são derivados de transactions.payout_amount. Mantida só por compatibilidade; não leia nem escreva nela.';



COMMENT ON COLUMN "public"."sub_players"."total_points" IS 'OBSOLETA (S5). Nunca escrita pelo app — pontos são derivados de transactions.final_placement. Mantida só por compatibilidade; não leia nem escreva nela.';



COMMENT ON COLUMN "public"."sub_players"."display_name_norm" IS 'Chave de identidade do jogador: display_name sem caixa e sem espaços nas pontas. Gerada pelo banco — nunca escreva nela. Alvo do ON CONFLICT do upsert de jogador.';



CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tournament_id" "uuid" NOT NULL,
    "player_id" "uuid" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "is_rebuy" boolean DEFAULT false NOT NULL,
    "is_addon" boolean DEFAULT false NOT NULL,
    "final_placement" integer,
    "payout_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


COMMENT ON TABLE "public"."transactions" IS 'Ledger de entradas/reentradas/add-ons. Fonte de verdade do ranking, dos ganhos e do ROI — nada disso é agregado persistido. RLS: acesso total a qualquer autenticado (dono único, S5).';



ALTER TABLE ONLY "public"."base_tournaments"
    ADD CONSTRAINT "base_tournaments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."live_state"
    ADD CONSTRAINT "live_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."snapshot_blindstructures"
    ADD CONSTRAINT "snapshot_blindstructures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."snapshot_blindstructures"
    ADD CONSTRAINT "snapshot_blindstructures_tournament_id_level_index_key" UNIQUE ("tournament_id", "level_index");



ALTER TABLE ONLY "public"."sub_players"
    ADD CONSTRAINT "sub_players_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_blinds_tournament" ON "public"."snapshot_blindstructures" USING "btree" ("tournament_id");



CREATE INDEX "idx_tx_player" ON "public"."transactions" USING "btree" ("player_id");



CREATE INDEX "idx_tx_tournament" ON "public"."transactions" USING "btree" ("tournament_id");



CREATE UNIQUE INDEX "sub_players_display_name_norm_uidx" ON "public"."sub_players" USING "btree" ("display_name_norm");



ALTER TABLE ONLY "public"."snapshot_blindstructures"
    ADD CONSTRAINT "snapshot_blindstructures_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "public"."base_tournaments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "public"."sub_players"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "public"."base_tournaments"("id") ON DELETE CASCADE;



CREATE POLICY "authenticated_all" ON "public"."base_tournaments" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authenticated_all" ON "public"."snapshot_blindstructures" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authenticated_all" ON "public"."sub_players" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "authenticated_all" ON "public"."transactions" TO "authenticated" USING (true) WITH CHECK (true);



ALTER TABLE "public"."base_tournaments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "live_auth_write" ON "public"."live_state" TO "authenticated" USING (true) WITH CHECK (true);



CREATE POLICY "live_public_read" ON "public"."live_state" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."live_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."snapshot_blindstructures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sub_players" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."live_state";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































REVOKE ALL ON FUNCTION "public"."player_leaderboard"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."player_leaderboard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."player_leaderboard"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_tournament"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_tournament"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_tournament"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_tournament_results"("p_tournament_id" "uuid", "p_results" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_tournament_results"("p_tournament_id" "uuid", "p_results" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_tournament_results"("p_tournament_id" "uuid", "p_results" "jsonb") TO "service_role";


















GRANT ALL ON TABLE "public"."base_tournaments" TO "anon";
GRANT ALL ON TABLE "public"."base_tournaments" TO "authenticated";
GRANT ALL ON TABLE "public"."base_tournaments" TO "service_role";



GRANT ALL ON TABLE "public"."live_state" TO "anon";
GRANT ALL ON TABLE "public"."live_state" TO "authenticated";
GRANT ALL ON TABLE "public"."live_state" TO "service_role";



GRANT ALL ON TABLE "public"."snapshot_blindstructures" TO "anon";
GRANT ALL ON TABLE "public"."snapshot_blindstructures" TO "authenticated";
GRANT ALL ON TABLE "public"."snapshot_blindstructures" TO "service_role";



GRANT ALL ON TABLE "public"."sub_players" TO "anon";
GRANT ALL ON TABLE "public"."sub_players" TO "authenticated";
GRANT ALL ON TABLE "public"."sub_players" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































