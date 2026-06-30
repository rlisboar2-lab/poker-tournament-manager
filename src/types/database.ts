// src/types/database.ts
// Espelho de tipos da malha relacional. Sem runtime.

import type { BaseSetup, PayoutSlice } from '../utils/poker-math';

export type TournamentStatus =
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'finished'
  | 'cancelled';

export interface StoredCurveParams extends BaseSetup {
  target_time_minutos: number;
  duracao_bloco_nivel: number;
}

export interface BaseTournament {
  id: string;
  name: string;
  start_time: string;
  end_time_projected: string | null;
  end_time_actual: string | null;
  total_prize_pool: number;
  buy_in_value: number;
  initial_stack: number;
  curve_params: StoredCurveParams;
  payout_structure: PayoutSlice[];
  status: TournamentStatus;
  created_at: string;
  updated_at: string;
}

export interface SubPlayer {
  id: string;
  display_name: string;
  nickname: string | null;
  total_winnings: number;
  created_at: string;
}

export interface Transaction {
  id: string;
  tournament_id: string;
  player_id: string;
  amount: number;
  is_rebuy: boolean;
  is_addon: boolean;
  final_placement: number | null;
  payout_amount: number;
  created_at: string;
}

export interface SnapshotBlindStructure {
  id: string;
  tournament_id: string;
  level_index: number;
  small_blind_val: number;
  big_blind_val: number;
  duration_seconds: number;
  created_at: string;
}
