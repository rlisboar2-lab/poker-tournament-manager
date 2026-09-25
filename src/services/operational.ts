// src/services/operational.ts
// Torneio persistente (fluxo 2): RPCs administrativas da migração 0013.
// Contrato: docs/contracts/rpc-v1.md. Regra financeira, locks, idempotência e
// validação ficam no banco — aqui só se tipa, se valida o formato e se traduz.
// O cliente nunca envia preço efetivo, fichas efetivas nem unidades efetivas
// de um pedido: só a configuração das ofertas, na criação do torneio.

import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type {
  ClockStatus,
  ParticipantStatus,
  PixKeyType,
  PublicStatus,
  PurchaseKind,
  PurchaseRequestStatus,
  AuthorizationStatus,
  DeviceSessionStatus,
} from '../types/database';

// ── Envelopes ─────────────────────────────────────────────────────────────

/** Catálogo fechado v1. Código fora da lista é quebra de contrato, não erro de domínio. */
export const RPC_ERROR_CODES = [
  'INVALID_ARGUMENT',
  'AUTH_REQUIRED',
  'ADMIN_REQUIRED',
  'NOT_FOUND',
  'NOT_PUBLIC',
  'REGISTRATION_CLOSED',
  'SESSION_PENDING',
  'SESSION_REVOKED',
  'SESSION_EXPIRED',
  'IDENTITY_CONFLICT',
  'VERSION_CONFLICT',
  'IDEMPOTENCY_CONFLICT',
  'REQUEST_SET_CHANGED',
  'REQUEST_STATE_CONFLICT',
  'PURCHASE_PENDING',
  'OFFER_NOT_ELIGIBLE',
  'AUTHORIZATION_REQUIRED',
  'AUTHORIZATION_EXPIRED',
  'AUTHORIZATION_REVOKED',
  'AUTHORIZATION_CONSUMED',
  'TOURNAMENT_STATE_CONFLICT',
  'PENDING_PAYMENT',
  'DUPLICATE_TRANSACTION',
] as const;

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

export interface RpcError {
  code: RpcErrorCode;
  message: string;
  retryable: boolean;
  details: Record<string, unknown>;
}

export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: RpcError };

/** Resposta fora do contrato v1 (bug de servidor ou versão errada). Nunca é erro de domínio. */
export class ContractError extends Error {
  constructor(message: string) {
    super(`Resposta fora do contrato RPC v1: ${message}`);
    this.name = 'ContractError';
  }
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isErrorCode = (v: unknown): v is RpcErrorCode =>
  typeof v === 'string' && (RPC_ERROR_CODES as readonly string[]).includes(v);

/** Valida o envelope e aplica `parseData` ao `data` do sucesso. */
export function parseEnvelope<T>(raw: unknown, parseData: (data: unknown) => T): RpcResult<T> {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean') throw new ContractError('envelope sem "ok"');
  if (raw.ok) return { ok: true, data: parseData(raw.data) };
  const e = raw.error;
  if (!isRecord(e)) throw new ContractError('erro sem objeto "error"');
  if (!isErrorCode(e.code)) throw new ContractError(`código desconhecido ${JSON.stringify(e.code)}`);
  return {
    ok: false,
    error: {
      code: e.code,
      message: typeof e.message === 'string' ? e.message : '',
      retryable: e.retryable === true,
      details: isRecord(e.details) ? e.details : {},
    },
  };
}

/**
 * Conflito que se resolve recarregando o estado do servidor. O cliente nunca
 * reenvia o comando com o cache local: recarrega e deixa o admin revisar.
 */
export const needsReload = (code: RpcErrorCode): boolean =>
  code === 'VERSION_CONFLICT' || code === 'REQUEST_SET_CHANGED';

/** Banco sem a 0013 (produção ainda no corte 0012): PostgREST não acha a função. */
export function isMissingRpc(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  return err?.code === 'PGRST202' || /could not find the function/i.test(err?.message ?? '');
}

// ── Conversões de formato ─────────────────────────────────────────────────
// Exportadas também para o serviço público (publicPortal.ts).

/** Dinheiro cruza a API como texto decimal com duas casas ("15.00"). */
export function toMoneyText(value: number): string {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`Valor inválido: ${value}`);
  return value.toFixed(2);
}

