# S19 — baseline, contratos e ambiente de banco

Data do corte: 17/09/2026 (atualizado 17/09/2026, sessão de retomada)
Status: em andamento; baseline local concluído, histórico remoto confirmado por leitura direta,
backup lógico e testes RLS/RPC em ambiente isolado ainda bloqueados por Docker/WSL.
Escopo: preparar testes reproduzíveis sem mudar o produto nem tocar no banco em uso.

## Atualização da retomada (17/09/2026)

- Supabase CLI passou a estar disponível via `npx supabase` (v2.117.0) nesta máquina — o
  bloqueio original de CLI ausente não existe mais.
- Docker está instalado, mas o daemon falha ao iniciar: WSL sem o componente kernel Linux
  instalado (`wsl --status` retornava só o help). Rodado `wsl --update` + `wsl --install
  --no-distribution` em PowerShell elevado; instalação reportou êxito mas exige reinício do
  Windows para ativar. Reinício ainda não feito nesta sessão.
- psql continua ausente; não é necessário — `supabase db query --linked` (via Management API)
  cobre leitura read-only sem precisar de Docker.
- Login feito na conta correta (dono do projeto `irkvvpuqvllksztxkqoc`, antes logada em conta
  errada sem esse projeto). Projeto linkado localmente (`supabase link`, sem push).
- **Achado que corrige o inventário abaixo:** consulta read-only direta ao catálogo remoto
  (`information_schema`, `pg_proc`, `pg_policies`) confirma que **0009 e 0010 já estão aplicadas
  no banco em uso** — `sub_players.is_active` existe, os 4 RPCs esperados existem
  (`player_leaderboard`, `rls_auto_enable`, `save_tournament`, `update_tournament_results`), as
  policies batem com o inventário lógico esperado pós-0010, e `public.app_admins` **não** existe
  (confirma que a lacuna da S20 segue intencional). Isso substitui a leitura anterior baseada em
  `supabase migration list`, que mostrava todo o histórico remoto vazio porque as migrações foram
  aplicadas manualmente pelo SQL Editor e nunca ficaram registradas na tabela de controle do CLI
  (`supabase_migrations.schema_migrations`) — portanto `migration list` não é uma fonte confiável
  para este projeto; o inventário direto ao catálogo é.
- Backup lógico (`supabase db dump --linked`) tentado e bloqueado: o dump usa uma imagem Docker
  para rodar `pg_dump`, então depende do mesmo reinício pendente. Nenhum dado foi lido ou alterado
  além do inventário read-only acima.
- **Aviso de segurança operacional:** `supabase db dump --dry-run` imprime a senha temporária do
  role de login gerado pelo CLI em texto plano no stdout. Evitar `--dry-run` neste projeto; usar
  o dump real direto para arquivo.

## Resultado do baseline

- npm run lint: concluído sem erros; 9 avisos preexistentes.
- npm run test: 75 testes aprovados em 4 arquivos.
- npm run build: concluído com sucesso.
- Supabase CLI: indisponível nesta máquina.
- Docker/runner compatível: indisponível nesta máquina.
- psql: indisponível nesta máquina.
- Nenhuma migração, consulta, backup ou restauração foi executada contra banco remoto.

## Reconciliação do worktree

O início da S19 encontrou mudanças locais que pertencem ao trabalho anterior e devem ser preservadas:

- src/App.tsx, src/components/LiveActions.tsx, src/components/PlayersPanel.tsx e
  src/services/tournaments.ts bloqueiam novos torneios para jogadores inativos;
- supabase/migrations/0010_inactivate_cebola.sql adiciona sub_players.is_active,
  retira jogadores inativos do ranking e reforça o bloqueio em save_tournament;
- docs/superpowers/specs/2026-09-17-pagamentos-publicos-rebuys-implementation-plan.md
  define S19–S27.

Esses arquivos não foram revertidos, renomeados ou enviados ao remoto pela S19.

## Inventário de migrações

