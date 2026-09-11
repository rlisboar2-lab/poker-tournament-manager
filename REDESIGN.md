# Redesenho do fluxo — backlog em sessões

Plano fatiado para execução **uma sessão por bloco**. Cada sessão lê só os arquivos do seu bloco.
Ao final de cada sessão: marcar `[x]`, `npm run build`, commitar, e informar o modelo da próxima.

Continuação de `AUDITORIA.md` (S1–S8, concluídas). Numeração segue de S9.

**Feitas:** S9 · S10 · S11  ·  **Pendentes:** S12 · S13 · S14 · S15

---

## Princípio do redesenho

Torneio tem **início, meio e fim**. A navegação deixa de ser um stepper de 6 abas fixas e vira
**hub + assistente + console**:

```
HOME (hub)
 ├─ ▶ Retomar torneio            (condicional: autosave não finalizado)
 ├─ [pódio top 3 clicável]       → RANKING
 ├─ ● Criar torneio (primário)   → WIZARD 1 → 2 → 3 → LIVE
 ├─ Ranking completo             → RANKING
 └─ Torneios finalizados         → HISTÓRICO

WIZARD   1. Configuração base (+ bloco recolhível "Premiação")
         2. Selecionar jogadores iniciais
         3. QR PIX dos buy-ins → "✓ Todos pagaram"

LIVE     Relógio + barra fixa: [+ Jogador] [✗ Eliminar] [↻ Rebuy] [＋ Add-on]
         penúltimo eliminado → FIM

FIM      Campeão declarado → confirmar colocações e prêmios (líquido = prêmio − investido)
         → "Torneio finalizado": [Salvar] [Descartar] [Novo torneio]
```

### Decisões travadas (não reabrir sem informação nova)

