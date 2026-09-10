-- supabase/migrations/0007_schema_notes.sql
-- Registra no próprio schema duas decisões da auditoria S5 (10/09/2026).
-- Só `comment on` — não altera dados, não altera estrutura, idempotente.
--
-- Tolerante ao estado real do banco: segundo o HANDOFF §4, `0004` (total_points)
-- e possivelmente `0005` (live_state) nunca rodaram. Cada comentário sobre
-- objeto opcional é guardado por uma checagem de existência, então este arquivo
-- roda limpo com ou sem essas migrações aplicadas.

-- ── 1. 🟠 Modelo de acesso: DONO ÚNICO ──────────────────────────────────
-- Decisão do responsável: o app tem um usuário só (lisboa@prospectus.lat).
-- As policies de 0002/0003 (`authenticated ... using(true)`) ficam como estão:
-- NÃO existe separação por dono. Todo usuário autenticado lê, edita e apaga
-- tudo — inclusive as transmissões ao vivo de `live_state`.
--
-- Isso só é seguro enquanto existir exatamente uma conta. Duas obrigações no
-- painel do Supabase, que nenhuma migração consegue garantir:
--   1. Authentication → Providers → "Allow new users to sign up" = OFF
--   2. Authentication → Users → manter só a conta do responsável
--
-- Se um dia entrar um segundo usuário de verdade, isto vira multi-tenant:
-- `owner_id uuid default auth.uid()` nas 5 tabelas + policies por dono +
-- backfill das linhas existentes, e o unique de jogador da 0006 passa a ser
-- por `(owner_id, display_name_norm)`.

comment on table base_tournaments is
  'Torneios. RLS: acesso total a qualquer usuário autenticado (modelo de dono único, S5). '
  'Sem owner_id — depende de existir só uma conta no projeto.';

comment on table sub_players is
  'Jogadores. RLS: acesso total a qualquer usuário autenticado (modelo de dono único, S5).';

comment on table transactions is
  'Ledger de entradas/reentradas/add-ons. Fonte de verdade do ranking, dos ganhos e do ROI — '
  'nada disso é agregado persistido. RLS: acesso total a qualquer autenticado (dono único, S5).';

comment on table snapshot_blindstructures is
  'Snapshot da escada de blinds do torneio. RLS: acesso total a qualquer autenticado (dono único, S5).';

-- live_state só existe se a 0005 tiver rodado.
do $$ begin
  if to_regclass('public.live_state') is not null then
    comment on table live_state is
      'Estado do relógio para o link público /watch/:id. Leitura anônima por desenho; escrita para '
      'qualquer autenticado, sem dono (modelo de dono único, S5) — qualquer conta autenticada pode '
      'sobrescrever ou apagar qualquer transmissão.';
  end if;
end $$;

-- ── 2. 🟡 Colunas obsoletas em sub_players ──────────────────────────────
-- `total_winnings` (0001) e `total_points` (0004) nunca são escritas pelo app:
-- ganhos, pontos e ROI são derivados de `transactions` no ranking. Mantidas por
-- decisão do responsável (documentar, não dropar) — dropar seria irreversível e
-- quebraria qualquer export/relatório externo que ainda leia as colunas.

do $$ begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'sub_players'
       and column_name = 'total_winnings'
  ) then
    comment on column sub_players.total_winnings is
      'OBSOLETA (S5). Nunca escrita pelo app — ganhos são derivados de transactions.payout_amount. '
      'Mantida só por compatibilidade; não leia nem escreva nela.';
  end if;

  -- Só existe se a 0004 tiver rodado; o HANDOFF §4 marca a 0004 como obsoleta.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'sub_players'
       and column_name = 'total_points'
  ) then
    comment on column sub_players.total_points is
      'OBSOLETA (S5). Nunca escrita pelo app — pontos são derivados de transactions.final_placement. '
      'Mantida só por compatibilidade; não leia nem escreva nela.';
  end if;
end $$;
