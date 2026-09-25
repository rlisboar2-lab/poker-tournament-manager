# Plano de implementação — portal público, PIX e compras do torneio

**Data:** 17/09/2026  
**Status:** S19–S24 concluídas; `0011`/`0012` aplicadas em produção em 23/09/2026; `0013` (S21) só no banco local. S25 é a próxima.  
**Projeto:** `poker-tournament-manager` — Vite, React 18, TypeScript e Supabase.

## Objetivo

Transformar o fluxo local de cobrança em um fluxo persistido e auditável:

1. o admin configura a chave PIX e publica o torneio;
2. jogadores usam o link público global, identificam-se e solicitam buy-in;
3. o admin confirma o lote e inicia o torneio com um único botão;
4. durante o torneio, o admin autoriza rebuy ou add-on por jogador;
5. o jogador solicita a opção liberada e declara o pagamento;
6. o admin confirma individualmente, e somente essa confirmação concede fichas e registra dinheiro;
7. ofertas simples, duplas e triplas obedecem a preços, consumo de unidades e elegibilidade próprios;
8. nenhuma etapa depende de QR code.

O Supabase será a fonte de verdade do estado financeiro e das solicitações. O estado local continuará como cache e recuperação da interface, sem poder confirmar pagamentos ou sobrescrever uma versão mais nova do servidor.

## Decisões fixadas

- Link principal global em `/jogar`, com somente um torneio público atual no MVP.
- Rota direta opcional `/jogar/:publicId` para acesso específico.
- Jogadores não criam conta nem senha.
- O navegador recebe uma sessão persistente vinculada ao jogador após validação do admin.
- “Trocar de jogador” exige confirmação e revoga a sessão anterior naquele navegador.
- Digitar o nome de alguém não concede automaticamente a identidade desse cadastro.
- “Informei o pagamento” não gera fichas nem lançamento financeiro.
- Somente a confirmação do admin cria a transação definitiva.
- Ranking, ROI e ganhos continuam derivados de `transactions`.
- O relógio continua baseado em `Date.now()` e âncoras absolutas.
- Não será adicionada biblioteca de rotas, UI ou estado.
- Migrações permanecem aditivas enquanto houver consumidores do modelo antigo.

## Fora de escopo

- Integração automática com banco ou provedor PIX.
- Confirmação automática de recebimento.
- Contas permanentes para jogadores.
- Múltiplos organizadores ou isolamento multiempresa.
- Mais de um torneio simultaneamente destacado no link global.
- Mudança das regras de pontuação, payout ou blinds além do reflexo de compras confirmadas.

## Pré-condições

Antes da primeira implementação:

1. preservar e reconciliar o worktree atual, que já tem mudanças em `App.tsx`, `LiveActions.tsx`, `PlayersPanel.tsx`, `tournaments.ts` e a migração `0010`;
2. confirmar quais migrações estão aplicadas no Supabase e registrar o corte no `HANDOFF.md`;
3. confirmar que `0010_inactivate_cebola.sql` será a última migração anterior a este recurso;
4. obter Supabase local ou projeto de teste para validar migrações/RLS antes do banco em uso;
5. exportar backup das tabelas atuais;
6. manter o cadastro público fechado até os testes de RLS e RPCs terminarem.

Não fazer push, deploy nem aplicar migração remota sem autorização específica.

## Modelo de dados alvo

### `base_tournaments`

Adicionar `flow_version`, `public_id`, `public_status`, `is_public_current`, `started_at`, `registration_closed_at` e `state_version`. Um índice único parcial permite somente um torneio com `is_public_current = true`.

### `app_admins`

Tabela com `user_id uuid primary key` e `created_at`. Ela substitui a suposição de que qualquer usuário autenticado é admin. O UUID inicial do responsável será cadastrado por procedimento de ambiente, sem e-mail ou UUID inventado dentro da migração versionada.

### `tournament_payment_settings`

Uma linha por torneio com tipo/chave PIX, nome do recebedor, instruções, versão e timestamps. O público acessa somente uma projeção filtrada por RPC e apenas quando o torneio estiver publicado.

### `tournament_runtime`

Uma linha por torneio com cronograma, estado do relógio, âncora, tempo pausado, fechamento das janelas, versão e timestamp. `live_state` continua como projeção pública do relógio, sem tokens, pedidos ou dados financeiros.

### `tournament_participants`

ID estável, torneio, jogador, status (`pending_buyin`, `active`, `eliminated`, `withdrawn`), mesa, assento, colocação operacional e timestamps. Deve existir no máximo uma linha por `(tournament_id, player_id)`.

### `player_device_sessions`

- hash único do token; nunca armazenar o token em texto puro;
- jogador opcional enquanto a associação estiver pendente;
- nome declarado;
- status `pending`, `active`, `revoked` ou `expired`;
- validação, último uso, expiração e revogação.

