# Contrato RPC v1 — portal público, PIX e compras

Versão: 1
Fixado em: 17/09/2026 (S19)
Aplica-se às RPCs novas das sessões S20–S27.

## Convenções

- IDs são UUID em texto.
- Datas são ISO 8601 em UTC.
- Dinheiro cruza a API como texto decimal com duas casas, por exemplo "15.00".
- Versões são inteiros positivos e usam concorrência otimista.
- Tokens de dispositivo nunca são devolvidos, persistidos em texto puro, registrados em log ou colocados em URL.
- Toda RPC nova retorna jsonb com um dos envelopes abaixo. Erros inesperados de infraestrutura continuam no
  canal de erro do Supabase.

Sucesso:

    { "ok": true, "data": {} }

Erro de domínio:

    {
      "ok": false,
      "error": {
        "code": "VERSION_CONFLICT",
        "message": "O torneio mudou. Recarregue e revise antes de confirmar.",
        "retryable": true,
        "details": { "current_version": 4 }
      }
    }

Uma repetição com a mesma idempotency_key e o mesmo comando devolve o envelope originalmente persistido.
A mesma chave com conteúdo diferente devolve IDEMPOTENCY_CONFLICT.

## Formatos compartilhados

TournamentSummary:

    {
      "id": "uuid",
      "public_id": "texto-opaco",
      "name": "Torneio",
      "public_status": "draft|published|registration_closed|running|finished|cancelled",
      "state_version": 1,
      "start_time": "2026-09-17T22:00:00Z"
    }

Offer:

    {
      "id": "uuid",
      "kind": "buyin|rebuy|addon",
      "name": "1º rebuy",
      "price": "15.00",
      "chips_granted": 10000,
      "rebuy_units": 1,
      "eligible_after_units": [0],
      "max_uses": 1
    }

PurchaseRequest:

    {
      "id": "uuid",
      "kind": "buyin|rebuy|addon",
      "status": "requested|payment_reported|confirmed|rejected|cancelled|expired",
      "offer_name": "1º rebuy",
      "price": "15.00",
      "chips_granted": 10000,
      "rebuy_units": 1,
      "created_at": "2026-09-17T22:00:00Z",
      "updated_at": "2026-09-17T22:00:00Z"
    }

## RPCs públicas

| RPC | Entrada | data no sucesso | Erros de domínio previstos |
|---|---|---|---|
| get_public_tournament | public_id text default null | tournament, offers, payment | NOT_FOUND, NOT_PUBLIC |
| identify_player | public_id text, claimed_name text, device_token text, idempotency_key uuid | session, tournament, next_action | INVALID_ARGUMENT, NOT_PUBLIC, REGISTRATION_CLOSED, IDENTITY_CONFLICT, IDEMPOTENCY_CONFLICT |
| get_player_portal | device_token text, public_id text default null | session, tournament, participant, requests, authorizations, offers, payment | SESSION_PENDING, SESSION_REVOKED, SESSION_EXPIRED, NOT_FOUND |
| request_buyin | device_token text, offer_id uuid, idempotency_key uuid | request | SESSION_PENDING, SESSION_REVOKED, SESSION_EXPIRED, REGISTRATION_CLOSED, OFFER_NOT_ELIGIBLE, PURCHASE_PENDING, IDEMPOTENCY_CONFLICT |
| request_purchase | device_token text, authorization_id uuid, offer_id uuid, idempotency_key uuid | request | SESSION_REVOKED, SESSION_EXPIRED, AUTHORIZATION_REQUIRED, AUTHORIZATION_EXPIRED, AUTHORIZATION_REVOKED, AUTHORIZATION_CONSUMED, OFFER_NOT_ELIGIBLE, PURCHASE_PENDING, IDEMPOTENCY_CONFLICT |
| report_payment | device_token text, request_id uuid | request | SESSION_REVOKED, SESSION_EXPIRED, NOT_FOUND, REQUEST_STATE_CONFLICT |
| cancel_purchase_request | device_token text, request_id uuid | request | SESSION_REVOKED, SESSION_EXPIRED, NOT_FOUND, REQUEST_STATE_CONFLICT |
| revoke_device_session | device_token text | revoked_at | SESSION_REVOKED, SESSION_EXPIRED |

