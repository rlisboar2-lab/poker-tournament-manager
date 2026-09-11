# Redesenho do fluxo — backlog em sessões

Plano fatiado para execução **uma sessão por bloco**. Cada sessão lê só os arquivos do seu bloco.
Ao final de cada sessão: marcar `[x]`, `npm run build`, commitar, e informar o modelo da próxima.

Continuação de `AUDITORIA.md` (S1–S8, concluídas). Numeração segue de S9.

**Feitas:** S9 · S10 · S11 · S12 · S13 · S14 · S15 · S16  ·  **Pendentes:** S17 · S18 (correções de bug, 11/09/2026)

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

## S12 — Wizard de criação (3 telas) + cobrança PIX  ·  Sonnet 5 · effort **medium**  ·  depende de S11 · **feita 11/09/2026**

Arquivos: `src/components/SetupPanel.tsx`, `src/components/PlayersPanel.tsx`,
`src/components/CobrancaPix.tsx` (novo), `src/screens/BuyIn.tsx` (novo),
`src/components/PayoutsPanel.tsx`, `src/App.tsx`

- [x] 🟡 **Tela 1 — configuração base.** `SetupPanel` como está, **mais** um bloco recolhível
      "Premiação" que embute o `PayoutsPanel` (percentuais + "Sugerir por nº de jogadores").
      A etapa `payouts` deixa de existir como tela; os valores em R$ são confirmados no fim.
- [x] 🟡 **Tela 2 — selecionar jogadores.** `PlayersPanel` em `mode="setup"`, com os chips de
      cadastrados que já existem. Sem steppers de rebuy/add-on aqui (rebuy no início não faz
      sentido); só nome e buy-ins.
- [x] 🟡 **Tela 3 — buy-ins.** `BuyIn.tsx`: QR grande (`public/pix-qr.png`), lista dos
      selecionados, total calculado (`N × buy_in_value`), e botão único
      `✓ Todos pagaram — iniciar torneio` → vai para `live`.
- [x] 🟡 **`CobrancaPix.tsx` reutilizável.** Props:
      `{ tipo: 'buyin'|'rebuy'|'addon'; jogador: string; valor: number; onPago(): void; onCancelar(): void }`.
      Mostra quem, o quê, quanto, o QR, e `✓ Pago (PIX ou dinheiro)`.
      **A transação só é aplicada no `onPago`** — senão um rebuy selecionado e não pago já
      recalibraria os blinds por dinheiro que não entrou. Usado pela S13.
- [x] 🟡 **Navegação do wizard.** Voltar/Avançar só dentro das 3 telas. Avançar da 3 = iniciar.

### Como ficou (11/09/2026)

- `SetupPanel` ganhou props opcionais `prizePool`/`playerCount`/`payoutPct`/`onPayoutChange`; quando
  passadas, renderiza `<details className="collapsible">` com `PayoutsPanel` dentro, no fim do
  painel. `App.tsx` não renderiza mais `PayoutsPanel` solto na tela `setup`.
- `PlayersPanel`: colunas Rebuys/Add-ons e o passo de `Stepper` correspondente só aparecem com
  `mode="live"`. `mode="setup"` (tela 2 do wizard) mostra só Jogador + Buy-ins.
- `BuyIn.tsx` (novo, `src/screens/`): recebe `entries`/`buyInValue`/`onConfirm`. QR
  (`public/pix-qr.png`, com aviso se faltar), tabela de buy-ins por jogador, total
  `entries.length × buyInValue`, botão que chama `onConfirm` (App: `() => setScreen('live')`).
- `CobrancaPix.tsx` (novo, `src/components/`): componente reutilizável descrito no plano, ainda
  não chamado de lugar nenhum — fica pronto para a S13 (ações ao vivo: adicionar/rebuy/add-on).
- `Screen` (`App.tsx`) já tinha `'buyin'`; `FLOW` passou a incluir a etapa:
  `['setup', 'players', 'buyin', 'live', 'finish']`. Voltar/Avançar da nav-row genérica cobrem a
  navegação do wizard automaticamente — a tela 3 só adiciona seu próprio botão de confirmação, que
  dispara a mesma transição (`buyin` → `live`).
