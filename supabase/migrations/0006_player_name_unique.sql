-- supabase/migrations/0006_player_name_unique.sql
-- 🔴 Nome de jogador duplicado quebra o save (`tournaments.ts:46`).
-- `upsertPlayer` faz select + `.maybeSingle()`, que LANÇA erro quando o nome casa
-- com 2 linhas. Não havia unique em `sub_players`, então duas linhas com o mesmo
-- nome (ou "Ana" e "ana") derrubavam o salvamento do torneio inteiro.
--
-- Fix: coluna normalizada gerada + unique index sobre ela. Normaliza caixa e
-- espaços nas pontas, de modo que "Ana", "ana" e " Ana " passam a ser o mesmo
-- jogador — que é o comportamento esperado numa lista digitada à mão.
--
-- Idempotente: pode rodar quantas vezes precisar.

-- ── 1. Pré-checagem: aborta se já existem duplicatas ────────────────────
-- O unique index não pode ser criado com duplicatas na tabela. Em vez de deixar
-- o Postgres devolver um erro genérico, listamos exatamente quais nomes travam.
do $$
declare
  dups text;
begin
  select string_agg(format('%L (%s linhas)', nome, n), ', ' order by nome)
    into dups
  from (
    select lower(btrim(display_name)) as nome, count(*) as n
    from sub_players
    group by 1
    having count(*) > 1
  ) d;

  if dups is not null then
    raise exception using
      message = 'Migração 0006 abortada: há jogadores duplicados em sub_players.',
      detail  = 'Duplicados: ' || dups,
      hint    = 'Uma linha vira a definitiva; as outras precisam ter as transactions '
             || 'repontadas antes de serem apagadas. Veja o bloco comentado no fim '
             || 'deste arquivo (0006) e rode-o com o nome em questão.';
  end if;
end $$;

-- ── 2. Coluna normalizada (gerada, sempre em sincronia) ─────────────────
alter table sub_players
  add column if not exists display_name_norm text
  generated always as (lower(btrim(display_name))) stored;

comment on column sub_players.display_name_norm is
  'Chave de identidade do jogador: display_name sem caixa e sem espaços nas pontas. '
  'Gerada pelo banco — nunca escreva nela. Alvo do ON CONFLICT do upsert de jogador.';

-- ── 3. Unique ───────────────────────────────────────────────────────────
create unique index if not exists sub_players_display_name_norm_uidx
  on sub_players (display_name_norm);

-- ── 4. Merge manual de duplicatas (só se a etapa 1 abortar) ─────────────
-- Repontar as transactions das linhas perdedoras para a mais antiga e apagar o
-- resto. Rode NUMA TRANSAÇÃO, revisando o resultado antes do commit.
--
--   begin;
--
--   with alvo as (
--     select id,
--            first_value(id) over (
--              partition by lower(btrim(display_name)) order by created_at
--            ) as manter
--     from sub_players
--     where lower(btrim(display_name)) = lower(btrim('NOME AQUI'))
--   )
--   update transactions t
--      set player_id = a.manter
--     from alvo a
--    where t.player_id = a.id and a.id <> a.manter;
--
--   delete from sub_players s
--    where lower(btrim(s.display_name)) = lower(btrim('NOME AQUI'))
--      and s.id <> (
--        select id from sub_players
--         where lower(btrim(display_name)) = lower(btrim('NOME AQUI'))
--         order by created_at limit 1
--      );
--
--   -- confira antes de fechar:
--   select * from sub_players where lower(btrim(display_name)) = lower(btrim('NOME AQUI'));
--   commit;
