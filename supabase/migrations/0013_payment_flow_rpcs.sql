-- 0013 — S21: máquina de estados e RPCs do fluxo de portal público, PIX e compras.
--
-- Plano: docs/superpowers/specs/2026-09-17-pagamentos-publicos-rebuys-implementation-plan.md
-- Contrato: docs/contracts/rpc-v1.md (implementado aqui; nomes de parâmetro = nomes do contrato)
--
-- O que muda:
--   * helpers privados de envelope, idempotência, sessão de dispositivo, elegibilidade e JSON.
--   * 8 RPCs públicas (anon) e 10 administrativas (app_admins), todas security definer com
--     search_path vazio, execute revogado de public e concedido explicitamente.
--   * 1 RPC administrativa de leitura (get_operational_tournament), aditiva ao contrato v1.
--
-- O que NÃO muda:
--   * nenhuma tabela, coluna, constraint ou policy. Policies antigas e RPCs legadas continuam.
--   * as tabelas novas seguem sem policy: todo acesso passa por estas funções.
--
-- Regras transversais:
--   * locks sempre nesta ordem: torneio → sessão → participante → autorização → pedido.
--     O torneio é travado com FOR NO KEY UPDATE por toda RPC que muda estado dele ou de seus
--     pedidos, o que serializa as mutações de um torneio e elimina ciclos de espera.
--   * erro de domínio volta como envelope ({ok:false,error}) e só é devolvido ANTES de qualquer
--     escrita, ou de dentro de um bloco begin/exception que desfaz as escritas do bloco.
--   * só `confirmed` gera transactions, fichas e dinheiro. Pedido, declaração e autorização não.
--   * o cliente nunca informa preço, fichas, unidades ou identidade administrativa.
--
-- Depende de 0012.

do $$
begin
  if to_regclass('public.rpc_idempotency') is null or to_regprocedure('private.is_admin()') is null then
    raise exception 'Migração 0013 abortada: schema da 0012 ausente. Rode a 0012 antes.';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 1. Helpers privados
-- ════════════════════════════════════════════════════════════════════════

-- ── Formatos ────────────────────────────────────────────────────────────
create or replace function private.iso(p timestamptz)
returns text language sql stable set search_path = '' as $$
  select pg_catalog.to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

create or replace function private.money_text(p numeric)
returns text language sql stable set search_path = '' as $$
  select pg_catalog.to_char(p, 'FM999999999990.00')
$$;

-- ── Envelopes ───────────────────────────────────────────────────────────
create or replace function private.rpc_ok(p_data jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('ok', true, 'data', coalesce(p_data, '{}'::jsonb))
$$;

-- Catálogo fechado v1. Código fora da lista é bug: aborta a transação.
-- retryable = o mesmo pedido pode dar certo depois de um evento externo (recarregar,
-- validação, autenticação, pagamento resolvido), sem trocar a entrada.
create or replace function private.rpc_error(p_code text, p_details jsonb default '{}'::jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_msg text; v_retry boolean;
begin
  select c.msg, c.retry into v_msg, v_retry
    from (values
      ('INVALID_ARGUMENT',          'Dados inválidos. Revise e tente de novo.',                                   false),
      ('AUTH_REQUIRED',             'Entre com a conta de administrador.',                                        true),
      ('ADMIN_REQUIRED',            'Esta conta não tem permissão de administrador.',                             false),
      ('NOT_FOUND',                 'Não encontrado.',                                                            false),
      ('NOT_PUBLIC',                'Este torneio não está aberto ao público.',                                   false),
      ('REGISTRATION_CLOSED',       'As inscrições deste torneio já fecharam.',                                   false),
      ('SESSION_PENDING',           'Sua identificação ainda aguarda a validação do organizador.',                true),
      ('SESSION_REVOKED',           'Esta sessão foi encerrada. Identifique-se de novo.',                         false),
      ('SESSION_EXPIRED',           'Sua sessão venceu. Identifique-se de novo.',                                 false),
      ('IDENTITY_CONFLICT',         'Esta identificação conflita com um cadastro existente. Fale com o organizador.', true),
      ('VERSION_CONFLICT',          'O torneio mudou. Recarregue e revise antes de confirmar.',                   true),
      ('IDEMPOTENCY_CONFLICT',      'Esta solicitação já foi usada para outro comando.',                          false),
      ('REQUEST_SET_CHANGED',       'A lista de buy-ins mudou. Recarregue e revise antes de iniciar.',            true),
      ('REQUEST_STATE_CONFLICT',    'Este pedido já está em outro estado.',                                       false),
      ('PURCHASE_PENDING',          'Já existe uma compra em andamento para este jogador.',                       true),
      ('OFFER_NOT_ELIGIBLE',        'Esta opção não está disponível agora.',                                      false),
      ('AUTHORIZATION_REQUIRED',    'Esta compra precisa ser liberada pelo organizador.',                         true),
      ('AUTHORIZATION_EXPIRED',     'A liberação desta compra venceu.',                                           false),
      ('AUTHORIZATION_REVOKED',     'A liberação desta compra foi cancelada.',                                    false),
      ('AUTHORIZATION_CONSUMED',    'Esta liberação já foi usada.',                                               false),
      ('TOURNAMENT_STATE_CONFLICT', 'Ação indisponível no estado atual do torneio.',                              false),
      ('PENDING_PAYMENT',           'Há pagamento informado aguardando confirmação.',                             true),
      ('DUPLICATE_TRANSACTION',     'Este pedido já gerou lançamento. Recarregue.',                               false)
    ) as c(code, msg, retry)
   where c.code = p_code;
  if v_msg is null then
    raise exception 'rpc_error: código fora do catálogo v1: %', p_code;
  end if;
  return pg_catalog.jsonb_build_object('ok', false, 'error', pg_catalog.jsonb_build_object(
    'code', p_code, 'message', v_msg, 'retryable', v_retry,
    'details', coalesce(p_details, '{}'::jsonb)));
end $$;

-- ── Idempotência ────────────────────────────────────────────────────────
create or replace function private.fingerprint(p_command text, p_args jsonb)
returns bytea language sql immutable set search_path = '' as $$
  select pg_catalog.sha256(pg_catalog.convert_to(p_command || '|' || coalesce(p_args, 'null'::jsonb)::text, 'UTF8'))
$$;

-- Envelope gravado (mesma chave, mesmo comando), IDEMPOTENCY_CONFLICT (mesma chave, outro
-- comando) ou null (chave nova). Só sucessos são gravados: erro não prende a chave.
create or replace function private.idem_replay(p_actor_kind text, p_actor uuid, p_key uuid,
                                               p_command text, p_args jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare v public.rpc_idempotency;
begin
  select * into v from public.rpc_idempotency
   where actor_kind = p_actor_kind and actor_id = p_actor and idempotency_key = p_key;
  if not found then
    return null;
  end if;
  if v.command = p_command and v.fingerprint = private.fingerprint(p_command, p_args) then
    return v.response;
  end if;
  return private.rpc_error('IDEMPOTENCY_CONFLICT', pg_catalog.jsonb_build_object('command', v.command));
end $$;

create or replace function private.idem_store(p_actor_kind text, p_actor uuid, p_key uuid,
                                              p_command text, p_args jsonb, p_response jsonb)
returns jsonb language sql volatile set search_path = '' as $$
  insert into public.rpc_idempotency (actor_kind, actor_id, idempotency_key, command, fingerprint, response)
  values (p_actor_kind, p_actor, p_key, p_command, private.fingerprint(p_command, p_args), p_response);
  select p_response;
$$;

-- ── Admin e sessão ──────────────────────────────────────────────────────
create or replace function private.admin_error()
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null then
    return private.rpc_error('AUTH_REQUIRED');
  end if;
  if not private.is_admin() then
    return private.rpc_error('ADMIN_REQUIRED');
  end if;
  return null;
end $$;

-- Hash do token ou null quando o formato é inválido (sem exceção).
create or replace function private.token_hash_or_null(p_token text)
returns bytea language sql immutable set search_path = '' as $$
  select case when p_token ~ '^[A-Za-z0-9_-]{43,128}$' then private.device_token_hash(p_token) end
$$;

-- Código de erro da sessão ou null. Vencimento é aplicado aqui (status passa a expired).
create or replace function private.session_error(p_session public.player_device_sessions, p_allow_pending boolean)
returns text language plpgsql volatile set search_path = '' as $$
begin
  if p_session.id is null then
    return 'NOT_FOUND';
  end if;
  if p_session.status = 'revoked' then
    return 'SESSION_REVOKED';
  end if;
  if p_session.status = 'expired' then
    return 'SESSION_EXPIRED';
  end if;
  if p_session.expires_at <= pg_catalog.now() then
    update public.player_device_sessions set status = 'expired' where id = p_session.id;
    return 'SESSION_EXPIRED';
  end if;
  if p_session.status = 'pending' and not p_allow_pending then
    return 'SESSION_PENDING';
  end if;
  return null;
end $$;

-- Último uso + validade deslizante de 180 dias. No máximo uma escrita por minuto por sessão.
create or replace function private.touch_session(p_session_id uuid)
returns void language sql volatile set search_path = '' as $$
  update public.player_device_sessions
     set last_used_at = pg_catalog.now(),
         expires_at   = greatest(expires_at, pg_catalog.now() + interval '180 days')
   where id = p_session_id
     and status in ('pending', 'active')
     and (last_used_at is null or last_used_at < pg_catalog.now() - interval '1 minute');
$$;

-- ── Elegibilidade e janelas ─────────────────────────────────────────────
-- Unidades usadas do tipo: rebuy soma rebuy_units; buy-in e add-on contam compras.
-- Confirmados + reservas não terminais. p_exclude tira o próprio pedido da conta.
create or replace function private.used_units(p_participant uuid, p_kind text, p_exclude uuid)
returns integer language sql stable set search_path = '' as $$
  select (case when p_kind = 'rebuy' then coalesce(sum(r.rebuy_units), 0) else count(*) end)::integer
    from public.purchase_requests r
   where r.participant_id = p_participant
     and r.kind = p_kind
     and r.status in ('requested', 'payment_reported', 'confirmed')
     and r.id is distinct from p_exclude
$$;

-- Regra de contagem da oferta (não olha is_active nem janela; quem chama decide).
create or replace function private.offer_eligible(p_participant uuid, p_offer public.purchase_offers, p_exclude uuid)
returns boolean language sql stable set search_path = '' as $$
  select private.used_units(p_participant, p_offer.kind, p_exclude) = any (p_offer.eligible_after_units)
     and (p_offer.max_uses is null
          or (select count(*) from public.purchase_requests r
               where r.participant_id = p_participant
                 and r.offer_id = p_offer.id
                 and r.status in ('requested', 'payment_reported', 'confirmed')
                 and r.id is distinct from p_exclude) < p_offer.max_uses)
$$;

-- Janela aberta pelo runtime persistido. Sem data de fechamento = aberta.
create or replace function private.window_open(p_tournament uuid, p_kind text)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((
    select case p_kind when 'buyin' then rt.registration_closes_at
                       when 'rebuy' then rt.rebuy_closes_at
                       else rt.addon_closes_at end
      from public.tournament_runtime rt
     where rt.tournament_id = p_tournament
  ) > pg_catalog.now(), true)
$$;

create or replace function private.accepting_registration(p_t public.base_tournaments)
returns boolean language sql stable set search_path = '' as $$
  select p_t.public_status = 'published' and private.window_open(p_t.id, 'buyin')
$$;

create or replace function private.eligible_offer_ids(p_participant uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(o.id order by o.kind, o.sort_order, o.id), '[]'::jsonb)
    from public.tournament_participants p
    join public.purchase_offers o on o.tournament_id = p.tournament_id
   where p.id = p_participant
     and o.is_active
     and private.window_open(p.tournament_id, o.kind)
     and private.offer_eligible(p.id, o, null)
$$;

-- ── JSON ────────────────────────────────────────────────────────────────
create or replace function private.tournament_json(p_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
           'id', t.id, 'public_id', t.public_id, 'name', t.name,
           'public_status', t.public_status, 'state_version', t.state_version,
           'start_time', private.iso(t.start_time), 'started_at', private.iso(t.started_at),
           'registration_closed_at', private.iso(t.registration_closed_at),
           'is_public_current', t.is_public_current)
    from public.base_tournaments t
   where t.id = p_id
$$;

create or replace function private.offer_json(p_offer public.purchase_offers)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
           'id', p_offer.id, 'kind', p_offer.kind, 'name', p_offer.name,
           'price', private.money_text(p_offer.price), 'chips_granted', p_offer.chips_granted,
           'rebuy_units', p_offer.rebuy_units,
           'eligible_after_units', pg_catalog.to_jsonb(p_offer.eligible_after_units),
           'max_uses', p_offer.max_uses)
$$;

create or replace function private.offers_json(p_tournament uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(private.offer_json(o)
                    order by pg_catalog.array_position(array['buyin', 'rebuy', 'addon'], o.kind), o.sort_order, o.id),
                  '[]'::jsonb)
    from public.purchase_offers o
   where o.tournament_id = p_tournament and o.is_active
$$;

create or replace function private.payment_json(p_tournament uuid)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
           'pix_key_type', s.pix_key_type, 'pix_key', s.pix_key, 'receiver_name', s.receiver_name,
           'instructions', s.instructions, 'version', s.version)
    from public.tournament_payment_settings s
   where s.tournament_id = p_tournament
$$;

create or replace function private.runtime_json(p_tournament uuid)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
           'schedule', rt.schedule, 'clock_status', rt.clock_status, 'anchor_ms', rt.anchor_ms,
           'paused_elapsed_ms', rt.paused_elapsed_ms,
           'registration_closes_at', private.iso(rt.registration_closes_at),
           'rebuy_closes_at', private.iso(rt.rebuy_closes_at),
           'addon_closes_at', private.iso(rt.addon_closes_at),
           'version', rt.version, 'updated_at', private.iso(rt.updated_at))
    from public.tournament_runtime rt
   where rt.tournament_id = p_tournament