As respostas públicas nunca incluem UUID de usuário administrativo, hash/token, pedidos de outro jogador,
campos internos de auditoria ou configurações PIX de torneio não publicado.

## RPCs administrativas

Todas exigem JWT autenticado cujo auth.uid() exista em public.app_admins. Falha retorna AUTH_REQUIRED ou
ADMIN_REQUIRED sem revelar se outro UUID é administrador.

| RPC | Entrada | data no sucesso | Erros adicionais previstos |
|---|---|---|---|
| create_operational_tournament | payload jsonb com nome, início, configuração, ofertas e PIX | tournament, offers, payment_version | INVALID_ARGUMENT, TOURNAMENT_STATE_CONFLICT |
| publish_tournament | tournament_id uuid, expected_version bigint | tournament | NOT_FOUND, VERSION_CONFLICT, TOURNAMENT_STATE_CONFLICT |
| resolve_player_claim | session_id uuid, player_id uuid default null, new_display_name text default null | session, participant | NOT_FOUND, INVALID_ARGUMENT, IDENTITY_CONFLICT, REGISTRATION_CLOSED |
| confirm_buyins_and_start | tournament_id uuid, expected_version bigint, reviewed_request_ids uuid[] | tournament, runtime, confirmed_requests, transactions | VERSION_CONFLICT, REQUEST_SET_CHANGED, REQUEST_STATE_CONFLICT, TOURNAMENT_STATE_CONFLICT, DUPLICATE_TRANSACTION |
| authorize_purchase | participant_id uuid, kind text, offer_ids uuid[], expires_at timestamptz | authorization, offers | INVALID_ARGUMENT, NOT_FOUND, OFFER_NOT_ELIGIBLE, TOURNAMENT_STATE_CONFLICT, PURCHASE_PENDING |
| confirm_purchase | request_id uuid, expected_version bigint | request, transaction, participant, tournament | VERSION_CONFLICT, REQUEST_STATE_CONFLICT, DUPLICATE_TRANSACTION, OFFER_NOT_ELIGIBLE |
| reject_purchase | request_id uuid, reason text | request | NOT_FOUND, REQUEST_STATE_CONFLICT |
| revoke_purchase_authorization | authorization_id uuid, reason text | authorization | NOT_FOUND, AUTHORIZATION_CONSUMED, REQUEST_STATE_CONFLICT |
| update_tournament_runtime | tournament_id uuid, expected_version bigint, payload jsonb | runtime, tournament | VERSION_CONFLICT, INVALID_ARGUMENT, TOURNAMENT_STATE_CONFLICT |
| finish_operational_tournament | tournament_id uuid, expected_version bigint, results jsonb | tournament, participants, transactions | VERSION_CONFLICT, PENDING_PAYMENT, INVALID_ARGUMENT, TOURNAMENT_STATE_CONFLICT |

## Catálogo fechado de erros v1

| Código | Significado | Repetir sem mudança? |
|---|---|---:|
| INVALID_ARGUMENT | campo ausente, tipo/faixa inválida ou combinação impossível | não |
| AUTH_REQUIRED | JWT administrativo ausente ou inválido | após autenticar |
| ADMIN_REQUIRED | usuário autenticado não está em app_admins | não |
| NOT_FOUND | recurso não existe ou não pode ser revelado ao chamador | não |
| NOT_PUBLIC | torneio existe, mas não está publicamente acessível | não |
| REGISTRATION_CLOSED | cadastro/buy-in inicial já fechou | não |
| SESSION_PENDING | identidade ainda aguarda validação | depois da validação |
| SESSION_REVOKED | sessão do dispositivo foi revogada | após nova identificação |
| SESSION_EXPIRED | sessão venceu | após nova identificação |
| IDENTITY_CONFLICT | nome/jogador conflita com associação existente | após revisão admin |
| VERSION_CONFLICT | expected_version não é a versão atual | sim, após recarregar |
| IDEMPOTENCY_CONFLICT | chave foi reutilizada com comando diferente | não; use nova chave |
| REQUEST_SET_CHANGED | lote de buy-ins mudou desde a revisão | sim, após recarregar |
| REQUEST_STATE_CONFLICT | pedido já está em estado incompatível | não |
| PURCHASE_PENDING | já existe compra adicional não terminal | depois de resolver |
| OFFER_NOT_ELIGIBLE | oferta não é válida para a contagem/estado atual | não |
| AUTHORIZATION_REQUIRED | compra adicional não foi autorizada | depois de autorizar |
| AUTHORIZATION_EXPIRED | autorização venceu | depois de nova autorização |
| AUTHORIZATION_REVOKED | autorização foi revogada | depois de nova autorização |
| AUTHORIZATION_CONSUMED | autorização de uso único já foi consumida | não |
| TOURNAMENT_STATE_CONFLICT | ação incompatível com o estado do torneio | não |
| PENDING_PAYMENT | há pagamento declarado ainda sem resolução | depois de resolver |
| DUPLICATE_TRANSACTION | transactions.request_id já foi consumido | não; recarregue |

