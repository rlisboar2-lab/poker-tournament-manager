# Auditoria — backlog em sessões

Plano fatiado para execução **uma sessão por bloco**. Cada sessão lê só os arquivos do seu bloco.
Ao final de cada sessão: marcar `[x]`, commitar, e informar o modelo da próxima.

Legenda: 🔴 bug · 🟠 segurança · 🟡 qualidade

**Feitas:** S1 · S2 · S3 · S4 · S5  ·  **Pendentes:** S6 · S7 · S8

> **Renumeração (10/09/2026):** o refactor do motor do relógio foi executado logo depois da S3 e
> passou a ser a **S4**. As antigas S4–S7 desceram um número (S4→S5, S5→S6, S6→S7, S7→S8). A
> numeração agora acompanha a ordem real de execução. Nada quebrou com isso: o refactor do relógio
> é folha no grafo — depende de S1 + S3 e nenhum outro bloco depende dele.

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
| `react-hooks/refs` | 21 | `App.tsx:126-135,219`, `useTournamentEngine.ts:96` | refs lidas durante o render — é o **estado espelhado da S4** |
| `react-hooks/set-state-in-effect` | 4 | `App.tsx:265,277`, `StatsPanel.tsx:42`, `WatchView.tsx:36` | `setState` dentro de effect |
| `react-hooks/purity` | 1 | `useTournamentEngine.ts:52` | `Date.now()` em `useRef` inicial (render impuro) |
| `react-hooks/exhaustive-deps` | 1 | `useTournamentEngine.ts:82` | falta `niveis` no `useMemo` |
| `@typescript-eslint/no-explicit-any` | 1 | `Clock.tsx:25` | `(window as any).webkitAudioContext` — escape de prefixo de fornecedor, aceitável |

`purity`, `refs` e `set-state-in-effect` são regras novas do React Compiler (`eslint-plugin-react-hooks` v7) e ficaram em `warn` no config: apontam exatamente o motor do relógio que a **S4** vai refatorar. Deixá-las em `error` travaria `npm run lint` em vermelho permanente. Reavaliar para `error` depois da S4.

---

## S3 — Denominação de fichas + testes  ·  Sonnet 5 · effort **medium**  ·  depende de S2
Arquivos: `src/utils/poker-math.ts`, `vitest.config.ts` (novo), `src/utils/__tests__/` (novo)

- [x] 🔴 **`500` não é ficha existente** — `poker-math.ts:80`. **Resolvido:** o Rod confirmou que a maleta re-denomina fichas em jogo — a ficha "1" vale 1000 desde o início e a ficha "5", quando some do jogo pelo color-up, passa a valer 500. Logo `chip: 500` é intencional. Fix aplicado: `CHIP_DENOMINATIONS = [5, 25, 50, 100, 500, 1000]` + comentário explicando a re-denominação (`poker-math.ts:4-6` e `:75-77`).
- [x] 🟡 Vitest + testes de `poker-math.ts` — `vitest.config.ts` (novo), `src/utils/__tests__/poker-math.test.ts` (novo), script `test: vitest run`. 23 testes: `minChipForBB`/color-up, `quantizeBlind` (múltiplo de 2×minChip, SB inteiro), monotonicidade de `calcularCurvaBlinds` (inclui params degenerados), `inserirNivelContinuando` (renumera, +1 nível, preserva cauda), `buildSchedule` (ante por late check-in, ante explícito com prioridade, intervalos, `is_late_checkin`).

> Ordem obrigatória: decidir a ficha **antes** dos testes, senão os testes travam a escada errada.
> Os testes são a rede de segurança da S4.

**Validação:** `npm test` verde (23/23). `npm run build` e `npm run lint` sem regressão (28 warnings, 0 errors).

### Notas da S3