$$;

-- p_admin acrescenta vínculos internos. Nunca inclui resolved_by (UUID administrativo).
create or replace function private.request_json(p_id uuid, p_admin boolean)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
           'id', r.id, 'kind', r.kind, 'status', r.status, 'offer_id', r.offer_id,
           'offer_name', r.offer_name, 'price', private.money_text(r.price),
           'chips_granted', r.chips_granted, 'rebuy_units', r.rebuy_units,
           'authorization_id', r.authorization_id, 'payment', r.payment_snapshot,
           'version', r.version, 'payment_reported_at', private.iso(r.payment_reported_at),
           'rejection_reason', r.rejection_reason,
           'created_at', private.iso(r.created_at), 'updated_at', private.iso(r.updated_at))
      || case when p_admin then pg_catalog.jsonb_build_object(
           'participant_id', r.participant_id, 'player_id', r.player_id, 'display_name', sp.display_name,
           'session_id', r.session_id, 'resolved_at', private.iso(r.resolved_at))
         else '{}'::jsonb end
    from public.purchase_requests r
    join public.sub_players sp on sp.id = r.player_id
   where r.id = p_id
$$;

create or replace function private.participant_json(p_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
           'id', p.id, 'player_id', p.player_id, 'display_name', sp.display_name, 'status', p.status,
           'table_number', p.table_number, 'seat_number', p.seat_number,
           'final_placement', p.final_placement, 'version', p.version,
           'confirmed_rebuy_units', (select coalesce(sum(r.rebuy_units), 0) from public.purchase_requests r
                                      where r.participant_id = p.id and r.kind = 'rebuy' and r.status = 'confirmed'),
           'reserved_rebuy_units',  (select coalesce(sum(r.rebuy_units), 0) from public.purchase_requests r
                                      where r.participant_id = p.id and r.kind = 'rebuy'
                                        and r.status in ('requested', 'payment_reported')),
           'confirmed_addons',      (select count(*) from public.purchase_requests r
                                      where r.participant_id = p.id and r.kind = 'addon' and r.status = 'confirmed'),
           'eligible_offer_ids', private.eligible_offer_ids(p.id))
    from public.tournament_participants p
    join public.sub_players sp on sp.id = p.player_id
   where p.id = p_id
$$;

-- status efetivo: ativa com validade vencida aparece como expired.
create or replace function private.authorization_json(p_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
           'id', a.id, 'participant_id', a.participant_id, 'kind', a.kind,
           'status', case when a.status = 'active' and a.expires_at <= pg_catalog.now() then 'expired' else a.status end,
           'expires_at', private.iso(a.expires_at), 'created_at', private.iso(a.created_at),
           'consumed_at', private.iso(a.consumed_at), 'revoked_at', private.iso(a.revoked_at),
           'revoke_reason', a.revoke_reason,
           'offer_ids', (select coalesce(pg_catalog.jsonb_agg(ao.offer_id order by ao.offer_id), '[]'::jsonb)
                           from public.purchase_authorization_offers ao where ao.authorization_id = a.id))
    from public.purchase_authorizations a
   where a.id = p_id
$$;

create or replace function private.transaction_json(p_request uuid)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
           'id', t.id, 'request_id', t.request_id, 'kind', t.kind, 'player_id', t.player_id,
           'amount', private.money_text(t.amount), 'rebuy_units', t.rebuy_units,
           'chips_granted', t.chips_granted, 'confirmed_at', private.iso(t.confirmed_at))
    from public.transactions t
   where t.request_id = p_request
$$;

create or replace function private.session_json(p_id uuid, p_admin boolean)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
           'id', s.id, 'status', s.status, 'claimed_name', s.claimed_name,
           'player_id', s.player_id, 'display_name', sp.display_name,
           'expires_at', private.iso(s.expires_at), 'created_at', private.iso(s.created_at))
      || case when p_admin then pg_catalog.jsonb_build_object(
           'claimed_in_tournament_id', s.claimed_in_tournament_id,
           'validated_at', private.iso(s.validated_at), 'last_used_at', private.iso(s.last_used_at))
         else '{}'::jsonb end
    from public.player_device_sessions s
    left join public.sub_players sp on sp.id = s.player_id
   where s.id = p_id
$$;

-- Próximo passo do portal: await_validation | request_buyin | await_buyin_confirmation | open_portal.
create or replace function private.next_action(p_session uuid, p_tournament uuid)
returns text language plpgsql stable set search_path = '' as $$
declare v_s public.player_device_sessions; v_t public.base_tournaments; v_part uuid;
begin
  select * into v_s from public.player_device_sessions where id = p_session;
  if v_s.status = 'pending' then
    return 'await_validation';
  end if;
  select * into v_t from public.base_tournaments where id = p_tournament;
  select id into v_part from public.tournament_participants
   where tournament_id = p_tournament and player_id = v_s.player_id;
  if v_part is not null then
    if exists (select 1 from public.purchase_requests r
                where r.participant_id = v_part and r.kind = 'buyin' and r.status = 'confirmed') then
      return 'open_portal';
    end if;
    if exists (select 1 from public.purchase_requests r
                where r.participant_id = v_part and r.kind = 'buyin'
                  and r.status in ('requested', 'payment_reported')) then
      return 'await_buyin_confirmation';
    end if;
  end if;
  if private.accepting_registration(v_t) then
    return 'request_buyin';
  end if;
  return 'open_portal';
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 2. RPCs públicas
-- ════════════════════════════════════════════════════════════════════════

