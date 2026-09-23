-- S19: inventario read-only do schema. Nao altera dados nem permissoes.
-- Rodar com ON_ERROR_STOP=1: secao vazia por erro e indistinguivel de secao vazia por ausencia.
\pset format unaligned
\pset tuples_only on
\pset fieldsep '|'
select 'TABLE|'||c.relname||'|rls='||c.relrowsecurity||'|force='||c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' order by 1;
select 'COL|'||table_name||'|'||column_name||'|'||data_type||'|null='||is_nullable||'|def='||coalesce(column_default,'-')
  from information_schema.columns where table_schema='public' order by 1;
select 'CON|'||rel.relname||'|'||con.conname||'|'||pg_get_constraintdef(con.oid)
  from pg_constraint con join pg_class rel on rel.oid=con.conrelid
  join pg_namespace n on n.oid=rel.relnamespace where n.nspname='public' order by 1;
select 'IDX|'||tablename||'|'||indexname||'|'||indexdef from pg_indexes where schemaname='public' order by 1;
select 'POL|'||tablename||'|'||policyname||'|'||cmd||'|'||array_to_string(roles,',')||'|qual='||coalesce(qual,'-')||'|check='||coalesce(with_check,'-')
  from pg_policies where schemaname='public' order by 1;
select 'FUN|'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|secdef='||p.prosecdef::text||'|vol='||p.provolatile::text||'|md5='||md5(pg_get_functiondef(p.oid))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.prokind='f' order by 1;
select 'TRG|'||c.relname||'|'||t.tgname||'|'||pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and not t.tgisinternal order by 1;
select 'EVT|'||e.evtname||'|'||e.evtevent||'|'||e.evtenabled::text||'|'||p.proname||'|'||n.nspname
  from pg_event_trigger e join pg_proc p on p.oid=e.evtfoid join pg_namespace n on n.oid=p.pronamespace order by 1;
select 'GRANT|'||grantee||'|'||table_name||'|'||privilege_type
  from information_schema.role_table_grants where table_schema='public' order by 1;
