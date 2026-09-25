// src/utils/__tests__/ledger.test.ts
import { describe, it, expect } from 'vitest';
import type { AdminPurchaseRequest, ConfirmedTransaction, OperationalSnapshot, Participant } from '../../services/operational';
import { calcularCurvaBlinds } from '../poker-math';
import { buildLedger, chipCurveInputs, describePurchases, legacyInvested, packageName, playerLedger } from '../ledger';

const part = (id: string, name: string): Participant => ({
  id, player_id: `pl-${id}`, display_name: name, status: 'active', table_number: null, seat_number: null,
  final_placement: null, version: 1, confirmed_rebuy_units: 0, reserved_rebuy_units: 0, confirmed_addons: 0,
  eligible_offer_ids: [],
});

const tx = (id: string, player: string, over: Partial<ConfirmedTransaction>): ConfirmedTransaction => ({
  id, request_id: `r-${id}`, kind: 'buyin', player_id: `pl-${player}`, amount: 10, rebuy_units: 0,
  chips_granted: 3000, confirmed_at: '2026-09-25T22:00:00Z', ...over,
});

const req = (txId: string, offer_name: string): AdminPurchaseRequest => ({
  id: `r-${txId}`, kind: 'rebuy', status: 'confirmed', offer_id: 'o', offer_name, price: 0, chips_granted: 1,
  rebuy_units: 1, authorization_id: null, version: 1, payment_reported_at: null, rejection_reason: null,
  created_at: '', updated_at: '', participant_id: 'p', player_id: 'pl', display_name: '', session_id: 's', resolved_at: null,
});

const snap = (transactions: ConfirmedTransaction[], requests: AdminPurchaseRequest[] = []): OperationalSnapshot => ({
  tournament: {
    id: 't1', public_id: 'pub', name: 'T', public_status: 'running', state_version: 3, start_time: '',
    started_at: null, registration_closed_at: null, is_public_current: true,
  },
  runtime: null, payment: null, offers: [],
  participants: [part('a', 'Ana'), part('b', 'Bia')],
  pending_sessions: [], requests, authorizations: [], transactions,
});

// Caso da fixture two-rebuys: Ana entra e compra o duplo; Bia entra e faz add-on.
const DUPLO = snap([
  tx('1', 'a', {}),
  tx('2', 'b', {}),
  tx('3', 'a', { kind: 'rebuy', amount: 35, rebuy_units: 2, chips_granted: 6000 }),
  tx('4', 'b', { kind: 'addon', amount: 20, chips_granted: 5000 }),
], [req('3', 'Rebuy duplo')]);

describe('buildLedger', () => {
  it('duplo = uma compra de R$ 35 com duas unidades; pote soma amount', () => {
    const l = buildLedger(DUPLO);
    expect(l.pool).toBe(75);
    const ana = playerLedger(l, 'Ana')!;
    expect(ana.invested).toBe(45);
    expect(ana.purchases).toHaveLength(2);
    expect(ana.purchases[1]).toMatchObject({ kind: 'rebuy', name: 'Rebuy duplo', amount: 35, rebuy_units: 2, chips: 6000 });
    expect(playerLedger(l, 'bia')!.invested).toBe(30);
  });

  it('fichas por tipo vêm de chips_granted, não de unidades × config', () => {
    const l = buildLedger(DUPLO);
    expect(l.chips).toEqual({ buyin: 6000, rebuy: 6000, addon: 5000 });
    const c = calcularCurvaBlinds({ ...chipCurveInputs(l), target_time_minutos: 120, duracao_bloco_nivel: 20 });
    expect(c.c_total).toBe(17000);
  });

  it('soma em centavos', () => {
    const l = buildLedger(snap([tx('1', 'a', { amount: 0.1 }), tx('2', 'a', { kind: 'addon', amount: 0.2 })]));
    expect(l.pool).toBe(0.3);
    expect(playerLedger(l, 'Ana')!.invested).toBe(0.3);
  });

  it('sem pedido correspondente, nomeia pelo tipo e unidades', () => {
    const l = buildLedger(snap([tx('9', 'a', { kind: 'rebuy', amount: 35, rebuy_units: 2 })]));
    expect(playerLedger(l, 'Ana')!.purchases[0].name).toBe('Rebuy ×2');
  });

  it('jogador sem lançamento não aparece', () => {
    expect(playerLedger(buildLedger(snap([])), 'Ana')).toBeUndefined();
  });
});

describe('exibição', () => {
  it('descreve as compras com o valor real', () => {
    const txt = describePurchases(playerLedger(buildLedger(DUPLO), 'Ana')!.purchases).replace(/\u00a0/g, ' ');
    expect(txt).toBe('Buy-in R$ 10,00 · Rebuy duplo R$ 35,00');
  });

  it('nome do pacote pelo lançamento', () => {
    expect(packageName('rebuy', 1)).toBe('Rebuy');
    expect(packageName('rebuy', 2)).toBe('Rebuy ×2');
    expect(packageName('addon', 0)).toBe('Add-on');
  });
});

describe('legado', () => {
  it('mantém contagem × preço da config', () => {
    const prices = { buy_in_value: 10, rebuy_value: 15, addon_value: 20 };
    expect(legacyInvested({ name: 'X', buyins: 1, rebuys: 2, addons: 1 }, prices)).toBe(60);
  });
});