-- ── get_public_tournament ───────────────────────────────────────────────
create or replace function public.get_public_tournament(public_id text default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_public_id alias for $1;
  v_t public.base_tournaments;
begin
  if p_public_id is null then
    select * into v_t from public.base_tournaments where is_public_current;
  else
    select * into v_t from public.base_tournaments where public_id = p_public_id and flow_version = 2;
  end if;
  if v_t.id is null then
    return private.rpc_error('NOT_FOUND');
  end if;
  if v_t.public_status not in ('published', 'registration_closed', 'running', 'finished') then
    return private.rpc_error('NOT_PUBLIC');
  end if;
  return private.rpc_ok(jsonb_build_object(
    'tournament', private.tournament_json(v_t.id),
    'offers', private.offers_json(v_t.id),
    'payment', case when v_t.public_status in ('published', 'registration_closed', 'running')
                    then private.payment_json(v_t.id) end));
end $$;

-- ── identify_player ─────────────────────────────────────────────────────
-- Cria sessão pendente (nunca assume cadastro existente) ou devolve a sessão do token.
-- Inscrição fechada: sessão nova só para nome de participante já inscrito (recuperação
-- após limpar o navegador); o admin ainda precisa validar.
create or replace function public.identify_player(
  public_id text, claimed_name text, device_token text, idempotency_key uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_public_id alias for $1; p_claimed_name alias for $2; p_token alias for $3; p_key alias for $4;
  v_name text; v_hash bytea; v_t public.base_tournaments; v_s public.player_device_sessions;
  v_new boolean := false; v_err text; v_args jsonb; v_resp jsonb; v_player_norm text;
begin
  v_name := btrim(coalesce(p_claimed_name, ''));
  if char_length(v_name) not between 1 and 80 then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'claimed_name'));
  end if;
  v_hash := private.token_hash_or_null(p_token);
  if v_hash is null then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'device_token'));
  end if;
  if p_key is null then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'idempotency_key'));
  end if;

  if p_public_id is null then
    select * into v_t from public.base_tournaments where is_public_current;
  else
    select * into v_t from public.base_tournaments where public_id = p_public_id and flow_version = 2;
  end if;
  if v_t.id is null or v_t.public_status not in ('published', 'registration_closed', 'running') then
    return private.rpc_error('NOT_PUBLIC');
  end if;

  v_args := jsonb_build_object('public_id', p_public_id, 'claimed_name', lower(v_name));

  select * into v_s from public.player_device_sessions where token_hash = v_hash for update;
  if v_s.id is null then
    if not private.accepting_registration(v_t) and not exists (
      select 1 from public.tournament_participants tp
        join public.sub_players sp on sp.id = tp.player_id
       where tp.tournament_id = v_t.id and tp.status <> 'withdrawn'
         and sp.display_name_norm = lower(v_name)
    ) then
      return private.rpc_error('REGISTRATION_CLOSED');
    end if;
    insert into public.player_device_sessions (token_hash, claimed_name, claimed_in_tournament_id, expires_at)
    values (v_hash, v_name, v_t.id, now() + interval '180 days')
    on conflict (token_hash) do nothing
    returning * into v_s;
    v_new := v_s.id is not null;
    if not v_new then
      select * into v_s from public.player_device_sessions where token_hash = v_hash for update;
    end if;
  end if;

  v_err := private.session_error(v_s, true);
  if v_err is not null then
    return private.rpc_error(v_err);
  end if;

  v_resp := private.idem_replay('session', v_s.id, p_key, 'identify_player', v_args);
  if v_resp is not null then
    return v_resp;
  end if;

  if not v_new then
    select sp.display_name_norm into v_player_norm from public.sub_players sp where sp.id = v_s.player_id;
    if lower(btrim(v_s.claimed_name)) <> lower(v_name) and v_player_norm is distinct from lower(v_name) then
      return private.rpc_error('IDENTITY_CONFLICT', jsonb_build_object('reason', 'session_has_other_identity'));
    end if;
    if v_s.status = 'pending' and v_s.claimed_in_tournament_id is distinct from v_t.id then
      update public.player_device_sessions set claimed_in_tournament_id = v_t.id where id = v_s.id;
    end if;
  end if;

  perform private.touch_session(v_s.id);
  v_resp := private.rpc_ok(jsonb_build_object(
    'session', private.session_json(v_s.id, false),
    'tournament', private.tournament_json(v_t.id),
    'next_action', private.next_action(v_s.id, v_t.id)));
  return private.idem_store('session', v_s.id, p_key, 'identify_player', v_args, v_resp);
end $$;

-- ── get_player_portal ───────────────────────────────────────────────────
create or replace function public.get_player_portal(device_token text, public_id text default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_token alias for $1; p_public_id alias for $2;
  v_hash bytea; v_s public.player_device_sessions; v_t public.base_tournaments;
  v_err text; v_part uuid;
begin
  v_hash := private.token_hash_or_null(p_token);
  if v_hash is null then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'device_token'));
  end if;
  select * into v_s from public.player_device_sessions where token_hash = v_hash;
  v_err := private.session_error(v_s, false);
  if v_err = 'SESSION_PENDING' then
    perform private.touch_session(v_s.id);
    return private.rpc_error(v_err, jsonb_build_object('session', private.session_json(v_s.id, false)));
  elsif v_err is not null then
    return private.rpc_error(v_err);
  end if;
  perform private.touch_session(v_s.id);

  if p_public_id is null then
    select * into v_t from public.base_tournaments where is_public_current;
  else
    select * into v_t from public.base_tournaments where public_id = p_public_id and flow_version = 2;
  end if;
  if v_t.id is null or v_t.public_status not in ('published', 'registration_closed', 'running', 'finished') then
    return private.rpc_error('NOT_FOUND');
  end if;

  select id into v_part from public.tournament_participants
   where tournament_id = v_t.id and player_id = v_s.player_id;

  return private.rpc_ok(jsonb_build_object(
    'session', private.session_json(v_s.id, false),
    'tournament', private.tournament_json(v_t.id),
    'participant', case when v_part is not null then private.participant_json(v_part) end,
    'requests', coalesce((select jsonb_agg(private.request_json(r.id, false) order by r.created_at, r.id)
                            from public.purchase_requests r where r.participant_id = v_part), '[]'::jsonb),
    'authorizations', coalesce((select jsonb_agg(private.authorization_json(a.id) order by a.created_at, a.id)
                                  from public.purchase_authorizations a
                                 where a.participant_id = v_part and a.status = 'active'
                                   and (a.expires_at is null or a.expires_at > now())), '[]'::jsonb),
    'offers', private.offers_json(v_t.id),
    'payment', case when v_t.public_status in ('published', 'registration_closed', 'running')
                    then private.payment_json(v_t.id) end,
    'next_action', private.next_action(v_s.id, v_t.id)));
end $$;

-- ── request_buyin ───────────────────────────────────────────────────────
create or replace function public.request_buyin(device_token text, offer_id uuid, idempotency_key uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_token alias for $1; p_offer alias for $2; p_key alias for $3;
  v_hash bytea; v_s public.player_device_sessions; v_o public.purchase_offers;
  v_t public.base_tournaments; v_p public.tournament_participants;
  v_err text; v_args jsonb; v_resp jsonb; v_open uuid; v_req uuid;
begin
  v_hash := private.token_hash_or_null(p_token);
  if v_hash is null then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'device_token'));
  end if;
  if p_offer is null or p_key is null then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', case when p_offer is null then 'offer_id' else 'idempotency_key' end));
  end if;
  select * into v_s from public.player_device_sessions where token_hash = v_hash;
  v_err := private.session_error(v_s, false);
  if v_err is not null then
    return private.rpc_error(v_err);
  end if;
  select * into v_o from public.purchase_offers where id = p_offer;
  if v_o.id is null or v_o.kind <> 'buyin' then
    return private.rpc_error('OFFER_NOT_ELIGIBLE', jsonb_build_object('reason', 'not_a_buyin_offer'));
  end if;

  -- locks: torneio → sessão → participante
  select * into v_t from public.base_tournaments where id = v_o.tournament_id and flow_version = 2 for no key update;
  select * into v_s from public.player_device_sessions where id = v_s.id for update;
  v_err := private.session_error(v_s, false);
  if v_err is not null then
    return private.rpc_error(v_err);
  end if;

  v_args := jsonb_build_object('offer_id', p_offer);
  v_resp := private.idem_replay('session', v_s.id, p_key, 'request_buyin', v_args);
  if v_resp is not null then
    return v_resp;
  end if;

  if v_t.id is null or v_t.public_status in ('draft', 'cancelled') then
    return private.rpc_error('OFFER_NOT_ELIGIBLE', jsonb_build_object('reason', 'tournament_not_public'));
  end if;
  if not private.accepting_registration(v_t) then
    return private.rpc_error('REGISTRATION_CLOSED');
  end if;
  if not exists (select 1 from public.sub_players sp where sp.id = v_s.player_id and sp.is_active) then
    return private.rpc_error('IDENTITY_CONFLICT', jsonb_build_object('reason', 'player_inactive'));
  end if;

  select * into v_p from public.tournament_participants
   where tournament_id = v_t.id and player_id = v_s.player_id for update;
  if v_p.id is null then
    insert into public.tournament_participants (tournament_id, player_id)
    values (v_t.id, v_s.player_id)
    returning * into v_p;
  end if;

  select r.id into v_open from public.purchase_requests r
   where r.participant_id = v_p.id and r.kind = 'buyin' and r.status in ('requested', 'payment_reported');
  if v_open is not null then
    return private.rpc_error('PURCHASE_PENDING', jsonb_build_object('request_id', v_open));
  end if;
  if not v_o.is_active or not private.offer_eligible(v_p.id, v_o, null) then
    return private.rpc_error('OFFER_NOT_ELIGIBLE', jsonb_build_object('reason', 'units'));
  end if;

  insert into public.purchase_requests (
    tournament_id, participant_id, player_id, session_id, offer_id, kind, idempotency_key,
    offer_name, price, chips_granted, rebuy_units, payment_snapshot)
  values (
    v_t.id, v_p.id, v_s.player_id, v_s.id, v_o.id, 'buyin', p_key,
    v_o.name, v_o.price, v_o.chips_granted, 0, coalesce(private.payment_json(v_t.id), '{}'::jsonb))
  returning id into v_req;

  perform private.touch_session(v_s.id);
  v_resp := private.rpc_ok(jsonb_build_object('request', private.request_json(v_req, false)));
  return private.idem_store('session', v_s.id, p_key, 'request_buyin', v_args, v_resp);
