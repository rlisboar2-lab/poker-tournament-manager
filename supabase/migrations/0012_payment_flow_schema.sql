-- 0012 — S20: schema aditivo do fluxo de portal público, PIX e compras.
--
-- Plano: docs/superpowers/specs/2026-09-17-pagamentos-publicos-rebuys-implementation-plan.md
-- Contrato: docs/contracts/rpc-v1.md
--
-- O que muda:
--   * base_tournaments e transactions ganham colunas novas; nada é removido.
--   * tabelas novas para admin explícito, PIX, runtime, participantes, sessões de
--     dispositivo, ofertas, autorizações, pedidos e idempotência.
--   * schema `private` com helpers de admin e de token (fora da API do PostgREST).
--
-- O que NÃO muda:
--   * policies antigas ("authenticated_all") e RPCs legadas continuam valendo.
--     O app atual lê e grava histórico exatamente como antes (flow_version = 1).
--   * as tabelas novas não têm policy nenhuma: anon e authenticated não leem nem
--     escrevem direto. O acesso virá das RPCs security definer da S21.
--
-- Integridade entre tabelas: FKs compostas carregam tournament_id (e player_id /
-- kind quando importa), de modo que o banco rejeita pedido, autorização, oferta ou
-- transação cruzando torneios, jogadores ou tipos — sem depender da RPC.
--
-- Depende de 0010 (sub_players.is_active) e 0011 (RLS automático).

-- ── 0. Pré-checagens ────────────────────────────────────────────────────
do $$
declare n bigint;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'sub_players' and column_name = 'is_active'
  ) then
    raise exception 'Migração 0012 abortada: sub_players.is_active ausente. Rode a 0010 antes.';
  end if;

  -- kind é derivado dos booleanos; linha com os dois ligados não tem tipo.
  select count(*) into n from public.transactions where is_rebuy and is_addon;
  if n > 0 then
    raise exception using
      message = format('Migração 0012 abortada: %s transação(ões) com is_rebuy e is_addon ao mesmo tempo.', n),
      hint    = 'Corrija essas linhas antes: cada transação é buy-in, rebuy ou add-on.';
  end if;
end $$;

-- ── 1. Schema privado e helpers ─────────────────────────────────────────
create schema if not exists private;
revoke all on schema private from public;
comment on schema private is
  'Helpers internos do fluxo de pagamentos (S20). Não exposto pelo PostgREST; chamado pelas RPCs security definer.';

-- Token do dispositivo → hash SHA-256. O token nunca é gravado em texto puro.
-- Formato aceito: base64url com 43 a 128 caracteres (>= 256 bits de entropia
-- quando gerado com 32 bytes aleatórios pelo Web Crypto).
create or replace function private.device_token_hash(p_token text)
returns bytea
language plpgsql
immutable
strict
set search_path = ''
as $$
begin
  if p_token !~ '^[A-Za-z0-9_-]{43,128}$' then
    raise exception using errcode = '22023', message = 'device_token inválido';
  end if;
  return pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8'));
end;
$$;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

-- Mesma regra da 0010: jogador inativo não entra em torneio novo.
create or replace function private.reject_inactive_participant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.sub_players p where p.id = new.player_id and not p.is_active
  ) then
    raise exception using errcode = '23514', message = 'jogador inativo não pode participar de torneio novo';
  end if;
  return new;
end;
$$;

-- Legado: save_tournament não conhece rebuy_units. Cada linha de rebuy antiga
-- vale uma unidade; buy-in e add-on valem zero. Escritas novas informam o valor.
create or replace function private.default_rebuy_units()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.rebuy_units is null then
    new.rebuy_units := case when new.is_rebuy then 1 else 0 end;
  end if;
  return new;
end;
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- ── 2. base_tournaments ─────────────────────────────────────────────────
alter table public.base_tournaments
  add column if not exists flow_version           smallint    not null default 1,
  add column if not exists public_id              text,
  add column if not exists public_status          text,
  add column if not exists is_public_current      boolean     not null default false,
  add column if not exists started_at             timestamptz,
  add column if not exists registration_closed_at timestamptz,
  add column if not exists state_version          bigint      not null default 1;

