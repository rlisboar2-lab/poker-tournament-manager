// src/utils/__tests__/operational-config.test.ts
import { describe, it, expect } from 'vitest';
import { buildFinishResults, buildOffers, validatePix, emptyPix, UNLIMITED_REBUY_CAP, type OfferConfig } from '../operational-config';
import type { Participant } from '../../services/operational';

const CFG: OfferConfig = {
  buy_in_value: 10, rebuy_value: 15, addon_value: 20,
  chips_per_rebuy: 3000, chips_per_addon: 3000,
  max_rebuys: 2, addon_enabled: false,
};

describe('buildOffers', () => {
  it('buy-in + um rebuy simples por contagem permitida', () => {
    const o = buildOffers(CFG, 3000);
    expect(o.map((x) => [x.kind, x.name, x.eligible_after_units, x.sort_order])).toEqual([
      ['buyin', 'Buy-in', [0], 1],
      ['rebuy', '1º rebuy', [0], 2],
      ['rebuy', '2º rebuy', [1], 3],
    ]);
    expect(o[0].chips_granted).toBe(3000);
  });

  it('duplo: R$ do pacote, 2 unidades, fichas em dobro, só com zero usadas', () => {
    const duplo = buildOffers({ ...CFG, double_rebuy_value: 35 }, 3000).find((x) => x.rebuy_units === 2);
    expect(duplo).toMatchObject({ price: 35, chips_granted: 6000, eligible_after_units: [0], max_uses: 1 });
  });

  it('duplo some quando o limite é 1 rebuy', () => {
    expect(buildOffers({ ...CFG, max_rebuys: 1, double_rebuy_value: 35 }, 3000).some((x) => x.rebuy_units === 2)).toBe(false);
  });

  it('sem limite vira uma oferta reutilizável até o teto do banco', () => {
    const r = buildOffers({ ...CFG, max_rebuys: 0 }, 3000).filter((x) => x.kind === 'rebuy');
    expect(r).toHaveLength(1);
    expect(r[0].max_uses).toBeNull();
    expect(r[0].eligible_after_units).toHaveLength(UNLIMITED_REBUY_CAP);
  });

  it('add-on só quando habilitado', () => {
    expect(buildOffers({ ...CFG, addon_enabled: true }, 3000).slice(-1)[0]).toMatchObject({ kind: 'addon', price: 20 });
    expect(buildOffers(CFG, 3000).some((x) => x.kind === 'addon')).toBe(false);
  });
});

describe('validatePix', () => {
  it('exige chave e recebedor', () => {
    expect(validatePix(emptyPix())).toHaveLength(2);
    expect(validatePix({ ...emptyPix(), pix_key: 'x', receiver_name: 'Rod' })).toEqual([]);
  });
});

const part = (id: string, display_name: string, status: Participant['status'] = 'active'): Participant => ({
  id, player_id: `pl-${id}`, display_name, status, table_number: null, seat_number: null, final_placement: null,
  version: 1, confirmed_rebuy_units: 0, reserved_rebuy_units: 0, confirmed_addons: 0, eligible_offer_ids: [],
});

describe('buildFinishResults', () => {
  it('casa por nome (sem caixa/espaços) e aponta quem não casou', () => {
    const { results, unmatched } = buildFinishResults(
      [
        { name: ' ana ', buyins: 1, rebuys: 0, addons: 0, final_placement: 1, payout_amount: 50 },
        { name: 'Bia', buyins: 1, rebuys: 0, addons: 0, eliminated: true, final_placement: 2 },
        { name: 'Caio', buyins: 1, rebuys: 0, addons: 0 },
      ],
      [part('p1', 'Ana'), part('p2', 'Bia', 'eliminated'), part('p3', 'Caio', 'withdrawn')],
    );
    expect(results).toEqual([
      { participant_id: 'p1', final_placement: 1, payout_amount: 50 },
      { participant_id: 'p2', final_placement: 2 },
    ]);
    expect(unmatched).toEqual(['Caio']);
  });
});