end $$;

-- ── request_purchase ────────────────────────────────────────────────────
-- Rebuy/add-on liberado pelo admin. A autorização é de uso único: consumida no pedido.
create or replace function public.request_purchase(
  device_token text, authorization_id uuid, offer_id uuid, idempotency_key uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_token alias for $1; p_auth alias for $2; p_offer alias for $3; p_key alias for $4;
  v_hash bytea; v_s public.player_device_sessions; v_a public.purchase_authorizations;
  v_t public.base_tournaments; v_p public.tournament_participants; v_o public.purchase_offers;
  v_err text; v_args jsonb; v_resp jsonb; v_open uuid; v_req uuid;
begin
  v_hash := private.token_hash_or_null(p_token);
  if v_hash is null then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'device_token'));
  end if;
  if p_auth is null or p_offer is null or p_key is null then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field',
      case when p_auth is null then 'authorization_id' when p_offer is null then 'offer_id' else 'idempotency_key' end));
  end if;
  select * into v_s from public.player_device_sessions where token_hash = v_hash;
  v_err := private.session_error(v_s, false);
  if v_err is not null then
    return private.rpc_error(v_err);
  end if;
  select * into v_a from public.purchase_authorizations where id = p_auth;
  if v_a.id is null then
    return private.rpc_error('AUTHORIZATION_REQUIRED');
  end if;

  -- locks: torneio → sessão → participante → autorização
  select * into v_t from public.base_tournaments where id = v_a.tournament_id for no key update;
  select * into v_s from public.player_device_sessions where id = v_s.id for update;
  v_err := private.session_error(v_s, false);
  if v_err is not null then
    return private.rpc_error(v_err);
  end if;

  v_args := jsonb_build_object('authorization_id', p_auth, 'offer_id', p_offer);
  v_resp := private.idem_replay('session', v_s.id, p_key, 'request_purchase', v_args);
  if v_resp is not null then
    return v_resp;
  end if;

  select * into v_p from public.tournament_participants where id = v_a.participant_id for update;
  if v_p.player_id is distinct from v_s.player_id then
    -- autorização de outro jogador: não revela que existe.
    return private.rpc_error('AUTHORIZATION_REQUIRED');
  end if;
  select * into v_a from public.purchase_authorizations where id = p_auth for update;

  if v_t.public_status <> 'running' then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT', jsonb_build_object('public_status', v_t.public_status));
  end if;
  select r.id into v_open from public.purchase_requests r
   where r.participant_id = v_p.id and r.kind <> 'buyin' and r.status in ('requested', 'payment_reported');
  if v_open is not null then
    return private.rpc_error('PURCHASE_PENDING', jsonb_build_object('request_id', v_open));
  end if;
  if v_a.status = 'revoked' then
    return private.rpc_error('AUTHORIZATION_REVOKED');
  end if;
  if v_a.status = 'consumed' then
    return private.rpc_error('AUTHORIZATION_CONSUMED');
  end if;
  if v_a.status = 'expired' or v_a.expires_at <= now() then
    update public.purchase_authorizations set status = 'expired', version = version + 1
     where id = v_a.id and status = 'active';
    return private.rpc_error('AUTHORIZATION_EXPIRED');
  end if;

  select o.* into v_o
    from public.purchase_offers o
    join public.purchase_authorization_offers ao on ao.offer_id = o.id and ao.authorization_id = v_a.id
   where o.id = p_offer;
  if v_o.id is null then
    return private.rpc_error('OFFER_NOT_ELIGIBLE', jsonb_build_object('reason', 'not_authorized'));
  end if;
  if not private.window_open(v_t.id, v_o.kind) then
    return private.rpc_error('OFFER_NOT_ELIGIBLE', jsonb_build_object('reason', 'window_closed'));
  end if;
  if not ((v_o.kind = 'rebuy' and v_p.status in ('active', 'eliminated'))
          or (v_o.kind = 'addon' and v_p.status = 'active')) then
    return private.rpc_error('OFFER_NOT_ELIGIBLE', jsonb_build_object('reason', 'participant_status'));
  end if;
  if not v_o.is_active or not private.offer_eligible(v_p.id, v_o, null) then
    return private.rpc_error('OFFER_NOT_ELIGIBLE', jsonb_build_object('reason', 'units'));
  end if;

  insert into public.purchase_requests (
    tournament_id, participant_id, player_id, session_id, authorization_id, offer_id, kind,
    idempotency_key, offer_name, price, chips_granted, rebuy_units, payment_snapshot)
  values (
    v_t.id, v_p.id, v_p.player_id, v_s.id, v_a.id, v_o.id, v_o.kind,
    p_key, v_o.name, v_o.price, v_o.chips_granted, v_o.rebuy_units,
    coalesce(private.payment_json(v_t.id), '{}'::jsonb))
  returning id into v_req;

  update public.purchase_authorizations
     set status = 'consumed', consumed_at = now(), version = version + 1
   where id = v_a.id;

  perform private.touch_session(v_s.id);
  v_resp := private.rpc_ok(jsonb_build_object('request', private.request_json(v_req, false)));
  return private.idem_store('session', v_s.id, p_key, 'request_purchase', v_args, v_resp);
end $$;

