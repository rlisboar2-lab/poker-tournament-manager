// src/services/tournaments.ts
// Camada de persistência. Tolera ausência de Supabase (modo somente-local).

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type {
  BaseTournament,
  StoredCurveParams,
} from '../types/database';
import type { BlindLevel, PayoutSlice } from '../utils/poker-math';

export interface LocalEntry {
  name: string;
  nickname?: string;
  buyins: number;   // entradas primárias deste jogador (normalmente 1)
  rebuys: number;
  addons: number;
  eliminated?: boolean;
  table?: number;   // mesa atribuída (1-based)
  seat?: number;    // assento na mesa (1-based)
  final_placement?: number;
  payout_amount?: number;
}

export interface SaveTournamentInput {
  name: string;
  start_time: string;
  end_time_projected: string | null;
  total_prize_pool: number;
  buy_in_value: number;
  rebuy_value: number;
  addon_value: number;
  initial_stack: number;
  curve_params: StoredCurveParams;
  payout_structure: PayoutSlice[];
  status: BaseTournament['status'];
  entries: LocalEntry[];
  levels: BlindLevel[];
  level_duration_seconds: number;
}

async function upsertPlayer(name: string, nickname?: string): Promise<string> {
  const { data: found } = await supabase!
    .from('sub_players')
    .select('id')
    .eq('display_name', name)
    .maybeSingle();
  if (found) return found.id as string;

  const { data, error } = await supabase!
    .from('sub_players')
    .insert({ display_name: name, nickname: nickname ?? null })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function saveTournament(input: SaveTournamentInput): Promise<string> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase não configurado (defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY).');
  }

  const { data: t, error: tErr } = await supabase
    .from('base_tournaments')
    .insert({
      name: input.name,
      start_time: input.start_time,
      end_time_projected: input.end_time_projected,
      end_time_actual: input.status === 'finished' ? new Date().toISOString() : null,
      total_prize_pool: input.total_prize_pool,
      buy_in_value: input.buy_in_value,
      initial_stack: input.initial_stack,
      curve_params: input.curve_params,
      payout_structure: input.payout_structure,
      status: input.status,
    })
    .select('id')
    .single();
  if (tErr) throw tErr;
  const tournament_id = t.id as string;

  // Snapshots de blinds.
  if (input.levels.length) {
    const { error } = await supabase.from('snapshot_blindstructures').insert(
      input.levels.map((l) => ({
        tournament_id,
        level_index: l.nivel,
        small_blind_val: l.small_blind,
        big_blind_val: l.big_blind,
        duration_seconds: input.level_duration_seconds,
      }))
    );
    if (error) throw error;
  }

  // Ledger: explode cada entry em transações atômicas.
  const rows: Record<string, unknown>[] = [];
  for (const e of input.entries) {
    const player_id = await upsertPlayer(e.name, e.nickname);
    for (let i = 0; i < Math.max(0, e.buyins); i++) {
      rows.push({
        tournament_id,
        player_id,
        amount: input.buy_in_value,
        is_rebuy: false,
        is_addon: false,
        final_placement: e.final_placement ?? null,
        payout_amount: i === 0 ? e.payout_amount ?? 0 : 0,
      });
    }
    for (let i = 0; i < Math.max(0, e.rebuys); i++) {
      rows.push({ tournament_id, player_id, amount: input.rebuy_value, is_rebuy: true, is_addon: false, payout_amount: 0 });
    }
    for (let i = 0; i < Math.max(0, e.addons); i++) {
      rows.push({ tournament_id, player_id, amount: input.addon_value, is_rebuy: false, is_addon: true, payout_amount: 0 });
    }
  }
  // Nota: pontos/ganhos/ROI são derivados das transações no ranking (nada de
  // agregados armazenados), assim editar/apagar torneios recalcula tudo certo.
  if (rows.length) {
    const { error } = await supabase.from('transactions').insert(rows);
    if (error) throw error;
  }

  return tournament_id;
}

export async function listTournaments(): Promise<BaseTournament[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from('base_tournaments')
    .select('*')
    .order('start_time', { ascending: false });
  if (error) throw error;
  return (data ?? []) as BaseTournament[];
}

export interface PlayerStat {
  display_name: string;
  points: number;
  total_winnings: number;
  total_invested: number;
  roi: number;
  events: number;
}

export interface KnownPlayer { id: string; display_name: string; }

export interface TournamentResultRow {
  player_id: string;
  display_name: string;
  buyins: number;
  rebuys: number;
  addons: number;
  invested: number;
  final_placement: number | null;
  payout_amount: number;
}