export function parseMoney(v: unknown, field: string): number {
  if (typeof v !== 'string' || !/^\d{1,12}(\.\d{1,2})?$/.test(v)) throw new ContractError(`${field} não é dinheiro em texto`);
  return Number(v);
}

export function str(o: Record<string, unknown>, k: string): string {
  const v = o[k];
  if (typeof v !== 'string') throw new ContractError(`${k} deveria ser texto`);
  return v;
}

export function strOrNull(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  if (v == null) return null;
  if (typeof v !== 'string') throw new ContractError(`${k} deveria ser texto ou null`);
  return v;
}

export function int(o: Record<string, unknown>, k: string): number {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isInteger(v)) throw new ContractError(`${k} deveria ser inteiro`);
  return v;
}

export function intOrNull(o: Record<string, unknown>, k: string): number | null {
  return o[k] == null ? null : int(o, k);
}

export function oneOf<T extends string>(o: Record<string, unknown>, k: string, allowed: readonly T[]): T {
  const v = o[k];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    throw new ContractError(`${k} fora de ${allowed.join('|')}`);
  }
  return v as T;
}

export function rec(v: unknown, what: string): Record<string, unknown> {
  if (!isRecord(v)) throw new ContractError(`${what} deveria ser objeto`);
  return v;
}

export function arr<T>(v: unknown, what: string, item: (x: unknown) => T): T[] {
  if (!Array.isArray(v)) throw new ContractError(`${what} deveria ser lista`);
  return v.map(item);
}

// ── Formatos do contrato ──────────────────────────────────────────────────

const PUBLIC_STATUSES: readonly PublicStatus[] = ['draft', 'published', 'registration_closed', 'running', 'finished', 'cancelled'];
export const PURCHASE_KINDS: readonly PurchaseKind[] = ['buyin', 'rebuy', 'addon'];
export const REQUEST_STATUSES: readonly PurchaseRequestStatus[] = ['requested', 'payment_reported', 'confirmed', 'rejected', 'cancelled', 'expired'];
const PARTICIPANT_STATUSES: readonly ParticipantStatus[] = ['pending_buyin', 'active', 'eliminated', 'withdrawn'];
const AUTH_STATUSES: readonly AuthorizationStatus[] = ['active', 'consumed', 'revoked', 'expired'];
const SESSION_STATUSES: readonly DeviceSessionStatus[] = ['pending', 'active', 'revoked', 'expired'];
const CLOCK_STATUSES: readonly ClockStatus[] = ['idle', 'running', 'paused', 'finished'];
const PIX_KEY_TYPES: readonly PixKeyType[] = ['cpf', 'cnpj', 'email', 'phone', 'random'];

export interface TournamentSummary {
  id: string;
  public_id: string | null; // nulo enquanto rascunho
  name: string;
  public_status: PublicStatus;
  state_version: number;
  start_time: string;
  started_at: string | null;
  registration_closed_at: string | null;
  is_public_current: boolean;
}

export function parseTournamentSummary(v: unknown): TournamentSummary {
  const o = rec(v, 'tournament');
  return {
    id: str(o, 'id'),
    public_id: strOrNull(o, 'public_id'),
    name: str(o, 'name'),
    public_status: oneOf(o, 'public_status', PUBLIC_STATUSES),
    state_version: int(o, 'state_version'),
    start_time: str(o, 'start_time'),
    started_at: strOrNull(o, 'started_at'),
    registration_closed_at: strOrNull(o, 'registration_closed_at'),
    is_public_current: o.is_public_current === true,
  };
}

export interface Offer {
  id: string;
  kind: PurchaseKind;
  name: string;
  price: number;
  chips_granted: number;
  rebuy_units: number;
  eligible_after_units: number[];
  max_uses: number | null;
}

