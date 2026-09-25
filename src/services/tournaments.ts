// src/services/tournaments.ts
// Camada de persistência. Tolera ausência de Supabase (modo somente-local).

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type {
  BaseTournament,
  PurchaseKind,
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

// Torneio + blinds + jogadores + ledger numa transação só (migração 0008).
// Pontos/ganhos/ROI são derivados das transações no ranking (nada de agregados
// armazenados), assim editar/apagar torneios recalcula tudo certo.
export async function saveTournament(input: SaveTournamentInput): Promise<string> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase não configurado (defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY).');
  }

  const { data, error } = await supabase.rpc('save_tournament', { payload: input });
  if (error) throw error;
  return data as string;
}

// Histórico só mostra torneio encerrado: o fluxo 2 nasce no servidor como
// rascunho e só entra aqui depois de `finish_operational_tournament`.
export async function listTournaments(): Promise<BaseTournament[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from('base_tournaments')
    .select('*')
    .or('flow_version.eq.1,public_status.eq.finished')
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

export interface ResultPackage {
  kind: PurchaseKind;
  rebuy_units: number;
  amount: number;
}

export interface TournamentResultRow {
  player_id: string;
  display_name: string;
  buyins: number;
  rebuys: number;   // unidades de rebuy (duplo = 2), não linhas
  addons: number;
  invested: number;
  final_placement: number | null;
  payout_amount: number;
  packages: ResultPackage[]; // uma por lançamento, com o valor real gravado
}

export interface TransactionRow {
  player_id: string;
  amount: number | string;
  is_rebuy: boolean;
  is_addon: boolean;
  rebuy_units: number | null;
  final_placement: number | null;
  payout_amount: number | string | null;
}

// Agrega os lançamentos por jogador. Rebuys somam `rebuy_units` (legado tem 1
// por linha desde a 0012); investido é a soma de `amount`, nunca contagem × preço.
export function aggregateResults(rows: TransactionRow[], nameById: Map<string, string>): TournamentResultRow[] {
  const byPlayer = new Map<string, TournamentResultRow>();
  const cents = new Map<string, number>(); // soma em centavos por jogador
  for (const r of rows) {
    let p = byPlayer.get(r.player_id);
    if (!p) {
      p = {
        player_id: r.player_id, display_name: nameById.get(r.player_id) ?? '?',
        buyins: 0, rebuys: 0, addons: 0, invested: 0, final_placement: null, payout_amount: 0, packages: [],
      };
      byPlayer.set(r.player_id, p);
    }
    const amount = Number(r.amount);
    const kind: PurchaseKind = r.is_rebuy ? 'rebuy' : r.is_addon ? 'addon' : 'buyin';
    const units = kind === 'rebuy' ? Number(r.rebuy_units ?? 1) : 0;
    const c = (cents.get(r.player_id) ?? 0) + Math.round(amount * 100);
    cents.set(r.player_id, c);
    p.invested = c / 100;
    if (kind === 'rebuy') p.rebuys += units; else if (kind === 'addon') p.addons += 1; else p.buyins += 1;
    p.packages.push({ kind, rebuy_units: units, amount });
    if (r.final_placement != null) p.final_placement = r.final_placement;
    p.payout_amount += Number(r.payout_amount ?? 0);
  }
  return [...byPlayer.values()].sort((a, b) => (a.final_placement ?? 999) - (b.final_placement ?? 999));
}

// Carrega os participantes de um torneio salvo (agregado das transações).
export async function getTournamentResults(tournamentId: string): Promise<TournamentResultRow[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data: rows, error } = await supabase
    .from('transactions')
    .select('player_id, amount, is_rebuy, is_addon, rebuy_units, final_placement, payout_amount')
    .eq('tournament_id', tournamentId);
  if (error) throw error;
  const { data: players } = await supabase.from('sub_players').select('id, display_name');
  const nameById = new Map((players ?? []).map((p) => [p.id as string, p.display_name as string]));
  return aggregateResults((rows ?? []) as TransactionRow[], nameById);
}

export interface TournamentResultUpdate {
  player_id: string;
  final_placement: number | null;
  payout_amount: number;
}

// Atualiza colocação e prêmio de cada jogador num torneio salvo, em 1 comando (migração 0008).
export async function updateTournamentResults(
  tournamentId: string,
  results: TournamentResultUpdate[]
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.rpc('update_tournament_results', {
    p_tournament_id: tournamentId,
    p_results: results,
  });
  if (error) throw error;
}

export async function listKnownPlayers(): Promise<KnownPlayer[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from('sub_players').select('id, display_name').eq('is_active', true).order('display_name');
  if (error) throw error;
  return (data ?? []) as KnownPlayer[];
}

// Nomes inativos continuam no histórico, mas não podem ser incluídos em novos
// torneios. A validação definitiva também acontece em `save_tournament` no banco.
export async function listInactivePlayerNames(): Promise<string[]> {
  if (!isSupabaseConfigured || !supabase) return [];
  const { data, error } = await supabase
    .from('sub_players').select('display_name').eq('is_active', false).order('display_name');
  if (error) throw error;
  return (data ?? []).map((p) => String(p.display_name));
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
// Agregado no Postgres pela RPC `player_leaderboard` (migração 0009).
export async function playerLeaderboard(): Promise<PlayerStat[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data, error } = await supabase.rpc('player_leaderboard');
  if (error) throw error;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    display_name: String(r.display_name),
    points: Number(r.points),
    total_winnings: Number(r.total_winnings),
    total_invested: Number(r.total_invested),
    roi: Number(r.roi),
    events: Number(r.events),
  }));
}