- `.collapsible` novo em `index.css`: `<summary>` com marcador ▸/▾ via `::before`, sem o marcador
  nativo do `<details>` (`::-webkit-details-marker`).
- Testado em `npm run dev` ponta a ponta: tela 1 (expandir Premiação, ver soma 100%) → Avançar →
  tela 2 (adicionar "Rod" e "Ana", só coluna Buy-ins) → Avançar → tela 3 (QR carregado, tabela Rod/Ana
  R$10 cada, total R$20) → "✓ Todos pagaram — iniciar torneio" → caiu no relógio, nível 1/11,
  5/10, `idle`.
- Lint: mesmo baseline (0 erros, 8 avisos `react-hooks/set-state-in-effect` pré-existentes, nenhum
  novo).

**Validação:** `npm run build` + `npm run lint` (0 erros) + `npx vitest run` (60 testes) +
`npm run dev`: criar torneio do zero pelas 3 telas até o relógio iniciar.
**Próxima:** S13 · Sonnet 5 · effort high.

---

## S13 — Console ao vivo + fim do torneio  ·  Sonnet 5 · effort **high**  ·  depende de S12

Arquivos: `src/components/Clock.tsx`, `src/components/LiveActions.tsx` (novo),
`src/screens/Finish.tsx` (novo), `src/utils/placements.ts`, `src/App.tsx`, `src/index.css`

### Console ao vivo

- [x] 🟡 **Barra fixa de 4 ações** (`LiveActions.tsx`), no rodapé, alcance de polegar no celular:
      `[+ Jogador] [✗ Eliminar] [↻ Rebuy] [＋ Add-on]`. Mantém os controles atuais do relógio.
- [x] 🟡 **Eliminar = ação mais rápida do app.** Lista de ativos ordenada por mesa/assento, um
      toque elimina. **Sem `confirm()`** — em vez disso, toast `João eliminado em 7º · desfazer`
      por 5s. Confirm em ação frequente atrasa o floor; undo é melhor.
- [x] 🟡 **Adicionar / Rebuy / Add-on** passam por `CobrancaPix`; commit só no "Pago".
- [x] 🔴 **Regras que o app não impõe hoje:** rebuy/reentrada **bloqueada** depois que o late
      check-in fecha (`state.level_number > late_checkin_level` resolvido); botão de rebuy
      respeita `max_rebuys`; add-on só se `addon_enabled`.
- [x] 🟡 **KPIs no relógio:** `Pote: R$ X · N na mesa · Stack médio · Pressão BB`. Hoje o pote só
      aparece na tela de premiação.
- [x] 🟡 **Color-up no cronograma.** Na tabela de níveis do `Clock.tsx`, marcar os níveis de
      `colorUpPoints()` (S9) com `🎨 retirar ficha de N`. Se o color-up não cai em intervalo,
      oferecer `+ intervalo aqui` usando `sugerirBreaksParaColorUp()`.

### Fim do torneio

- [x] 🟡 **Gatilho do penúltimo.** Quando `applyElimination` deixar 1 ativo, o relógio **pausa**
      (nunca reseta) e abre `Finish.tsx` com o campeão declarado — `renumberPlacements` já resolve
      o 1º lugar (`placements.ts:196`).
- [x] 🔴 **Guarda obrigatória.** `Finish.tsx` é não-destrutiva e reversível: botão
      `↩ Não acabou` revive o jogador e volta ao relógio. Toque errado não pode encerrar torneio.
- [x] 🟡 **Confirmar colocações e prêmios.** Tabela por jogador: colocação editável, prêmio em R$
      editável, **investido**, e **líquido = prêmio − investido** (a lógica já existe em
      `ResultsPanel.tsx:236`; migrar e aposentar o painel).
- [x] 🟡 **Tela "Torneio finalizado":** `[💾 Salvar torneio] [🗑 Descartar resultados] [＋ Novo torneio]`.
      Salvar **idempotente** (toque duplo não grava dois torneios — travar por flag de id salvo).
      Descartar pede `confirm()`.

