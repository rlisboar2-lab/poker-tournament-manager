# Corte de segurança `0015` — aplicar, conferir e reverter

A `0015` troca "todo autenticado é admin" por `app_admins` e fecha o acesso direto de `anon`. Ela só
faz sentido no mesmo release do cliente que já usa as RPCs (`0013`/`0014`) e não mostra QR (S26).
Nada aqui é executado sem autorização do Rod.

## Antes de aplicar (produção)

1. Backup lógico recente (`docs/runbooks/supabase-test-and-backup.md`).
2. `0013` e `0014` aplicadas, nessa ordem.
3. Admin cadastrado (`docs/runbooks/app-admins.md`). Conferir:

   ```sql
   select a.user_id, u.email from public.app_admins a join auth.users u on u.id = a.user_id;
   ```

   Sem linha, a `0015` aborta de propósito: "há usuários em auth.users e nenhum em public.app_admins".
4. Cliente do mesmo release publicado ou pronto para publicar logo em seguida. O cliente anterior
   continua funcionando para o admin cadastrado; o que muda para ele é só a tela sem QR.

## Aplicar

SQL Editor → colar `supabase/migrations/0015_security_cut.sql` inteiro → Run. É idempotente.
Depois: Settings → API → **Reload schema cache**.

## Conferir no catálogo

```sql
-- policies: admin_all nas 4 legadas; live_state com leitura pública e escrita do admin por comando
select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public' order by 1, 2;

-- anon: só SELECT em live_state
select table_name, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'anon';

-- authenticated: sem TRUNCATE/REFERENCES/TRIGGER
select table_name, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and grantee = 'authenticated'
   and privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE');   -- esperado: 0 linhas

-- anon executa só as 8 RPCs públicas
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') order by 1;
```

Smoke test (painel logado): abrir Histórico e Ranking, salvar ou editar um torneio de teste, abrir
`/watch/:id` em janela anônima e `/jogar`. Console sem 401/403 com o admin logado.

## Security Advisor esperado depois da `0015`

- `anon_security_definer_function_executable` (8): as RPCs públicas do portal. Por desenho: validam
  token e estado no banco.
- `authenticated_security_definer_function_executable` (21): as mesmas 8 + as 13 administrativas, que
  checam `app_admins` na primeira instrução e devolvem ADMIN_REQUIRED.
- `rls_enabled_no_policy` (INFO, 10): tabelas do fluxo de pagamentos, acessadas só pelas RPCs.
- Qualquer outro aviso de segurança é novidade e precisa ser investigado antes de liberar.

## Reverter

Volta às permissões anteriores sem apagar dados (o cliente sem QR segue funcionando com elas). Usar
somente se o admin ficar sem acesso e o cadastro em `app_admins` não resolver.

```sql
begin;
do $$
declare t text;
begin
  foreach t in array array['base_tournaments', 'sub_players', 'transactions', 'snapshot_blindstructures'] loop
    execute format('drop policy if exists "admin_all" on public.%I', t);
    execute format('create policy "authenticated_all" on public.%I for all to authenticated using (true) with check (true)', t);
    execute format('grant all on table public.%I to anon, authenticated', t);
  end loop;
end $$;

drop policy if exists "live_admin_insert" on public.live_state;
drop policy if exists "live_admin_update" on public.live_state;
drop policy if exists "live_admin_delete" on public.live_state;
create policy "live_auth_write" on public.live_state for all to authenticated using (true) with check (true);
grant all on table public.live_state to anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_operational_tournament(jsonb)', 'public.publish_tournament(uuid, bigint)',
    'public.resolve_player_claim(uuid, uuid, text)', 'public.confirm_buyins_and_start(uuid, bigint, uuid[])',
    'public.authorize_purchase(uuid, text, uuid[], timestamptz)', 'public.confirm_purchase(uuid, bigint)',
    'public.reject_purchase(uuid, text)', 'public.revoke_purchase_authorization(uuid, text)',
    'public.update_tournament_runtime(uuid, bigint, jsonb)', 'public.finish_operational_tournament(uuid, bigint, jsonb)',
    'public.get_operational_tournament(uuid)', 'public.update_tournament_setup(uuid, bigint, jsonb)',
    'public.cancel_operational_tournament(uuid, bigint)'
  ] loop
    execute format('grant execute on function %s to anon', f);
  end loop;
end $$;

revoke execute on function private.is_admin() from authenticated;
revoke usage on schema private from authenticated;
commit;
```

A reversão não devolve `EXECUTE` de `rls_auto_enable` a PUBLIC: é função de event trigger e não tem uso
pela API. Depois de reverter, as RPCs administrativas continuam exigindo `app_admins` por dentro.