-- ── report_payment / cancel_purchase_request ────────────────────────────
-- "Informei o pagamento" só muda o estado do pedido: nada de fichas nem de dinheiro.
create or replace function public.report_payment(device_token text, request_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_token alias for $1; p_req alias for $2;
  v_hash bytea; v_s public.player_device_sessions; v_r public.purchase_requests; v_err text;
begin
  v_hash := private.token_hash_or_null(p_token);
  if v_hash is null or p_req is null then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', case when v_hash is null then 'device_token' else 'request_id' end));
  end if;
  select * into v_s from public.player_device_sessions where token_hash = v_hash;
  v_err := private.session_error(v_s, false);
  if v_err is not null then
    return private.rpc_error(v_err);
  end if;
  select * into v_r from public.purchase_requests where id = p_req;
  if v_r.id is null or v_r.player_id is distinct from v_s.player_id then
    return private.rpc_error('NOT_FOUND');
  end if;

  perform 1 from public.base_tournaments where id = v_r.tournament_id for no key update;
  select * into v_s from public.player_device_sessions where id = v_s.id for update;
  v_err := private.session_error(v_s, false);
  if v_err is not null then
    return private.rpc_error(v_err);
  end if;
  perform 1 from public.tournament_participants where id = v_r.participant_id for update;
  select * into v_r from public.purchase_requests where id = p_req for update;

  if v_r.status = 'requested' then
    update public.purchase_requests
       set status = 'payment_reported', payment_reported_at = now(), version = version + 1
     where id = v_r.id;
  elsif v_r.status <> 'payment_reported' then
    return private.rpc_error('REQUEST_STATE_CONFLICT', jsonb_build_object('status', v_r.status));
  end if;
  perform private.touch_session(v_s.id);
  return private.rpc_ok(jsonb_build_object('request', private.request_json(v_r.id, false)));
end $$;

-- Cancelar só antes de declarar pagamento; depois disso quem resolve é o admin (rejeitar).
create or replace function public.cancel_purchase_request(device_token text, request_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_token alias for $1; p_req alias for $2;
  v_hash bytea; v_s public.player_device_sessions; v_r public.purchase_requests; v_err text;
begin
  v_hash := private.token_hash_or_null(p_token);
  if v_hash is null or p_req is null then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', case when v_hash is null then 'device_token' else 'request_id' end));
  end if;
  select * into v_s from public.player_device_sessions where token_hash = v_hash;
  v_err := private.session_error(v_s, false);
  if v_err is not null then
    return private.rpc_error(v_err);
  end if;
  select * into v_r from public.purchase_requests where id = p_req;
  if v_r.id is null or v_r.player_id is distinct from v_s.player_id then
    return private.rpc_error('NOT_FOUND');
  end if;

  perform 1 from public.base_tournaments where id = v_r.tournament_id for no key update;
  select * into v_s from public.player_device_sessions where id = v_s.id for update;
  v_err := private.session_error(v_s, false);
  if v_err is not null then
    return private.rpc_error(v_err);
  end if;
  perform 1 from public.tournament_participants where id = v_r.participant_id for update;
  select * into v_r from public.purchase_requests where id = p_req for update;

  if v_r.status = 'requested' then
    update public.purchase_requests set status = 'cancelled', version = version + 1 where id = v_r.id;
  elsif v_r.status <> 'cancelled' then
    return private.rpc_error('REQUEST_STATE_CONFLICT', jsonb_build_object('status', v_r.status));
  end if;
  perform private.touch_session(v_s.id);
  return private.rpc_ok(jsonb_build_object('request', private.request_json(v_r.id, false)));
end $$;

-- ── revoke_device_session ───────────────────────────────────────────────
-- "Trocar de jogador": encerra a sessão deste navegador. O cliente gera token novo depois.
create or replace function public.revoke_device_session(device_token text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_token alias for $1;
  v_hash bytea; v_s public.player_device_sessions; v_err text; v_at timestamptz;
begin
  v_hash := private.token_hash_or_null(p_token);
  if v_hash is null then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'device_token'));
  end if;
  select * into v_s from public.player_device_sessions where token_hash = v_hash for update;
  v_err := private.session_error(v_s, true);
  if v_err is not null then
    return private.rpc_error(v_err);
  end if;
  update public.player_device_sessions
     set status = 'revoked', revoked_at = now(), revoke_reason = 'encerrada pelo próprio dispositivo'
   where id = v_s.id
  returning revoked_at into v_at;
  return private.rpc_ok(jsonb_build_object('revoked_at', private.iso(v_at)));
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 3. RPCs administrativas (auth.uid() em app_admins)
-- ════════════════════════════════════════════════════════════════════════

-- ── create_operational_tournament ───────────────────────────────────────
-- payload: { name, start_time?, initial_stack?, curve_params?, payout_structure?, schedule?,
--            registration_closes_at?, rebuy_closes_at?, addon_closes_at?,
--            offers: [{ kind, name, price, chips_granted, rebuy_units?, eligible_after_units?,
--                       max_uses?, sort_order? }],
--            payment: { pix_key_type, pix_key, receiver_name, instructions? } }
create or replace function public.create_operational_tournament(payload jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_payload alias for $1;
  v_err jsonb; v_tid uuid; v_buyin numeric; v_state text; v_con text; v_col text;
begin
  v_err := private.admin_error();
  if v_err is not null then
    return v_err;
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'payload'));
  end if;
  if char_length(btrim(coalesce(p_payload->>'name', ''))) not between 1 and 120 then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'name'));
  end if;
  if jsonb_typeof(p_payload->'offers') is distinct from 'array' then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'offers'));
  end if;
  if jsonb_typeof(p_payload->'payment') is distinct from 'object' then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'payment'));
  end if;
  if exists (select 1 from jsonb_array_elements(p_payload->'offers') x
              where jsonb_typeof(x) <> 'object'
                 or coalesce(x->>'price', '') !~ '^[0-9]{1,12}([.][0-9]{1,2})?$') then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'offers.price'));
  end if;
  select (x->>'price')::numeric(14,2) into v_buyin
    from jsonb_array_elements(p_payload->'offers') with ordinality e(x, ord)
   where x->>'kind' = 'buyin'
   order by coalesce((x->>'sort_order')::int, e.ord::int), e.ord
   limit 1;
  if v_buyin is null then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'offers', 'reason', 'buyin_required'));
  end if;

  begin
    insert into public.base_tournaments (
      name, start_time, buy_in_value, initial_stack, curve_params, payout_structure,
      status, flow_version, public_status)
    values (
      btrim(p_payload->>'name'),
      coalesce((p_payload->>'start_time')::timestamptz, now()),
      v_buyin,
      coalesce((p_payload->>'initial_stack')::integer, 3750),
      coalesce(p_payload->'curve_params', '{}'::jsonb),
      coalesce(p_payload->'payout_structure', '[]'::jsonb),
      'scheduled', 2, 'draft')
    returning id into v_tid;

    insert into public.tournament_runtime (tournament_id, schedule, registration_closes_at, rebuy_closes_at, addon_closes_at)
    values (
      v_tid,
      coalesce(p_payload->'schedule', '[]'::jsonb),
      (p_payload->>'registration_closes_at')::timestamptz,
      (p_payload->>'rebuy_closes_at')::timestamptz,
      (p_payload->>'addon_closes_at')::timestamptz);

    insert into public.purchase_offers (
      tournament_id, kind, name, sort_order, price, chips_granted, rebuy_units, eligible_after_units, max_uses)
    select v_tid,
           x->>'kind',
           btrim(x->>'name'),
           coalesce((x->>'sort_order')::integer, e.ord::integer),
           (x->>'price')::numeric(14,2),
           (x->>'chips_granted')::integer,
           coalesce((x->>'rebuy_units')::integer, case when x->>'kind' = 'rebuy' then 1 else 0 end),
           case when x ? 'eligible_after_units'
                then array(select v::integer from jsonb_array_elements_text(x->'eligible_after_units') v)
                else '{0}'::integer[] end,
           (x->>'max_uses')::integer
      from jsonb_array_elements(p_payload->'offers') with ordinality e(x, ord);

    insert into public.tournament_payment_settings (tournament_id, pix_key_type, pix_key, receiver_name, instructions)
    values (
      v_tid,
      p_payload->'payment'->>'pix_key_type',
      btrim(p_payload->'payment'->>'pix_key'),
      btrim(p_payload->'payment'->>'receiver_name'),
      nullif(btrim(p_payload->'payment'->>'instructions'), ''));
  exception when data_exception or integrity_constraint_violation then
    get stacked diagnostics v_state = returned_sqlstate, v_con = constraint_name, v_col = column_name;
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object(
      'sqlstate', v_state, 'constraint', nullif(v_con, ''), 'column', nullif(v_col, '')));
  end;

  return private.rpc_ok(jsonb_build_object(
    'tournament', private.tournament_json(v_tid),
    'offers', private.offers_json(v_tid),
    'payment_version', (select version from public.tournament_payment_settings where tournament_id = v_tid)));
end $$;

-- ── publish_tournament ──────────────────────────────────────────────────
create or replace function public.publish_tournament(tournament_id uuid, expected_version bigint)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_tid alias for $1; p_expected alias for $2;
  v_err jsonb; v_t public.base_tournaments; v_other uuid;
begin
  v_err := private.admin_error();
  if v_err is not null then
    return v_err;
  end if;
  if p_tid is null or p_expected is null then
    return private.rpc_error('INVALID_ARGUMENT');
  end if;
  select * into v_t from public.base_tournaments where id = p_tid and flow_version = 2 for no key update;
  if v_t.id is null then
    return private.rpc_error('NOT_FOUND');
  end if;
  if v_t.state_version <> p_expected then
    return private.rpc_error('VERSION_CONFLICT', jsonb_build_object('current_version', v_t.state_version));
  end if;
  if v_t.public_status <> 'draft' then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT', jsonb_build_object('public_status', v_t.public_status));
  end if;
  if not exists (select 1 from public.tournament_payment_settings where tournament_id = p_tid) then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT', jsonb_build_object('reason', 'payment_missing'));
  end if;
  if not exists (select 1 from public.purchase_offers where tournament_id = p_tid and kind = 'buyin' and is_active) then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT', jsonb_build_object('reason', 'buyin_offer_missing'));
  end if;
  select id into v_other from public.base_tournaments where is_public_current and id <> p_tid;
  if v_other is not null then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT',
      jsonb_build_object('reason', 'another_public_tournament', 'tournament_id', v_other));
  end if;

  begin
    update public.base_tournaments
       set public_status = 'published',
           public_id = coalesce(public_id, 't-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
           is_public_current = true,
           state_version = state_version + 1
     where id = p_tid;
  exception when unique_violation then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT', jsonb_build_object('reason', 'another_public_tournament'));
  end;
  return private.rpc_ok(jsonb_build_object('tournament', private.tournament_json(p_tid)));
end $$;

-- ── resolve_player_claim ────────────────────────────────────────────────
-- Associa a sessão pendente a um jogador existente (player_id) ou a um cadastro novo
-- (new_display_name). Com inscrição aberta, cria o participante pending_buyin.
create or replace function public.resolve_player_claim(
  session_id uuid, player_id uuid default null, new_display_name text default null)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_session alias for $1; p_player alias for $2; p_new_name alias for $3;
  v_err jsonb; v_code text; v_s public.player_device_sessions; v_t public.base_tournaments;
  v_sp public.sub_players; v_name text; v_player uuid; v_part uuid; v_taken uuid; v_open boolean;
begin
  v_err := private.admin_error();
  if v_err is not null then
    return v_err;
  end if;
  if p_session is null or (p_player is null) = (p_new_name is null) then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('reason', 'player_id_xor_new_display_name'));
  end if;
  if p_new_name is not null then
    v_name := btrim(p_new_name);
    if char_length(v_name) not between 1 and 80 then
      return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'new_display_name'));
    end if;
  end if;

  select * into v_s from public.player_device_sessions where id = p_session;
  if v_s.id is null then
    return private.rpc_error('NOT_FOUND');
  end if;
  -- locks: torneio → sessão → participante
  if v_s.claimed_in_tournament_id is not null then
    select * into v_t from public.base_tournaments where id = v_s.claimed_in_tournament_id for no key update;
  end if;
  select * into v_s from public.player_device_sessions where id = p_session for update;

  if v_s.status = 'active' then
    if p_player is not null and v_s.player_id = p_player then
      select id into v_part from public.tournament_participants
       where tournament_id = v_t.id and player_id = p_player;
      return private.rpc_ok(jsonb_build_object(
        'session', private.session_json(v_s.id, true),
        'participant', case when v_part is not null then private.participant_json(v_part) end));
    end if;
    return private.rpc_error('IDENTITY_CONFLICT', jsonb_build_object('reason', 'session_already_active'));
  end if;
  v_code := private.session_error(v_s, true);
  if v_code is not null then
    return private.rpc_error('IDENTITY_CONFLICT', jsonb_build_object('reason', lower(v_code)));
  end if;

  if p_player is not null then
    select * into v_sp from public.sub_players where id = p_player;
    if v_sp.id is null then
      return private.rpc_error('NOT_FOUND');
    end if;
    if not v_sp.is_active then
      return private.rpc_error('IDENTITY_CONFLICT', jsonb_build_object('reason', 'player_inactive'));
    end if;
    v_player := p_player;
  else
    select id into v_taken from public.sub_players where display_name_norm = lower(v_name);
    if v_taken is not null then
      return private.rpc_error('IDENTITY_CONFLICT',
        jsonb_build_object('reason', 'display_name_taken', 'player_id', v_taken));
    end if;
  end if;

  v_open := v_t.id is not null and v_t.public_status in ('published', 'registration_closed', 'running');
  if v_open then
    if v_player is not null then
      select id into v_part from public.tournament_participants
       where tournament_id = v_t.id and player_id = v_player for update;
    end if;
    if v_part is null and not private.accepting_registration(v_t) then
      return private.rpc_error('REGISTRATION_CLOSED');
    end if;
  end if;

  begin
    if v_player is null then
      insert into public.sub_players (display_name) values (v_name) returning id into v_player;
    end if;
    if v_open and v_part is null then
      insert into public.tournament_participants (tournament_id, player_id)
      values (v_t.id, v_player)
      returning id into v_part;
    end if;
    update public.player_device_sessions
       set status = 'active', player_id = v_player, validated_at = now(), validated_by = auth.uid()
     where id = v_s.id;
  exception when unique_violation then
    return private.rpc_error('IDENTITY_CONFLICT', jsonb_build_object('reason', 'display_name_taken'));
  end;

  return private.rpc_ok(jsonb_build_object(
    'session', private.session_json(v_s.id, true),
    'participant', case when v_part is not null then private.participant_json(v_part) end));