**Validação:** `npm run build` + `npm run dev`: rodar um torneio de 3 jogadores ponta a ponta,
incluindo rebuy, add-on, entrada tardia, eliminar até o penúltimo, desfazer, eliminar de novo,
salvar.
**Próxima:** S14 · Sonnet 5 · effort high.

### Como ficou (11/09/2026)

- `LiveActions.tsx` (novo, `src/components/`): barra fixa no rodapé com as 4 ações. `+ Jogador` e
  `↻ Rebuy` desabilitam com `title="Late check-in fechado"` quando
  `engine.state.level_number > resolvedLateCheckinLevel`; `↻ Rebuy` também filtra jogadores no
  `max_rebuys`; `＋ Add-on` some inteiro se `!addon_enabled`. As três ações passam por
  `CobrancaPix` — o `LocalEntry` só muda (`addAndSeat`/`rebuys+1`/`addons+1`, em `App.tsx`) no
  callback `onPago`. `✗ Eliminar` lista os ativos por mesa/assento e elimina no toque, sem `confirm()`.
- Toast de desfazer: estado `eliminationToast` em `App.tsx`, populado dentro de `toggleEliminated`
  (calcula a colocação como `entries.filter(!eliminated).length` *antes* da eliminação — é
  exatamente a posição que `renumberPlacements` vai atribuir). Suprimido quando a eliminação é a
  penúltima (`colocacao <= 2`): nesse caso o app já pula direto para `Finish.tsx`, cujo
  `↩ Não acabou` cobre o mesmo desfazer.
- KPIs do relógio: `Clock.tsx` ganhou `prizePool`/`playersRemaining` como props (vêm de `App.tsx`,
  que já os calculava) — sem tocar no motor.
- Color-up: `Clock.tsx` deriva `BlindLevel[]` cru direto de `items` (bate com a tabela exibida,
  inclusive com estrutura editada manualmente) e chama `colorUpPoints`/`sugerirBreaksParaColorUp`
  (S9, sem alterar assinatura). Nível marcado ganha pill dourada; `+ intervalo aqui` só aparece
  quando o color-up ainda não cai logo após um intervalo configurado, e chama `onAddBreakAfter`
  (mesmo padrão de `inserirIntervaloAgora`, para o nível sugerido em vez do corrente).
- Gatilho de fim: `useEffect` em `App.tsx` observa `entries`/`screen` — com `screen === 'live'`,
  relógio não `idle` e exatamente 1 ativo sobrando (de um campo com mais de 1 jogador), chama
  `engine.pause()` e `setScreen('finish')`. A troca de tela tira a própria condição do próximo
  render, então dispara uma vez só.
- `Finish.tsx` (novo, `src/screens/`) substitui e aposenta `ResultsPanel.tsx` (removido). Campeão
  vem de `entries.find(e => !e.eliminated && e.final_placement === 1)`; "↩ Não acabou" acha quem
  tem `final_placement === 2` (o penúltimo a cair) e chama `toggleEliminated(idx, false)` — revive
  pela mesma função de `placements.ts` que já cobria isso, sem lógica nova.
- Salvamento idempotente: novo estado `savedTournamentId` (persistido no autosave, zerado em
  `resetTorneio`). `onSave` retorna cedo se já houver id; `handleFinishSave` embrulha com
  `saving`/try-catch para o botão nunca travar em "Salvando…" se a chamada falhar.
  `🗑 Descartar resultados` pede `confirm()` e cai em `resetTorneio('home')`; `＋ Novo torneio` só
  confirma se ainda não foi salvo.
- Testado em `npm run dev` ponta a ponta com 4 jogadores (Ana/Bob/Caio/Dan): `+ intervalo aqui`
  encaixou o color-up do nível 3 corretamente; entrada tardia, rebuy e add-on recalibraram pote e
  curva via `CobrancaPix`; eliminar Caio e Bob mostrou o toast (`"Bob eliminado em 3º · desfazer"`)
  e sumiu em ~5s; eliminar o penúltimo abriu `Finish` com "🏆 Ana é o campeão!", pausado (não
  reiniciado); "↩ Não acabou" reviveu Dan e voltou ao relógio pausado; "💾 Salvar torneio" sem
  Supabase configurado mostrou o alerta de erro sem travar o botão; "🗑 Descartar resultados"
  voltou à home limpa. Também confirmado: avançando ao nível 8 (late check-in fecha no 6 para
  11 níveis), `+ Jogador` e `↻ Rebuy` desabilitam com o título "Late check-in fechado".
