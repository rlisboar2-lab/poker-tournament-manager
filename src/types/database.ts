// src/types/database.ts
// Espelho de tipos da malha relacional. Sem runtime.

import type { BaseSetup, PayoutSlice } from '../utils/poker-math';

export type TournamentStatus =
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'finished'
  | 'cancelled';

export type FlowVersion = 1 | 2;

export type PublicStatus =
  | 'draft'
  | 'published'
  | 'registration_closed'
  | 'running'
  | 'finished'
  | 'cancelled';

export type PurchaseKind = 'buyin' | 'rebuy' | 'addon';

export type ParticipantStatus = 'pending_buyin' | 'active' | 'eliminated' | 'withdrawn';

export type DeviceSessionStatus = 'pending' | 'active' | 'revoked' | 'expired';

export type AuthorizationStatus = 'active' | 'consumed' | 'revoked' | 'expired';

export type PurchaseRequestStatus =
  | 'requested'
  | 'payment_reported'
  | 'confirmed'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export type PixKeyType = 'cpf' | 'cnpj' | 'email' | 'phone' | 'random';

export type ClockStatus = 'idle' | 'running' | 'paused' | 'finished';

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
  /** 1 = legado (salvo só no fim); 2 = torneio persistente com portal e pedidos (0012). */
  flow_version: FlowVersion;
  public_id: string | null;
  /** Nulo no fluxo 1; sempre preenchido no fluxo 2. */
  public_status: PublicStatus | null;
  is_public_current: boolean;
  started_at: string | null;
  registration_closed_at: string | null;
  state_version: number;
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
  /** Pedido confirmado que gerou a linha (fluxo 2). Único. */
  request_id: string | null;
  /** Coluna gerada a partir de is_rebuy/is_addon — nunca escrever. */
  kind: PurchaseKind;
  /** Unidades de rebuy consumidas: 1 por rebuy legado, 2 no duplo, 0 em buy-in/add-on. */
  rebuy_units: number;
  /** Fichas concedidas; nulo no legado. */
  chips_granted: number | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
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

// ── Fluxo de pagamentos (0012) ──────────────────────────────────────────
// Tabelas sem acesso direto de anon/authenticated: o cliente só as vê pelas
// RPCs da S21. Os tipos espelham as linhas para os serviços e testes.
// Dinheiro chega como number pelo PostgREST; o contrato RPC v1 usa texto decimal.

export interface AppAdmin {
  user_id: string;
  created_at: string;
}

export interface TournamentPaymentSettings {
  tournament_id: string;
  pix_key_type: PixKeyType;
  pix_key: string;
  receiver_name: string;
  instructions: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TournamentRuntime {
  tournament_id: string;
  schedule: unknown[];
  clock_status: ClockStatus;
  anchor_ms: number;
  paused_elapsed_ms: number;
  registration_closes_at: string | null;
  rebuy_closes_at: string | null;
  addon_closes_at: string | null;
  version: number;
  updated_at: string;
}

export interface TournamentParticipant {
  id: string;
  tournament_id: string;
  player_id: string;
  status: ParticipantStatus;
  table_number: number | null;
  seat_number: number | null;
  final_placement: number | null;
  eliminated_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

/** token_hash fica só no banco; nunca trafega para o cliente. */
export interface PlayerDeviceSession {
  id: string;
  player_id: string | null;
  claimed_name: string;
  claimed_in_tournament_id: string | null;
  status: DeviceSessionStatus;
  validated_at: string | null;
  validated_by: string | null;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
}

export interface PurchaseOffer {
  id: string;
  tournament_id: string;
  kind: PurchaseKind;
  name: string;
  sort_order: number;
  price: number;
  chips_granted: number;
  rebuy_units: number;
  /** Unidades já usadas com as quais a oferta vale. 1º simples [0], 2º simples [1], duplo [0]. */
  eligible_after_units: number[];
  max_uses: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PurchaseAuthorization {
  id: string;
  tournament_id: string;
  participant_id: string;
  kind: Exclude<PurchaseKind, 'buyin'>;
  status: AuthorizationStatus;
  created_by: string;
  expires_at: string | null;
  consumed_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface PurchaseAuthorizationOffer {
  authorization_id: string;
  offer_id: string;
  tournament_id: string;
  kind: Exclude<PurchaseKind, 'buyin'>;
}

export interface PurchaseRequest {
  id: string;
  tournament_id: string;
  participant_id: string;
  player_id: string;
  session_id: string;
  authorization_id: string | null;
  offer_id: string;
  kind: PurchaseKind;
  status: PurchaseRequestStatus;
  idempotency_key: string;
  offer_name: string;
  price: number;
  chips_granted: number;
  rebuy_units: number;
  payment_snapshot: Record<string, unknown>;
  payment_reported_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  rejection_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}