export function parseOffer(v: unknown): Offer {
  const o = rec(v, 'offer');
  return {
    id: str(o, 'id'),
    kind: oneOf(o, 'kind', PURCHASE_KINDS),
    name: str(o, 'name'),
    price: parseMoney(o.price, 'offer.price'),
    chips_granted: int(o, 'chips_granted'),
    rebuy_units: int(o, 'rebuy_units'),
    eligible_after_units: arr(o.eligible_after_units, 'eligible_after_units', (x) => {
      if (typeof x !== 'number' || !Number.isInteger(x)) throw new ContractError('eligible_after_units');
      return x;
    }),
    max_uses: intOrNull(o, 'max_uses'),
  };
}

export interface PaymentSettings {
  pix_key_type: PixKeyType;
  pix_key: string;
  receiver_name: string;
  instructions: string | null;
  version: number;
}

export function parsePayment(v: unknown): PaymentSettings | null {
  if (v == null) return null;
  const o = rec(v, 'payment');
  return {
    pix_key_type: oneOf(o, 'pix_key_type', PIX_KEY_TYPES),
    pix_key: str(o, 'pix_key'),
    receiver_name: str(o, 'receiver_name'),
    instructions: strOrNull(o, 'instructions'),
    version: int(o, 'version'),
  };
}