- Lint: mesmo baseline (0 erros; 9 avisos `react-hooks/set-state-in-effect`/`no-explicit-any`
  pré-existentes — 1 novo do mesmo tipo, no `useEffect` do gatilho de fim, mesma classe já aceita
  no restante do arquivo). `npx vitest run`: 60 testes, sem mudança.

---

## S14 — Ranking em pódio + torneios finalizados  ·  Sonnet 5 · effort **high**  ·  depende de S11 · **feita 11/09/2026**

Arquivos: `src/screens/Ranking.tsx` (novo), `src/screens/Historico.tsx` (novo),
`src/components/StatsPanel.tsx` (aposentar), `src/index.css`

- [x] 🟡 **`Ranking.tsx` em 3 camadas** (padrão de leaderboard: pódio + destaque + tabela):
      1. **Pódio 1º/2º/3º** — alta importância: cards grandes, ouro/prata/bronze, nome, pontos,
         líquido. 1º ao centro e maior.
      2. **4º ao 9º** — média importância: linhas compactas com nome, pontos e líquido.
         É a "força dos 9 primeiros".
      3. **Tabela geral** — todos, com as colunas que já existem: pontos, eventos, investido,
         ganhos, líquido, ROI (`StatsPanel.tsx:133`).
      Dados: `playerLeaderboard()` sem mudança de serviço.
- [x] 🟡 **`Historico.tsx`.** Lista de torneios salvos como cards: nome, data, pote, pódio do
      torneio, e ações `✏ Resultado` / `✎ Renomear` / `🗑 Excluir`. Reaproveita
      `getTournamentResults` / `updateTournamentResults` / `renameTournament` / `deleteTournament`.
      **Escopo travado: só resultados** — sem adicionar/remover jogador (exigiria migração).
- [x] 🟡 **Aposentar `StatsPanel.tsx`.** O botão "Salvar torneio atual" migrou para a tela de fim
      (S13); o resto se divide entre `Ranking` e `Historico`. "Jogadores cadastrados" + renomear vai
      para o rodapé de `Historico`.

### Como ficou (11/09/2026)

- `Ranking.tsx` (novo, `src/screens/`): busca `playerLeaderboard()` no mount (mesmo padrão do
  `Home.tsx`). Pódio (`board.slice(0,3)`) renderizado em ordem visual 2º/1º/3º via `order` CSS
  (`.ranking-podium-card.place-N`), 1º maior e com borda dourada. 4º-9º (`board.slice(3,9)`) em
  linhas compactas. Tabela geral abaixo com todos e as mesmas colunas do `StatsPanel` antigo
  (pontos, eventos, investido, ganhos, líquido, ROI). Sem prop nenhuma — não precisa mais de
  `onSave` (já migrado pra `Finish.tsx` na S13).
- `Historico.tsx` (novo, `src/screens/`): `listTournaments()` +, em paralelo (`Promise.all`),
  `getTournamentResults(t.id).slice(0,3)` por torneio pra montar o pódio de cada card
  (`podiums: Record<id, TournamentResultRow[]>`). Cards com nome, data, pote, status e o pódio em
  medalhas; ações `✏ Resultado`/`✎ Renomear`/`🗑 Excluir` idênticas ao `StatsPanel` antigo. Editor
  de resultado (colocação/prêmio) é o mesmo bloco que existia, só movido pra cá. Rodapé "Jogadores
  cadastrados" com renomear, migrado sem mudança de lógica.
- `StatsPanel.tsx` removido. `App.tsx`: `{screen === 'ranking' && <Ranking />}` /
  `{screen === 'historico' && <Historico />}`, sem prop `onSave` (o botão de salvar já não existia
  duas vezes desde a S13 — isso só tirava a duplicata).
