-- supabase/migrations/0001_core_schema.sql
-- DDL declarativa pura (PostgreSQL / Supabase). Sem seeds, sem lógica de app.

create extension if not exists "pgcrypto";

-- ── Máquina de estados do evento ────────────────────────────────────────
do $$ begin
  create type tournament_status as enum (
    'scheduled', 'running', 'paused', 'finished', 'cancelled'
  );
exception when duplicate_object then null; end $$;

-- ── Entidade Base_Tournaments ───────────────────────────────────────────
create table if not exists base_tournaments (
  id                  uuid primary key default gen_random_uuid(),
  name                text        not null,
  start_time          timestamptz not null default now(),
  end_time_projected  timestamptz,
  end_time_actual     timestamptz,
  total_prize_pool    numeric(14,2) not null default 0,
  buy_in_value        numeric(14,2) not null default 0,
  initial_stack       integer     not null default 3750,
  -- setup paramétrico escolhido (smallest_chip, initial_sb, initial_bb, stack_bb,
  -- target_time_minutos, duracao_bloco_nivel) + tabela de payouts:
  curve_params        jsonb       not null default '{}'::jsonb,
  payout_structure    jsonb       not null default '[]'::jsonb,
  status              tournament_status not null default 'scheduled',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ── Entidade Sub_Players ────────────────────────────────────────────────
create table if not exists sub_players (
  id              uuid primary key default gen_random_uuid(),
  display_name    text not null,
  nickname        text,
  total_winnings  numeric(14,2) not null default 0,
  created_at      timestamptz not null default now()
);

-- ── Ledger / Transactions (Entries) ─────────────────────────────────────
create table if not exists transactions (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references base_tournaments(id) on delete cascade,
  player_id       uuid not null references sub_players(id)      on delete restrict,
  amount          numeric(14,2) not null,
  is_rebuy        boolean not null default false,
  is_addon        boolean not null default false,
  final_placement integer,
  payout_amount   numeric(14,2) not null default 0,
  created_at      timestamptz not null default now()
);

create index if not exists idx_tx_tournament on transactions(tournament_id);
create index if not exists idx_tx_player     on transactions(player_id);

-- ── Snapshot_BlindStructures ────────────────────────────────────────────
create table if not exists snapshot_blindstructures (
  id               uuid primary key default gen_random_uuid(),
  tournament_id    uuid not null references base_tournaments(id) on delete cascade,
  level_index      integer not null,
  small_blind_val  integer not null,
  big_blind_val    integer not null,
  duration_seconds integer not null,
  created_at       timestamptz not null default now(),
  unique (tournament_id, level_index)
);

create index if not exists idx_blinds_tournament on snapshot_blindstructures(tournament_id);