- `inserirNivelContinuando` **não** garante o BB final exato: em blinds altos (minChip 500) a
  quantização pode arredondar o alvo um `bandStep` para cima. Comportamento aceito; o teste
  cobre o intervalo `[finalBB, finalBB + bandStep]`. Reavaliar na S4 se a cauda precisa fechar exata.
- `vitest@^2.1.9` (peer do `vite@5`; a 3.x exige vite 6+). Persiste o aviso de postinstall do
  `esbuild` já documentado na S2.
- **Próximo:** S4 (refactor do motor do relógio) — **Opus 5**, effort max. Liberada: depende de
  S3 + S1, ambos feitos. Depois dela, S5 (migrações de banco), que exige aviso ao responsável
  antes de aplicar SQL.

---

## S4 — Refactor do motor do relógio  ·  Opus 5 · effort **max**  ·  depende de S3 (testes) + S1
Arquivos: `src/hooks/useTournamentEngine.ts`, `src/App.tsx`, `src/utils/placements.ts` (novo),
`src/utils/__tests__/placements.test.ts` (novo), `src/hooks/__tests__/findPosition.test.ts` (novo)

- [x] 🟡 **Estado espelhado** — **Resolvido.** `useTournamentEngine(params)` recebe os parâmetros como prop pura: sumiram o `useState<EngineParams>`, o `update_curve` e o effect de sincronia com `JSON.stringify(derivedParams)`. A âncora do relógio virou estado (`ClockSnapshot`) em vez de refs lidos no render, e `snapshot` passou de callback a valor. Com `items`/`curve`/`snapshot` de identidade estável entre ticks, o effect da transmissão ao vivo usa deps reais (sem a assinatura por `JSON.stringify` a cada 250ms) e o autosave lê o estado por um ref atualizado em effect, com o intervalo montado uma única vez.
- [x] 🟡 **Editar estrutura com relógio rodando** — **Resolvido.** O engine guarda a posição lógica (item + segundos corridos) num effect e reancora quando `items` troca: `findPosition` reencontra o item pelos blinds (imunes à renumeração do `deleteLevel`) e cai para o número do nível quando os blinds mudam. Apagar justamente o nível em jogo é a única exceção — aí o `App` pede confirmação antes.
- [x] 🟡 **Reviver jogador não corrige colocações** — **Resolvido.** Lógica extraída para `src/utils/placements.ts`: cada eliminação/revivida renumera a lista inteira a partir da ordem de eliminação, em bloco contíguo terminando no total de participantes. Antes, reviver quem caiu antes dos outros deixava as colocações deles defasadas.

**Validação:** `npm test` 41/41 verde (23 de `poker-math` + 11 de `placements` + 7 de `findPosition`),
`npm run build` passa, `npm run lint` de 28 → **6 warnings, 0 errors**.
Torneio simulado no `npm run dev` (5 jogadores):

| Cenário | Resultado |
|---|---|
| Avançar nível ×2 com relógio rodando | 2 → 3 → 4, cada um em 20:00 |
| Apagar nível anterior ao corrente | nível corrente mantém blinds e tempo (100/200 · 19:03), só renumera |
| `+ Intervalo após nível atual` | nível corrente não se move |
| Inserir nível antes do corrente | nível corrente não se move |
| Eliminar Ana, Bruno, Carla | 5º, 4º, 3º |
| Reviver Bruno (do meio) | Carla 3º → 4º, Ana segue 5º |
| Reabrir o app | relógio retomado no ponto certo, sem erro no console |
| Autosave | grava a cada 2002ms (não 4×/s) |

### Notas da S4

- Regressão encontrada e corrigida no próprio refactor: sem avançar o `now` do render junto com a
  âncora, "Avançar nível" caía até 250ms antes do alvo e parava no fim do nível anterior. O helper
  `commit(t, fn)` move os dois no mesmo instante.