// Carrega os participantes de um torneio salvo (agregado das transações).
export async function getTournamentResults(tournamentId: string): Promise<TournamentResultRow[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data: rows, error } = await supabase
    .from('transactions')
    .select('player_id, amount, is_rebuy, is_addon, final_placement, payout_amount')
    .eq('tournament_id', tournamentId);
  if (error) throw error;
  const { data: players } = await supabase.from('sub_players').select('id, display_name');
  const nameById = new Map((players ?? []).map((p) => [p.id, p.display_name]));

  const byPlayer = new Map<string, TournamentResultRow>();
  for (const r of rows ?? []) {
    if (!byPlayer.has(r.player_id)) {
      byPlayer.set(r.player_id, {
        player_id: r.player_id, display_name: nameById.get(r.player_id) ?? '?',
        buyins: 0, rebuys: 0, addons: 0, invested: 0, final_placement: null, payout_amount: 0,
      });
    }
    const p = byPlayer.get(r.player_id)!;
    p.invested += Number(r.amount);
    if (r.is_rebuy) p.rebuys += 1; else if (r.is_addon) p.addons += 1; else p.buyins += 1;
    if (r.final_placement != null) p.final_placement = r.final_placement;
    p.payout_amount += Number(r.payout_amount ?? 0);
  }
  return [...byPlayer.values()].sort((a, b) => (a.final_placement ?? 999) - (b.final_placement ?? 999));
}

// Atualiza colocação e prêmio de cada jogador num torneio salvo.
export async function updateTournamentResults(
  tournamentId: string,
  results: { player_id: string; final_placement: number | null; payout_amount: number }[]
): Promise<void> {
  if (!supabase) return;
  const { data: rows, error } = await supabase
    .from('transactions').select('id, player_id, is_rebuy, is_addon').eq('tournament_id', tournamentId);
  if (error) throw error;

  for (const r of results) {
    const mine = (rows ?? []).filter((x) => x.player_id === r.player_id);
    if (mine.length === 0) continue;
    // Zera prêmio e aplica colocação em todas as linhas do jogador.
    const upd = await supabase.from('transactions')
      .update({ final_placement: r.final_placement, payout_amount: 0 })
      .eq('tournament_id', tournamentId).eq('player_id', r.player_id);
    if (upd.error) throw upd.error;
    // Coloca o prêmio na linha de buy-in.
    const buyin = mine.find((x) => !x.is_rebuy && !x.is_addon) ?? mine[0];
    const upd2 = await supabase.from('transactions')
      .update({ payout_amount: r.payout_amount }).eq('id', buyin.id);
    if (upd2.error) throw upd2.error;
  }
}

export async function listKnownPlayers(): Promise<KnownPlayer[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from('sub_players').select('id, display_name').order('display_name');
  if (error) throw error;
  return (data ?? []) as KnownPlayer[];
}

export async function renamePlayer(id: string, display_name: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('sub_players').update({ display_name }).eq('id', id);
  if (error) throw error;
}

export async function renameTournament(id: string, name: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from('base_tournaments').update({ name }).eq('id', id);
  if (error) throw error;
}

export async function deleteTournament(id: string): Promise<void> {
  if (!supabase) return;
  // Cascade remove transações e blinds (FK on delete cascade).
  const { error } = await supabase.from('base_tournaments').delete().eq('id', id);
  if (error) throw error;
}

// Ranking derivado das transações (sem agregados armazenados), então
// editar/apagar torneios recalcula pontos, ganhos e ROI automaticamente.
export async function playerLeaderboard(): Promise<PlayerStat[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data: players, error } = await supabase.from('sub_players').select('id, display_name');
  if (error) throw error;
  const { data: txs, error: txErr } = await supabase
    .from('transactions')
    .select('player_id, tournament_id, amount, is_rebuy, is_addon, final_placement, payout_amount');
  if (txErr) throw txErr;

  // Participantes por torneio = jogadores com buy-in (não rebuy/add-on).
  const participants = new Map<string, Set<string>>();
  // Colocação por (jogador, torneio).
  const placement = new Map<string, number>();
  for (const t of txs ?? []) {
    if (!t.is_rebuy && !t.is_addon) {
      if (!participants.has(t.tournament_id)) participants.set(t.tournament_id, new Set());
      participants.get(t.tournament_id)!.add(t.player_id);
    }
    if (t.final_placement != null) placement.set(`${t.player_id}|${t.tournament_id}`, t.final_placement);
  }

  const out: PlayerStat[] = [];
  for (const p of players ?? []) {
    const mine = (txs ?? []).filter((t) => t.player_id === p.id);
    if (mine.length === 0) continue;
    const invested = mine.reduce((s, t) => s + Number(t.amount), 0);
    const winnings = mine.reduce((s, t) => s + Number(t.payout_amount ?? 0), 0);
    const tourneys = new Set(mine.map((t) => t.tournament_id));
    let points = 0;
    for (const tid of tourneys) {
      const np = participants.get(tid)?.size ?? 0;
      const pl = placement.get(`${p.id}|${tid}`);
      if (pl) points += Math.max(0, np - pl + 1);
    }
    out.push({
      display_name: p.display_name,
      points,
      total_winnings: winnings,
      total_invested: invested,
      roi: invested > 0 ? (winnings - invested) / invested : 0,
      events: tourneys.size,
    });
  }
  // Ordena por pontos (desempate por líquido).
  return out.sort(
    (a, b) => b.points - a.points || (b.total_winnings - b.total_invested) - (a.total_winnings - a.total_invested)
  );
}
