-- supabase/migrations/0002_rls.sql
-- Row Level Security: apenas usuários autenticados acessam os dados.
-- O papel `anon` (chave pública usada no navegador antes do login) fica barrado.

alter table base_tournaments        enable row level security;
alter table sub_players             enable row level security;
alter table transactions            enable row level security;
alter table snapshot_blindstructures enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'base_tournaments', 'sub_players', 'transactions', 'snapshot_blindstructures'
  ] loop
    execute format('drop policy if exists "authenticated_all" on %I;', t);
    execute format(
      'create policy "authenticated_all" on %I for all to authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;