- CSS novo em `index.css`: `.ranking-podium*`, `.ranking-mid*`, `.historico-list`,
  `.historico-card*`, `.historico-podium*`. Reaproveita tokens existentes (`--gold`, `--accent`,
  `--danger`, `--panel-2`, `--border`).
- Testado em `npm run dev`: navegação Home → Ranking completo → ← Início → Torneios finalizados,
  sem erro no console nas duas telas. Sem Supabase configurado neste ambiente — pódio e cards com
  dados reais não puderam ser testados visualmente; só a ausência de erro com listas vazias (aviso
  correto de "Supabase não configurado" em ambas as telas, `Historico` mostra "Sem dados." e "Sem
  jogadores salvos.").
- Lint: `npm run lint` 0 erros, 10 avisos (mesma classe `react-hooks/set-state-in-effect`
  pré-existente da S10/S13 — 1 a mais que o baseline porque o fetch-on-mount único do `StatsPanel`
  virou dois arquivos separados, `Ranking.tsx` e `Historico.tsx`, cada um com seu próprio efeito).
  `npx vitest run`: 60 testes, sem mudança (motor não tocado).

**Validação:** `npm run build` + `npm run dev` com Supabase configurado.
**Próxima:** S15 · Haiku 4.5 · effort medium.

---

## S15 — Polimento visual, responsivo e build final  ·  Haiku 4.5 · effort **medium**  ·  depende de todas

Arquivos: `src/index.css`, `src/theme.ts`, `public/manifest.webmanifest`

- [x] 🟡 Revisar o CSS das telas novas (home, wizard, live actions, finish, ranking, histórico) em
      largura de celular e de PC. Barra de ações fixa não pode cobrir conteúdo.
      Testado no preview (375x812 e desktop): `.app:has(.live-actions-bar)` com `padding-bottom: 76px`
      mantém todo conteúdo (inclusive tabela de cronograma e botões Voltar/Avançar) acessível acima
      da barra fixa. Sem sobreposição encontrada.
- [x] 🟡 Conferir que o modo tela cheia do relógio (`clock-panel.fs`) e o QR de canto continuam
      certos com a barra de ações nova.
      Confirmado por revisão de código: `.clock-panel.fs` tem `z-index: 1500` (cobre toda a viewport),
      acima da `.live-actions-bar` (`z-index: 100`), e `.corner-qr` é posicionado absolute dentro do
      stacking context do `.fs`. A API de Fullscreen nativa não pôde ser acionada no sandbox do
      browser de preview (limitação do ambiente de teste, não do código).
- [x] 🟡 `npm run lint` — reavaliar se os warnings de `react-hooks/refs` do `App.tsx` caíram depois
      dos refactors das S10/S11 (ver relatório da S2 no `AUDITORIA.md`).
      Caíram. `npm run lint` retorna 0 erros, 10 warnings (nenhum em `App.tsx`; restantes são
      `no-explicit-any` em `Clock.tsx` e `set-state-in-effect` em `WatchView.tsx`/`Historico.tsx`/`Ranking.tsx`,
      pré-existentes e fora do escopo desta sessão).
- [x] 🟡 `npm run build` limpo e smoke test do PWA no celular.
      `npm run build` limpo (tsc + vite build, sem erros). `manifest.webmanifest` e `public/icon.svg`
      conferidos por arquivo. Instalação real de PWA no celular não foi testada (sem dispositivo físico
      nesta sessão) — não afirmo esse teste como executado.

**Validação:** `npm run lint` (exit 0) + `npm run build`.
**Próxima:** —

---

# Correções de bug — rodada de 11/09/2026 (S16–S18)

Origem: teste em produção do fluxo completo (criação → live → campeão). Seis defeitos reportados
pelo usuário + um item de fluxo que faltava ("Finalizar torneio"). Auditoria feita antes do
fatiamento; cada achado abaixo tem o arquivo e a linha onde a causa vive.

### Achados da auditoria

| # | Sintoma | Causa | Local |
|---|---|---|---|
| 1 | `Avançar` pula o "Todos pagaram" | nav-row global não conhece telas-portão | `App.tsx` nav-row / `BuyIn.tsx` |
| 2a | Eliminado não aparece no Rebuy | `rebuyable` deriva de `active` (`!eliminated`) | `LiveActions.tsx` |
| 2b | Sheet "+ Jogador" sem nomes salvos | `knownPlayers` nunca chega ao `LiveActions` | `App.tsx` / `LiveActions.tsx` |
| 2c | Nome repetido vira duplicata na lista | `addAndSeat` não checa nome; `jaNoTorneio` só filtra os chips | `seating.ts` / `PlayersPanel.tsx` |
| 3 | Intervalo default no nível 9 | `breaks: [{ after_level: 9 }]` literal, desconectado do late `auto` | `App.tsx` `defaultConfig()` |
| 4 | Sobrando 1 jogador, nada indica o fim | gatilho do campeão tem guarda `status === 'idle' → return` | `App.tsx` |
| 5 | Defaults errados | `target 240` / `addon_enabled true` / `max_rebuys 0` | `App.tsx` `defaultConfig()` |
| 6 | `Avançar` visível na tela de campeão | `finish` está dentro do `FLOW`; botão só é desabilitado | `App.tsx` |
| 7 | Sem saída para torneio abandonado | só `Novo torneio` (apaga sem oferecer salvar) | `App.tsx` cabeçalho |

### Decisões travadas nesta rodada (não reabrir sem informação nova)

- **Reentrada é rebuy, não buy-in.** Elegibilidade ao rebuy = `rebuys < max_rebuys` (ou ilimitado)
  **E** late check-in aberto — **independente de `eliminated`**. Eliminado que volta paga
  `rebuy_value`; `buy_in_value` só na primeira entrada da vida do jogador naquele torneio.
  Enquanto não volta, segue contando como eliminado (fora de `playersRemaining`, sem mesa/assento,
  com colocação provisória). `renumberPlacements` já corrige todo mundo na volta.
- **`active` continua governando Eliminar e Add-on.** Morto não faz add-on e não é eliminado
  de novo. Só o Rebuy passa a enxergar a lista inteira.
- **Nome duplicado é erro bloqueante**, não aviso. Comparação case- e acento-insensível. O caminho
  de quem já está no torneio é o Rebuy, nunca o `+ Jogador` — com a guarda, os dois param de se
  sobrepor.
- **`Finalizar torneio` → `Salvar` não grava direto, navega para `finish`.** Em torneio
  interrompido, `renumberPlacements` só atribui colocação aos eliminados; os ativos ficam
  `final_placement: undefined` e gravar assim produziria ranking furado. A `finish` já tem os
  campos de colocação e o save idempotente.

---

## S16 — Navegação, defaults e saída do torneio  ·  Haiku 4.5 · effort **low**  ·  sem pré-requisito · **feita 11/09/2026 (Sonnet 5)**

Arquivos: `src/App.tsx`, `src/index.css`

- [x] 🔴 **Portão do buy-in (#1).** Na tela `buyin`, esconder o `Avançar →` da nav-row. A única
      saída é `✓ Todos pagaram — iniciar torneio`. Intenção: o torneio não começa com o caixa
      incompleto — dívida arrastada prejudica quem vai receber prêmio.
- [x] 🟡 **`finish` fora do `FLOW` (#6).** Tela terminal não tem nav-row: nem `Voltar`, nem
      `Avançar` desabilitado. Hoje `FLOW` inclui `finish` e o botão só fica cinza.
- [x] 🟡 **Defaults (#5)** em `defaultConfig()`: `target_time_minutos: 300`,
      `addon_enabled: false`, `max_rebuys: 1`.
- [x] 🔴 **`⏹ Finalizar torneio` (#7)** no cabeçalho, visível quando `entries.length > 0` e a tela
      não é `home`/`ranking`/`historico`. Abre modal de 3 saídas: **Salvar** (navega para `finish`,
      ver decisão travada) · **Descartar** (`resetTorneio('home')`, mantendo o `confirm` atual) ·
      **Cancelar**. Reaproveitou `.qr-overlay`/`.qr-card` do `LiveActions`.

**Validação:** `npm run build` ok; testado no preview de produção —
`setup→players→buyin` só sai pelo botão verde; `finish` sem nav-row; `⏹ Finalizar` abre as três
saídas (Salvar navega pra `finish`, Cancelar fecha o modal — testados; Descartar segue o mesmo
`confirm` do `Novo torneio`, não executado no teste pra não zerar o estado).
`FLOW` continua incluindo `finish` (só a nav-row some) — nada mais depende disso hoje.
**Próxima:** S17 · Opus 5 · effort medium.

---

## S17 — Integridade do cadastro ao vivo  ·  Opus 5 · effort **medium**  ·  depende de S16

Arquivos: `src/components/LiveActions.tsx`, `src/components/PlayersPanel.tsx`,
`src/utils/seating.ts`, `src/App.tsx`, `src/utils/__tests__/`

- [ ] 🔴 **Guarda antiduplicata (#2c).** `addAndSeat` rejeita nome já presente no torneio
      (case- e acento-insensível, comparando também com eliminados). O chamador mostra erro
      visível — nada de falha silenciosa. Mesma guarda no `PlayersPanel` (`add` por digitação,
      não só nos chips) e no sheet `+ Jogador` do `LiveActions`.
- [ ] 🔴 **Rebuy de eliminado = reentrada (#2a).** `rebuyable` passa a derivar de `entries`, não de
      `active`: filtro é `rebuys < max_rebuys` (ou ilimitado) + late aberto. Item da lista marca
      quem está fora ("eliminado — volta pagando rebuy"). Ao confirmar o pagamento de
      `rebuy_value`: `applyElimination(i, false)` + `addAndSeat` de volta à mesa + `rebuys + 1`.
- [ ] 🟡 **`knownPlayers` no `LiveActions` (#2b).** Passar a prop do `App` e renderizar chips de
      1 clique + `datalist`, com a mesma aparência do `PlayersPanel`. Cadastrado que já está no
      torneio não aparece nos chips (regra `jaNoTorneio` existente).
- [ ] 🟡 **Testes:** duplicata rejeitada (incluindo contra eliminado e com diferença de
      caixa/acento); reentrada renumera colocações de todos que caíram antes; reentrada respeita
      `max_rebuys` e o fechamento do late.

**Validação:** `npx vitest run`; no dev — eliminar jogador, abrir Rebuy, ele aparece marcado,
pagar, volta à mesa com colocações renumeradas; readicionar nome existente pelo `+ Jogador` dá erro.
**Próxima:** S18 · Opus 5 · effort medium.

---

## S18 — Intervalo pós-late e fim automático  ·  Opus 5 · effort **medium**  ·  depende de S17

Arquivos: `src/App.tsx`, `src/utils/__tests__/`

- [ ] 🔴 **Intervalo default pós-late (#3).** Regra do produto: o intervalo padrão é **sempre
      depois do late check-in**, nunca um nível literal. Hoje `defaultConfig()` grava
      `after_level: 9` e o late é `auto = ceil(níveis/2)` — os dois não conversam. O `after_level`
      do break default precisa derivar de `resolvedLateCheckinLevel`, que só existe depois de
      `projectedLevelCount`. Cuidado: `defaultConfig()` roda antes disso. Resolver com sentinela
      (`after_level: 'late'`) ou com effect de sincronização — não realimentar o cálculo da curva
      em laço (`sumBreakMin` entra em `effectiveTarget`, que entra em `projectedLevelCount`).
      Break editado à mão pelo usuário não pode ser sobrescrito.
- [ ] 🔴 **Fim de torneio sem depender do relógio (#4).** Tirar a guarda
      `engine.state.status === 'idle' → return` do gatilho do campeão: com relógio nunca iniciado,
      eliminar até sobrar 1 hoje não sinaliza nada. Além da troca de tela, mostrar na `live` um
      indicativo explícito ("🏆 <nome> é o campeão — torneio encerrado") antes/junto da transição.
- [ ] 🟡 **Teste:** break default acompanha o late quando o nº de jogadores muda a curva.

**Validação:** `npm run build`; variar o nº de jogadores e conferir o break colado no late;
eliminar até 1 com relógio parado **e** com relógio rodando.
**Próxima:** —
