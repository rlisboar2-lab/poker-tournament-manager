-- supabase/migrations/0003_rls_fix.sql
-- Correção definitiva do RLS: garante RLS ligado + policies explícitas para
-- usuários autenticados (leitura/escrita total). Resolve o erro
-- "new row violates row-level security policy".
-- Idempotente: pode rodar quantas vezes precisar.

alter table base_tournaments         enable row level security;
alter table sub_players              enable row level security;
alter table transactions             enable row level security;
alter table snapshot_blindstructures enable row level security;

-- base_tournaments
drop policy if exists "authenticated_all" on base_tournaments;
create policy "authenticated_all" on base_tournaments
  for all to authenticated using (true) with check (true);

-- sub_players
drop policy if exists "authenticated_all" on sub_players;
create policy "authenticated_all" on sub_players
  for all to authenticated using (true) with check (true);

-- transactions
drop policy if exists "authenticated_all" on transactions;
create policy "authenticated_all" on transactions
  for all to authenticated using (true) with check (true);

-- snapshot_blindstructures
drop policy if exists "authenticated_all" on snapshot_blindstructures;
create policy "authenticated_all" on snapshot_blindstructures
  for all to authenticated using (true) with check (true);