export interface Runtime {
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

export function parseRuntime(v: unknown): Runtime | null {
  if (v == null) return null;
  const o = rec(v, 'runtime');
  return {
    schedule: arr(o.schedule, 'schedule', (x) => x),
    clock_status: oneOf(o, 'clock_status', CLOCK_STATUSES),
    anchor_ms: int(o, 'anchor_ms'),
    paused_elapsed_ms: int(o, 'paused_elapsed_ms'),
    registration_closes_at: strOrNull(o, 'registration_closes_at'),
    rebuy_closes_at: strOrNull(o, 'rebuy_closes_at'),
    addon_closes_at: strOrNull(o, 'addon_closes_at'),
    version: int(o, 'version'),
    updated_at: str(o, 'updated_at'),
  };
}

export interface Participant {
  id: string;
  player_id: string;
  display_name: string;
  status: ParticipantStatus;
  table_number: number | null;
  seat_number: number | null;
  final_placement: number | null;
  version: number;
  confirmed_rebuy_units: number;
  reserved_rebuy_units: number;
  confirmed_addons: number;
  eligible_offer_ids: string[];
}

export function parseParticipant(v: unknown): Participant {
  const o = rec(v, 'participant');
  return {
    id: str(o, 'id'),
    player_id: str(o, 'player_id'),
    display_name: str(o, 'display_name'),
    status: oneOf(o, 'status', PARTICIPANT_STATUSES),
    table_number: intOrNull(o, 'table_number'),
    seat_number: intOrNull(o, 'seat_number'),
    final_placement: intOrNull(o, 'final_placement'),
    version: int(o, 'version'),
    confirmed_rebuy_units: int(o, 'confirmed_rebuy_units'),
    reserved_rebuy_units: int(o, 'reserved_rebuy_units'),
    confirmed_addons: int(o, 'confirmed_addons'),
    eligible_offer_ids: arr(o.eligible_offer_ids ?? [], 'eligible_offer_ids', (x) => {
      if (typeof x !== 'string') throw new ContractError('eligible_offer_ids');
      return x;
    }),
  };
}

/** PurchaseRequest na visão administrativa (campos aditivos da S21 incluídos). */
export interface AdminPurchaseRequest {
  id: string;
  kind: PurchaseKind;
  status: PurchaseRequestStatus;
  offer_id: string;
  offer_name: string;
  price: number;
  chips_granted: number;
  rebuy_units: number;
  authorization_id: string | null;
  version: number;
  payment_reported_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
  participant_id: string;
  player_id: string;
  display_name: string;
  session_id: string;
  resolved_at: string | null;
}

export function parseAdminRequest(v: unknown): AdminPurchaseRequest {
  const o = rec(v, 'request');
  return {
    id: str(o, 'id'),
    kind: oneOf(o, 'kind', PURCHASE_KINDS),
    status: oneOf(o, 'status', REQUEST_STATUSES),
    offer_id: str(o, 'offer_id'),
    offer_name: str(o, 'offer_name'),
    price: parseMoney(o.price, 'request.price'),
    chips_granted: int(o, 'chips_granted'),
    rebuy_units: int(o, 'rebuy_units'),
    authorization_id: strOrNull(o, 'authorization_id'),
    version: int(o, 'version'),
    payment_reported_at: strOrNull(o, 'payment_reported_at'),
    rejection_reason: strOrNull(o, 'rejection_reason'),
    created_at: str(o, 'created_at'),
    updated_at: str(o, 'updated_at'),
    participant_id: str(o, 'participant_id'),
    player_id: str(o, 'player_id'),
    display_name: str(o, 'display_name'),
    session_id: str(o, 'session_id'),
    resolved_at: strOrNull(o, 'resolved_at'),
  };
}

export interface Authorization {
  id: string;
  participant_id: string;
  kind: Exclude<PurchaseKind, 'buyin'>;
  status: AuthorizationStatus;
  expires_at: string | null;
  created_at: string;
  consumed_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  offer_ids: string[];
}

export function parseAuthorization(v: unknown): Authorization {
  const o = rec(v, 'authorization');
  return {
    id: str(o, 'id'),
    participant_id: str(o, 'participant_id'),
    kind: oneOf(o, 'kind', ['rebuy', 'addon'] as const),
    status: oneOf(o, 'status', AUTH_STATUSES),
    expires_at: strOrNull(o, 'expires_at'),
    created_at: str(o, 'created_at'),
    consumed_at: strOrNull(o, 'consumed_at'),
    revoked_at: strOrNull(o, 'revoked_at'),
    revoke_reason: strOrNull(o, 'revoke_reason'),
    offer_ids: arr(o.offer_ids, 'offer_ids', (x) => {
      if (typeof x !== 'string') throw new ContractError('offer_ids');
      return x;
    }),
  };
}

export interface PendingSession {
  id: string;
  status: DeviceSessionStatus;
  claimed_name: string;
  player_id: string | null;
  display_name: string | null;
  expires_at: string;
  created_at: string;
}

export function parsePendingSession(v: unknown): PendingSession {
  const o = rec(v, 'session');
  return {
    id: str(o, 'id'),
    status: oneOf(o, 'status', SESSION_STATUSES),
    claimed_name: str(o, 'claimed_name'),
    player_id: strOrNull(o, 'player_id'),
    display_name: strOrNull(o, 'display_name'),
    expires_at: str(o, 'expires_at'),
    created_at: str(o, 'created_at'),
  };
}

/** Leitura completa do torneio operacional (get_operational_tournament). */
export interface OperationalSnapshot {
  tournament: TournamentSummary;
  runtime: Runtime | null;
  payment: PaymentSettings | null;
  offers: Offer[];
  participants: Participant[];
  pending_sessions: PendingSession[];
  requests: AdminPurchaseRequest[];
  authorizations: Authorization[];
}

export function parseSnapshot(v: unknown): OperationalSnapshot {
  const o = rec(v, 'data');
  return {
    tournament: parseTournamentSummary(o.tournament),
    runtime: parseRuntime(o.runtime),
    payment: parsePayment(o.payment),
    offers: arr(o.offers, 'offers', parseOffer),
    participants: arr(o.participants, 'participants', parseParticipant),
    pending_sessions: arr(o.pending_sessions, 'pending_sessions', parsePendingSession),
    requests: arr(o.requests, 'requests', parseAdminRequest),
    authorizations: arr(o.authorizations, 'authorizations', parseAuthorization),
  };
}

// ── Entradas ──────────────────────────────────────────────────────────────

export interface OfferInput {
  kind: PurchaseKind;
  name: string;
  price: number;
  chips_granted: number;
  rebuy_units?: number;
  eligible_after_units?: number[];
  max_uses?: number | null;
  sort_order?: number;
}

export interface PaymentInput {
  pix_key_type: PixKeyType;
  pix_key: string;
  receiver_name: string;
  instructions?: string | null;
}

export interface CreateTournamentInput {
  name: string;
  start_time: string;
  initial_stack: number;
  curve_params: Record<string, unknown>;
  payout_structure: unknown[];
  schedule?: unknown[];
  offers: OfferInput[];
  payment: PaymentInput;
}

/** Payload no formato do cabeçalho de create_operational_tournament (0013). */
export function toCreatePayload(input: CreateTournamentInput): Record<string, unknown> {
  return {
    name: input.name.trim(),
    start_time: input.start_time,
    initial_stack: input.initial_stack,
    curve_params: input.curve_params,
    payout_structure: input.payout_structure,
    ...(input.schedule ? { schedule: input.schedule } : {}),
    offers: input.offers.map((o, i) => ({
      kind: o.kind,
      name: o.name.trim(),
      price: toMoneyText(o.price),
      chips_granted: o.chips_granted,
      ...(o.rebuy_units != null ? { rebuy_units: o.rebuy_units } : {}),
      ...(o.eligible_after_units ? { eligible_after_units: o.eligible_after_units } : {}),
      ...(o.max_uses != null ? { max_uses: o.max_uses } : {}),
      sort_order: o.sort_order ?? i + 1,
    })),
    payment: {
      pix_key_type: input.payment.pix_key_type,
      pix_key: input.payment.pix_key.trim(),
      receiver_name: input.payment.receiver_name.trim(),
      ...(input.payment.instructions?.trim() ? { instructions: input.payment.instructions.trim() } : {}),
    },
  };
}

export interface RuntimePatch {
  schedule?: unknown[];
  clock_status?: Exclude<ClockStatus, 'finished'>;
  anchor_ms?: number;
  paused_elapsed_ms?: number;
  registration_closes_at?: string | null;
  rebuy_closes_at?: string | null;
  addon_closes_at?: string | null;
}

export interface FinishResult {
  participant_id: string;
  final_placement?: number;
  payout_amount?: number;
}

// ── Chamadas ──────────────────────────────────────────────────────────────

export async function callRpc<T>(fn: string, args: Record<string, unknown>, parseData: (d: unknown) => T): Promise<RpcResult<T>> {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error('Supabase não configurado (defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY).');
  }
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error; // infraestrutura: canal de erro do Supabase
  return parseEnvelope(data, parseData);
}