Novos códigos exigem nova versão deste documento ou registro explícito de compatibilidade. O cliente depende
do code, nunca do texto da mensagem.

## Invariantes transacionais

1. A confirmação inicial bloqueia o torneio antes de validar a versão e o conjunto revisado.
2. Compras adicionais bloqueiam nesta ordem: torneio, participante, autorização e pedido.
3. Só o estado confirmed cria transactions, concede fichas e altera totais.
4. O snapshot do pedido preserva oferta, preço, fichas, unidades e instrução PIX vistos na solicitação.
5. Unidades elegíveis somam confirmações e reservas não terminais; término sem confirmação libera a reserva.
6. transactions.request_id é único e a repetição idempotente devolve o resultado já confirmado.
7. O cliente não envia preço efetivo, fichas efetivas, unidades efetivas nem identidade administrativa.

## Registro de compatibilidade v1 — implementação S21 (23/09/2026)

Nenhum código novo: o catálogo acima continua fechado (código fora dele aborta a RPC). As notas abaixo
são aditivas e não mudam formatos existentes. Implementação: `supabase/migrations/0013_payment_flow_rpcs.sql`.

Nomes de parâmetro: exatamente os da coluna "Entrada" (ex.: `supabase.rpc('request_buyin', { device_token, offer_id, idempotency_key })`).

Códigos do catálogo que as RPCs podem devolver além dos "previstos" da tabela:

- toda RPC: INVALID_ARGUMENT para entrada ausente ou malformada (inclusive token fora do formato base64url 43–128).
- RPCs públicas com token: NOT_FOUND para token bem formado que nunca foi registrado; a checagem da
  sessão (SESSION_PENDING/REVOKED/EXPIRED) vem antes de qualquer outra.
- identify_player: SESSION_REVOKED / SESSION_EXPIRED ao reusar token encerrado (o cliente gera token novo).
- request_buyin: NOT_FOUND e IDENTITY_CONFLICT (`details.reason = player_inactive`).
- request_purchase: NOT_FOUND, SESSION_PENDING, TOURNAMENT_STATE_CONFLICT (torneio fora de `running`).
- report_payment / cancel_purchase_request: SESSION_PENDING.
- revoke_device_session: NOT_FOUND.
- admin: AUTH_REQUIRED / ADMIN_REQUIRED em todas; NOT_FOUND quando o id não existe; confirm_buyins_and_start
  pode devolver TOURNAMENT_STATE_CONFLICT (`no_buyins`); authorize_purchase pode devolver OFFER_NOT_ELIGIBLE
  (`window_closed`) e TOURNAMENT_STATE_CONFLICT (`participant_status`).

Campos aditivos nas respostas: TournamentSummary ganha `started_at`, `registration_closed_at` e
`is_public_current`; PurchaseRequest ganha `offer_id`, `authorization_id`, `payment` (snapshot PIX),
`version`, `payment_reported_at` e `rejection_reason` (o admin recebe também `participant_id`,
`player_id`, `display_name`, `session_id`, `resolved_at`). `participant` traz unidades confirmadas e
reservadas, add-ons confirmados e `eligible_offer_ids`. identify_player e get_player_portal trazem
`next_action`: `await_validation | request_buyin | await_buyin_confirmation | open_portal`.