O navegador mantém um segredo aleatório forte em armazenamento local. As RPCs recebem o segredo no corpo, calculam o hash e limitam a ação àquela sessão. Não usar token em URL nem fingerprint invasivo.

### `purchase_offers`

Cada oferta guarda torneio, tipo (`buyin`, `rebuy`, `addon`), nome, ordem, preço, fichas concedidas, unidades de rebuy consumidas, contagens já usadas que a tornam elegível, limite de usos e estado ativo.

O exemplo de duas unidades fica:

| Oferta | Usos permitidos | Unidades | Preço |
|---|---:|---:|---:|
| 1º simples | `{0}` | 1 | R$ 15 |
| 2º simples | `{1}` | 1 | R$ 20 |
| Duplo | `{0}` | 2 | R$ 35 |

O duplo deixa de ser elegível após um simples porque `1` não pertence às contagens permitidas.

### Autorizações e solicitações

`purchase_authorizations` registra participante, tipo, estado, autor e validade. `purchase_authorization_offers` relaciona as ofertas liberadas. A autorização será de uso único no MVP.

`purchase_requests` guarda sessão, participante, autorização, oferta, estado, chave de idempotência e snapshot imutável de nome, preço, fichas, unidades e instrução PIX. Estados: `requested`, `payment_reported`, `confirmed`, `rejected`, `cancelled`, `expired`.

No MVP haverá no máximo uma solicitação adicional não terminal por participante. Isso torna a reserva de unidades determinística.

### Compatibilidade de `transactions`

Adicionar sem remover os campos atuais:

- `request_id uuid unique`;
- `kind`: `buyin`, `rebuy` ou `addon`;
- `rebuy_units integer not null default 0`;
- `chips_granted integer`;
- `confirmed_by` e `confirmed_at`.

Fazer backfill do tipo a partir de `is_rebuy`/`is_addon` e de uma unidade por rebuy legado. Durante a transição, novas escritas preenchem campos novos e booleanos antigos.

Um pacote duplo gera uma transação de R$ 35, duas unidades e as fichas configuradas. Não gera duas linhas de R$ 35.

## RPCs propostas

### Públicas

- `get_public_tournament(public_id nullable)`: retorna o torneio atual ou direto, ofertas públicas e PIX permitido.
- `identify_player(public_id, claimed_name, device_token, idempotency_key)`: cria/recupera sessão pendente sem assumir cadastro existente.
- `get_player_portal(device_token, public_id nullable)`: retorna apenas identidade, participação, pedidos e autorizações da sessão.
- `request_buyin(device_token, offer_id, idempotency_key)`.
- `request_purchase(device_token, authorization_id, offer_id, idempotency_key)`.
- `report_payment(device_token, request_id)`.
- `cancel_purchase_request(device_token, request_id)`.
- `revoke_device_session(device_token)`.

### Administrativas

- `create_operational_tournament(payload)`.
- `publish_tournament(tournament_id, expected_version)`.
- `resolve_player_claim(session_id, player_id nullable, new_display_name nullable)`.
- `confirm_buyins_and_start(tournament_id, expected_version, reviewed_request_ids)`.
- `authorize_purchase(participant_id, kind, offer_ids, expires_at)`.
- `confirm_purchase(request_id, expected_version)`.
- `reject_purchase(request_id, reason)`.
- `revoke_purchase_authorization(authorization_id, reason)`.
- `update_tournament_runtime(tournament_id, expected_version, payload)`.
- `finish_operational_tournament(tournament_id, expected_version, results)`.

### Garantias transacionais

- A confirmação inicial bloqueia o torneio e confirma exatamente os IDs revisados. Mudança de versão/lista gera conflito e recarrega a tela.
- Bloqueios seguem a ordem torneio, participante, autorização e pedido.
- `transactions.request_id` impede concessão duplicada.
- Repetição da mesma chave de idempotência devolve o resultado anterior.
- Elegibilidade soma unidades confirmadas e reservadas por pedidos não terminais.
- Pendência, pagamento declarado e autorização não alteram pote, fichas, blinds ou jogador.
- O servidor determina janelas pelo runtime persistido; o horário do aparelho não decide.
- Finalização é bloqueada enquanto houver pagamento declarado sem resolução.

## RLS e grants

- nenhuma leitura ou escrita direta de `anon` nas tabelas privadas;
- escrita administrativa somente para `app_admins`;
- público opera apenas pelas RPCs limitadas;
- `live_state` mantém somente leitura pública do relógio;
- usuário autenticado não admin não herda acesso total;
- chamadas diretas não alteram preço, fichas, unidades, status ou associações.

Funções privilegiadas usam objetos qualificados, `security definer`, `set search_path = ''`, revogação de execução pública e grants explícitos. As policies amplas serão retiradas somente no release em que as RPCs administrativas substitutas estiverem ativas.

## Sessões de implementação

### S19 — Baseline, contratos e ambiente de banco

**Objetivo:** preparar base reproduzível sem mudar o produto.

