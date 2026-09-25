// src/services/__tests__/tournament-results.test.ts
// Histórico: agrega lançamentos por valor gravado e unidades de rebuy.
import { describe, it, expect } from 'vitest';
import { aggregateResults, type TransactionRow } from '../tournaments';

const row = (player: string, over: Partial<TransactionRow> = {}): TransactionRow => ({
  player_id: player, amount: '10.00', is_rebuy: false, is_addon: false, rebuy_units: 0,
  final_placement: null, payout_amount: 0, ...over,
});

const names = new Map([['a', 'Ana'], ['b', 'Bia']]);

describe('aggregateResults', () => {
  it('duplo do fluxo 2: uma linha, duas unidades, R$ 35', () => {
    const [ana] = aggregateResults([
      row('a', { final_placement: 1, payout_amount: '45.00' }),
      row('a', { amount: '35.00', is_rebuy: true, rebuy_units: 2 }),
    ], names);
    expect(ana).toMatchObject({ display_name: 'Ana', buyins: 1, rebuys: 2, addons: 0, invested: 45, payout_amount: 45 });
    expect(ana.packages).toEqual([
      { kind: 'buyin', rebuy_units: 0, amount: 10 },
      { kind: 'rebuy', rebuy_units: 2, amount: 35 },
    ]);
  });

  it('legado: uma unidade por linha de rebuy, add-on conta linhas', () => {
    const [bia] = aggregateResults([
      row('b'),
      row('b', { amount: '15.00', is_rebuy: true, rebuy_units: 1 }),
      row('b', { amount: '15.00', is_rebuy: true, rebuy_units: 1 }),
      row('b', { amount: '20.00', is_addon: true }),
    ], names);
    expect(bia).toMatchObject({ buyins: 1, rebuys: 2, addons: 1, invested: 60 });
  });

  it('ordena por colocação; sem colocação vai para o fim', () => {
    const out = aggregateResults([row('a'), row('b', { final_placement: 1 })], names);
    expect(out.map((r) => r.display_name)).toEqual(['Bia', 'Ana']);
  });
});
