# S19 — Resultados da auditoria de migrações, RLS/RPC e backup

Executado em 2026-09-23. Ambiente: stack local do Supabase (Docker), Postgres 17.6,
mesma major version do projeto remoto `irkvvpuqvllksztxkqoc`.

Procedimento em [supabase-test-and-backup.md](supabase-test-and-backup.md).

---

## 1. Testes de RLS e RPC — PASSOU

`supabase/tests/rls-rpc-baseline.sql`, 10 blocos de asserção, rodado dentro de transação
com `rollback` no final (não persiste nada). Saída completa, exit code 0:

```
OK 1  - RLS ligado nas cinco tabelas
OK 2  - policies conferem com o inventario logico
OK 3  - RPCs revogadas de public/anon e concedidas a authenticated
OK 4  - anon sem leitura e sem escrita nas tabelas privadas
OK 5  - live_state com leitura publica e escrita autenticada
OK 6  - save_tournament grava torneio, niveis e ledger na mesma transacao
OK 7  - payload invalido aborta a transacao inteira
OK 8  - inativo bloqueado na RPC e fora do ranking
OK 9  - pontos, investimento e eventos do ranking conferem
OK 10 - display_name_norm rejeita nome duplicado
```

Reexecutar:

```bash
docker exec -i supabase_db_poker-tournament-manager psql -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -f - < supabase/tests/rls-rpc-baseline.sql
```

## 2. Determinismo da cadeia 0001→0010 — PASSOU

Três execuções de `supabase db reset --local` a partir de banco vazio. As 10 migrações
aplicaram sem erro nas três. Inventário estrutural capturado após a segunda e a terceira:
**225 linhas, zero diferenças.**

O inventário cobre: tabelas com flags de RLS, colunas (tipo/nulidade/default), constraints,
índices, policies, corpo das funções (md5 de `pg_get_functiondef`), triggers de tabela,
event triggers e grants por role.

## 3. Backup lógico do remoto — FEITO

Três dumps em `supabase/backups/`, com checksums em `SHA256SUMS-2026-09-23.txt`:

| Arquivo | Bytes | SHA-256 |
|---|---:|---|
| `s19-remote-roles-2026-09-23.sql` | 297 | `25873cec56a2cc6514e204f420231777f85c03da818caa7090cdcdfa89776ecd` |
| `s19-remote-schema-2026-09-23.sql` | 22369 | `f93a3b005b63c64dcd0df416b50e0e3fa13e6dd7566ab1829b135c727fc63147` |
| `s19-remote-data-2026-09-23.sql` | 105801 | `5a7dcb5a541ce1854a48e0336fee08052f1c7bd80b909f601b253345e7c699f2` |

### Achado: o backup anterior nunca existiu de fato

`supabase/backups/s19-remote-schema-2026-09-17.sql` tem **0 bytes**. O dump de 17/09 foi
registrado como concluído mas não gerou conteúdo. Entre 17/09 e 23/09 o projeto operou sem
backup válido. Arquivo mantido no lugar como registro do incidente.

## 4. Comparação produção ↔ replay das migrações

Método: schema do remoto restaurado em banco réplica local (`remote_replica`), mesmo
inventário rodado nos dois lados, comparação linha a linha.

**Idênticos:** tabelas, flags de RLS, colunas, constraints, índices, policies, grants,
triggers de tabela, e a função `update_tournament_results`.

### 4.1 Drift real — `rls_auto_enable()`

Existe em produção, **não existe em nenhuma migração**. `SECURITY DEFINER`,
`search_path` fixo em `pg_catalog`, retorna `event_trigger`. Liga RLS automaticamente
em toda tabela criada no schema `public` — rede de segurança contra tabela nova
nascer desprotegida.

Corpo completo em `s19-remote-schema-2026-09-23.sql` a partir da linha 116.

**Pendência não resolvida:** o dump não traz nenhum `CREATE EVENT TRIGGER`, mas
`supabase db dump` roda sem superusuário e omite event triggers por padrão. Não dá para
concluir pelo dump se a função está ativa ou se é código órfão. Resolver no SQL editor do
painel:

```sql
select evtname, evtevent, evtenabled
  from pg_event_trigger
 where evtfoid = 'public.rls_auto_enable'::regproc;
```

- Se retornar linha → o comportamento é real e precisa virar migração versionada.
- Se vier vazio → função órfã, decidir entre remover de produção ou versionar junto com o trigger.

### 4.2 Diferença cosmética — CRLF vs LF

`player_leaderboard()` e `save_tournament(jsonb)` têm md5 diferente entre produção e replay,
mas são **semanticamente idênticas**: o corpo armazenado em produção usa CRLF, o replay local
gera LF. Sem impacto em comportamento.

Efeito colateral: qualquer comparação automática de schema vai acusar essas duas funções como
divergentes para sempre. Normalizar (reaplicar as funções com LF em produção) ou ignorar
explicitamente `\r` na ferramenta de comparação.

### 4.3 Falso positivo do método

Seis linhas `EVT|` aparecem só no lado local (`pgrst_ddl_watch`, `issue_pg_cron_access` e
outras quatro). São event triggers nativos do Supabase que moram no schema `extensions`; o
dump só traz `public`. Não é drift.

---

## Armadilha encontrada na própria ferramenta de inventário

A primeira versão do `schema-inventory.sql` falhava silenciosamente na seção de funções:

```
ERROR:  operator is not unique: text || "char"
```

`pg_proc.provolatile` é do tipo `"char"` e a concatenação com `text` fica ambígua. O psql
seguia para a próxima consulta, o inventário saía sem nenhuma linha de função, e a comparação
dava "zero diferenças" — escondendo exatamente onde estava o drift.

Corrigido com `p.provolatile::text` e `p.prosecdef::text`. Adicionada também a seção de
event triggers, que não existia.

**Sempre rodar o inventário com `ON_ERROR_STOP=1` ou conferir o contador de erros na saída.**
Uma seção vazia por erro de sintaxe é indistinguível de uma seção vazia por ausência de objetos.

---

---

## Achado de segurança: dump de dados continha credenciais

`supabase db dump --data-only` não se limita ao schema `public`. O arquivo gerado inclui:

- `auth.users` — contas com hash de senha
- `auth.sessions` e `auth.refresh_tokens` — tokens de sessão válidos
- `auth.identities`, `auth.mfa_amr_claims`

`supabase/backups/` não estava no `.gitignore`. Um `git add .` teria commitado refresh
tokens válidos no repositório — quem tivesse acesso ao repo poderia se autenticar como o usuário.

Corrigido em `supabase/.gitignore`:

```
backups/*-data-*.sql
```

Schema e roles seguem versionáveis (o de roles só contém `statement_timeout` por role).

O arquivo continua no disco local, fora do git. Ao arquivar ou compartilhar a pasta do projeto,
tratar `s19-remote-data-2026-09-23.sql` como material sensível.

## Pendências

- [ ] Confirmar no painel se o event trigger de `rls_auto_enable` está ativo (consulta acima)
- [ ] Versionar `rls_auto_enable` como migração `0011`, se confirmado ativo
- [ ] Decidir sobre a normalização CRLF→LF de `player_leaderboard` e `save_tournament`
- [ ] Automatizar o dump com verificação de tamanho > 0 (o incidente de 17/09 passou despercebido)
- [ ] Rotacionar as sessões do Supabase se o dump de dados já tiver saído desta máquina