- Os 22 warnings de `react-hooks/refs` + `purity` + `exhaustive-deps` sumiram; o motor do relógio
  está limpo. Restam 6: 5 `set-state-in-effect` (`App.tsx` restore/assentos/prêmios,
  `StatsPanel.tsx:42`, `WatchView.tsx:36`) e 1 `no-explicit-any` (`Clock.tsx:25`, prefixo de
  fornecedor). Promover as regras do React Compiler a `error` agora exigiria tratar esses 5.
- Ticker só existe enquanto o relógio roda: pausado/parado não re-renderiza mais a 4×/s.
- **Próximo:** S5 (migrações de banco) — **Opus 5**, effort high. Bloqueado por decisão do Rod:
  modelo de acesso **(a)** dono único ou **(b)** multi-tenant com `owner_id`. Exige aviso e
  autorização antes de aplicar SQL (AGENTS.md).

---

## S5 — Migrações de banco  ·  Opus 5 · effort **high**  ·  depende de S1
Arquivos: `supabase/migrations/0006_player_name_unique.sql`, `supabase/migrations/0007_schema_notes.sql`, `HANDOFF.md`

> ⚠️ Exigia aviso ao responsável antes de aplicar (AGENTS.md). O SQL foi escrito aqui e **aplicado
> pelo Rod** no Supabase → SQL Editor em 10/09/2026, junto com os passos de painel (signup OFF, uma
> conta só). Nada foi executado pelo agente — sem `psql`/`docker` na máquina.

- [x] 🟠 **Definir o modelo de acesso primeiro** — **Decidido: (a) dono único.** O Rod usa o app sozinho
  (`lisboa@prospectus.lat`). As policies `authenticated_all using(true)` de 0002/0003 ficam como estão,
  sem `owner_id`. A garantia sai do banco e vai pro painel: *Allow new users to sign up = OFF* +
  só a conta dele em Authentication → Users. Registrado em `comment on table` (0007) e no HANDOFF §7.
- [x] 🟠 **`live_state` sem dono** — **Risco aceito, sem mudança de schema.** Decorre de (a): com uma
  conta só, "qualquer autenticado sobrescreve qualquer transmissão" não tem superfície. Documentado no
  `comment on table live_state` (0007). Se entrar um segundo usuário, isto volta junto com o `owner_id`.
- [x] 🔴 **Nome de jogador duplicado quebra o save** — `0006`. Coluna gerada
  `display_name_norm = lower(btrim(display_name))` + `unique index sub_players_display_name_norm_uidx`.
  Normaliza caixa e espaços, então "Ana", "ana" e " Ana " viram o mesmo jogador. A migração tem
  pré-checagem: se já houver duplicatas, ela aborta listando os nomes e traz o SQL de merge comentado
  (reponta `transactions.player_id` para a linha mais antiga antes de apagar as outras).
- [x] 🟡 Colunas mortas `total_winnings` / `total_points` — **documentadas, não dropadas** (decisão do
  Rod): `comment on column ... 'OBSOLETA (S5)'` em `0007`.

**Validação:** `npm run build` passa, `npm test` 41/41, `npm run lint` 6 warnings / 0 errors — sem
regressão em relação à S4 (nenhum arquivo de `src/` foi tocado). SQL **não executado**: smoke test de
login + salvar torneio fica com o Rod, depois de rodar as migrações.

### Notas da S5

- **Aplicadas em 10/09/2026** na ordem `0005` → `0006` → `0007`, pelo Rod. A `0007` é tolerante:
  comenta `live_state` e `total_points` só se existirem, porque a `0004` nunca rodou.
- **Painel do Supabase feito junto:** *Allow new users to sign up* = OFF e só `lisboa@prospectus.lat`
  em Authentication → Users. É isso que sustenta o modelo de dono único — se cair, o `using(true)`
  vira acesso total pra qualquer conta nova.
- **Sem `owner_id` em lugar nenhum.** A separação por dono não existe no banco — a segurança do app
  hoje é "existe uma conta só". Virar multi-tenant depois custa: `owner_id uuid default auth.uid()` nas
  5 tabelas, backfill das linhas existentes com o UUID do Rod, policies por dono, e o unique da `0006`
  passa a ser `(owner_id, display_name_norm)`.
