-- 0016 — Exclusão determinística de torneios do fluxo público (S27).
-- A restauração de um dump pode mudar a ordem das cascatas; um pedido ainda
-- ligado a uma oferta bloqueia a exclusão se a oferta cair primeiro.
-- Mantém todas as FKs imediatas e preserva o bloqueio ao apagar só uma oferta.

create or replace function private.delete_operational_tournament_dependents()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.flow_version = 2 then
    -- Transações referenciam pedidos; elas precisam sair primeiro.
    delete from public.transactions where tournament_id = old.id;
    -- Pedidos referenciam ofertas e autorizações que as cascatas apagarão.
    delete from public.purchase_requests where tournament_id = old.id;
  end if;
  return old;
end;
$$;

drop trigger if exists base_tournaments_delete_operational_dependents on public.base_tournaments;
create trigger base_tournaments_delete_operational_dependents
  before delete on public.base_tournaments
  for each row execute function private.delete_operational_tournament_dependents();

-- O schema private não é uma API. Reaplica o corte da 0015 para novas funções.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated;
