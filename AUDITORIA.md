# Auditoria — backlog em sessões

Plano fatiado para execução **uma sessão por bloco**. Cada sessão lê só os arquivos do seu bloco.
Ao final de cada sessão: marcar `[x]`, commitar, e informar o modelo da próxima.

Legenda: 🔴 bug · 🟠 segurança · 🟡 qualidade

---

## S1 — Quick wins críticos  ·  Sonnet 5 · effort **high**  ·  sem pré-requisito
Arquivos: `src/App.tsx`, `src/hooks/useTournamentEngine.ts`, `src/utils/seating.ts`, `src/components/Clock.tsx`

- [x] 🔴 **Autosave roda ~4×/s** — `App.tsx:190`. `engine` nas deps do effect; o hook devolve objeto novo a cada render e o ticker re-renderiza a 250ms, então o `setInterval(2000)` nunca dispara e `write()` executa 4×/s. Fix: tirar `engine` das deps, acessar `snapshot` por ref (ou `useMemo` no retorno do hook).
- [x] 🔴 **Link ao vivo quebra fora de HTTPS** — `App.tsx:265`. Fallback de `crypto.randomUUID` não gera UUID; `live_state.id` é `uuid` → upsert falha com `invalid input syntax for type uuid`, e o erro só vira `console.warn`. Fix: UUID v4 manual no fallback + estado de erro visível na UI.
- [x] 🔴 **Colisão de assento ao vivo** — `seating.ts:60`. `seat = counts[target] + 1` conta só ativos sentados; eliminado libera assento sem renumerar → assento duplicado. Fix: `max(seat ocupado na mesa) + 1`.
- [x] 🔴 **Relógio restaurado salta para `finished`** — `App.tsx:178`. `restore` reancora em epoch absoluto; reabrir no dia seguinte com status `running` encerra o torneio. Fix: se `Date.now() - anchorMs > duração total`, restaurar como `paused` e avisar.
- [x] 🟡 **Alarme de 1 min não reamarma** — `Clock.tsx:130`. `minuteFiredRef` guarda `item_index`; `−1m`/`+1m` no mesmo nível não refaz o alarme.
- [x] 🟡 **`AudioContext` nunca fechado** — `Clock.tsx`. `ctx.close()` no unmount.

**Validação:** `npm run build` + rodar `npm run dev`, publicar link ao vivo, adicionar jogador ao vivo após eliminação.

---

## S2 — Higiene do repositório + ESLint  ·  Haiku 4.5 · effort **low**  ·  sem pré-requisito
Arquivos: `.gitignore`, `package.json`, `eslint.config.js` (novo), `src/services/tournaments.ts`, `src/App.tsx`

- [x] 🟡 Apagar `vite.config.ts.timestamp-*.mjs` e adicionar `vite.config.ts.timestamp-*` ao `.gitignore`.
- [x] 🟡 Verificar integridade do `npm ci` — `node_modules/.bin/tsc` ausente; `npm run build` depende dele. **Resolvido:** `npm ci` limpo restaura `tsc` e `eslint`; `npm run build` passa. Fica o aviso `npm warn allow-scripts esbuild@0.21.5 (postinstall)` — o postinstall do esbuild não roda até `npm approve-scripts esbuild`. Não quebrou o build aqui (Windows, binário já presente), mas é a causa provável do `tsc` ausente antes.
- [x] 🟡 Instalar ESLint (`eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`) + script `lint`. Hoje há 5 `// eslint-disable-line` sem ESLint instalado — diretivas mortas. **Não fazer mass-fix**; só configurar e reportar.
- [ ] ~~🟡 Remover campos mortos `rebuy_value` / `addon_value` de `SaveTournamentInput`~~ — **achado incorreto, item cancelado.** Os dois campos estão vivos: alimentam `transactions.amount` das linhas de reentrada e add-on em `tournaments.ts:112` e `tournaments.ts:115`. Remover gravaria `amount: undefined` e quebraria `invested`/prize pool. O que não existe é coluna correspondente em `base_tournaments` — o valor entra no ledger, que é justamente o design.

**Validação:** `npm run lint` roda (exit 0); `npm run build` passa. ✅

### Relatório do lint (28 warnings, 0 errors)