1. reconciliar mudanças locais e estado da `0010`;
2. inventariar schema/migrações aplicadas e conta admin;
3. fixar payloads, respostas e códigos de erro das RPCs;
4. criar fixtures do exemplo de dois rebuys e concorrência;
5. preparar ambiente de teste autorizado;
6. registrar backup e restauração.

**Aceite:** migrações e permissões podem ser testadas repetidamente sem tocar primeiro no banco em uso.

**Validação:** `npm run lint`, `npm run test`, `npm run build` e inventário do schema.

### S20 — Schema aditivo e admin explícito

**Objetivo:** criar entidades, constraints e compatibilidade.

**Arquivos:** nova migração após `0010`, `src/types/database.ts` e testes SQL.

Criar tabelas/índices; fazer backfill de transações; criar helpers privados de admin e token; manter o fluxo legado funcionando.

**Aceite:** o app antigo continua lendo e salvando histórico; constraints rejeitam cruzamento de torneios, duplicatas e valores inválidos.

**Execução (23/09/2026, branch `s20/schema-aditivo-admin`):**

- `0011_rls_auto_enable.sql` versiona o drift da S19 (função + event trigger `ensure_rls`, ativo em produção). A migração do schema virou `0012_payment_flow_schema.sql`.
- `0012` cria as 10 tabelas, o schema `private` (`is_admin`, `device_token_hash`, triggers) e as colunas novas de `base_tournaments`/`transactions`. Tabelas novas: RLS ligado, nenhuma policy, `revoke all` de anon/authenticated. O acesso fica para as RPCs da S21.
- Integridade por FKs compostas (`tournament_id`, `player_id`, `kind`): pedido, autorização, oferta liberada e transação não cruzam torneio, jogador ou tipo.
- Desvios do plano, deliberados:
  - `transactions.kind` é **coluna gerada** de `is_rebuy`/`is_addon`. Legado e fluxo novo não divergem.
  - `rebuy_units` é not null **sem default**. Um trigger preenche 1 por rebuy omitido: com default 0, o `save_tournament` legado gravaria rebuy com zero unidades.
  - Tabela extra `rpc_idempotency`, para cumprir o contrato "mesma chave devolve o envelope gravado".
  - Sessão de dispositivo é global, não por torneio. `claimed_in_tournament_id` só dá contexto à fila.
- Validação: reset `0001`→`0012` sem erro; inventário de dois resets idêntico (631 linhas); `rls-rpc-baseline.sql` 10/10; `s20-schema.sql` 13/13. Dados reais do dump de 23/09 carregados no banco local: backfill de 252 transações (111 rebuys = 111 unidades), `player_leaderboard()` com hash idêntico antes e depois, as duas suítes passam também sobre esses dados. `npm run build`, `npm test` (75) e `npm run lint` (0 erros) passam.
- Limite: o app não foi exercitado no navegador contra o banco local. A compatibilidade foi provada no nível SQL/RPC, que é o único caminho de escrita do cliente.

### S21 — Máquina de estados e RPCs

**Objetivo:** colocar todas as regras críticas no banco antes da interface pública.

Implementar identidade, portal filtrado, buy-in, resolução do jogador, confirmação em lote, autorização, solicitação, declaração, confirmação, rejeição, reservas, idempotência, bloqueios, versão e finalização.

**Aceite:** todo fluxo financeiro funciona por RPC sem depender do estado React.

**Validação:** transições inválidas, concorrência, repetição, token/preço adulterado, janela fechada e rollback integral.

**Execução (23/09/2026, branch `s21/rpcs-fluxo-pagamentos`, criada da `main` que já contém S19/S20):**

- `0013_payment_flow_rpcs.sql`: 8 RPCs públicas + 10 administrativas do contrato v1 e a leitura
  administrativa aditiva `get_operational_tournament`. Todas `security definer`, `search_path = ''`,
  execute revogado de public/anon/authenticated e concedido de novo explicitamente. Nenhuma tabela ou
  policy mudou. Helpers em `private` (envelope com catálogo fechado, idempotência, sessão, elegibilidade, JSON).
- Locks: torneio (`for no key update`) → sessão → participante → autorização → pedido. Erro de domínio
  só sai antes de escrever ou de dentro de bloco `begin/exception` que desfaz o bloco.
- Decisões registradas em `docs/contracts/rpc-v1.md` ("Registro de compatibilidade"): nenhum código novo.
- Validação: reset `0001`→`0013` limpo; `rls-rpc-baseline.sql` 10/10, `s20-schema.sql` 13/13,
  `s21-rpcs.sql` 16/16 (inclui os 4 cenários de `two-rebuys.json`, triplo, add-on, token
  revogado/vencido/adulterado, acesso direto negado, janela fechada e rollback integral forçado por
  trigger), `s21-concurrency.sh` 8/8 (os 8 casos de `concurrency-cases.json` com conexões `psql`
  paralelas; a conexão B comprovadamente espera o commit de A). Rodado duas vezes.
