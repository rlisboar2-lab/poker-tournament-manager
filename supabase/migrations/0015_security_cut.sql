-- 0015 — Corte de segurança (S26).
--
-- Troca "todo autenticado é admin" por checagem de public.app_admins e fecha o acesso
-- direto que o público não deve ter. Não cria tabela nem muda regra financeira.
--
-- Depois desta migração:
--   * anon: SELECT em live_state (relógio público) e EXECUTE nas 8 RPCs públicas do
--     portal. Nada mais: sem grant nas tabelas legadas, sem RPC administrativa.
--   * authenticated fora de app_admins: não lê nem escreve tabela alguma (RLS), só lê
--     live_state; RPCs administrativas devolvem ADMIN_REQUIRED; save_tournament e
--     update_tournament_results falham no RLS; player_leaderboard volta vazio.
--   * admin (app_admins): as mesmas operações de antes, por policies e RPCs.
--   * TRUNCATE, REFERENCES e TRIGGER saem de anon/authenticated (TRUNCATE ignora RLS).
--
-- Pré-requisito em produção: o responsável cadastrado em app_admins
-- (docs/runbooks/app-admins.md). A migração aborta se houver usuário em auth.users e
-- nenhum admin, para não trancar o painel. Banco novo (sem usuários) passa.
--
-- Reversão: docs/runbooks/security-cut-0015.md.

-- ── 0. Guarda contra trancar o admin ────────────────────────────────────
do $$
begin
  if exists (select 1 from auth.users) and not exists (select 1 from public.app_admins) then
    raise exception using
      message = '0015 abortada: há usuários em auth.users e nenhum em public.app_admins',
      hint    = 'Cadastre o responsável (docs/runbooks/app-admins.md) e rode de novo.';
  end if;
end $$;

-- ── 1. private.is_admin() utilizável nas policies ───────────────────────
-- Policies rodam com o papel de quem consulta; authenticated precisa de USAGE no schema
-- e EXECUTE só neste helper. O schema private não é exposto pelo PostgREST
-- (config.toml: schemas = public, graphql_public), então isso não vira endpoint.
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;

-- Atenção para migrações futuras: com USAGE concedido, um helper novo em private nasce
-- executável por PUBLIC (default do Postgres, que não se revoga por schema). Toda
-- migração que criar função em private termina com
--   revoke all on all functions in schema private from public, anon, authenticated;
-- e reconcede is_admin() a authenticated. s26-security.sql (bloco 3) falha se esquecer.

-- ── 2. Tabelas legadas: somente app_admins ──────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'base_tournaments', 'sub_players', 'transactions', 'snapshot_blindstructures'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "authenticated_all" on public.%I', t);
    execute format('drop policy if exists "admin_all" on public.%I', t);
    execute format(
      'create policy "admin_all" on public.%I for all to authenticated '
      'using ((select private.is_admin())) with check ((select private.is_admin()))', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
  end loop;
end $$;

-- ── 3. live_state: leitura pública, escrita só do admin ─────────────────
alter table public.live_state enable row level security;

-- Uma policy por comando de escrita: com "for all", o SELECT do authenticated teria duas
-- policies permissivas (Advisor: multiple_permissive_policies).
drop policy if exists "live_auth_write" on public.live_state;
drop policy if exists "live_admin_insert" on public.live_state;
drop policy if exists "live_admin_update" on public.live_state;
drop policy if exists "live_admin_delete" on public.live_state;
create policy "live_admin_insert" on public.live_state
  for insert to authenticated with check ((select private.is_admin()));
create policy "live_admin_update" on public.live_state
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "live_admin_delete" on public.live_state
  for delete to authenticated using ((select private.is_admin()));

-- live_public_read (0005) continua: select para anon e authenticated.
revoke all on table public.live_state from public, anon, authenticated;
grant select on table public.live_state to anon;
grant select, insert, update, delete on table public.live_state to authenticated;

-- ── 4. RPCs administrativas: fora de anon ───────────────────────────────
-- Continuam executáveis por authenticated para devolver ADMIN_REQUIRED no envelope.
-- anon sem JWT recebe permission denied (42501); o cliente trata como AUTH_REQUIRED.
do $$
declare f text;
begin
  foreach f in array array[
    'public.create_operational_tournament(jsonb)',
    'public.publish_tournament(uuid, bigint)',
    'public.resolve_player_claim(uuid, uuid, text)',
    'public.confirm_buyins_and_start(uuid, bigint, uuid[])',
    'public.authorize_purchase(uuid, text, uuid[], timestamptz)',
    'public.confirm_purchase(uuid, bigint)',
    'public.reject_purchase(uuid, text)',
    'public.revoke_purchase_authorization(uuid, text)',
    'public.update_tournament_runtime(uuid, bigint, jsonb)',
    'public.finish_operational_tournament(uuid, bigint, jsonb)',
    'public.get_operational_tournament(uuid)',
    'public.update_tournament_setup(uuid, bigint, jsonb)',
    'public.cancel_operational_tournament(uuid, bigint)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ── 5. Função de event trigger fora do alcance dos papéis da API ────────
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
