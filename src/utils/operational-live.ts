// src/utils/operational-live.ts
// Torneio persistente (fluxo 2) ao vivo: o banco é a única fonte de fichas e
// dinheiro. As entradas locais (mesa, assentos, eliminações) só recebem
// buy-ins, rebuys e add-ons que já vieram confirmados do servidor.

import type { LocalEntry } from '../services/tournaments';
import type { AdminPurchaseRequest, OperationalSnapshot, Participant } from '../services/operational';
import type { PurchaseKind } from '../types/database';
import { applyElimination } from './placements';
import { nameKey, rebalanceSeating, seatEntry } from './seating';

const OPEN = new Set(['requested', 'payment_reported']);

export const isOpenRequest = (r: AdminPurchaseRequest) => OPEN.has(r.status);

const byCreated = (a: AdminPurchaseRequest, b: AdminPurchaseRequest) =>
  a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** Buy-ins iniciais ainda não resolvidos: exatamente o lote que o servidor vai comparar. */
export const openBuyins = (s: OperationalSnapshot) =>
  s.requests.filter((r) => r.kind === 'buyin' && isOpenRequest(r)).sort(byCreated);

/** Rebuys/add-ons esperando confirmação ou rejeição. Pagamento informado primeiro. */
export const openPurchases = (s: OperationalSnapshot) =>
  s.requests
    .filter((r) => r.kind !== 'buyin' && isOpenRequest(r))
    .sort((a, b) => Number(b.status === 'payment_reported') - Number(a.status === 'payment_reported') || byCreated(a, b));

/** Sessões esperando o admin validar o nome. */
export const pendingClaims = (s: OperationalSnapshot) =>
  s.pending_sessions.filter((x) => x.status === 'pending');

/** Ativas e não vencidas (o servidor já devolve `expired` no status efetivo). */
export const activeAuthorizations = (s: OperationalSnapshot) =>
  s.authorizations.filter((a) => a.status === 'active');

export function participantByName(participants: Participant[], name: string): Participant | undefined {
  const k = nameKey(name);
  return participants.find((p) => nameKey(p.display_name) === k);
}

/** Ofertas do tipo que o servidor considera elegíveis agora (contagem + janela). */
export function eligibleOffers(s: OperationalSnapshot, p: Participant, kind: Exclude<PurchaseKind, 'buyin'>) {
  const ids = new Set(p.eligible_offer_ids);
  return s.offers.filter((o) => o.kind === kind && ids.has(o.id));
}

/**
 * Mesa inicial a partir do servidor: só quem teve buy-in confirmado (status
 * active/eliminated). Contagens vêm confirmadas; assentos são sorteados aqui.
 */
export function entriesFromParticipants(participants: Participant[]): LocalEntry[] {
  const entries: LocalEntry[] = participants
    .filter((p) => p.status === 'active' || p.status === 'eliminated')
    .map((p) => ({
      name: p.display_name,
      buyins: 1,
      rebuys: p.confirmed_rebuy_units,
      addons: p.confirmed_addons,
    }));
  return rebalanceSeating(entries);
}

/**
 * Aplica às entradas locais as compras confirmadas no servidor. Rebuy novo de
 * um eliminado é reentrada: volta à mesa e as colocações são renumeradas.
 * Devolve a mesma lista quando nada muda (evita laço de render).
 */
export function reconcileEntries(
  entries: LocalEntry[], participants: Participant[], prizePool: number, payoutPct: number[],
): LocalEntry[] {
  let out = entries;
  for (let i = 0; i < out.length; i++) {
    const e = out[i];
    const p = participantByName(participants, e.name);
    if (!p || (p.status !== 'active' && p.status !== 'eliminated')) continue;
    if (e.rebuys === p.confirmed_rebuy_units && e.addons === p.confirmed_addons) continue;
    const reentry = !!e.eliminated && p.confirmed_rebuy_units > e.rebuys;
    out = out.map((x, j) => (j === i ? { ...x, rebuys: p.confirmed_rebuy_units, addons: p.confirmed_addons } : x));
    if (reentry) out = seatEntry(applyElimination(out, i, false, prizePool, payoutPct), i);
  }
  return out;
}

/**
 * Eliminados com reentrada em andamento (rebuy liberado ou pedido aberto). Com
 * alguém aqui, o campeão não pode ser declarado: ele pode voltar à mesa.
 */
export function pendingReentries(s: OperationalSnapshot, entries: LocalEntry[]): string[] {
  const participants = new Set<string>();
  for (const r of s.requests) if (r.kind === 'rebuy' && isOpenRequest(r)) participants.add(r.participant_id);
  for (const a of activeAuthorizations(s)) if (a.kind === 'rebuy') participants.add(a.participant_id);
  return entries
    .filter((e) => e.eliminated)
    .filter((e) => {
      const p = participantByName(s.participants, e.name);
      return !!p && participants.has(p.id);
    })
    .map((e) => e.name);
}
