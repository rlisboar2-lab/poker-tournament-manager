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
    // Acumula ROI histórico do jogador.
    if (e.payout_amount) {
      const { data: p } = await supabase.from('sub_players').select('total_winnings').eq('id', player_id).single();
      const acc = Number(p?.total_winnings ?? 0) + e.payout_amount;
      await supabase.from('sub_players').update({ total_winnings: acc }).eq('id', player_id);
    }
  }
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
  total_winnings: number;
  total_invested: number;
  roi: number;
  events: number;
}

export async function playerLeaderboard(): Promise<PlayerStat[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data: players, error } = await supabase.from('sub_players').select('id, display_name, total_winnings');
  if (error) throw error;

  const out: PlayerStat[] = [];
  for (const p of players ?? []) {
    const { data: txs } = await supabase
      .from('transactions')
      .select('amount, tournament_id')
      .eq('player_id', p.id);
    const invested = (txs ?? []).reduce((s, t) => s + Number(t.amount), 0);
    const events = new Set((txs ?? []).map((t) => t.tournament_id)).size;
    const winnings = Number(p.total_winnings ?? 0);
    out.push({
      display_name: p.display_name,
      total_winnings: winnings,
      total_invested: invested,
      roi: invested > 0 ? (winnings - invested) / invested : 0,
      events,
    });
  }
  return out.sort((a, b) => b.roi - a.roi);
}
