// src/utils/__tests__/operational-live.test.ts
import { describe, it, expect } from 'vitest';
import type { LocalEntry } from '../../services/tournaments';
import type { AdminPurchaseRequest, Authorization, OperationalSnapshot, Participant } from '../../services/operational';
import {
  eligibleOffers,
  entriesFromParticipants,
  openBuyins,
  openPurchases,
  pendingReentries,
  reconcileEntries,
} from '../operational-live';

const part = (id: string, name: string, over: Partial<Participant> = {}): Participant => ({
  id, player_id: `pl-${id}`, display_name: name, status: 'active', table_number: null, seat_number: null,
  final_placement: null, version: 1, confirmed_rebuy_units: 0, reserved_rebuy_units: 0, confirmed_addons: 0,
  eligible_offer_ids: [], ...over,
});

const req = (id: string, over: Partial<AdminPurchaseRequest> = {}): AdminPurchaseRequest => ({
  id, kind: 'buyin', status: 'requested', offer_id: 'o1', offer_name: 'Buy-in', price: 10, chips_granted: 3000,
  rebuy_units: 0, authorization_id: null, version: 1, payment_reported_at: null, rejection_reason: null,
  created_at: `2026-09-25T22:00:0${id.length}Z`, updated_at: '2026-09-25T22:00:00Z',
  participant_id: 'p1', player_id: 'pl-p1', display_name: 'Ana', session_id: 's1', resolved_at: null, ...over,
});

const auth = (id: string, over: Partial<Authorization> = {}): Authorization => ({
  id, participant_id: 'p1', kind: 'rebuy', status: 'active', expires_at: null, created_at: '2026-09-25T22:00:00Z',
  consumed_at: null, revoked_at: null, revoke_reason: null, offer_ids: ['o2'], ...over,
});

const snap = (over: Partial<OperationalSnapshot> = {}): OperationalSnapshot => ({
  tournament: {
    id: 't1', public_id: 'pub', name: 'T', public_status: 'running', state_version: 3, start_time: '',
    started_at: null, registration_closed_at: null, is_public_current: true,
  },
  runtime: null, payment: null, offers: [], participants: [], pending_sessions: [], requests: [], authorizations: [],
  ...over,
});