| Arquivo | SHA-256 | Situação conhecida no banco em uso |
|---|---|---|
| 0001_core_schema.sql | 40549cb68d4bf8fff3ad6aa1cd893b1de449b177e3762edb32c5b8168f26ee19 | registrada como aplicada |
| 0002_rls.sql | 755533f85494e8313551b3a7f91e26cb2e80f5960ec70a44c8e28fc051656fa2 | substituída por 0003; aplicação remota não registrada |
| 0003_rls_fix.sql | 37d651b64ade73b18b082403184b919635d506b33c549b34616787c4260d1fd8 | registrada como aplicada |
| 0004_player_points.sql | bddfee4cdf8fa35590b7900c0e133a2c3521a6b1e6b4c09d1172be3cb9f15c71 | obsoleta; aplicação remota não registrada |
| 0005_live_state.sql | 327475367d2dd55656a1ef224fcbc3dc68a43a31c1abacb1c1596b333e7ec03a | registrada como aplicada |
| 0006_player_name_unique.sql | aa3a62ecc7ba56a492f477b1a7156c7e21842fb4e76a5c0c50ad598293b4dddf | registrada como aplicada em 10/09/2026 |
| 0007_schema_notes.sql | 4142e504e969217218fb8271bf3652574879779fba4934be7b02621f0ebcec4 | registrada como aplicada em 10/09/2026 |
| 0008_transactional_persistence.sql | 4a95f37e52a195e89cc2552afb35a5a988528ae25b1f02973e89b71aa6525ff1 | registrada como aplicada em 10/09/2026 |
| 0009_scalable_leaderboard.sql | 465742c468b4c2d41ab7cf36d96ada83c07a01150d8291b5dbd198922ca86e6b | **confirmada aplicada** (inventário direto, 17/09/2026) |
| 0010_inactivate_cebola.sql | 98786d76da66fff17873e9829431c3c82f034b6c5542f561123810fae34aeb54 | **confirmada aplicada** (inventário direto, 17/09/2026) |

O corte acima para 0001–0008 ainda vem do HANDOFF.md (registro manual), não de consulta ao banco.
0009 e 0010 foram confirmadas por consulta read-only direta ao catálogo remoto nesta sessão (ver
"Atualização da retomada" acima) — `supabase migration list` não serve de fonte aqui porque a
tabela de controle do CLI nunca foi populada (migrações aplicadas manualmente pelo SQL Editor).

## Inventário lógico esperado após 0010

| Tipo | Objetos |
|---|---|
| tabelas privadas | base_tournaments, sub_players, transactions, snapshot_blindstructures |
| projeção pública | live_state |
| enum | tournament_status |
| RPCs autenticadas | save_tournament, update_tournament_results, player_leaderboard |
| policies atuais | authenticated_all nas quatro tabelas privadas; live_public_read e live_auth_write em live_state |
| grants relevantes | RPCs revogadas de public/anon e concedidas a authenticated |
| lacuna intencional | app_admins e as novas tabelas/RPCs só entram a partir da S20 |

O arquivo supabase/tests/schema-inventory.sql consulta o catálogo sem alterar dados. Ele deverá ser executado
no ambiente isolado e, depois, no remoto somente com autorização de leitura para comparar o estado real.

## Conta administrativa

- O modelo atual ainda considera qualquer usuário authenticated como administrador pelas policies de 0003.
- O HANDOFF registra cadastro público desligado e apenas a conta do responsável em Authentication.
- public.app_admins ainda não existe; será criada na S20.
- O UUID do responsável não foi lido nem inventado. Ele deverá ser obtido no ambiente autorizado e inserido
  por procedimento de ambiente, fora da migração versionada.

## Contratos e fixtures fixados

- Contrato RPC v1: docs/contracts/rpc-v1.md.
- Fixture de duas unidades de rebuy: supabase/tests/fixtures/two-rebuys.json.
- Matriz de concorrência: supabase/tests/fixtures/concurrency-cases.json.
- Consulta read-only de inventário: supabase/tests/schema-inventory.sql.
- Ambiente, backup e restauração: docs/runbooks/supabase-test-and-backup.md.

## Bloqueios para concluir a S19

1. ~~instalar Supabase CLI~~ resolvido (`npx supabase`, v2.117.0). Falta só reiniciar o Windows
   para o componente WSL ativar e o Docker Desktop subir (instalação do WSL já feita, pendente
   reboot manual do responsável);
2. ~~confirmar o histórico remoto, especialmente 0009 e 0010~~ resolvido por inventário direto
   read-only nesta sessão;
3. gerar backup lógico antes de mudança no banco em uso e registrar arquivo, data e SHA-256 —
   depende do reboot (item 1), pois `supabase db dump` usa uma imagem Docker;
4. executar a cadeia completa e os testes de RLS/RPC no ambiente isolado — depende do reboot
   (item 1).

Até esses itens serem concluídos, a S19 permanece em andamento e S20 não deve tocar o banco em uso.
Depois do reboot, retomar direto pelos itens 3 e 4 — CLI e login remoto já estão prontos.
