# Cadastrar o admin em `app_admins`

A migração `0012` cria `public.app_admins`, mas não cadastra ninguém: UUID de usuário não entra em
arquivo versionado. Até a `0015` (S26), a tabela vazia só afeta as RPCs administrativas do fluxo 2: o
legado usa as policies `authenticated_all`. **Depois da `0015`, conta fora de `app_admins` não lê nem
grava nada** (legado incluído) — cadastrar o responsável antes de aplicá-la. A própria `0015` aborta se
houver usuário em `auth.users` e nenhum admin.

## Produção (SQL Editor do Supabase)

Só depois de a `0012` estar aplicada e com autorização do Rod.

```sql
-- 1. Conferir a conta (deve existir exatamente uma, com signup desligado).
select id, email, created_at from auth.users order by created_at;

-- 2. Cadastrar pelo e-mail, sem copiar UUID à mão.
insert into public.app_admins (user_id)
select id from auth.users where email = '<email-do-responsavel>'
on conflict (user_id) do nothing;

-- 3. Conferir.
select a.user_id, u.email, a.created_at
  from public.app_admins a join auth.users u on u.id = a.user_id;
```

## Local (Supabase CLI)

Criar o usuário pelo Studio local (Authentication → Add user) e repetir o passo 2 via:

```bash
docker exec -i supabase_db_poker-tournament-manager psql -U postgres -d postgres
```

## Remover

```sql
delete from public.app_admins where user_id = (select id from auth.users where email = '<email>');
```

Apagar o usuário em Authentication remove a linha sozinho (`on delete cascade`).