export interface CreatedTournament {
  tournament: TournamentSummary;
  offers: Offer[];
  payment_version: number;
}

export const createOperationalTournament = (input: CreateTournamentInput) =>
  callRpc('create_operational_tournament', { payload: toCreatePayload(input) }, (d): CreatedTournament => {
    const o = rec(d, 'data');
    return {
      tournament: parseTournamentSummary(o.tournament),
      offers: arr(o.offers, 'offers', parseOffer),
      payment_version: int(o, 'payment_version'),
    };
  });

export const publishTournament = (tournamentId: string, expectedVersion: number) =>
  callRpc('publish_tournament', { tournament_id: tournamentId, expected_version: expectedVersion },
    (d) => ({ tournament: parseTournamentSummary(rec(d, 'data').tournament) }));

/** Sem id: o torneio do fluxo 2 mais recente ainda não finalizado/cancelado. */
export const getOperationalTournament = (tournamentId: string | null = null) =>
  callRpc('get_operational_tournament', { tournament_id: tournamentId }, parseSnapshot);

export const updateTournamentRuntime = (tournamentId: string, expectedVersion: number, patch: RuntimePatch) =>
  callRpc('update_tournament_runtime', { tournament_id: tournamentId, expected_version: expectedVersion, payload: patch },
    (d) => {
      const o = rec(d, 'data');
      return { runtime: parseRuntime(o.runtime), tournament: parseTournamentSummary(o.tournament) };
    });

export const finishOperationalTournament = (tournamentId: string, expectedVersion: number, results: FinishResult[]) =>
  callRpc('finish_operational_tournament', {
    tournament_id: tournamentId,
    expected_version: expectedVersion,
    results: results.map((r) => ({
      participant_id: r.participant_id,
      ...(r.final_placement != null ? { final_placement: r.final_placement } : {}),
      // Arredondado a centavos: o banco recusa prêmio com mais de 2 casas.
      ...(r.payout_amount != null ? { payout_amount: Math.round(r.payout_amount * 100) / 100 } : {}),
    })),
  }, (d) => {
    const o = rec(d, 'data');
    return {
      tournament: parseTournamentSummary(o.tournament),
      participants: arr(o.participants, 'participants', parseParticipant),
    };
  });