end $$;

-- ── confirm_buyins_and_start ────────────────────────────────────────────
-- Confirma EXATAMENTE o lote revisado, fecha a inscrição e inicia o relógio, tudo ou nada.
create or replace function public.confirm_buyins_and_start(
  tournament_id uuid, expected_version bigint, reviewed_request_ids uuid[])
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_tid alias for $1; p_expected alias for $2; p_reviewed alias for $3;
  v_err jsonb; v_t public.base_tournaments; v_current uuid[]; v_reviewed uuid[];
begin
  v_err := private.admin_error();
  if v_err is not null then
    return v_err;
  end if;
  if p_tid is null or p_expected is null or p_reviewed is null or array_position(p_reviewed, null) is not null then
    return private.rpc_error('INVALID_ARGUMENT');
  end if;

  -- invariante 1: trava o torneio antes de validar versão e lote.
  select * into v_t from public.base_tournaments where id = p_tid and flow_version = 2 for no key update;
  if v_t.id is null then
    return private.rpc_error('NOT_FOUND');
  end if;
  if v_t.state_version <> p_expected then
    return private.rpc_error('VERSION_CONFLICT', jsonb_build_object('current_version', v_t.state_version));
  end if;
  if v_t.public_status not in ('published', 'registration_closed') then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT', jsonb_build_object('public_status', v_t.public_status));
  end if;

  v_reviewed := array(select distinct x from unnest(p_reviewed) x order by x);
  v_current := array(select r.id from public.purchase_requests r
                      where r.tournament_id = p_tid and r.kind = 'buyin'
                        and r.status in ('requested', 'payment_reported')
                      order by r.id);
  if v_current <> v_reviewed then
    return private.rpc_error('REQUEST_SET_CHANGED', jsonb_build_object(
      'current_request_ids', to_jsonb(v_current),
      'added', to_jsonb(array(select x from unnest(v_current) x except select y from unnest(v_reviewed) y)),
      'removed', to_jsonb(array(select y from unnest(v_reviewed) y except select x from unnest(v_current) x))));
  end if;
  if cardinality(v_current) = 0 then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT', jsonb_build_object('reason', 'no_buyins'));
  end if;
  if exists (select 1 from public.transactions where request_id = any (v_current)) then
    return private.rpc_error('DUPLICATE_TRANSACTION');
  end if;

  perform 1 from public.tournament_participants
   where id in (select r.participant_id from public.purchase_requests r where r.id = any (v_current))
   order by id for update;
  perform 1 from public.purchase_requests where id = any (v_current) order by id for update;

  begin
    update public.purchase_requests
       set status = 'confirmed', resolved_at = now(), resolved_by = auth.uid(), version = version + 1
     where id = any (v_current);

    insert into public.transactions (
      tournament_id, player_id, amount, is_rebuy, is_addon, rebuy_units, chips_granted,
      request_id, confirmed_by, confirmed_at)
    select r.tournament_id, r.player_id, r.price, false, false, 0, r.chips_granted,
           r.id, auth.uid(), now()
      from public.purchase_requests r
     where r.id = any (v_current);

    update public.tournament_participants
       set status = 'active', version = version + 1
     where id in (select r.participant_id from public.purchase_requests r where r.id = any (v_current));
    -- inscrição fechou: quem não teve buy-in confirmado sai do torneio.
    update public.tournament_participants
       set status = 'withdrawn', version = version + 1
     where tournament_id = p_tid and status = 'pending_buyin';

    update public.base_tournaments
       set public_status = 'running', status = 'running', started_at = now(),
           registration_closed_at = now(), state_version = state_version + 1
     where id = p_tid;

    insert into public.tournament_runtime (tournament_id, clock_status, anchor_ms)
    values (p_tid, 'running', (extract(epoch from now()) * 1000)::bigint)
    on conflict (tournament_id) do update
       set clock_status = 'running', anchor_ms = excluded.anchor_ms, paused_elapsed_ms = 0,
           version = public.tournament_runtime.version + 1;
  exception when unique_violation then
    return private.rpc_error('DUPLICATE_TRANSACTION');
  end;

  return private.rpc_ok(jsonb_build_object(
    'tournament', private.tournament_json(p_tid),
    'runtime', private.runtime_json(p_tid),
    'confirmed_requests', (select jsonb_agg(private.request_json(x, true) order by x) from unnest(v_current) x),
    'transactions', (select jsonb_agg(private.transaction_json(x) order by x) from unnest(v_current) x)));
end $$;

-- ── authorize_purchase ──────────────────────────────────────────────────
-- Libera rebuy/add-on para um participante. Substitui a autorização ativa do mesmo tipo.
create or replace function public.authorize_purchase(
  participant_id uuid, kind text, offer_ids uuid[], expires_at timestamptz)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_part alias for $1; p_kind alias for $2; p_offers alias for $3; p_expires alias for $4;
  v_err jsonb; v_p public.tournament_participants; v_t public.base_tournaments;
  v_ids uuid[]; v_bad jsonb; v_open uuid; v_auth uuid;
begin
  v_err := private.admin_error();
  if v_err is not null then
    return v_err;
  end if;
  if p_part is null or p_kind is null or p_kind not in ('rebuy', 'addon')
     or p_offers is null or cardinality(p_offers) = 0 or array_position(p_offers, null) is not null then
    return private.rpc_error('INVALID_ARGUMENT');
  end if;
  if p_expires is not null and p_expires <= now() then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'expires_at'));
  end if;
  v_ids := array(select distinct x from unnest(p_offers) x order by x);

  select * into v_p from public.tournament_participants where id = p_part;
  if v_p.id is null then
    return private.rpc_error('NOT_FOUND');
  end if;
  -- locks: torneio → participante → autorização
  select * into v_t from public.base_tournaments where id = v_p.tournament_id for no key update;
  if v_t.public_status <> 'running' then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT', jsonb_build_object('public_status', v_t.public_status));
  end if;
  select * into v_p from public.tournament_participants where id = p_part for update;
  if not ((p_kind = 'rebuy' and v_p.status in ('active', 'eliminated'))
          or (p_kind = 'addon' and v_p.status = 'active')) then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT',
      jsonb_build_object('reason', 'participant_status', 'status', v_p.status));
  end if;
  if not private.window_open(v_t.id, p_kind) then
    return private.rpc_error('OFFER_NOT_ELIGIBLE', jsonb_build_object('reason', 'window_closed'));
  end if;
  select r.id into v_open from public.purchase_requests r
   where r.participant_id = v_p.id and r.kind <> 'buyin' and r.status in ('requested', 'payment_reported');
  if v_open is not null then
    return private.rpc_error('PURCHASE_PENDING', jsonb_build_object('request_id', v_open));
  end if;

  select jsonb_agg(x order by x) into v_bad
    from unnest(v_ids) x
   where not exists (
     select 1 from public.purchase_offers o
      where o.id = x and o.tournament_id = v_t.id and o.kind = p_kind and o.is_active
        and private.offer_eligible(v_p.id, o, null));
  if v_bad is not null then
    return private.rpc_error('OFFER_NOT_ELIGIBLE', jsonb_build_object('offer_ids', v_bad));
  end if;

  update public.purchase_authorizations
     set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = 'substituída por nova autorização', version = version + 1
   where participant_id = v_p.id and kind = p_kind and status = 'active';

  insert into public.purchase_authorizations (tournament_id, participant_id, kind, created_by, expires_at)
  values (v_t.id, v_p.id, p_kind, auth.uid(), p_expires)
  returning id into v_auth;
  insert into public.purchase_authorization_offers (authorization_id, offer_id, tournament_id, kind)
  select v_auth, x, v_t.id, p_kind from unnest(v_ids) x;

  return private.rpc_ok(jsonb_build_object(
    'authorization', private.authorization_json(v_auth),
    'offers', (select jsonb_agg(private.offer_json(o) order by o.sort_order, o.id)
                 from public.purchase_offers o where o.id = any (v_ids))));
end $$;

-- ── confirm_purchase ────────────────────────────────────────────────────
-- Única porta de fichas e dinheiro para rebuy/add-on. Repetição devolve o resultado já confirmado.
create or replace function public.confirm_purchase(request_id uuid, expected_version bigint)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_req alias for $1; p_expected alias for $2;
  v_err jsonb; v_r public.purchase_requests; v_t public.base_tournaments;
  v_p public.tournament_participants; v_o public.purchase_offers;