- Limites: não rodou contra o dump real de produção (a `0013` não mexe em dados nem tabelas); o app não
  chama as RPCs ainda. O legado lista torneios do fluxo 2 no Histórico e soma no ranking transações de
  torneio em andamento: filtrar por `flow_version`/status antes de usar o fluxo 2 em produção (S25).

### S22 — Serviços TypeScript e torneio persistente

**Objetivo:** integrar o admin ao modelo novo mantendo o portal fechado.

**Arquivos:** tipos, `src/services/tournaments.ts`, novo serviço operacional, `App.tsx`, `SetupPanel.tsx` e testes.

Tipar contratos; criar serviço isolado; persistir ao publicar; configurar PIX/ofertas; guardar IDs/versão; tratar conflitos; atualizar o torneio existente ao finalizar.

**Aceite:** admin cria, configura, publica e retoma um torneio persistente sem duplicação.

**Execução (23/09/2026, mesma branch `s21/rpcs-fluxo-pagamentos`, sem commit):**

- `src/services/operational.ts`: envelopes com catálogo fechado (código fora dele = `ContractError`), parsers
  dos formatos do contrato (dinheiro em texto → number), `needsReload` (VERSION_CONFLICT/REQUEST_SET_CHANGED),
  `describeError` por code/reason e wrappers de create/publish/get/update_runtime/finish.
- `src/utils/operational-config.ts`: ofertas a partir da config (buy-in; 1 rebuy simples por contagem até
  `max_rebuys`; "sem limite" = oferta única com teto de 20 contagens, limite do `purchase_offers_eligible_chk`;
  duplo opcional `double_rebuy_value`, 2 unidades, fichas em dobro, só com zero usadas; add-on), validação
  do PIX e casamento local→`participant_id` por nome no fim.
- `src/hooks/useOperationalTournament.ts` + `PortalPanel.tsx` (tela de Setup): PIX fora da `AppConfig`
  (preset não apaga), criar rascunho, publicar, retomar torneio aberto do servidor, recarregar. IDs e
  `state_version` no autosave. Uma ação por vez. Antes de criar, procura torneio aberto e recusa duplicar.
  Conflito recarrega do servidor e devolve a decisão ao admin. Banco sem 0013 (PGRST202) esconde o painel.
- Fim: com `public_status = running`, "Salvar" chama `finish_operational_tournament` no mesmo registro;
  persistente não iniciado pede confirmação antes do save legado. Histórico filtra
  `flow_version = 1 or public_status = finished`.
- Validação: PostgREST local recuperado (imagens `postgrest:v14.5`/`postgres-meta:v0.99.0` rebaixadas;
  edge runtime excluído do start). Reset `0001`→`0013`; SQL 10/10, 13/13, 16/16, concorrência 8/8;
  `bash supabase/tests/s22-admin-rest.sh` 1/1 (supabase-js real: criar, versão velha, publicar, retomar,
  identificar/resolver/buy-in/confirmar lote, runtime com versão velha e nova, finalizar, Histórico);
  96 testes, build e lint sem warning novo.
- Limites: clique ponta a ponta na UI não foi feito pelo agente (login exige senha). Não existe RPC para
  alterar ofertas/PIX após criar nem para cancelar um rascunho: o painel avisa divergência; fica para `0014`.
  Ranking (`player_leaderboard`) ainda soma transações de torneio do fluxo 2 em andamento: pré-requisito da S25.

### S23 — Portal público e identidade

**Objetivo:** entregar `/jogar` com identificação persistente e buy-in em espera.

**Arquivos:** `main.tsx`, novas telas/componentes, serviço público e CSS.

Adicionar rotas manuais; token via Web Crypto/localStorage; estados de identificação e compra; cópia da chave PIX; troca confirmada; polling curto e atualização imediata após ações.

**Aceite:** recarga preserva a identidade; outro navegador não a herda; troca revoga o token; pedido não altera fichas/pote.

**Execução (25/09/2026, branch `s21/rpcs-fluxo-pagamentos`; S22 commitada em `835bbbb`; S23 sem commit):**

- `src/services/publicPortal.ts`: 8 RPCs públicas tipadas (reusa envelope/parsers de `operational.ts`, agora
  exportados junto com `callRpc` e `isMissingRpc`), `next_action`, pedido na visão do jogador (snapshot PIX
  `{}` → null) e mensagens pt-BR por code/reason. Token: 32 bytes de `crypto.getRandomValues` em base64url
  (43 caracteres), só no `localStorage` (`pokerapp.portal.device_token`); sem `getRandomValues` recusa (nunca
  Math.random); armazenamento bloqueado → token só em memória, com aviso na tela.
- `src/hooks/usePlayerPortal.ts`: lê torneio público + portal; SESSION_PENDING → espera; REVOKED/EXPIRED →
  apaga token e volta à identificação; NOT_FOUND com torneio existente = token não registrado. Uma ação por
  vez, releitura depois de cada ação, polling de 5 s só com a aba visível. Chave de idempotência mantida
  enquanto o mesmo comando é repetido sem resposta. Trocar de jogador revoga no servidor e só então apaga o token.