Config em `eslint.config.js` (flat config, ESLint 10). As 5 diretivas `eslint-disable` do código estão vivas — nenhuma reportada como não usada.

| Regra | Ocorrências | Onde | Leitura |
|---|---|---|---|
| `react-hooks/refs` | 21 | `App.tsx:126-135,219`, `useTournamentEngine.ts:96` | refs lidas durante o render — é o **estado espelhado da S8** |
| `react-hooks/set-state-in-effect` | 4 | `App.tsx:265,277`, `StatsPanel.tsx:42`, `WatchView.tsx:36` | `setState` dentro de effect |
| `react-hooks/purity` | 1 | `useTournamentEngine.ts:52` | `Date.now()` em `useRef` inicial (render impuro) |
| `react-hooks/exhaustive-deps` | 1 | `useTournamentEngine.ts:82` | falta `niveis` no `useMemo` |
| `@typescript-eslint/no-explicit-any` | 1 | `Clock.tsx:25` | `(window as any).webkitAudioContext` — escape de prefixo de fornecedor, aceitável |

`purity`, `refs` e `set-state-in-effect` são regras novas do React Compiler (`eslint-plugin-react-hooks` v7) e ficaram em `warn` no config: apontam exatamente o motor do relógio que a **S8** vai refatorar. Deixá-las em `error` travaria `npm run lint` em vermelho permanente. Reavaliar para `error` depois da S8.

---

## S3 — Denominação de fichas + testes  ·  Sonnet 5 · effort **medium**  ·  depende de S2
Arquivos: `src/utils/poker-math.ts`, `vitest.config.ts` (novo), `src/utils/__tests__/` (novo)

- [x] 🔴 **`500` não é ficha existente** — `poker-math.ts:80`. **Resolvido:** o Rod confirmou que a maleta re-denomina fichas em jogo — a ficha "1" vale 1000 desde o início e a ficha "5", quando some do jogo pelo color-up, passa a valer 500. Logo `chip: 500` é intencional. Fix aplicado: `CHIP_DENOMINATIONS = [5, 25, 50, 100, 500, 1000]` + comentário explicando a re-denominação (`poker-math.ts:4-6` e `:75-77`).
- [x] 🟡 Vitest + testes de `poker-math.ts` — `vitest.config.ts` (novo), `src/utils/__tests__/poker-math.test.ts` (novo), script `test: vitest run`. 23 testes: `minChipForBB`/color-up, `quantizeBlind` (múltiplo de 2×minChip, SB inteiro), monotonicidade de `calcularCurvaBlinds` (inclui params degenerados), `inserirNivelContinuando` (renumera, +1 nível, preserva cauda), `buildSchedule` (ante por late check-in, ante explícito com prioridade, intervalos, `is_late_checkin`).

> Ordem obrigatória: decidir a ficha **antes** dos testes, senão os testes travam a escada errada.
> Os testes são a rede de segurança da S8.

**Validação:** `npm test` verde (23/23). `npm run build` e `npm run lint` sem regressão (28 warnings, 0 errors).

### Notas da S3

- `inserirNivelContinuando` **não** garante o BB final exato: em blinds altos (minChip 500) a
  quantização pode arredondar o alvo um `bandStep` para cima. Comportamento aceito; o teste
  cobre o intervalo `[finalBB, finalBB + bandStep]`. Reavaliar na S8 se a cauda precisa fechar exata.
- `vitest@^2.1.9` (peer do `vite@5`; a 3.x exige vite 6+). Persiste o aviso de postinstall do
  `esbuild` já documentado na S2.
- **Próximo:** S4 (migrações de banco) — **Opus 5**, effort high. Exige aviso ao responsável antes
  de aplicar SQL. Depende de S1 (feito). Alternativamente S8 (Opus 5, effort max) já está liberada
  (depende de S3 + S1, ambos feitos).

---

## S4 — Migrações de banco  ·  Opus 5 · effort **high**  ·  depende de S1
Arquivos: `supabase/migrations/0006_*.sql` … `0009_*.sql`

> ⚠️ Exige aviso ao responsável antes de aplicar (AGENTS.md). Agrupado numa autorização só.