alter table public.base_tournaments
  add constraint base_tournaments_flow_version_chk
    check (flow_version in (1, 2)),
  add constraint base_tournaments_public_status_chk
    check (public_status in ('draft', 'published', 'registration_closed', 'running', 'finished', 'cancelled')),
  -- legado (1) não tem estado público; fluxo novo (2) sempre tem.
  add constraint base_tournaments_flow_public_chk
    check (
      (flow_version = 1 and public_status is null and public_id is null and not is_public_current)
      or (flow_version = 2 and public_status is not null)
    ),
  add constraint base_tournaments_public_current_chk
    check (not is_public_current
           or (public_id is not null and public_status in ('published', 'registration_closed', 'running'))),
  add constraint base_tournaments_public_id_chk
    check (public_id ~ '^[a-z0-9-]{6,64}$'),
  add constraint base_tournaments_state_version_chk
    check (state_version > 0);

create unique index if not exists base_tournaments_public_id_uidx
  on public.base_tournaments (public_id) where public_id is not null;

-- No máximo um torneio no link global /jogar.
create unique index if not exists base_tournaments_one_public_current_uidx
  on public.base_tournaments (is_public_current) where is_public_current;

comment on column public.base_tournaments.flow_version is
  '1 = legado (torneio só existe ao salvar no fim). 2 = torneio persistente com portal, pedidos e confirmação.';
comment on column public.base_tournaments.public_id is
  'Identificador opaco da rota /jogar/:publicId. Nulo até publicar.';
comment on column public.base_tournaments.state_version is
  'Concorrência otimista: toda RPC que muda o torneio compara e incrementa.';

-- ── 3. app_admins ───────────────────────────────────────────────────────
-- Substitui "todo autenticado é admin". O UUID do responsável é cadastrado por
-- procedimento de ambiente (docs/runbooks), nunca por esta migração.
create table if not exists public.app_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- auth.uid() está em app_admins? Helper das RPCs administrativas da S21.
create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_admins a where a.user_id = auth.uid()
  );
$$;

revoke all on function private.is_admin() from public, anon, authenticated;