- `src/components/PlayerPortalView.tsx` + CSS `.portal-*` (celular primeiro) + rotas `/jogar` e
  `/jogar/:publicId` em `main.tsx` (Netlify já redireciona tudo para `index.html`). Copiar chave com fallback
  `execCommand` fora de contexto seguro. Botão "Já fiz o PIX, avisar o organizador" com texto dizendo que só
  vale depois da confirmação. Rebuy/add-on liberados pelo admin já aparecem (autorizações → ofertas).
- Build estava quebrado desde a S22 (`process`/`Buffer` no teste de integração sem tipos do Node): corrigido
  sem dependência nova.
- Validação: 113 testes (17 novos), build ok, lint 0 erros (9 avisos antigos). Banco local após `db reset`:
  `s22-admin-rest.sh` 1/1 e `bash supabase/tests/s23-portal-rest.sh` 1/1 (identifica, pendente, outro token
  não herda, nome diferente = IDENTITY_CONFLICT, validação, buy-in idempotente, PURCHASE_PENDING, pagamento
  informado sem transação, revogação). Navegador (viewport 375 px, Vite no banco local): identificar → espera
  → validado pelo admin → pedir buy-in → copiar chave → informar pagamento → recarga preserva → admin confirma
  lote → "No torneio" → trocar de jogador (token antigo passa a SESSION_REVOKED, localStorage vazio);
  `/jogar/<id inexistente>` mostra "Torneio não encontrado". Sem erros no console.
- Descoberta: `resolve_player_claim` já cria o participante `pending_buyin` (portal validado nunca vem com
  `participant = null` no torneio em que o nome foi validado).
- Limites: screenshot não saiu (pane oculto não desenha); polling com pane oculto fica pausado por desenho.
  Não testado em celular real via IP local (HTTP).

### S24 — Admin: lote e compras ao vivo

**Objetivo:** substituir confirmações locais pelo fluxo remoto.

**Arquivos:** `BuyIn.tsx`, `LiveActions.tsx`, componentes de fila, `App.tsx`, serviços e CSS.

Listar/resolver claims; botão único de lote; iniciar motor pela âncora do servidor; autorizar ofertas; confirmar/rejeitar pedidos; atualizar entradas somente após resposta; impedir campeão enquanto houver reentrada declarada e não resolvida.

**Aceite:** não existe caminho novo que conceda fichas antes do commit do banco; lote inicial detecta revisão desatualizada.

**Execução (25/09/2026, branch `s21/rpcs-fluxo-pagamentos`; S23 já estava commitada em `641c8a7`):**

- `src/services/operational.ts`: wrappers tipados de `resolve_player_claim`, `confirm_buyins_and_start`,
  `authorize_purchase`, `confirm_purchase`, `reject_purchase` e `revoke_purchase_authorization` (nomes de parâmetro
  exatos do contrato), parser de transação (dinheiro em texto) e `runtime` obrigatório no início. `describeError`
  cobre IDENTITY_CONFLICT, REGISTRATION_CLOSED, REQUEST_STATE_CONFLICT, PURCHASE_PENDING, OFFER_NOT_ELIGIBLE,
  AUTHORIZATION_CONSUMED, DUPLICATE_TRANSACTION e os reasons `no_buyins`/`participant_status`/`window_closed`.
- `src/utils/operational-live.ts` (puro, testado): filas (buy-ins abertos = exatamente o conjunto que o servidor
  compara; compras abertas com PIX informado primeiro; identificações pendentes; liberações ativas), ofertas
  elegíveis segundo `eligible_offer_ids`, mesa inicial a partir dos participantes confirmados e
  `reconcileEntries`: contagens locais = unidades/add-ons **confirmados** no servidor; rebuy novo de eliminado
  vira reentrada (volta à mesa, colocações renumeradas). `pendingReentries` = eliminado com rebuy liberado ou
  pedido de rebuy aberto.
- Hook: ações `resolveClaim`, `startBatch`, `authorize`, `confirm`, `reject`, `revoke`, `dismiss`; cada comando
  espera a resposta do banco e relê; erro de domínio também relê. Polling de 5 s com aba visível nos status
  published/registration_closed/running; releitura antiga descartada por número de sequência.
- `screens/BuyInRemote.tsx` (tela 3 quando o torneio persistente está publicado): fila de identificações
  (jogador novo ou vínculo a cadastro, nome igual pré-selecionado), lote com rejeição por motivo, aviso de quem
  sai por não ter pedido, botão único com confirmação. REQUEST_SET_CHANGED/VERSION_CONFLICT recarregam e
  informam quantos pedidos entraram/saíram. Resposta perdida: com o servidor em `running`, a tela oferece abrir o
  relógio com o estado do servidor.
