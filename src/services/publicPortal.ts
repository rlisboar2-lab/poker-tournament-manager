// src/services/publicPortal.ts
// Portal do jogador (/jogar): RPCs públicas da migração 0013 e o token do dispositivo.
// Contrato: docs/contracts/rpc-v1.md. O banco decide identidade, preço, fichas e
// elegibilidade; aqui só se tipa, se valida o formato e se guarda o token.
//
// Token do dispositivo: 32 bytes aleatórios em base64url, guardado só no
// localStorage deste navegador. Nunca vai para URL, log ou outro armazenamento.
// O banco guarda apenas o hash.

import {
  arr,
  callRpc,
  int,
  isRecord,
  oneOf,
  parseAuthorization,
  parseMoney,
  parseOffer,
  parseParticipant,
  parsePayment,
  parsePendingSession,
  parseTournamentSummary,
  PURCHASE_KINDS,
  rec,
  REQUEST_STATUSES,
  str,
  strOrNull,
  type Authorization,
  type Offer,
  type Participant,
  type PaymentSettings,
  type PendingSession,
  type RpcError,
  type RpcErrorCode,
  type TournamentSummary,
} from './operational';
import { uuidV4 } from '../utils/uuid';
import type { PurchaseKind, PurchaseRequestStatus } from '../types/database';

// ── Token do dispositivo ──────────────────────────────────────────────────

export const DEVICE_TOKEN_KEY = 'pokerapp.portal.device_token';

/** Mesmo formato que o banco aceita (private.token_hash_or_null). */
const TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/;

export const isDeviceToken = (v: unknown): v is string => typeof v === 'string' && TOKEN_RE.test(v);

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * `getRandomValues` existe também fora de contexto seguro (HTTP no IP local),
 * ao contrário de `crypto.subtle`/`randomUUID`. Sem ele não há token: um segredo
 * com Math.random seria adivinhável.
 */
export function generateDeviceToken(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (typeof c?.getRandomValues !== 'function') {
    throw new Error('Este navegador não gera números aleatórios seguros. Use um navegador atualizado.');
  }
  const bytes = new Uint8Array(32);
  c.getRandomValues(bytes);
  return toBase64Url(bytes); // 43 caracteres
}

/** localStorage pode lançar (modo privado, bloqueio de site): tratar como vazio. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadDeviceToken(): string | null {
  try {
    const v = storage()?.getItem(DEVICE_TOKEN_KEY);
    return isDeviceToken(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearDeviceToken(): void {
  try {
    storage()?.removeItem(DEVICE_TOKEN_KEY);
  } catch {
    /* sem armazenamento: nada a apagar */
  }
}

/** Devolve o token salvo ou cria um novo. `persisted = false` avisa que a recarga não vai lembrar. */
export function ensureDeviceToken(): { token: string; persisted: boolean } {
  const saved = loadDeviceToken();
  if (saved) return { token: saved, persisted: true };
  const token = generateDeviceToken();
  try {
    const s = storage();
    if (!s) return { token, persisted: false };
    s.setItem(DEVICE_TOKEN_KEY, token);
    return { token, persisted: s.getItem(DEVICE_TOKEN_KEY) === token };
  } catch {
    return { token, persisted: false };
  }
}

// ── Formatos públicos ─────────────────────────────────────────────────────

export const NEXT_ACTIONS = ['await_validation', 'request_buyin', 'await_buyin_confirmation', 'open_portal'] as const;
export type NextAction = (typeof NEXT_ACTIONS)[number];

/** Pedido na visão do próprio jogador (sem vínculos administrativos). */
export interface PublicPurchaseRequest {
  id: string;
  kind: PurchaseKind;
  status: PurchaseRequestStatus;
  offer_id: string;
  offer_name: string;
  price: number;
  chips_granted: number;
  rebuy_units: number;
  authorization_id: string | null;
  /** PIX visto no momento do pedido; null quando o torneio não tinha PIX. */
  payment: PaymentSettings | null;
  version: number;
  payment_reported_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export function parsePublicRequest(v: unknown): PublicPurchaseRequest {
  const o = rec(v, 'request');
  const snap = o.payment;
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
    payment: isRecord(snap) && Object.keys(snap).length === 0 ? null : parsePayment(snap),
    version: int(o, 'version'),
    payment_reported_at: strOrNull(o, 'payment_reported_at'),
    rejection_reason: strOrNull(o, 'rejection_reason'),
    created_at: str(o, 'created_at'),
    updated_at: str(o, 'updated_at'),
  };
}

export interface PublicTournament {
  tournament: TournamentSummary;
  offers: Offer[];
  payment: PaymentSettings | null;
}

export function parsePublicTournament(v: unknown): PublicTournament {
  const o = rec(v, 'data');
  return {
    tournament: parseTournamentSummary(o.tournament),
    offers: arr(o.offers, 'offers', parseOffer),
    payment: parsePayment(o.payment),
  };
}

export interface IdentifyResult {
  session: PendingSession;
  tournament: TournamentSummary;
  next_action: NextAction;
}

export function parseIdentify(v: unknown): IdentifyResult {
  const o = rec(v, 'data');
  return {
    session: parsePendingSession(o.session),
    tournament: parseTournamentSummary(o.tournament),
    next_action: oneOf(o, 'next_action', NEXT_ACTIONS),
  };
}