// ── Fila ao vivo (S24): identidades, lote inicial e compras ──────────────
// Fichas e dinheiro só existem depois do envelope ok destas RPCs: o cliente
// não aplica nada antes da resposta do banco.

/** Linha de transactions devolvida pelas confirmações (dinheiro em texto → number). */
export interface ConfirmedTransaction {
  id: string;
  request_id: string;
  kind: PurchaseKind;
  player_id: string;
  amount: number;
  rebuy_units: number;
  chips_granted: number | null;
  confirmed_at: string | null;
}

export function parseTransaction(v: unknown): ConfirmedTransaction {
  const o = rec(v, 'transaction');
  return {
    id: str(o, 'id'),
    request_id: str(o, 'request_id'),
    kind: oneOf(o, 'kind', PURCHASE_KINDS),
    player_id: str(o, 'player_id'),
    amount: parseMoney(o.amount, 'transaction.amount'),
    rebuy_units: int(o, 'rebuy_units'),
    chips_granted: intOrNull(o, 'chips_granted'),
    confirmed_at: strOrNull(o, 'confirmed_at'),
  };
}

/** Validar identidade: vincular a jogador existente XOR criar nome novo. */
export type ClaimTarget = { playerId: string } | { newDisplayName: string };

export interface ResolvedClaim {
  session: PendingSession;
  participant: Participant | null; // null quando não há torneio aberto
}

export const parseResolvedClaim = (d: unknown): ResolvedClaim => {
  const o = rec(d, 'data');
  return {
    session: parsePendingSession(o.session),
    participant: o.participant == null ? null : parseParticipant(o.participant),
  };
};

export const resolvePlayerClaim = (sessionId: string, target: ClaimTarget) =>
  callRpc('resolve_player_claim', {
    session_id: sessionId,
    player_id: 'playerId' in target ? target.playerId : null,
    new_display_name: 'newDisplayName' in target ? target.newDisplayName.trim() : null,
  }, parseResolvedClaim);

export interface StartedTournament {
  tournament: TournamentSummary;
  runtime: Runtime; // âncora do servidor: o motor local começa daqui, não de Date.now()
  confirmed_requests: AdminPurchaseRequest[];
  transactions: ConfirmedTransaction[];
}

export const parseStarted = (d: unknown): StartedTournament => {
  const o = rec(d, 'data');
  const runtime = parseRuntime(o.runtime);
  if (!runtime) throw new ContractError('runtime ausente após iniciar');
  return {
    tournament: parseTournamentSummary(o.tournament),
    runtime,
    confirmed_requests: arr(o.confirmed_requests ?? [], 'confirmed_requests', parseAdminRequest),
    transactions: arr(o.transactions ?? [], 'transactions', parseTransaction),
  };
};

/** Confirma exatamente o lote revisado e inicia o relógio no servidor (tudo ou nada). */
export const confirmBuyinsAndStart = (tournamentId: string, expectedVersion: number, reviewedRequestIds: string[]) =>
  callRpc('confirm_buyins_and_start', {
    tournament_id: tournamentId,
    expected_version: expectedVersion,
    reviewed_request_ids: reviewedRequestIds,
  }, parseStarted);

export interface AuthorizedPurchase {
  authorization: Authorization;
  offers: Offer[];
}

export const parseAuthorized = (d: unknown): AuthorizedPurchase => {
  const o = rec(d, 'data');
  return {
    authorization: parseAuthorization(o.authorization),
    offers: arr(o.offers ?? [], 'offers', parseOffer),
  };
};

/** Libera rebuy/add-on a um participante. `expiresAt` null = sem validade. */
export const authorizePurchase = (
  participantId: string, kind: Exclude<PurchaseKind, 'buyin'>, offerIds: string[], expiresAt: string | null,
) =>
  callRpc('authorize_purchase', {
    participant_id: participantId,
    kind,
    offer_ids: offerIds,
    expires_at: expiresAt,
  }, parseAuthorized);

export interface ConfirmedPurchase {
  request: AdminPurchaseRequest;
  transaction: ConfirmedTransaction;
  participant: Participant;
  tournament: TournamentSummary;
}