- **Apagar os outros usuários do Supabase é manual** — nenhuma migração faz isso, e o agente não tem
  acesso ao painel. Está no checklist do HANDOFF §7.
- **Efeito colateral até a S6:** com o unique no ar, digitar "ana" existindo "Ana" passa a dar erro de
  unique na hora do save, em vez de criar uma linha duplicada em silêncio (que quebrava o save
  *seguinte*). Falha barulhenta em vez de corrupção silenciosa — e some quando a S6 trocar o
  select+insert por `upsert`.
- **Próximo:** S6 (app consome as migrações) — **Haiku 4.5**, effort low. **Desbloqueada:** a `0006`
  já está no banco, então o `onConflict: 'display_name_norm'` tem índice pra inferir.

---

## S6 — App consome as migrações  ·  Haiku 4.5 · effort **low**  ·  depende de S5 ✅ (migrações aplicadas em 10/09/2026)
Arquivos: `src/services/tournaments.ts`, `src/App.tsx`, `src/components/WatchView.tsx`

- [ ] 🔴 `upsertPlayer` → `upsert(..., { onConflict: 'display_name_norm' })` em vez de select+insert.
  **Atenção:** o alvo é `display_name_norm` (coluna gerada da `0006`), não `display_name` — o unique
  está sobre a normalizada. Como é coluna gerada, o insert não a envia; o `ON CONFLICT` só a infere.
  Confirmar no dev que o PostgREST aceita o alvo antes de fechar o bloco.
- [ ] 🟠 **Transmissão não encerra de fato** — `App.tsx:344`. `pararTransmissao` só limpa o id local; a linha em `live_state` fica pública para sempre e as linhas acumulam. Fix: `delete from live_state where id = ...` + limpeza por `updated_at`.
- [ ] 🟠 **QR PIX no link público** — `WatchView.tsx:109`. `/pix-qr.png` é asset estático, acessível direto na URL. **Perguntar ao Rod** se é intencional; se não, servir só autenticado.

---

## S7 — Persistência transacional (RPC)  ·  Opus 5 · effort **high**  ·  depende de S3 + S5
Arquivos: `supabase/migrations/0010_*.sql`, `src/services/tournaments.ts`

- [ ] 🔴 **`saveTournament` não é atômico** — `tournaments.ts:58`. 3 inserts sequenciais; falha no 3º deixa torneio + blinds órfãos e o ranking conta o torneio com 0 participantes. Fix: função Postgres única numa transação.
- [ ] 🟡 `updateTournamentResults` faz N+1 queries — 2 updates por jogador em loop sequencial. Fix: mesma RPC ou batch.

---

## S8 — Ranking escalável  ·  Sonnet 5 · effort **medium**  ·  depende de S7
Arquivos: `supabase/migrations/0011_*.sql`, `src/services/tournaments.ts`, `src/components/StatsPanel.tsx`

- [ ] 🔴 **`playerLeaderboard` trunca em 1000 linhas** — `tournaments.ts:243`. `select` sem paginação; limite padrão do Supabase corta o histórico silenciosamente. Também é O(n²) (`filter` dentro do loop). Fix: view/RPC agregando no Postgres.

---

## Grafo de dependências

```
S1 ──┬──────────────► S5 ──► S6
     │                 │
S2 ──► S3 ─────────────┴──► S7 ──► S8
        │
        └──────────► S4 (também depende de S1)
```

S1 e S2 são independentes — podem ser feitas em qualquer ordem.
S4 é folha: nenhum bloco depende dela.

Ordem restante: **S6 → S7 → S8**. S7 só precisa de S3 + S5, então pode vir antes da S6. As migrações
da S5 já estão aplicadas no banco, então as duas estão liberadas.