begin
  v_err := private.admin_error();
  if v_err is not null then
    return v_err;
  end if;
  if p_req is null or p_expected is null then
    return private.rpc_error('INVALID_ARGUMENT');
  end if;
  select * into v_r from public.purchase_requests where id = p_req;
  if v_r.id is null then
    return private.rpc_error('NOT_FOUND');
  end if;

  -- locks: torneio → participante → autorização → pedido
  select * into v_t from public.base_tournaments where id = v_r.tournament_id for no key update;
  select * into v_p from public.tournament_participants where id = v_r.participant_id for update;
  if v_r.authorization_id is not null then
    perform 1 from public.purchase_authorizations where id = v_r.authorization_id for update;
  end if;
  select * into v_r from public.purchase_requests where id = p_req for update;

  if v_r.status <> 'confirmed' then
    if v_r.kind = 'buyin' then
      return private.rpc_error('REQUEST_STATE_CONFLICT', jsonb_build_object('reason', 'buyin_confirmed_in_batch'));
    end if;
    if v_r.version <> p_expected then
      return private.rpc_error('VERSION_CONFLICT', jsonb_build_object('current_version', v_r.version));
    end if;
    if v_r.status not in ('requested', 'payment_reported') then
      return private.rpc_error('REQUEST_STATE_CONFLICT', jsonb_build_object('status', v_r.status));
    end if;
    if v_t.public_status <> 'running' then
      return private.rpc_error('TOURNAMENT_STATE_CONFLICT', jsonb_build_object('public_status', v_t.public_status));
    end if;
    select * into v_o from public.purchase_offers where id = v_r.offer_id;
    if not private.offer_eligible(v_p.id, v_o, v_r.id) then
      return private.rpc_error('OFFER_NOT_ELIGIBLE', jsonb_build_object('reason', 'units'));
    end if;
    if exists (select 1 from public.transactions where request_id = v_r.id) then
      return private.rpc_error('DUPLICATE_TRANSACTION');
    end if;

    begin
      update public.purchase_requests
         set status = 'confirmed', resolved_at = now(), resolved_by = auth.uid(), version = version + 1
       where id = v_r.id;
      insert into public.transactions (
        tournament_id, player_id, amount, is_rebuy, is_addon, rebuy_units, chips_granted,
        request_id, confirmed_by, confirmed_at)
      values (
        v_r.tournament_id, v_r.player_id, v_r.price, v_r.kind = 'rebuy', v_r.kind = 'addon',
        v_r.rebuy_units, v_r.chips_granted, v_r.id, auth.uid(), now());
      if v_r.kind = 'rebuy' and v_p.status = 'eliminated' then
        update public.tournament_participants
           set status = 'active', eliminated_at = null, version = version + 1
         where id = v_p.id;
      end if;
      update public.base_tournaments set state_version = state_version + 1 where id = v_t.id;
    exception when unique_violation then
      return private.rpc_error('DUPLICATE_TRANSACTION');
    end;
  end if;

  return private.rpc_ok(jsonb_build_object(
    'request', private.request_json(v_r.id, true),
    'transaction', private.transaction_json(v_r.id),
    'participant', private.participant_json(v_r.participant_id),
    'tournament', private.tournament_json(v_r.tournament_id)));
end $$;

-- ── reject_purchase ─────────────────────────────────────────────────────
create or replace function public.reject_purchase(request_id uuid, reason text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_req alias for $1; p_reason alias for $2;
  v_err jsonb; v_r public.purchase_requests;
begin
  v_err := private.admin_error();
  if v_err is not null then
    return v_err;
  end if;
  if p_req is null or char_length(p_reason) > 200 then
    return private.rpc_error('INVALID_ARGUMENT');
  end if;
  select * into v_r from public.purchase_requests where id = p_req;
  if v_r.id is null then
    return private.rpc_error('NOT_FOUND');
  end if;
  perform 1 from public.base_tournaments where id = v_r.tournament_id for no key update;
  perform 1 from public.tournament_participants where id = v_r.participant_id for update;
  if v_r.authorization_id is not null then
    perform 1 from public.purchase_authorizations where id = v_r.authorization_id for update;
  end if;
  select * into v_r from public.purchase_requests where id = p_req for update;

  if v_r.status in ('requested', 'payment_reported') then
    update public.purchase_requests
       set status = 'rejected', resolved_at = now(), resolved_by = auth.uid(),
           rejection_reason = nullif(btrim(p_reason), ''), version = version + 1
     where id = v_r.id;
  elsif v_r.status <> 'rejected' then
    return private.rpc_error('REQUEST_STATE_CONFLICT', jsonb_build_object('status', v_r.status));
  end if;
  return private.rpc_ok(jsonb_build_object('request', private.request_json(v_r.id, true)));
end $$;

-- ── revoke_purchase_authorization ───────────────────────────────────────
create or replace function public.revoke_purchase_authorization(authorization_id uuid, reason text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_auth alias for $1; p_reason alias for $2;
  v_err jsonb; v_a public.purchase_authorizations; v_open uuid;
begin
  v_err := private.admin_error();
  if v_err is not null then
    return v_err;
  end if;
  if p_auth is null or char_length(p_reason) > 200 then
    return private.rpc_error('INVALID_ARGUMENT');
  end if;
  select * into v_a from public.purchase_authorizations where id = p_auth;
  if v_a.id is null then
    return private.rpc_error('NOT_FOUND');
  end if;
  perform 1 from public.base_tournaments where id = v_a.tournament_id for no key update;
  perform 1 from public.tournament_participants where id = v_a.participant_id for update;
  select * into v_a from public.purchase_authorizations where id = p_auth for update;

  if v_a.status = 'consumed' then
    select r.id into v_open from public.purchase_requests r
     where r.authorization_id = v_a.id and r.status in ('requested', 'payment_reported');
    if v_open is not null then
      -- já virou pedido: o admin resolve o pedido (rejeitar), não a autorização.
      return private.rpc_error('REQUEST_STATE_CONFLICT', jsonb_build_object('request_id', v_open));
    end if;
    return private.rpc_error('AUTHORIZATION_CONSUMED');
  end if;
  if v_a.status = 'active' and v_a.expires_at <= now() then
    update public.purchase_authorizations set status = 'expired', version = version + 1 where id = v_a.id;
  elsif v_a.status = 'active' then
    update public.purchase_authorizations
       set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
           revoke_reason = nullif(btrim(p_reason), ''), version = version + 1
     where id = v_a.id;
  end if;
  return private.rpc_ok(jsonb_build_object('authorization', private.authorization_json(v_a.id)));
end $$;

-- ── update_tournament_runtime ───────────────────────────────────────────
-- payload parcial: schedule, clock_status (idle|running|paused), anchor_ms, paused_elapsed_ms,
-- registration_closes_at, rebuy_closes_at, addon_closes_at. Chave desconhecida = INVALID_ARGUMENT.
create or replace function public.update_tournament_runtime(tournament_id uuid, expected_version bigint, payload jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_tid alias for $1; p_expected alias for $2; p_payload alias for $3;
  v_err jsonb; v_t public.base_tournaments; v_unknown jsonb; v_state text; v_con text; v_col text;
begin
  v_err := private.admin_error();
  if v_err is not null then
    return v_err;
  end if;
  if p_tid is null or p_expected is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return private.rpc_error('INVALID_ARGUMENT');
  end if;
  select jsonb_agg(k order by k) into v_unknown
    from jsonb_object_keys(p_payload) k
   where k not in ('schedule', 'clock_status', 'anchor_ms', 'paused_elapsed_ms',
                   'registration_closes_at', 'rebuy_closes_at', 'addon_closes_at');
  if v_unknown is not null then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('unknown_keys', v_unknown));
  end if;
  if p_payload ? 'clock_status' and coalesce(p_payload->>'clock_status', '') not in ('idle', 'running', 'paused') then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'clock_status'));
  end if;

  select * into v_t from public.base_tournaments where id = p_tid and flow_version = 2 for no key update;
  if v_t.id is null then
    return private.rpc_error('NOT_FOUND');
  end if;
  if v_t.state_version <> p_expected then
    return private.rpc_error('VERSION_CONFLICT', jsonb_build_object('current_version', v_t.state_version));
  end if;
  if v_t.public_status in ('finished', 'cancelled') then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT', jsonb_build_object('public_status', v_t.public_status));
  end if;
  if p_payload->>'clock_status' in ('running', 'paused') and v_t.public_status <> 'running' then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT', jsonb_build_object('reason', 'not_started'));
  end if;

  begin
    insert into public.tournament_runtime (tournament_id) values (p_tid) on conflict (tournament_id) do nothing;
    update public.tournament_runtime
       set schedule               = case when p_payload ? 'schedule' then p_payload->'schedule' else schedule end,
           clock_status           = case when p_payload ? 'clock_status' then p_payload->>'clock_status' else clock_status end,
           anchor_ms              = case when p_payload ? 'anchor_ms' then (p_payload->>'anchor_ms')::bigint else anchor_ms end,
           paused_elapsed_ms      = case when p_payload ? 'paused_elapsed_ms' then (p_payload->>'paused_elapsed_ms')::bigint else paused_elapsed_ms end,
           registration_closes_at = case when p_payload ? 'registration_closes_at' then (p_payload->>'registration_closes_at')::timestamptz else registration_closes_at end,
           rebuy_closes_at        = case when p_payload ? 'rebuy_closes_at' then (p_payload->>'rebuy_closes_at')::timestamptz else rebuy_closes_at end,
           addon_closes_at        = case when p_payload ? 'addon_closes_at' then (p_payload->>'addon_closes_at')::timestamptz else addon_closes_at end,
           version                = version + 1
     where tournament_id = p_tid;
    update public.base_tournaments set state_version = state_version + 1 where id = p_tid;
  exception when data_exception or integrity_constraint_violation then
    get stacked diagnostics v_state = returned_sqlstate, v_con = constraint_name, v_col = column_name;
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object(
      'sqlstate', v_state, 'constraint', nullif(v_con, ''), 'column', nullif(v_col, '')));
  end;

  return private.rpc_ok(jsonb_build_object(
    'runtime', private.runtime_json(p_tid),
    'tournament', private.tournament_json(p_tid)));