-- ── 4. Configuração PIX por torneio ─────────────────────────────────────
create table if not exists public.tournament_payment_settings (
  tournament_id uuid primary key references public.base_tournaments (id) on delete cascade,
  pix_key_type  text not null check (pix_key_type in ('cpf', 'cnpj', 'email', 'phone', 'random')),
  pix_key       text not null check (char_length(btrim(pix_key)) between 1 and 140),
  receiver_name text not null check (char_length(btrim(receiver_name)) between 1 and 100),
  instructions  text check (char_length(instructions) <= 500),
  version       bigint not null default 1 check (version > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── 5. Runtime do relógio ───────────────────────────────────────────────
-- Fonte de verdade do relógio no fluxo 2. live_state segue como projeção pública.
create table if not exists public.tournament_runtime (
  tournament_id          uuid primary key references public.base_tournaments (id) on delete cascade,
  schedule               jsonb  not null default '[]'::jsonb check (jsonb_typeof(schedule) = 'array'),
  clock_status           text   not null default 'idle'
                           check (clock_status in ('idle', 'running', 'paused', 'finished')),
  anchor_ms              bigint not null default 0 check (anchor_ms >= 0),
  paused_elapsed_ms      bigint not null default 0 check (paused_elapsed_ms >= 0),
  registration_closes_at timestamptz,
  rebuy_closes_at        timestamptz,
  addon_closes_at        timestamptz,
  version                bigint not null default 1 check (version > 0),
  updated_at             timestamptz not null default now()
);

-- ── 6. Participantes ────────────────────────────────────────────────────
create table if not exists public.tournament_participants (
  id                  uuid primary key default gen_random_uuid(),
  tournament_id       uuid not null references public.base_tournaments (id) on delete cascade,
  player_id           uuid not null references public.sub_players (id) on delete restrict,
  status              text not null default 'pending_buyin'
                        check (status in ('pending_buyin', 'active', 'eliminated', 'withdrawn')),
  table_number        smallint check (table_number > 0),
  seat_number         smallint check (seat_number > 0),
  final_placement     integer  check (final_placement > 0),
  eliminated_at       timestamptz,
  version             bigint not null default 1 check (version > 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint tournament_participants_one_per_player unique (tournament_id, player_id),
  constraint tournament_participants_id_tournament_uq unique (id, tournament_id),
  constraint tournament_participants_id_tournament_player_uq unique (id, tournament_id, player_id),
  constraint tournament_participants_eliminated_chk
    check (status <> 'eliminated' or eliminated_at is not null)
);

create index if not exists idx_participants_player on public.tournament_participants (player_id);

-- ── 7. Sessões de dispositivo ───────────────────────────────────────────
-- Global (não por torneio): o mesmo navegador continua identificado no próximo
-- torneio. claimed_in_tournament_id só dá contexto à fila de validação do admin.
create table if not exists public.player_device_sessions (
  id                       uuid primary key default gen_random_uuid(),
  token_hash               bytea not null unique check (octet_length(token_hash) = 32),
  player_id                uuid references public.sub_players (id) on delete restrict,
  claimed_name             text not null check (char_length(btrim(claimed_name)) between 1 and 80),
  claimed_in_tournament_id uuid references public.base_tournaments (id) on delete set null,
  status                   text not null default 'pending'
                             check (status in ('pending', 'active', 'revoked', 'expired')),
  validated_at             timestamptz,
  validated_by             uuid,
  last_used_at             timestamptz,
  expires_at               timestamptz not null,
  revoked_at               timestamptz,
  revoke_reason            text check (char_length(revoke_reason) <= 200),
  created_at               timestamptz not null default now(),
  constraint player_device_sessions_active_chk
    check (status <> 'active' or (player_id is not null and validated_at is not null)),
  constraint player_device_sessions_revoked_chk
    check (status <> 'revoked' or revoked_at is not null),
  constraint player_device_sessions_expiry_chk
    check (expires_at > created_at)
);

create index if not exists idx_device_sessions_player on public.player_device_sessions (player_id);
create index if not exists idx_device_sessions_pending
  on public.player_device_sessions (claimed_in_tournament_id) where status = 'pending';

comment on column public.player_device_sessions.token_hash is
  'SHA-256 do token do navegador (private.device_token_hash). O token em si nunca é armazenado.';

-- ── 8. Ofertas ──────────────────────────────────────────────────────────
-- eligible_after_units: quantas unidades do mesmo tipo o jogador já pode ter
-- usado para a oferta valer. Ex.: 1º simples {0}, 2º simples {1}, duplo {0}.
create table if not exists public.purchase_offers (
  id                   uuid primary key default gen_random_uuid(),
  tournament_id        uuid not null references public.base_tournaments (id) on delete cascade,
  kind                 text not null check (kind in ('buyin', 'rebuy', 'addon')),
  name                 text not null check (char_length(btrim(name)) between 1 and 60),
  sort_order           integer not null default 0,
  price                numeric(14,2) not null check (price >= 0),
  chips_granted        integer not null check (chips_granted > 0),
  rebuy_units          integer not null default 0,
  eligible_after_units integer[] not null default '{0}',
  max_uses             integer check (max_uses > 0),
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint purchase_offers_id_tournament_kind_uq unique (id, tournament_id, kind),
  constraint purchase_offers_units_chk
    check ((kind = 'rebuy' and rebuy_units between 1 and 10) or (kind <> 'rebuy' and rebuy_units = 0)),
  constraint purchase_offers_eligible_chk
    check (cardinality(eligible_after_units) between 1 and 20
           and array_position(eligible_after_units, null) is null
           and 0 <= all (eligible_after_units)
           and 100 >= all (eligible_after_units))
);

create index if not exists idx_offers_tournament on public.purchase_offers (tournament_id, kind, sort_order);

-- ── 9. Autorizações de rebuy/add-on ─────────────────────────────────────
create table if not exists public.purchase_authorizations (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null,
  participant_id uuid not null,
  kind           text not null check (kind in ('rebuy', 'addon')),
  status         text not null default 'active' check (status in ('active', 'consumed', 'revoked', 'expired')),
  created_by     uuid not null,
  expires_at     timestamptz,
  consumed_at    timestamptz,
  revoked_at     timestamptz,
  revoked_by     uuid,
  revoke_reason  text check (char_length(revoke_reason) <= 200),
  version        bigint not null default 1 check (version > 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint purchase_authorizations_participant_fk
    foreign key (participant_id, tournament_id)
    references public.tournament_participants (id, tournament_id) on delete cascade,
  constraint purchase_authorizations_id_tournament_kind_uq unique (id, tournament_id, kind),
  constraint purchase_authorizations_id_full_uq unique (id, tournament_id, participant_id, kind),
  constraint purchase_authorizations_consumed_chk check (status <> 'consumed' or consumed_at is not null),
  constraint purchase_authorizations_revoked_chk check (status <> 'revoked' or revoked_at is not null)
);

-- Uso único: no máximo uma autorização ativa por participante e tipo.
create unique index if not exists purchase_authorizations_one_active_uidx
  on public.purchase_authorizations (participant_id, kind) where status = 'active';

create table if not exists public.purchase_authorization_offers (
  authorization_id uuid not null,
  offer_id         uuid not null,
  tournament_id    uuid not null,
  kind             text not null,
  primary key (authorization_id, offer_id),
  constraint purchase_authorization_offers_authorization_fk
    foreign key (authorization_id, tournament_id, kind)
    references public.purchase_authorizations (id, tournament_id, kind) on delete cascade,
  constraint purchase_authorization_offers_offer_fk
    foreign key (offer_id, tournament_id, kind)
    references public.purchase_offers (id, tournament_id, kind) on delete cascade
);

-- ── 10. Pedidos ─────────────────────────────────────────────────────────
-- Snapshot imutável do que o jogador viu ao pedir. Só `confirmed` gera transação.
create table if not exists public.purchase_requests (
  id                  uuid primary key default gen_random_uuid(),
  tournament_id       uuid not null,
  participant_id      uuid not null,
  player_id           uuid not null,
  session_id          uuid not null references public.player_device_sessions (id) on delete restrict,
  authorization_id    uuid,
  offer_id            uuid not null,
  kind                text not null check (kind in ('buyin', 'rebuy', 'addon')),
  status              text not null default 'requested'
                        check (status in ('requested', 'payment_reported', 'confirmed', 'rejected', 'cancelled', 'expired')),
  idempotency_key     uuid not null,
  offer_name          text not null,
  price               numeric(14,2) not null check (price >= 0),
  chips_granted       integer not null check (chips_granted > 0),
  rebuy_units         integer not null,
  payment_snapshot    jsonb not null default '{}'::jsonb check (jsonb_typeof(payment_snapshot) = 'object'),
  payment_reported_at timestamptz,
  resolved_at         timestamptz,
  resolved_by         uuid,
  rejection_reason    text check (char_length(rejection_reason) <= 200),
  version             bigint not null default 1 check (version > 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint purchase_requests_participant_fk
    foreign key (participant_id, tournament_id, player_id)
    references public.tournament_participants (id, tournament_id, player_id) on delete cascade,
  constraint purchase_requests_offer_fk
    foreign key (offer_id, tournament_id, kind)
    references public.purchase_offers (id, tournament_id, kind),
  constraint purchase_requests_authorization_fk
    foreign key (authorization_id, tournament_id, participant_id, kind)
    references public.purchase_authorizations (id, tournament_id, participant_id, kind),
  -- a oferta pedida precisa estar entre as liberadas pela autorização.
  constraint purchase_requests_authorized_offer_fk
    foreign key (authorization_id, offer_id)
    references public.purchase_authorization_offers (authorization_id, offer_id),
  constraint purchase_requests_session_idempotency_uq unique (session_id, idempotency_key),
  constraint purchase_requests_id_full_uq unique (id, tournament_id, player_id, kind),
  constraint purchase_requests_authorization_kind_chk
    check ((kind = 'buyin') = (authorization_id is null)),
  constraint purchase_requests_units_chk
    check ((kind = 'rebuy' and rebuy_units between 1 and 10) or (kind <> 'rebuy' and rebuy_units = 0)),
  constraint purchase_requests_reported_chk
    check (status <> 'payment_reported' or payment_reported_at is not null),
  constraint purchase_requests_resolved_chk
    check (status not in ('confirmed', 'rejected') or resolved_at is not null)
);

-- Um buy-in vivo (pendente ou confirmado) por participante.
create unique index if not exists purchase_requests_one_buyin_uidx
  on public.purchase_requests (participant_id)
  where kind = 'buyin' and status in ('requested', 'payment_reported', 'confirmed');

-- No máximo uma compra adicional não terminal por participante (reserva determinística).
create unique index if not exists purchase_requests_one_open_extra_uidx
  on public.purchase_requests (participant_id)
  where kind <> 'buyin' and status in ('requested', 'payment_reported');

create index if not exists idx_requests_tournament_status on public.purchase_requests (tournament_id, status);

-- ── 11. Idempotência das RPCs ───────────────────────────────────────────
-- Repetição com a mesma chave e o mesmo comando devolve o envelope gravado.
-- fingerprint diferente com a mesma chave = IDEMPOTENCY_CONFLICT.
create table if not exists public.rpc_idempotency (
  actor_kind      text not null check (actor_kind in ('session', 'admin')),
  actor_id        uuid not null,
  idempotency_key uuid not null,
  command         text not null check (char_length(command) between 1 and 64),
  fingerprint     bytea not null check (octet_length(fingerprint) = 32),
  response        jsonb not null,
  created_at      timestamptz not null default now(),
  primary key (actor_kind, actor_id, idempotency_key)
);

-- ── 12. transactions: colunas novas + compatibilidade ───────────────────
alter table public.transactions
  add column if not exists request_id    uuid,
  add column if not exists kind          text generated always as (
                                           case when is_addon then 'addon'
                                                when is_rebuy then 'rebuy'
                                                else 'buyin' end
                                         ) stored,
  add column if not exists rebuy_units   integer,
  add column if not exists chips_granted integer,
  add column if not exists confirmed_by  uuid,
  add column if not exists confirmed_at  timestamptz;

-- Backfill: uma unidade por rebuy legado.
update public.transactions
   set rebuy_units = case when is_rebuy then 1 else 0 end
 where rebuy_units is null;

alter table public.transactions alter column rebuy_units set not null;

drop trigger if exists transactions_default_rebuy_units on public.transactions;
create trigger transactions_default_rebuy_units
  before insert on public.transactions
  for each row execute function private.default_rebuy_units();

alter table public.transactions
  add constraint transactions_single_kind_chk
    check (not (is_rebuy and is_addon)),
  add constraint transactions_rebuy_units_chk
    check ((is_rebuy and rebuy_units between 1 and 10) or (not is_rebuy and rebuy_units = 0)),
  add constraint transactions_chips_granted_chk
    check (chips_granted is null or chips_granted > 0),
  add constraint transactions_confirmation_chk
    check (request_id is null or confirmed_at is not null),
  add constraint transactions_request_uq unique (request_id),
  -- a transação pertence ao mesmo torneio, jogador e tipo do pedido confirmado.
  add constraint transactions_request_fk
    foreign key (request_id, tournament_id, player_id, kind)
    references public.purchase_requests (id, tournament_id, player_id, kind);

comment on column public.transactions.kind is
  'Derivado de is_rebuy/is_addon (gerado). Escritas novas continuam preenchendo os booleanos.';
comment on column public.transactions.rebuy_units is
  'Unidades de rebuy consumidas. Legado: 1 por linha de rebuy (trigger preenche quando omitido). Duplo = 2.';
comment on column public.transactions.request_id is
  'Pedido confirmado que originou a linha (fluxo 2). Único: impede concessão duplicada.';

-- ── 13. Triggers ────────────────────────────────────────────────────────
drop trigger if exists participants_reject_inactive on public.tournament_participants;
create trigger participants_reject_inactive
  before insert or update of player_id on public.tournament_participants
  for each row execute function private.reject_inactive_participant();

do $$
declare t text;
begin
  foreach t in array array[
    'tournament_payment_settings', 'tournament_runtime', 'tournament_participants',
    'purchase_offers', 'purchase_authorizations', 'purchase_requests'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function private.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end $$;

-- ── 14. RLS e grants das tabelas novas ──────────────────────────────────
-- RLS ligado e nenhuma policy: sem acesso direto de anon/authenticated.
-- O ensure_rls (0011) já liga o RLS; repetido aqui para ambientes sem o trigger.
do $$
declare t text;
begin
  foreach t in array array[
    'app_admins', 'tournament_payment_settings', 'tournament_runtime', 'tournament_participants',
    'player_device_sessions', 'purchase_offers', 'purchase_authorizations',
    'purchase_authorization_offers', 'purchase_requests', 'rpc_idempotency'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
  end loop;
end $$;
