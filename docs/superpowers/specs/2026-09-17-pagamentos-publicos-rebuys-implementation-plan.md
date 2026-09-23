# Plano de implementação — portal público, PIX e compras do torneio

**Data:** 17/09/2026  
**Status:** S19 e S20 concluídas (local); S21 é a próxima. Produção ainda no corte `0010`.  
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

### S22 — Serviços TypeScript e torneio persistente

**Objetivo:** integrar o admin ao modelo novo mantendo o portal fechado.

**Arquivos:** tipos, `src/services/tournaments.ts`, novo serviço operacional, `App.tsx`, `SetupPanel.tsx` e testes.

Tipar contratos; criar serviço isolado; persistir ao publicar; configurar PIX/ofertas; guardar IDs/versão; tratar conflitos; atualizar o torneio existente ao finalizar.

**Aceite:** admin cria, configura, publica e retoma um torneio persistente sem duplicação.

### S23 — Portal público e identidade

**Objetivo:** entregar `/jogar` com identificação persistente e buy-in em espera.

**Arquivos:** `main.tsx`, novas telas/componentes, serviço público e CSS.

Adicionar rotas manuais; token via Web Crypto/localStorage; estados de identificação e compra; cópia da chave PIX; troca confirmada; polling curto e atualização imediata após ações.

**Aceite:** recarga preserva a identidade; outro navegador não a herda; troca revoga o token; pedido não altera fichas/pote.

### S24 — Admin: lote e compras ao vivo

**Objetivo:** substituir confirmações locais pelo fluxo remoto.

**Arquivos:** `BuyIn.tsx`, `LiveActions.tsx`, componentes de fila, `App.tsx`, serviços e CSS.

Listar/resolver claims; botão único de lote; iniciar motor pela âncora do servidor; autorizar ofertas; confirmar/rejeitar pedidos; atualizar entradas somente após resposta; impedir campeão enquanto houver reentrada declarada e não resolvida.

**Aceite:** não existe caminho novo que conceda fichas antes do commit do banco; lote inicial detecta revisão desatualizada.

### S25 — Pacotes, finanças, histórico e ranking

**Objetivo:** remover suposições de preço fixo e contagem por linha.

**Arquivos:** `App.tsx`, `Finish.tsx`, `Historico.tsx`, serviços, consultas de ranking e testes.

Somar valores por `amount`, rebuys por `rebuy_units` e fichas por `chips_granted`; exibir pacote real; filtrar ranking por eventos concluídos; preservar defaults legados.

**Aceite:** duplo custa R$ 35, consome duas unidades, concede fichas configuradas e aparece como uma compra; ROI/pote usam R$ 35.

### S26 — Corte de segurança e remoção do QR

**Objetivo:** ativar permissões finais e retirar a dependência de QR.

**Arquivos:** migração RLS/grants, `BuyIn.tsx`, `CobrancaPix.tsx`, `Clock.tsx`, referências a `PixQr.tsx`, `HANDOFF.md` e CSS.

Substituir policies amplas; revogar acesso direto; remover referências a `/pix-qr.png`; aposentar `PixQr.tsx` somente após inventário; atualizar documentação; revisar o Security Advisor.

**Aceite:** público só usa RPCs próprias; não há QR exibido ou exigido; admin preserva as funções do torneio.

### S27 — Auditoria e liberação

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