- Início: mesa montada só depois do commit, relógio restaurado pela `anchor_ms` do runtime (não `Date.now()`).
- Ao vivo (`running`): aba **Pedidos** com contador (identificações de recuperação, confirmar/rejeitar
  rebuy/add-on, revogar liberação). Rebuy/Add-on da barra só liberam a compra no servidor; "+ Jogador"
  bloqueado (a inscrição fecha no início). Mesa com contagens travadas, sem adicionar/remover; "Reentrar" vira
  "Desfazer eliminação". Limite de rebuy e presença do add-on vêm das ofertas do servidor. Campeão não é
  declarado enquanto houver `pendingReentries` (banner explica).
- Validação: 135 testes (22 novos: 11 de serviço, 11 do utilitário), build ok, lint 0 erros (9 avisos antigos).
  Banco local após `db reset`: `s22-admin-rest.sh` 1/1, **`s24-live-rest.sh` 1/1** (claims, nome duplicado =
  IDENTITY_CONFLICT, lote desatualizado = REQUEST_SET_CHANGED sem efeito, rejeição do atrasado, início com
  âncora do servidor, R$ 10 × 2, withdrawn, liberação segura campeão, pedido informado não mexe em nada, versão
  velha = VERSION_CONFLICT, duplo R$ 35/2 unidades/6.000 fichas, repetição idempotente, reentrada, add-on revogado
  e rejeitado com motivo) e `s23-portal-rest.sh` 1/1. Ordem obrigatória: reset → s22 → s24 → s23.
- Navegador (painel 629 px, admin logado pelo Rod, jogador em outra aba): validar 2 identificações → lote de 2 →
  relógio iniciou pela âncora (nível 1 com o tempo já decorrido no servidor) → liberar rebuy da Bia → eliminar
  Bia com 2 na mesa segurou o campeão → portal trocou para Bia (recuperação com inscrição fechada) → admin
  validou na aba Pedidos (vínculo pré-selecionado) → Bia pediu duplo e informou PIX → mesa inalterada até
  "Confirmar pagamento" → 2 rebuys, Bia de volta à mesa, trava liberada → add-on liberado, pedido e rejeitado
  com motivo (botão bloqueado sem motivo), add-ons continuam 0. Sem erros no console. O caso REQUEST_SET_CHANGED
  pela UI não foi exercitado (só na integração).
- Limites conhecidos: pote/ROI locais ainda usam quantidade × preço da config (duplo aparece como 2 × rebuy_value
  = R$ 30, não R$ 35) — é a S25. O servidor não sabe de eliminações (portal mostra "No torneio" para eliminado);
  pausa/retomada do relógio não sincroniza com `update_tournament_runtime`. Sem entrada tardia no fluxo 2 nem
  buy-in lançado pelo admin para jogador sem celular. Autorização sem validade (`expires_at` null).

### S25 — Pacotes, finanças, histórico e ranking

**Objetivo:** remover suposições de preço fixo e contagem por linha.

**Arquivos:** `App.tsx`, `Finish.tsx`, `Historico.tsx`, serviços, consultas de ranking e testes.

Somar valores por `amount`, rebuys por `rebuy_units` e fichas por `chips_granted`; exibir pacote real; filtrar ranking por eventos concluídos; preservar defaults legados.

**Aceite:** duplo custa R$ 35, consome duas unidades, concede fichas configuradas e aparece como uma compra; ROI/pote usam R$ 35.

**Execução (25/09/2026, branch `s21/rpcs-fluxo-pagamentos`; S24 commitada em `7067a3c`):**

- Decisão do Rod: as pendências da `0014` sem dono (alterar ofertas/PIX, cancelar antes do início) entraram
  nesta sessão, na mesma migração do ranking.
- `0014_finance_setup_ranking.sql`: `player_leaderboard` com o filtro do Histórico (legado ou fluxo 2
  `finished`), mantendo o corte de inativo da `0010`; `get_operational_tournament` devolve `transactions`;
  `update_tournament_setup` (ofertas em rascunho/publicado sem pedido vivo, senão `offers_locked`; PIX até o
  fim, `version` + 1; ofertas antigas inativadas) e `cancel_operational_tournament` (rascunho, publicado ou
  inscrição fechada; PIX informado = PENDING_PAYMENT; `requested` expira, `pending_buyin` vira `withdrawn`).
  Registro no contrato (`rpc-v1.md`, S25), sem código novo.
- `src/utils/ledger.ts` (puro): pote, investido por jogador, compras (nome da oferta via pedido) e fichas por
  tipo a partir dos lançamentos; soma em centavos. `App.tsx`: com o servidor em `running`/`finished`, pote,
  investimento e entradas de fichas da curva vêm do livro-caixa (motor recebe 1 × total por tipo); legado
  intocado (`legacyInvested`). `Finish` recebe `investedOf`/`purchasesOf` e mostra as compras reais.
  Histórico: `aggregateResults` soma `rebuy_units` e `amount` e lista os pacotes ("Rebuy ×2 R$ 35,00").