`retryable` é `true` quando o mesmo pedido pode dar certo depois de um evento externo, sem trocar a
entrada: AUTH_REQUIRED, SESSION_PENDING, IDENTITY_CONFLICT, VERSION_CONFLICT, REQUEST_SET_CHANGED,
PURCHASE_PENDING, AUTHORIZATION_REQUIRED e PENDING_PAYMENT.

RPC administrativa aditiva (leitura): `get_operational_tournament(tournament_id uuid default null)` →
tournament, runtime, payment, offers, participants, pending_sessions, requests, authorizations. Sem
argumento, devolve o torneio do fluxo 2 mais recente ainda não finalizado.

Semântica fixada na implementação:

- Idempotência grava só sucesso; erro não prende a chave. A chave é por sessão e vale entre comandos:
  reusar a chave em outro comando dá IDEMPOTENCY_CONFLICT.
- Sessão nova com inscrição fechada só é aceita para nome de participante já inscrito (recuperação após
  limpar o navegador); continua pendente até o admin validar.
- Autorização é consumida quando o pedido nasce. Cancelar ou rejeitar libera a reserva de unidades, mas
  uma nova compra exige nova autorização.
- Cancelar só vale antes de "informei o pagamento"; depois disso o admin rejeita.
- confirm_purchase de pedido já confirmado devolve o resultado confirmado (sem checar versão).
  confirm_purchase e update_tournament_runtime incrementam `state_version` do torneio.
- confirm_buyins_and_start marca como `withdrawn` quem ficou em `pending_buyin`.
- finish_operational_tournament expira pedidos `requested` e autorizações ativas; `payment_reported`
  bloqueia com PENDING_PAYMENT. `results` = `[{participant_id, final_placement?, payout_amount?}]`.

## Registro de compatibilidade v1 — S25 (25/09/2026)

Aditivo; nenhum código de erro novo. Implementação: `supabase/migrations/0014_finance_setup_ranking.sql`.

- `get_operational_tournament` ganha `transactions`: lançamentos confirmados do torneio no formato de
  `confirm_purchase.transaction` (`id, request_id, kind, player_id, amount, rebuy_units, chips_granted,
  confirmed_at`; dinheiro em texto). O admin deriva pote, investimento e fichas somente daí.
- `update_tournament_setup(tournament_id uuid, expected_version bigint, payload jsonb)` → tournament,
  offers, payment. `payload = {offers?, payment?}` (pelo menos um), no mesmo formato da criação.
  Ofertas: só em `draft`, ou `published` sem pedido `requested`/`payment_reported`/`confirmed`; senão
  TOURNAMENT_STATE_CONFLICT (`offers_locked`). As antigas ficam inativas; `buy_in_value` do torneio
  segue o novo buy-in. PIX: qualquer estado antes de `finished`/`cancelled`; `payment.version` + 1.
  Pedido já feito mantém o snapshot (invariante 4). Incrementa `state_version`. Erros: INVALID_ARGUMENT
  (inclusive `reason = buyin_required`), NOT_FOUND, VERSION_CONFLICT, TOURNAMENT_STATE_CONFLICT.
- `cancel_operational_tournament(tournament_id uuid, expected_version bigint)` → tournament. Só em
  `draft`, `published` ou `registration_closed`, sem lançamentos (`reason = has_transactions` por
  defesa). `payment_reported` bloqueia com PENDING_PAYMENT (`request_ids`): o admin rejeita com motivo
  antes. Efeito: `requested` → `expired`, autorizações ativas → `expired`, `pending_buyin` →
  `withdrawn`, `public_status = status = cancelled`, sai do link `/jogar`. Erros: INVALID_ARGUMENT,
  NOT_FOUND, VERSION_CONFLICT, TOURNAMENT_STATE_CONFLICT, PENDING_PAYMENT.
- `player_leaderboard()` (legado, fora do envelope) passa a considerar só torneio legado
  (`flow_version = 1`) ou do fluxo 2 finalizado — o mesmo filtro do Histórico.
