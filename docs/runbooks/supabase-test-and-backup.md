# Runbook — Supabase isolado, backup e restauração

Este procedimento impede que testes da S19–S27 atinjam primeiro o banco em uso.

## Estado desta máquina em 17/09/2026

- Supabase CLI, Docker e psql não estão instalados.
- Projeto remoto conhecido: irkvvpuqvllksztxkqoc.
- Não vincular nem alterar o projeto remoto durante o teste local.

## Preparar o ambiente local

Pré-requisitos: Supabase CLI e Docker Desktop, ou runtime compatível. A documentação oficial exige ambos para
o stack local. Não coloque chaves, senhas ou strings de conexão no repositório.

1. Na raiz do projeto, inicialize a configuração local somente se supabase/config.toml não existir:

       npx supabase init

2. Confirme que não há projeto remoto vinculado antes de qualquer reset.

3. Inicie o stack e recrie apenas o banco local:

       npx supabase start
       npx supabase db reset --local

   O reset local apaga somente o banco local e reaplica todas as migrações em ordem. Nunca acrescente
   --linked: essa opção é destrutiva para o projeto remoto.

4. Rode duas vezes npx supabase db reset --local. A segunda execução prova repetibilidade da cadeia.

5. Execute o inventário SQL e os testes de RLS/RPC. Registre data, versão da CLI, versão do Postgres,
   resultado e diferenças no documento da S19.

O repositório tem migrações históricas substituídas/obsoletas (0002 e 0004). Elas são aditivas e entram no
replay local completo; o inventário remoto deve distinguir arquivo versionado de migração historicamente aplicada.

## Confirmar o corte remoto sem aplicar mudanças

Em sessão explicitamente autorizada para o projeto correto:

    npx supabase migration list
    npx supabase db push --dry-run

O primeiro comando compara histórico local/remoto; o segundo é somente prévia. Registre no handoff as migrações
aplicadas e pendentes. Não rode db push sem nova autorização específica.

## Backup lógico antes de mudança remota

Use uma string de conexão obtida em Supabase → Connect e mantenha-a apenas na sessão do terminal. Salve os
arquivos fora do repositório, em pasta privada com data/hora. Nunca cole a string no handoff.

    npx supabase db dump --db-url "<CONNECTION_STRING>" -f roles.sql --role-only
    npx supabase db dump --db-url "<CONNECTION_STRING>" -f schema.sql
    npx supabase db dump --db-url "<CONNECTION_STRING>" -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
    Get-FileHash -Algorithm SHA256 roles.sql,schema.sql,data.sql

Registre no HANDOFF.md: data/hora, projeto, pasta privada, tamanho e SHA-256 de cada arquivo. Não versione dumps
com dados de jogadores ou credenciais.

## Testar restauração

Restauração nunca é ensaiada no banco em uso. Use projeto descartável autorizado ou Postgres local vazio e siga
o procedimento oficial da versão da CLI/Postgres instalada. Valide:

- tabelas, enums, índices, FKs, funções, grants e policies;
- contagens por tabela antes/depois;
- anon bloqueado nas tabelas privadas;
- usuário autenticado não admin bloqueado nas RPCs administrativas;
- fixtures two-rebuys.json e concurrency-cases.json.

Uma restauração só conta como validada quando o destino isolado abre, passa nos testes e os hashes do backup
ficam registrados. Criar o backup sem restaurá-lo em ambiente isolado não conclui este item.

## Referências oficiais

- https://supabase.com/docs/guides/local-development/cli-workflows
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