- Painel do portal: PIX editável até o fim, botão "Enviar alterações ao servidor" (só o que divergiu e é
  permitido), aviso de ofertas travadas, "Cancelar torneio persistente" antes do início.
- Validação: 150 testes (15 novos), build ok, lint 0 erros (9 avisos antigos). Banco local após reset:
  `rls-rpc-baseline` 10/10, `s20-schema` 13/13, `s21-rpcs` 16/16, `s21-concurrency` 8/8; integração
  reset → s22 1/1 → s24 1/1 → **s25 2/2** → s23 1/1.
- Navegador (painel 629 px, admin logado pelo Rod): torneio publicado com PIX informado → ofertas travadas
  → PIX trocado (versão 2 no banco) → cancelar barrado com aviso acionável → rejeição com motivo → cancelado
  (`withdrawn`/`rejected`, fora do Histórico). Torneio semeado por script com duplo confirmado → relógio
  pelo servidor: pote R$ 55,00 → eliminação → fim com Ana R$ 45,00 "Buy-in R$ 10,00 · Rebuy duplo R$ 35,00"
  → salvo → Histórico R$ 55,00 e "Rebuy ×2 R$ 35,00" → Ranking Ana investido R$ 45,00, ROI −38,9%. Sem erro
  no console. Screenshot indisponível (janela atrás); verificação por texto da página. Fim de torneio legado
  não foi reexercitado na UI (coberto por teste unitário).
- Limites: prêmios da tela de fim seguem a divisão local (sobra do 3º lugar sem jogador continua como antes);
  alterar ofertas em torneio publicado não avisa quem já abriu o portal.

### S26 — Corte de segurança e remoção do QR

**Objetivo:** ativar permissões finais e retirar a dependência de QR.

**Arquivos:** migração RLS/grants, `BuyIn.tsx`, `CobrancaPix.tsx`, `Clock.tsx`, referências a `PixQr.tsx`, `HANDOFF.md` e CSS.

Substituir policies amplas; revogar acesso direto; remover referências a `/pix-qr.png`; aposentar `PixQr.tsx` somente após inventário; atualizar documentação; revisar o Security Advisor.

**Aceite:** público só usa RPCs próprias; não há QR exibido ou exigido; admin preserva as funções do torneio.

**Execução (25/09/2026, branch `s21/rpcs-fluxo-pagamentos`; S25 em `75e0284`):**

- Inventário antes da migração: `anon` tinha todos os privilégios de tabela nas 5 tabelas legadas (só o RLS
  segurava), inclusive `TRUNCATE`, que ignora RLS — também concedido a `authenticated`, ou seja, qualquer
  conta logada podia esvaziar `transactions`. As 13 RPCs administrativas eram executáveis por `anon`;
  `rls_auto_enable` por PUBLIC.
- `0015_security_cut.sql`: aborta se houver usuário e nenhum `app_admins`; `authenticated` ganha USAGE em
  `private` e EXECUTE só em `is_admin()` (as policies precisam); `authenticated_all` → `admin_all`
  (`(select private.is_admin())`) nas 4 legadas; `live_state` com leitura pública e escrita do admin em
  policies por comando (evita `multiple_permissive_policies`); grants refeitos (anon só SELECT em
  `live_state`; authenticated só CRUD nas legadas e `live_state`); RPCs administrativas só para
  `authenticated`; `rls_auto_enable` fechada. Default privileges não foram alterados: o Postgres não revoga
  por schema, e o default global quebrava funções temporárias; a `s26-security.sql` detecta helper novo
  exposto.
- Cliente: `callRpc` traduz `42501` de RPC administrativa em AUTH_REQUIRED (pública continua lançando);
  lista de jogadores só com sessão. QR removido de `BuyIn`, `CobrancaPix`, `Clock` (botão e canto da tela
  cheia) e `WatchView`; `PixQr.tsx`, `public/pix-qr.png`, `QrIcon` e o CSS correspondente apagados; tela
  cheia e `/watch` sem coluna reservada.
- Testes: `s26-security.sql` 6/6 (grants, policies, funções, anon, autenticado comum, admin);
  `rls-rpc-baseline` 10/10, `s20-schema` 13/13 e `s21-rpcs` 16/16 ajustados ao corte; `s21-concurrency` 8/8;
  integração s22 1/1 → s24 1/1 → s25 2/2 → s23 1/1; 153 testes unitários (3 novos), build ok, lint 0 erros.
- Security Advisor local (lints do Studio): restam só `anon/authenticated_security_definer_function_executable`
  (RPCs por desenho) e `rls_enabled_no_policy` INFO nas tabelas do fluxo 2. Esperado e reversão:
  `docs/runbooks/security-cut-0015.md` (script de reversão executado em transação desfeita).