- [ ] 🟠 **Definir o modelo de acesso primeiro** — `0003_rls_fix.sql`. Hoje `authenticated_all using(true)`: todo usuário logado lê/edita/apaga tudo. Decidir: **(a)** dono único → confirmar *Authentication → Providers → Allow new users to sign up = OFF*; **(b)** multi-tenant → `owner_id uuid default auth.uid()` em todas as tabelas + policies por dono.
- [ ] 🟠 **`live_state` sem dono** — `0005_live_state.sql:26`. Qualquer autenticado sobrescreve/apaga qualquer transmissão. Fix: `owner_id` + policy de write por dono; leitura pública permanece. *(decorre da decisão acima)*
- [ ] 🔴 **Nome de jogador duplicado quebra o save** — `tournaments.ts:44`. `.maybeSingle()` lança com 2 linhas e não há unique. Fix: `create unique index on sub_players (lower(display_name))`.
- [ ] 🟡 Colunas mortas: `sub_players.total_winnings` e `total_points` (migração 0004) nunca são escritas — ranking é derivado. Dropar ou documentar como obsoletas.

**Validação:** migrações idempotentes; smoke test de login + salvar torneio.

---

## S5 — App consome as migrações  ·  Haiku 4.5 · effort **low**  ·  depende de S4
Arquivos: `src/services/tournaments.ts`, `src/App.tsx`, `src/components/WatchView.tsx`

- [ ] 🔴 `upsertPlayer` → `upsert(..., { onConflict: 'display_name' })` em vez de select+insert.
- [ ] 🟠 **Transmissão não encerra de fato** — `App.tsx:272`. `pararTransmissao` só limpa o id local; a linha em `live_state` fica pública para sempre e as linhas acumulam. Fix: `delete from live_state where id = ...` + limpeza por `updated_at`.
- [ ] 🟠 **QR PIX no link público** — `WatchView.tsx:107`. `/pix-qr.png` é asset estático, acessível direto na URL. **Perguntar ao Rod** se é intencional; se não, servir só autenticado.

---

## S6 — Persistência transacional (RPC)  ·  Opus 5 · effort **high**  ·  depende de S3 + S4
Arquivos: `supabase/migrations/0010_*.sql`, `src/services/tournaments.ts`

- [ ] 🔴 **`saveTournament` não é atômico** — `tournaments.ts:56`. 3 inserts sequenciais; falha no 3º deixa torneio + blinds órfãos e o ranking conta o torneio com 0 participantes. Fix: função Postgres única numa transação.
- [ ] 🟡 `updateTournamentResults` faz N+1 queries — 2 updates por jogador em loop sequencial. Fix: mesma RPC ou batch.

---

## S7 — Ranking escalável  ·  Sonnet 5 · effort **medium**  ·  depende de S6
Arquivos: `supabase/migrations/0011_*.sql`, `src/services/tournaments.ts`, `src/components/StatsPanel.tsx`

- [ ] 🔴 **`playerLeaderboard` trunca em 1000 linhas** — `tournaments.ts:229`. `select` sem paginação; limite padrão do Supabase corta o histórico silenciosamente. Também é O(n²) (`filter` dentro do loop). Fix: view/RPC agregando no Postgres.

---

## S8 — Refactor do motor do relógio  ·  Opus 5 · effort **max**  ·  depende de S3 (testes) + S1
Arquivos: `src/hooks/useTournamentEngine.ts`, `src/App.tsx`

- [ ] 🟡 **Estado espelhado** — o hook copia `initial` para `useState` e sincroniza via `update_curve` + `JSON.stringify(derivedParams)` como signature (`App.tsx:172`). Params derivados deveriam ser props puros, sem `setParams`.
- [ ] 🟡 **Editar estrutura com relógio rodando** — `App.tsx:246`. `deleteLevel`/`addLevelAfter` mudam `items` com o elapsed fixo → o nível atual pula sem aviso. Fix: reancorar preservando o nível corrente, ou confirmar com o usuário.
- [ ] 🟡 **Reviver jogador não corrige colocações** — `App.tsx:294`. Des-eliminar deixa as colocações dos outros defasadas.

**Validação:** testes da S3 verdes + torneio simulado ponta a ponta.

---

## Grafo de dependências

```
S1 ──┬──────────────► S4 ──► S5
     │                 │
S2 ──► S3 ─────────────┴──► S6 ──► S7
        │
        └──────────► S8 (também depende de S1)
```

S1 e S2 são independentes — podem ser feitas em qualquer ordem.
