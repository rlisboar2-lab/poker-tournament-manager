-- supabase/migrations/0005_live_state.sql
-- Estado ao vivo do torneio para telespectadores (link público, só leitura).
-- O host (logado) escreve; qualquer um lê (sem login) para acompanhar o relógio.
-- NÃO contém dados financeiros/jogadores — só o necessário pro relógio de blinds.

create table if not exists live_state (
  id                uuid primary key default gen_random_uuid(), -- id do link (/watch/:id)
  name              text not null default '',
  schedule          jsonb not null default '[]'::jsonb,          -- níveis + intervalos
  status            text not null default 'idle',                -- idle|running|paused|finished
  anchor_ms         bigint not null default 0,                   -- epoch de âncora do relógio
  paused_elapsed_ms bigint not null default 0,
  players_remaining integer not null default 1,
  total_chips       numeric not null default 0,
  updated_at        timestamptz not null default now()
);

alter table live_state enable row level security;

-- Leitura pública (telespectador sem login).
drop policy if exists "live_public_read" on live_state;
create policy "live_public_read" on live_state for select to anon, authenticated using (true);

-- Escrita apenas para autenticados (o host do torneio).
drop policy if exists "live_auth_write" on live_state;
create policy "live_auth_write" on live_state for all to authenticated using (true) with check (true);

-- Realtime (updates chegam ao vivo no /watch).
do $$ begin
  alter publication supabase_realtime add table live_state;
exception when duplicate_object then null; when undefined_object then null; end $$;