end $$;

-- ── finish_operational_tournament ───────────────────────────────────────
-- results: [{ participant_id, final_placement?, payout_amount? }]. Colocação vai para todas as
-- linhas do jogador; prêmio fica na linha de buy-in (mesma regra de update_tournament_results).
-- Pedido não declarado expira (libera reserva); pagamento declarado bloqueia (PENDING_PAYMENT).
create or replace function public.finish_operational_tournament(tournament_id uuid, expected_version bigint, results jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_tid alias for $1; p_expected alias for $2; p_results alias for $3;
  v_err jsonb; v_t public.base_tournaments; v_pending jsonb;
  v_ids uuid[]; v_pl integer[]; v_pay numeric[]; v_state text; v_con text; v_col text;
begin
  v_err := private.admin_error();
  if v_err is not null then
    return v_err;
  end if;
  if p_tid is null or p_expected is null or p_results is null or jsonb_typeof(p_results) <> 'array' then
    return private.rpc_error('INVALID_ARGUMENT');
  end if;

  select * into v_t from public.base_tournaments where id = p_tid and flow_version = 2 for no key update;
  if v_t.id is null then
    return private.rpc_error('NOT_FOUND');
  end if;
  if v_t.state_version <> p_expected then
    return private.rpc_error('VERSION_CONFLICT', jsonb_build_object('current_version', v_t.state_version));
  end if;
  if v_t.public_status <> 'running' then
    return private.rpc_error('TOURNAMENT_STATE_CONFLICT', jsonb_build_object('public_status', v_t.public_status));
  end if;
  select jsonb_agg(r.id order by r.id) into v_pending
    from public.purchase_requests r
   where r.tournament_id = p_tid and r.status = 'payment_reported';
  if v_pending is not null then
    return private.rpc_error('PENDING_PAYMENT', jsonb_build_object('request_ids', v_pending));
  end if;

  begin
    select coalesce(array_agg(x.participant_id order by e.ord), '{}'),
           coalesce(array_agg(x.final_placement order by e.ord), '{}'),
           coalesce(array_agg(x.payout_amount order by e.ord), '{}')
      into v_ids, v_pl, v_pay
      from jsonb_array_elements(p_results) with ordinality e(item, ord)
     cross join lateral jsonb_to_record(e.item)
           as x(participant_id uuid, final_placement integer, payout_amount numeric);
  exception when data_exception then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'results'));
  end;
  if array_position(v_ids, null) is not null
     or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x)
     or exists (select 1 from unnest(v_pl) x where x <= 0)
     or (select count(x) from unnest(v_pl) x) <> (select count(distinct x) from unnest(v_pl) x)
     or exists (select 1 from unnest(v_pay) x where x < 0 or x <> round(x, 2))
     or exists (select 1 from unnest(v_ids) x
                 where not exists (select 1 from public.tournament_participants p
                                    where p.id = x and p.tournament_id = p_tid
                                      and p.status in ('active', 'eliminated'))) then
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object('field', 'results'));
  end if;

  perform 1 from public.tournament_participants where tournament_id = p_tid order by id for update;
  perform 1 from public.purchase_requests
   where tournament_id = p_tid and status = 'requested' order by id for update;

  begin
    update public.purchase_requests
       set status = 'expired', version = version + 1
     where tournament_id = p_tid and status = 'requested';
    update public.purchase_authorizations
       set status = 'expired', version = version + 1
     where tournament_id = p_tid and status = 'active';

    update public.tournament_participants p
       set final_placement = x.pl, version = p.version + 1
      from unnest(v_ids, v_pl) as x(id, pl)
     where p.id = x.id;

    update public.transactions t
       set final_placement = x.pl,
           payout_amount   = case when t.kind = 'buyin' then coalesce(x.pay, 0) else 0 end
      from unnest(v_ids, v_pl, v_pay) as x(id, pl, pay)
      join public.tournament_participants p on p.id = x.id
     where t.tournament_id = p_tid and t.player_id = p.player_id;

    update public.base_tournaments
       set public_status = 'finished', status = 'finished', end_time_actual = now(),
           is_public_current = false, state_version = state_version + 1,
           total_prize_pool = (select coalesce(sum(t.amount), 0) from public.transactions t where t.tournament_id = p_tid)
     where id = p_tid;
    update public.tournament_runtime
       set clock_status = 'finished', version = version + 1
     where tournament_id = p_tid;
  exception when data_exception or integrity_constraint_violation then
    get stacked diagnostics v_state = returned_sqlstate, v_con = constraint_name, v_col = column_name;
    return private.rpc_error('INVALID_ARGUMENT', jsonb_build_object(
      'sqlstate', v_state, 'constraint', nullif(v_con, ''), 'column', nullif(v_col, '')));
  end;

  return private.rpc_ok(jsonb_build_object(
    'tournament', private.tournament_json(p_tid),
    'participants', (select coalesce(jsonb_agg(private.participant_json(p.id) order by p.final_placement nulls last, p.id), '[]'::jsonb)
                       from public.tournament_participants p where p.tournament_id = p_tid and p.status <> 'withdrawn'),
    'transactions', (select coalesce(jsonb_agg(private.transaction_json(t.request_id) order by t.confirmed_at, t.id), '[]'::jsonb)
                       from public.transactions t where t.tournament_id = p_tid and t.request_id is not null)));
end $$;

-- ── get_operational_tournament (leitura admin; aditiva ao contrato v1) ──
-- Sem argumento: o torneio do fluxo 2 mais recente ainda não finalizado/cancelado.
create or replace function public.get_operational_tournament(tournament_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  p_tid alias for $1;
  v_err jsonb; v_t public.base_tournaments;
begin
  v_err := private.admin_error();
  if v_err is not null then
    return v_err;
  end if;
  if p_tid is null then
    select * into v_t from public.base_tournaments
     where flow_version = 2 and public_status not in ('finished', 'cancelled')
     order by created_at desc, id limit 1;
  else
    select * into v_t from public.base_tournaments where id = p_tid and flow_version = 2;
  end if;
  if v_t.id is null then
    return private.rpc_error('NOT_FOUND');
  end if;

  return private.rpc_ok(jsonb_build_object(
    'tournament', private.tournament_json(v_t.id),
    'runtime', private.runtime_json(v_t.id),
    'payment', private.payment_json(v_t.id),
    'offers', private.offers_json(v_t.id),
    'participants', (select coalesce(jsonb_agg(private.participant_json(p.id) order by sp.display_name, p.id), '[]'::jsonb)
                       from public.tournament_participants p join public.sub_players sp on sp.id = p.player_id
                      where p.tournament_id = v_t.id),
    'pending_sessions', (select coalesce(jsonb_agg(private.session_json(s.id, true) order by s.created_at, s.id), '[]'::jsonb)
                           from public.player_device_sessions s
                          where s.claimed_in_tournament_id = v_t.id and s.status = 'pending' and s.expires_at > now()),
    'requests', (select coalesce(jsonb_agg(private.request_json(r.id, true) order by r.created_at, r.id), '[]'::jsonb)
                   from public.purchase_requests r where r.tournament_id = v_t.id),
    'authorizations', (select coalesce(jsonb_agg(private.authorization_json(a.id) order by a.created_at, a.id), '[]'::jsonb)
                         from public.purchase_authorizations a where a.tournament_id = v_t.id)));
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- 4. Permissões
-- ════════════════════════════════════════════════════════════════════════
-- O Supabase concede EXECUTE a anon/authenticated por default privilege: revoga tudo e
-- concede de novo, explicitamente. Admin RPCs ficam executáveis por anon para devolver
-- AUTH_REQUIRED no envelope; a checagem de app_admins é a primeira instrução de cada uma.
revoke all on all functions in schema private from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.get_public_tournament(text)',
    'public.identify_player(text, text, text, uuid)',
    'public.get_player_portal(text, text)',
    'public.request_buyin(text, uuid, uuid)',
    'public.request_purchase(text, uuid, uuid, uuid)',
    'public.report_payment(text, uuid)',
    'public.cancel_purchase_request(text, uuid)',
    'public.revoke_device_session(text)',
    'public.create_operational_tournament(jsonb)',
    'public.publish_tournament(uuid, bigint)',
    'public.resolve_player_claim(uuid, uuid, text)',
    'public.confirm_buyins_and_start(uuid, bigint, uuid[])',
    'public.authorize_purchase(uuid, text, uuid[], timestamptz)',
    'public.confirm_purchase(uuid, bigint)',
    'public.reject_purchase(uuid, text)',
    'public.revoke_purchase_authorization(uuid, text)',
    'public.update_tournament_runtime(uuid, bigint, jsonb)',
    'public.finish_operational_tournament(uuid, bigint, jsonb)',
    'public.get_operational_tournament(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;

comment on function public.identify_player(text, text, text, uuid) is
  'S21 / contrato rpc-v1. Sessão pendente por token de dispositivo; nunca assume cadastro existente.';
comment on function public.confirm_buyins_and_start(uuid, bigint, uuid[]) is
  'S21 / contrato rpc-v1. Confirma exatamente o lote revisado, fecha inscrição e inicia o relógio (tudo ou nada).';
comment on function public.confirm_purchase(uuid, bigint) is
  'S21 / contrato rpc-v1. Única porta de fichas/dinheiro de rebuy e add-on; repetição devolve o resultado confirmado.';
comment on function public.get_operational_tournament(uuid) is
  'S21. Leitura administrativa do torneio do fluxo 2 (fila de claims, pedidos, autorizações). Aditiva ao contrato v1.';
