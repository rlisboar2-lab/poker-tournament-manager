-- 0011 — versiona o RLS automático que já existe em produção (drift da S19).
--
-- Em produção existem a função public.rls_auto_enable() e o event trigger
-- ensure_rls (ddl_command_end, evtenabled = 'O'), criados fora das migrações.
-- Confirmado por Rod no SQL Editor em 23/09/2026. Corpo da função copiado do
-- dump supabase/backups/s19-remote-schema-2026-09-23.sql (linha 116).
--
-- Efeito: toda tabela criada no schema public nasce com RLS ligado. Versionar
-- aqui faz o banco local de teste se comportar como produção antes da 0012,
-- que cria as tabelas do fluxo de pagamentos.
--
-- Idempotente: em produção a função é substituída pelo mesmo corpo e o trigger
-- existente é mantido.

create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $$
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

comment on function public.rls_auto_enable() is
  'Liga RLS em toda tabela criada no schema public. Disparada pelo event trigger ensure_rls. Existia em produção sem migração; versionada na 0011 (S20).';

do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
      when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      execute function public.rls_auto_enable();
  end if;
end;
$$;
