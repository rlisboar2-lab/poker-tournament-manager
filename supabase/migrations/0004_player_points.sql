-- supabase/migrations/0004_player_points.sql
-- Pontuação acumulada por jogador (ranking por pontos).
-- 1º lugar = nº de participantes, 2º = nº-1, ... (mínimo 0), somado a cada torneio.

alter table sub_players
  add column if not exists total_points integer not null default 0;