- Navegador (porta 5181, banco local): anônimo — `/watch/:id` lê o relógio sem QR, `/jogar` abre o torneio
  publicado, tela inicial sem 401. Admin logado pelo Rod — ranking, Histórico e jogadores carregam;
  torneio legado: cobrança de buy-in sem QR (sem rolagem horizontal) → relógio sem "Mostrar QR" → cobrança
  de rebuy sem QR → tela cheia com controles na largura toda → "Publicar ao vivo" grava `live_state` (201).
  `confirm()` nativo substituído via console só para o teste. Screenshot em escala reduzida.
- Limites: produção continua no corte `0012`; `0013`–`0015` só no banco local. Fluxo 2 completo pela UI não
  foi refeito nesta sessão (coberto pela integração REST).

### S27 — Auditoria e liberação

**Execução parcial (25/09/2026):** testes locais e UI de dois jogadores + admin registrados em docs/runbooks/s27-auditoria-2026-09-25.md. Rod informou aplicação de 0013–0015 após cadastro do admin; backup novo gerado e restaurado com 46/46 contagens. Correção da home e migração 0016 aprovadas, implementadas e validadas localmente; S20 13/13 no banco novo e na cópia restaurada. Rod informou a execução da 0016, confirmada por dump remoto de leitura. Consulta direta ao catálogo e Security Advisor remoto, deploy e smoke test de produção seguem pendentes.


**Objetivo:** liberar com evidência e reversão.

Executar a matriz completa; testar dois navegadores de jogador e um admin; simular resposta perdida após commit; verificar regressão legada; documentar operação; fazer smoke test descartável; ativar o público somente depois do teste.

**Aceite:** critérios finais passam, backup e reversão estão documentados e a liberação foi aprovada.

## Matriz mínima de testes

### Regra, concorrência e dinheiro

- primeiro simples R$ 15, segundo R$ 20 e duplo R$ 35;
- simples pendente bloqueia duplo; rejeitar/cancelar libera reserva;
- triplo exige três unidades restantes;
- add-on não consome rebuy;
- dois cliques no início e dois admins confirmando;
- pedido repetido e resposta perdida após commit;
- autorização revogada durante uso;
- buy-in chegando entre revisão e início;
- valores, unidades e fichas inválidos rejeitados no banco.

### Identidade e RLS

- primeiro acesso, recarga, nome novo/existente/inativo;
- troca cancelada/confirmada, token revogado/expirado/adulterado;
- limpeza de storage e segundo dispositivo;
- tentativa de ler pedido de outro jogador;
- `anon` sem leitura de tabelas privadas;
- autenticado não admin sem privilégios administrativos;
- cliente não consegue impor preço, fichas ou unidades.

### Regressão

- relógio, pausas, late check-in, ante e ratchet;
- reentrada, assento e colocações;
- transmissão `/watch/:id`;
- histórico/ranking legados;
- jogador inativo;
- retomada da PWA;
- finalização natural e manual.

## Liberação e reversão

1. aplicar migrações aditivas;
2. manter `flow_version = 1` para legados;
3. liberar o portal sem torneio encontrável até publicação do admin;
4. testar com torneio descartável;
5. restringir RLS quando cliente e RPCs estiverem no mesmo release;
6. abrir o torneio real depois do smoke test;
7. em falha de interface, retirar `is_public_current` e voltar ao cliente anterior sem apagar registros;
8. em falha financeira, bloquear novas ações e corrigir por migração compensatória auditável.

## Critérios finais

- `/jogar` encontra somente o torneio atual.
- Identidade persiste e pode ser trocada com confirmação.
- Token não acessa outro jogador.
- Buy-ins ficam pendentes até o botão único do admin.
- O botão confirma exatamente o lote revisado e inicia o relógio atomicamente.
- Rebuy/add-on exigem autorização, pedido e confirmação individual.
- Somente confirmação gera dinheiro e fichas.
- Pacotes consomem unidades e valores corretamente.
- Pote, investimento, histórico, ranking e fichas derivam de transações confirmadas.
- O app não depende de imagem ou geração de QR.
- Policies antigas não concedem administração a qualquer autenticado.
- Build, lint, testes unitários, SQL/RLS e fluxo multidispositivo passam.
- Backup, migrações, smoke test e limitações ficam registrados no handoff.

## Riscos principais

1. O worktree já está alterado e a migração `0010` pode não estar aplicada remotamente.
2. Restringir RLS cedo quebra o app; restringir tarde expõe o fluxo.
3. O torneio passa a existir antes da finalização; consultas históricas devem filtrar status.
4. Servidor e cliente precisam usar a mesma âncora/versão do relógio.
5. O token mantém continuidade, mas não prova identidade civil; o admin valida a associação.
6. “Informei pagamento” não comprova PIX; a linguagem da UI deve ser inequívoca.
7. Reentrada pendente interfere em campeão e colocação.
8. Qualquer cálculo restante baseado em quantidade × preço fixo produzirá valores errados.