describe('filas', () => {
  it('lote inicial = só buy-ins abertos, em ordem de chegada', () => {
    const s = snap({ requests: [
      req('b', { status: 'payment_reported' }), req('a'), req('c', { status: 'rejected' }),
      req('d', { kind: 'rebuy' }),
    ] });
    expect(openBuyins(s).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('compras abertas põem pagamento informado primeiro e ignoram buy-in', () => {
    const s = snap({ requests: [
      req('x', { kind: 'rebuy' }), req('yy', { kind: 'addon', status: 'payment_reported' }),
      req('z', { kind: 'rebuy', status: 'confirmed' }), req('w'),
    ] });
    expect(openPurchases(s).map((r) => r.id)).toEqual(['yy', 'x']);
  });

  it('ofertas elegíveis seguem o servidor e filtram o tipo', () => {
    const offers = [
      { id: 'o2', kind: 'rebuy' as const, name: '1º', price: 15, chips_granted: 3000, rebuy_units: 1, eligible_after_units: [0], max_uses: 1 },
      { id: 'o3', kind: 'addon' as const, name: 'Add', price: 20, chips_granted: 3000, rebuy_units: 0, eligible_after_units: [], max_uses: 1 },
      { id: 'o4', kind: 'rebuy' as const, name: '2º', price: 20, chips_granted: 3000, rebuy_units: 1, eligible_after_units: [1], max_uses: 1 },
    ];
    const p = part('p1', 'Ana', { eligible_offer_ids: ['o2', 'o3'] });
    expect(eligibleOffers(snap({ offers }), p, 'rebuy').map((o) => o.id)).toEqual(['o2']);
  });
});

describe('entradas a partir do servidor', () => {
  it('mesa inicial só com buy-in confirmado', () => {
    const out = entriesFromParticipants([
      part('p1', 'Ana'), part('p2', 'Bia', { status: 'withdrawn' }), part('p3', 'Caio', { status: 'pending_buyin' }),
    ]);
    expect(out.map((e) => e.name)).toEqual(['Ana']);
    expect(out[0]).toMatchObject({ buyins: 1, rebuys: 0, addons: 0, table: 1, seat: 1 });
  });

  it('reconciliação aplica unidades confirmadas (duplo = 2) e add-on', () => {
    const entries: LocalEntry[] = [
      { name: 'Ana', buyins: 1, rebuys: 0, addons: 0, table: 1, seat: 1 },
      { name: 'Bia', buyins: 1, rebuys: 0, addons: 0, table: 1, seat: 2 },
    ];
    const out = reconcileEntries(entries, [
      part('p1', 'ana', { confirmed_rebuy_units: 2 }), part('p2', 'Bia', { confirmed_addons: 1 }),
    ], 100, [1]);
    expect(out[0].rebuys).toBe(2);
    expect(out[1].addons).toBe(1);
  });

  it('nada mudou devolve a mesma lista', () => {
    const entries: LocalEntry[] = [{ name: 'Ana', buyins: 1, rebuys: 1, addons: 0 }];
    expect(reconcileEntries(entries, [part('p1', 'Ana', { confirmed_rebuy_units: 1 })], 0, [])).toBe(entries);
  });

  it('rebuy confirmado de eliminado é reentrada: volta à mesa e renumera', () => {
    const entries: LocalEntry[] = [
      { name: 'Ana', buyins: 1, rebuys: 0, addons: 0, table: 1, seat: 1 },
      { name: 'Bia', buyins: 1, rebuys: 0, addons: 0, table: 1, seat: 2 },
      { name: 'Caio', buyins: 1, rebuys: 0, addons: 0, eliminated: true, final_placement: 3 },
    ];
    const out = reconcileEntries(entries, [
      part('p1', 'Ana'), part('p2', 'Bia'), part('p3', 'Caio', { confirmed_rebuy_units: 1 }),
    ], 30, [0.5, 0.3, 0.2]);
    expect(out[2]).toMatchObject({ rebuys: 1, eliminated: false, final_placement: undefined });
    expect(out[2].table).toBe(1);
  });

  it('participante desconhecido ou sem buy-in não mexe na entrada', () => {
    const entries: LocalEntry[] = [{ name: 'Zé', buyins: 1, rebuys: 0, addons: 0 }];
    expect(reconcileEntries(entries, [part('p9', 'Zé', { status: 'withdrawn', confirmed_rebuy_units: 3 })], 0, [])).toBe(entries);
  });
});

describe('campeão bloqueado por reentrada', () => {
  const entries: LocalEntry[] = [
    { name: 'Ana', buyins: 1, rebuys: 0, addons: 0 },
    { name: 'Bia', buyins: 1, rebuys: 0, addons: 0, eliminated: true, final_placement: 2 },
  ];
  const participants = [part('p1', 'Ana'), part('p2', 'Bia')];

  it('pedido de rebuy aberto de eliminado bloqueia', () => {
    const s = snap({ participants, requests: [req('r1', { kind: 'rebuy', participant_id: 'p2', status: 'payment_reported' })] });
    expect(pendingReentries(s, entries)).toEqual(['Bia']);
  });

  it('rebuy liberado (autorização ativa) bloqueia', () => {
    expect(pendingReentries(snap({ participants, authorizations: [auth('a1', { participant_id: 'p2' })] }), entries)).toEqual(['Bia']);
  });

  it('add-on, pedido resolvido, autorização revogada ou jogador ativo não bloqueiam', () => {
    const s = snap({
      participants,
      requests: [
        req('r1', { kind: 'rebuy', participant_id: 'p2', status: 'rejected' }),
        req('r2', { kind: 'rebuy', participant_id: 'p1' }),
      ],
      authorizations: [auth('a1', { participant_id: 'p2', status: 'revoked' }), auth('a2', { participant_id: 'p2', kind: 'addon' })],
    });
    expect(pendingReentries(s, entries)).toEqual([]);
  });
});