- **Ante desacoplado do late check-in.** `late_checkin_level` default `auto = ceil(níveis/2)`;
  `ante_start_level` default `auto = ceil(níveis × 0,75)`. Com o default de 11 níveis,
  `ceil(11×0,75) = 9` — idêntico ao `late_checkin_level: 9` de hoje, então o tempo total de
  torneio **não muda**. Isso substitui a trava do `AGENTS.md` ("ante separado do late check-in não
  será configurável"): o acoplamento só era inofensivo porque o late-reg estava a 82% do torneio.
- **Pagamento sem ledger de pendência.** Tela 3 do wizard tem um botão único "✓ Todos pagaram".
  As ações ao vivo (adicionar/rebuy/add-on) confirmam uma a uma com "✓ Pago", e a transação só
  entra no `c_total` nesse clique. Não há status pago/pendente por jogador.
- **Editar torneio finalizado = só resultados.** Renomear, colocações, prêmios em R$, excluir.
  Sem adicionar/remover jogador de torneio salvo.
- **Zero migração de banco em todo o redesenho.** Nenhuma sessão abaixo mexe em
  `supabase/migrations/`.

---

## S9 — Motor puro: ratchet, color-up, níveis automáticos  ·  Sonnet 5 · effort **high**  ·  sem pré-requisito

Arquivos: `src/utils/poker-math.ts`, `src/App.tsx` (só tipos/config), `src/presets.ts`,
`src/utils/__tests__/poker-math.test.ts`

Bloco puro e testável. Não toca em componente nem no hook do relógio (isso é a S10).

### Contexto do bug que esta sessão fecha (metade 1 de 2)

`calcularCurvaBlinds()` (`poker-math.ts:155`) reconstrói a curva **inteira** a cada mudança de
`c_total` — inclusive os níveis já jogados. Com o default (8 entradas, stack 3000, 11 níveis):

```
antes  (24.000 fichas): 10 20 30 50 100 150 200 300 500  800 1400
depois (4 rebuys)     : 10 20 30 50 100 150 300 400 800 1200 2000
```

Corrigir um rebuy **para menos** faz o BB do nível corrente literalmente diminuir. E como a ficha
mínima é derivada do BB (`minChipForBB`), um BB menor pode voltar a exigir uma ficha que já saiu
fisicamente da mesa no color-up.

### Tarefas

- [x] 🔴 **Piso publicado (ratchet de blinds).** Nova assinatura:
      `recalibrarCurva(p: CurveParams, opts: { frozen?: BlindLevel[]; floor?: number[] }): CurveResult`.
      - `frozen` = níveis já jogados (inclusive o corrente): copiados intactos, nunca reprojetados.
      - A cauda é reprojetada como progressão geométrica a partir do último `frozen` até
        `alvo_big_blind` (mesma ideia de `inserirNivelContinuando`).
      - Invariante final por índice `i`:
        `bb[i] = max(bb_calculado[i], floor[i] ?? 0, bb[i-1] + bandStep(bb[i-1], chip))`.
      - Manter `calcularCurvaBlinds(p)` como wrapper sem `opts` (não quebrar testes S3).
- [x] 🔴 **Ratchet da ficha mínima.** `minChipForBB(bb, floorChip, ratchetChip?)` nunca devolve
      abaixo de `ratchetChip`. Ficha retirada do jogo não volta. `quantizeBlind`/`bandStep` recebem
      o mesmo parâmetro.
- [x] 🟡 **Pontos de color-up.** Novo `colorUpPoints(levels: BlindLevel[], chip: number)` →
      `{ nivel: number; retira: number; passa_a_usar: number }[]`, derivado de onde
      `minChipForBB` sobe entre níveis consecutivos.
- [x] 🟡 **Alinhar color-up a intervalo.** Novo `sugerirBreaksParaColorUp(levels, breaks)` →
      lista de `after_level` recomendados. Prática do setor: color-up no intervalo, nunca no meio
      do nível. A sessão só entrega a função + testes; o uso na UI é a S13.
- [x] 🟡 **Níveis automáticos.** `nivelAuto(totalLevels, frac) = Math.max(1, Math.ceil(totalLevels * frac))`.
      Em `AppConfig`: `late_checkin_level: number | 'auto'` e **novo** `ante_start_level: number | 'auto'`,
      ambos default `'auto'` (`0.5` e `0.75` respectivamente). Número literal = escolha manual do
      usuário, preservada. `late_checkin_level` já é resolvido em `App.tsx` (via `nivelAuto` +
      `qnt_niveis_projetados`) antes de ir pro motor; `ante_start_level` fica só no config nesta
      sessão — a fiação real dentro do motor ao vivo (`useTournamentEngine.ts`) é da S10.
- [x] 🔴 **`buildSchedule` usa `ante_start_level`**, não mais `late_checkin_level`
      (`poker-math.ts:262`). `is_late_checkin` continua amarrado ao `late_checkin_level`.
      `ScheduleParams` ganha `ante_start_level` — **opcional**, cai em `late_checkin_level` quando
      ausente (compat: o único chamador hoje, `useTournamentEngine.ts`, não muda nesta sessão e
      mantém o comportamento de hoje até a S10 threadar o valor de verdade).
- [x] 🟡 **Preset Quadra intacto.** `presets.ts` mantém `late_checkin_level: 10` literal; o ante da
      Quadra é explícito por nível (`BlindLevel.ante`), então `ante_start_level` não o afeta.
      Adicionado `ante_start_level: 10` literal por clareza.
- [x] 🟡 **Compatibilidade do autosave.** `SavedState` antigo tem `late_checkin_level: number`.
      Número continua válido (= manual). Não bump de `SAVE_KEY`.

### Testes (vitest)

- ratchet: recalibrar com `c_total` menor nunca produz BB abaixo de `floor`.
- ratchet: nível em `frozen` sai byte-idêntico da recalibração.
- color-up monótono: nenhuma sequência de níveis exige ficha menor que uma já retirada.
- `colorUpPoints` acha as 4 fronteiras da escada de `COLORUP`.
- `nivelAuto(11, 0.75) === 9` e `nivelAuto(11, 0.5) === 6`.
- ante: com `ante_start_level: 'auto'` e 11 níveis, a agenda é idêntica à de hoje com
  `late_checkin_level: 9`.

**Validação:** `npm run lint` + `npm run build` + `npx vitest run`.
**Próxima:** S10 · **Opus 5** · effort high.

---

## S10 — Motor vivo: reancoragem que nunca retrocede  ·  **Opus 5** · effort **high**  ·  depende de S9

Arquivos: `src/hooks/useTournamentEngine.ts`, `src/App.tsx`,
`src/hooks/__tests__/findPosition.test.ts`

Sessão **curta e cirúrgica**, em Opus porque é onde o bug nasceu e onde um erro corrompe torneio ao
vivo em silêncio.

### Contexto do bug que esta sessão fecha (metade 2 de 2)

`findPosition()` (`useTournamentEngine.ts:71`) casa a posição pelo par `"sb/bb"`. Quando a curva
sobe, o par que era o nível 8 passa a ocupar o nível 7 — a string casa no índice **anterior**, e
`useTournamentEngine.ts:288` chama `setElapsedMs()` para trás. O relógio volta um nível.

O casamento por blinds existe por um motivo legítimo: sobreviver à **renumeração** feita por
`deleteLevel` (S1). Não pode ser simplesmente removido — precisa distinguir a origem da mudança.

### Tarefas

- [x] 🔴 **`findPosition(items, pos, minIndex?)`.** Com `minIndex` definido, nunca retorna índice
      menor. Passar `minIndex = state.item_index` quando a mudança veio de **recalibração**;
      deixar indefinido quando veio de **edição manual** (`override_levels` mudou).
- [x] 🔴 **Distinguir a origem.** No effect de reancoragem (`:279`), comparar
      `params.override_levels` por identidade contra a do commit anterior (ref). Mudou →
      edição manual. Não mudou mas `items` mudou → recalibração.
- [x] 🔴 **Passado congelado.** O hook expõe `frozenLevels`: os níveis de índice `<=` o nível
      corrente, materializados. `App.tsx` passa isso de volta em `recalibrarCurva({ frozen })`.
      Guardar em estado do App (não em ref lido no render — ver warnings `react-hooks/refs` do lint).
- [x] 🔴 **Piso persistido.** `SavedState` ganha `publishedFloor?: number[]`. A cada recalibração
      `floor[i] = max(floor[i] ?? 0, bb_novo[i])`. Sobrevive a fechar/reabrir o app.
- [x] 🟡 **Aviso na UI.** Quando uma recalibração for barrada pelo piso, mostrar no `notice` do
      topo: `estrutura recalibrada (piso mantido)`. Sem `alert`.

### Testes

- `findPosition` com `minIndex` nunca retrocede, mesmo com blinds duplicados.
- `findPosition` sem `minIndex` continua achando o item renumerado (regressão da S1).
- cenário do bug ponta a ponta: nível 8 = 150/300, +4 rebuys, o relógio continua no nível 8.

### Como ficou (10/09/2026)

- `EngineParams` ganhou `ante_start_level`, `frozen_levels` e `published_floor`; o motor troca
  `calcularCurvaBlinds` por `recalibrarCurva(params, { frozen, floor })` e passa `ante_start_level`
  para `buildSchedule` — a fiação do ante que a S9 deixou pendente.
- `findPosition(items, pos, minIndex?)`: `minIndex` é piso da busca. O `lastLevel` continua sendo
  rastreado abaixo do piso (senão o intervalo perderia o nível que o precede).
- A origem da mudança sai da identidade de `params.override_levels` guardada em ref: trocou →
  edição manual (sem piso, pode recuar); só `items` mudou → recalibração (piso = `state.item_index`).
- `frozenLevels` é exposto pelo motor, guardado em estado no `App` e devolvido em `frozen_levels`.
  A comparação por conteúdo (`sameLevels`) corta o laço de realimentação.
- Piso: efeito no `App` acumula `floor[i] = max(floor[i], bb[i])` **só com o relógio fora de
  `idle`**; voltar para `idle` (novo torneio/preset) descarta o piso. Persistido em
  `SavedState.publishedFloor`, sem bump de `SAVE_KEY`.
- `floorHeld` compara a curva com piso contra a mesma curva sem piso; some quando há estrutura
  editada à mão, em que a curva calculada não vai para a tela.
- Lint: os dois efeitos novos acrescentam 2 avisos `react-hooks/set-state-in-effect` (6 → 8, 0
  erros), mesma categoria dos que o `App.tsx` já tinha. É o custo do estado pedido no plano
  ("guardar em estado do App, não em ref lido no render").

**Validação:** `npm run lint` (0 erros) + `npm run build` + `npx vitest run` (60 testes) +
`npm run dev` percorrido no navegador: 8 entradas, 11 níveis, relógio rodando no nível 8
(200/400); +4 rebuys → continua no nível 8 com 200/400 e só a cauda sobe (9: 250/500 → 400/800);
removendo os 4 rebuys a estrutura não desce e o topo mostra `estrutura recalibrada (piso mantido)`;
apagar um nível anterior (edição manual) ainda move o relógio junto com os blinds.
**Próxima:** S11 · Sonnet 5 · effort high.

---

## S11 — Home hub + roteador de telas  ·  Sonnet 5 · effort **high**  ·  sem pré-requisito · **feita 11/09/2026**

Arquivos: `src/App.tsx` (refactor estrutural), `src/screens/Home.tsx` (novo), `src/index.css`

- [x] 🟡 **Máquina de telas.** Substituir `Stage` (6 abas) por
      `type Screen = 'home' | 'setup' | 'players' | 'buyin' | 'live' | 'finish' | 'ranking' | 'historico'`.
      `SavedState.stage` → `screen`, tolerando o valor antigo na leitura (mapear `setup`→`setup`,
      `players`→`players`, `payouts`→`setup`, `live`→`live`, `results`→`finish`, `stats`→`historico`).
- [x] 🟡 **`Home.tsx`.** De cima para baixo:
      1. `▶ Retomar torneio` — **condicional**: só se o autosave tem torneio iniciado e não
         finalizado. Mostra nome, nível e nº na mesa. É a proteção contra perder torneio em
         andamento; tem que ser o primeiro elemento quando existe.
      2. Bloco pódio: top 3 do `playerLeaderboard()`, clicável → `ranking`.
      3. `● Criar torneio` — botão primário grande.
      4. `Ranking completo` e `Torneios finalizados` — secundários.
- [x] 🟡 **Cabeçalho.** Fora da home, um botão `← Início` no topo. Personalizar/Sair continuam.
      Remover a `nav-row` de Voltar/Avançar da home, ranking e histórico (elas não são etapas).
- [x] 🟡 **`novoTorneio()`** passa a voltar para `home`, não para `setup`.

### Como ficou (11/09/2026)

- `Screen` substitui `Stage`; a sequência navegada por Voltar/Avançar (`FLOW`) é
  `['setup', 'players', 'live', 'finish']` — `payouts` como etapa própria acabou (dobrada dentro de
  `setup`, renderizando `PayoutsPanel` logo abaixo do `SetupPanel`; vira bloco recolhível de verdade
  só na S12). `results`→`finish` e `stats`→`historico` são só troca de nome por enquanto: mesmos
  `ResultsPanel`/`StatsPanel`, sem tocar nesses arquivos (fora do escopo desta sessão).
- `ranking` e `historico` apontam **os dois** para `StatsPanel` (mesmo componente) — não existe
  `Ranking.tsx`/`Historico.tsx` ainda (isso é S14, que também aposenta o `StatsPanel`). A home já
  entrega o pódio embutido via `playerLeaderboard()`; o clique nele ou em "Ranking completo" só
  precisa cair em algum lugar não-vazio até lá.
- `buyin` existe no tipo `Screen` (contrato da S12) mas nada navega pra ele ainda — sem conteúdo,
  de propósito.
- Reabrir o app com torneio ao vivo (`clock.status` `running`/`paused` no autosave) força a tela
  inicial para `home` mesmo que o `screen`/`stage` salvo fosse outro — é o comportamento validado
  (home oferece Retomar; só o clique leva pro relógio). Sem torneio ao vivo, a tela salva (nova ou
  mapeada da antiga) é respeitada normalmente.
- `criarTorneio()` (botão da home) só confirma e apaga dados se houver relógio `running`/`paused`;
  caso contrário só navega pra `setup` sem mexer no que já estava configurado. `novoTorneio()`
  (cabeçalho) continua sempre confirmando, e agora devolve pra `home` em vez de `setup`.
- Testado em `npm run dev`: autosave de uma sessão anterior (torneio no nível 8/10, 8 na mesa) —
  reabrir mostrou a home com "Retomar torneio · Home Game · nível 8/10 · 8 na mesa"; clicar caiu no
  relógio exatamente nesse nível; `← Início` voltou pra home mantendo o Retomar (relógio seguiu
  rodando); `Ranking completo`/`Torneios finalizados` abriram o `StatsPanel` sem nav-row. Sem
  Supabase configurado neste ambiente — pódio (que depende de `playerLeaderboard()`) não pôde ser
  testado visualmente; só a ausência de erro quando a lista vem vazia.
- Lint: mesmo baseline da S10 (0 erros, 8 avisos `react-hooks/set-state-in-effect` pré-existentes,
  nenhum novo).

**Validação:** `npm run build` + `npm run dev`: fechar o app com torneio ao vivo, reabrir, confirmar
que a home oferece Retomar e que retomar cai no relógio no mesmo nível.
**Próxima:** S12 · Sonnet 5 · effort medium.

---

## S12 — Wizard de criação (3 telas) + cobrança PIX  ·  Sonnet 5 · effort **medium**  ·  depende de S11

Arquivos: `src/components/SetupPanel.tsx`, `src/components/PlayersPanel.tsx`,
`src/components/CobrancaPix.tsx` (novo), `src/screens/BuyIn.tsx` (novo),
`src/components/PayoutsPanel.tsx`, `src/App.tsx`

- [ ] 🟡 **Tela 1 — configuração base.** `SetupPanel` como está, **mais** um bloco recolhível
      "Premiação" que embute o `PayoutsPanel` (percentuais + "Sugerir por nº de jogadores").
      A etapa `payouts` deixa de existir como tela; os valores em R$ são confirmados no fim.
- [ ] 🟡 **Tela 2 — selecionar jogadores.** `PlayersPanel` em `mode="setup"`, com os chips de
      cadastrados que já existem. Sem steppers de rebuy/add-on aqui (rebuy no início não faz
      sentido); só nome e buy-ins.
- [ ] 🟡 **Tela 3 — buy-ins.** `BuyIn.tsx`: QR grande (`public/pix-qr.png`), lista dos
      selecionados, total calculado (`N × buy_in_value`), e botão único
      `✓ Todos pagaram — iniciar torneio` → vai para `live`.
- [ ] 🟡 **`CobrancaPix.tsx` reutilizável.** Props:
      `{ tipo: 'buyin'|'rebuy'|'addon'; jogador: string; valor: number; onPago(): void; onCancelar(): void }`.
      Mostra quem, o quê, quanto, o QR, e `✓ Pago (PIX ou dinheiro)`.
      **A transação só é aplicada no `onPago`** — senão um rebuy selecionado e não pago já
      recalibraria os blinds por dinheiro que não entrou. Usado pela S13.
- [ ] 🟡 **Navegação do wizard.** Voltar/Avançar só dentro das 3 telas. Avançar da 3 = iniciar.

**Validação:** `npm run build` + `npm run dev`: criar torneio do zero pelas 3 telas.
**Próxima:** S13 · Sonnet 5 · effort high.

---

## S13 — Console ao vivo + fim do torneio  ·  Sonnet 5 · effort **high**  ·  depende de S12

Arquivos: `src/components/Clock.tsx`, `src/components/LiveActions.tsx` (novo),
`src/screens/Finish.tsx` (novo), `src/utils/placements.ts`, `src/App.tsx`, `src/index.css`

### Console ao vivo

- [ ] 🟡 **Barra fixa de 4 ações** (`LiveActions.tsx`), no rodapé, alcance de polegar no celular:
      `[+ Jogador] [✗ Eliminar] [↻ Rebuy] [＋ Add-on]`. Mantém os controles atuais do relógio.
- [ ] 🟡 **Eliminar = ação mais rápida do app.** Lista de ativos ordenada por mesa/assento, um
      toque elimina. **Sem `confirm()`** — em vez disso, toast `João eliminado em 7º · desfazer`
      por 5s. Confirm em ação frequente atrasa o floor; undo é melhor.
- [ ] 🟡 **Adicionar / Rebuy / Add-on** passam por `CobrancaPix`; commit só no "Pago".
- [ ] 🔴 **Regras que o app não impõe hoje:** rebuy/reentrada **bloqueada** depois que o late
      check-in fecha (`state.level_number > late_checkin_level` resolvido); botão de rebuy
      respeita `max_rebuys`; add-on só se `addon_enabled`.
- [ ] 🟡 **KPIs no relógio:** `Pote: R$ X · N na mesa · Stack médio · Pressão BB`. Hoje o pote só
      aparece na tela de premiação.
- [ ] 🟡 **Color-up no cronograma.** Na tabela de níveis do `Clock.tsx`, marcar os níveis de
      `colorUpPoints()` (S9) com `🎨 retirar ficha de N`. Se o color-up não cai em intervalo,
      oferecer `+ intervalo aqui` usando `sugerirBreaksParaColorUp()`.

### Fim do torneio

- [ ] 🟡 **Gatilho do penúltimo.** Quando `applyElimination` deixar 1 ativo, o relógio **pausa**
      (nunca reseta) e abre `Finish.tsx` com o campeão declarado — `renumberPlacements` já resolve
      o 1º lugar (`placements.ts:196`).
- [ ] 🔴 **Guarda obrigatória.** `Finish.tsx` é não-destrutiva e reversível: botão
      `↩ Não acabou` revive o jogador e volta ao relógio. Toque errado não pode encerrar torneio.
- [ ] 🟡 **Confirmar colocações e prêmios.** Tabela por jogador: colocação editável, prêmio em R$
      editável, **investido**, e **líquido = prêmio − investido** (a lógica já existe em
      `ResultsPanel.tsx:236`; migrar e aposentar o painel).
- [ ] 🟡 **Tela "Torneio finalizado":** `[💾 Salvar torneio] [🗑 Descartar resultados] [＋ Novo torneio]`.
      Salvar **idempotente** (toque duplo não grava dois torneios — travar por flag de id salvo).
      Descartar pede `confirm()`.

**Validação:** `npm run build` + `npm run dev`: rodar um torneio de 3 jogadores ponta a ponta,
incluindo rebuy, add-on, entrada tardia, eliminar até o penúltimo, desfazer, eliminar de novo,
salvar.
**Próxima:** S14 · Sonnet 5 · effort high.

---

## S14 — Ranking em pódio + torneios finalizados  ·  Sonnet 5 · effort **high**  ·  depende de S11

Arquivos: `src/screens/Ranking.tsx` (novo), `src/screens/Historico.tsx` (novo),
`src/components/StatsPanel.tsx` (aposentar), `src/index.css`

- [ ] 🟡 **`Ranking.tsx` em 3 camadas** (padrão de leaderboard: pódio + destaque + tabela):
      1. **Pódio 1º/2º/3º** — alta importância: cards grandes, ouro/prata/bronze, nome, pontos,
         líquido. 1º ao centro e maior.
      2. **4º ao 9º** — média importância: linhas compactas com nome, pontos e líquido.
         É a "força dos 9 primeiros".
      3. **Tabela geral** — todos, com as colunas que já existem: pontos, eventos, investido,
         ganhos, líquido, ROI (`StatsPanel.tsx:133`).
      Dados: `playerLeaderboard()` sem mudança de serviço.
- [ ] 🟡 **`Historico.tsx`.** Lista de torneios salvos como cards: nome, data, pote, pódio do
      torneio, e ações `✏ Resultado` / `✎ Renomear` / `🗑 Excluir`. Reaproveita
      `getTournamentResults` / `updateTournamentResults` / `renameTournament` / `deleteTournament`.
      **Escopo travado: só resultados** — sem adicionar/remover jogador (exigiria migração).
- [ ] 🟡 **Aposentar `StatsPanel.tsx`.** O botão "Salvar torneio atual" migrou para a tela de fim
      (S13); o resto se divide entre `Ranking` e `Historico`. "Jogadores cadastrados" + renomear vai
      para o rodapé de `Historico`.

**Validação:** `npm run build` + `npm run dev` com Supabase configurado.
**Próxima:** S15 · Haiku 4.5 · effort medium.

---

## S15 — Polimento visual, responsivo e build final  ·  Haiku 4.5 · effort **medium**  ·  depende de todas

Arquivos: `src/index.css`, `src/theme.ts`, `public/manifest.webmanifest`

- [ ] 🟡 Revisar o CSS das telas novas (home, wizard, live actions, finish, ranking, histórico) em
      largura de celular e de PC. Barra de ações fixa não pode cobrir conteúdo.
- [ ] 🟡 Conferir que o modo tela cheia do relógio (`clock-panel.fs`) e o QR de canto continuam
      certos com a barra de ações nova.
- [ ] 🟡 `npm run lint` — reavaliar se os warnings de `react-hooks/refs` do `App.tsx` caíram depois
      dos refactors das S10/S11 (ver relatório da S2 no `AUDITORIA.md`).
- [ ] 🟡 `npm run build` limpo e smoke test do PWA no celular.

**Validação:** `npm run lint` (exit 0) + `npm run build`.
**Próxima:** —