export interface PlayerPortal {
  session: PendingSession;
  tournament: TournamentSummary;
  participant: Participant | null;
  requests: PublicPurchaseRequest[];
  authorizations: Authorization[];
  offers: Offer[];
  payment: PaymentSettings | null;
  next_action: NextAction;
}

export function parsePlayerPortal(v: unknown): PlayerPortal {
  const o = rec(v, 'data');
  return {
    session: parsePendingSession(o.session),
    tournament: parseTournamentSummary(o.tournament),
    participant: o.participant == null ? null : parseParticipant(o.participant),
    requests: arr(o.requests, 'requests', parsePublicRequest),
    authorizations: arr(o.authorizations, 'authorizations', parseAuthorization),
    offers: arr(o.offers, 'offers', parseOffer),
    payment: parsePayment(o.payment),
    next_action: oneOf(o, 'next_action', NEXT_ACTIONS),
  };
}

const parseRequestData = (d: unknown) => parsePublicRequest(rec(d, 'data').request);

// ── Chamadas ──────────────────────────────────────────────────────────────
// Sem publicId: o torneio público atual (is_public_current).

export const getPublicTournament = (publicId: string | null) =>
  callRpc('get_public_tournament', { public_id: publicId }, parsePublicTournament);

export const identifyPlayer = (publicId: string | null, claimedName: string, deviceToken: string, idempotencyKey: string) =>
  callRpc('identify_player', {
    public_id: publicId, claimed_name: claimedName.trim(), device_token: deviceToken, idempotency_key: idempotencyKey,
  }, parseIdentify);

export const getPlayerPortal = (deviceToken: string, publicId: string | null) =>
  callRpc('get_player_portal', { device_token: deviceToken, public_id: publicId }, parsePlayerPortal);

export const requestBuyin = (deviceToken: string, offerId: string, idempotencyKey: string) =>
  callRpc('request_buyin', { device_token: deviceToken, offer_id: offerId, idempotency_key: idempotencyKey }, parseRequestData);

export const requestPurchase = (deviceToken: string, authorizationId: string, offerId: string, idempotencyKey: string) =>
  callRpc('request_purchase', {
    device_token: deviceToken, authorization_id: authorizationId, offer_id: offerId, idempotency_key: idempotencyKey,
  }, parseRequestData);

export const reportPayment = (deviceToken: string, requestId: string) =>
  callRpc('report_payment', { device_token: deviceToken, request_id: requestId }, parseRequestData);

export const cancelPurchaseRequest = (deviceToken: string, requestId: string) =>
  callRpc('cancel_purchase_request', { device_token: deviceToken, request_id: requestId }, parseRequestData);

export const revokeDeviceSession = (deviceToken: string) =>
  callRpc('revoke_device_session', { device_token: deviceToken }, (d) => ({ revoked_at: str(rec(d, 'data'), 'revoked_at') }));

export const newIdempotencyKey = uuidV4;

// ── Mensagens ─────────────────────────────────────────────────────────────

/** Sessão encerrada: o token deste navegador não serve mais e precisa ser trocado. */
export const isSessionEnded = (code: RpcErrorCode): boolean =>
  code === 'SESSION_REVOKED' || code === 'SESSION_EXPIRED';

/** Texto pt-BR para o jogador. Depende só do code/reason (nunca da message). */
export function describePublicError(e: RpcError): string {
  const reason = typeof e.details.reason === 'string' ? e.details.reason : null;
  switch (e.code) {
    case 'NOT_FOUND': return 'Não encontramos este torneio ou pedido.';
    case 'NOT_PUBLIC': return 'Este torneio não está aberto para os jogadores.';
    case 'REGISTRATION_CLOSED': return 'As inscrições deste torneio já fecharam. Fale com o organizador.';
    case 'SESSION_PENDING': return 'O organizador ainda não validou seu nome.';
    case 'SESSION_REVOKED':
    case 'SESSION_EXPIRED':
      return 'A identificação deste navegador terminou. Informe seu nome de novo.';
    case 'IDENTITY_CONFLICT':
      if (reason === 'session_has_other_identity') return 'Este navegador já está identificado com outro nome. Use "Trocar de jogador".';
      if (reason === 'player_inactive') return 'Seu cadastro está inativo. Fale com o organizador.';
      return 'Esse nome conflita com outro cadastro. O organizador precisa revisar.';
    case 'INVALID_ARGUMENT':
      return e.details.field === 'claimed_name' ? 'Informe um nome com até 80 caracteres.' : 'Dados inválidos.';
    case 'PURCHASE_PENDING': return 'Você já tem um pedido em aberto.';
    case 'OFFER_NOT_ELIGIBLE': return 'Esta opção não está disponível para você agora.';
    case 'AUTHORIZATION_REQUIRED': return 'Esta compra precisa ser liberada pelo organizador.';
    case 'AUTHORIZATION_EXPIRED': return 'A liberação desta compra venceu. Peça de novo ao organizador.';
    case 'AUTHORIZATION_REVOKED': return 'O organizador cancelou a liberação desta compra.';
    case 'AUTHORIZATION_CONSUMED': return 'Esta liberação já foi usada.';
    case 'REQUEST_STATE_CONFLICT': return 'Este pedido já mudou de situação.';
    case 'TOURNAMENT_STATE_CONFLICT': return 'Isso não está disponível neste momento do torneio.';
    case 'IDEMPOTENCY_CONFLICT': return 'Não foi possível concluir. Tente de novo.';
    default: return `Erro ${e.code}.`;
  }
}