export const parseConfirmedPurchase = (d: unknown): ConfirmedPurchase => {
  const o = rec(d, 'data');
  return {
    request: parseAdminRequest(o.request),
    transaction: parseTransaction(o.transaction),
    participant: parseParticipant(o.participant),
    tournament: parseTournamentSummary(o.tournament),
  };
};

/** Única porta de fichas/dinheiro de rebuy e add-on. Versão = a do pedido, não a do torneio. */
export const confirmPurchase = (requestId: string, expectedVersion: number) =>
  callRpc('confirm_purchase', { request_id: requestId, expected_version: expectedVersion }, parseConfirmedPurchase);

export const rejectPurchase = (requestId: string, reason: string) =>
  callRpc('reject_purchase', { request_id: requestId, reason: reason.trim() },
    (d) => ({ request: parseAdminRequest(rec(d, 'data').request) }));

export const revokePurchaseAuthorization = (authorizationId: string, reason: string) =>
  callRpc('revoke_purchase_authorization', { authorization_id: authorizationId, reason: reason.trim() },
    (d) => ({ authorization: parseAuthorization(rec(d, 'data').authorization) }));

// ── Mensagens ─────────────────────────────────────────────────────────────

/** Texto pt-BR para o admin. Depende só do code (o contrato proíbe depender da message). */
export function describeError(e: RpcError): string {
  const reason = typeof e.details.reason === 'string' ? e.details.reason : null;
  switch (e.code) {
    case 'AUTH_REQUIRED': return 'Sessão expirada. Entre de novo.';
    case 'ADMIN_REQUIRED': return 'Este usuário não é administrador do app.';
    case 'NOT_FOUND': return 'Registro não encontrado no servidor. Recarregue.';
    case 'VERSION_CONFLICT':
    case 'REQUEST_SET_CHANGED':
      return 'O torneio mudou no servidor. O estado foi recarregado: revise e tente de novo.';
    case 'INVALID_ARGUMENT': {
      const field = typeof e.details.field === 'string' ? e.details.field
        : typeof e.details.column === 'string' ? e.details.column : null;
      return field ? `Dado inválido: ${field}.` : 'Dados inválidos.';
    }
    case 'TOURNAMENT_STATE_CONFLICT':
      if (reason === 'another_public_tournament') return 'Já existe outro torneio público. Finalize-o antes de publicar este.';
      if (reason === 'payment_missing') return 'Configure o PIX antes de publicar.';
      if (reason === 'buyin_offer_missing') return 'O torneio precisa de uma oferta de buy-in.';
      if (reason === 'no_buyins') return 'Nenhum buy-in pedido ainda. Espere os jogadores pedirem pelo link.';
      if (reason === 'participant_status') return 'O jogador não está em condição de receber esta liberação.';
      return 'Ação incompatível com o estado atual do torneio.';
    case 'PENDING_PAYMENT': return 'Há pagamentos informados ainda sem confirmação ou rejeição.';
    case 'IDENTITY_CONFLICT':
      if (reason === 'display_name_taken') return 'Já existe um jogador com esse nome. Vincule ao cadastro existente.';
      if (reason === 'player_inactive') return 'Jogador inativo: não pode entrar em torneios.';
      if (reason === 'session_already_active') return 'Esta identificação já foi validada para outro jogador.';
      return 'A identificação mudou (o aparelho trocou ou saiu). Recarregue.';
    case 'REGISTRATION_CLOSED': return 'A inscrição já fechou para novos jogadores.';
    case 'REQUEST_STATE_CONFLICT':
      if (reason === 'buyin_confirmed_in_batch') return 'Buy-in inicial só é confirmado no lote de início.';
      return 'O pedido já foi resolvido ou mudou de estado. Recarregue.';
    case 'PURCHASE_PENDING': return 'O jogador já tem uma compra em aberto. Resolva-a antes.';
    case 'OFFER_NOT_ELIGIBLE':
      if (reason === 'window_closed') return 'A janela desta compra já fechou.';
      return 'Oferta não disponível para a contagem atual do jogador.';
    case 'AUTHORIZATION_CONSUMED': return 'A liberação já virou pedido: resolva o pedido.';
    case 'DUPLICATE_TRANSACTION': return 'Esta compra já foi lançada. Recarregue.';
    default: return `Erro ${e.code}.`;
  }
}
