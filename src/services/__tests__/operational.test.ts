// src/services/__tests__/operational.test.ts
import { describe, it, expect } from 'vitest';
import {
  ContractError,
  RPC_ERROR_CODES,
  describeError,
  needsReload,
  parseEnvelope,
  parseMoney,
  parseSnapshot,
  parseTournamentSummary,
  toCreatePayload,
  toMoneyText,
} from '../operational';

const TOURNAMENT = {
  id: '00000000-0000-4000-8000-000000000001',
  public_id: null,
  name: 'Home Game',
  public_status: 'draft',
  state_version: 1,
  start_time: '2026-09-23T22:00:00Z',
  started_at: null,
  registration_closed_at: null,
  is_public_current: false,
};

const OFFER = {
  id: '00000000-0000-4000-8000-0000000000a1',
  kind: 'rebuy',
  name: 'Rebuy duplo',
  price: '35.00',
  chips_granted: 6000,
  rebuy_units: 2,
  eligible_after_units: [0],
  max_uses: 1,
};

describe('parseEnvelope', () => {
  it('sucesso aplica o parser ao data', () => {
    const r = parseEnvelope({ ok: true, data: { tournament: TOURNAMENT } }, (d) => parseTournamentSummary((d as { tournament: unknown }).tournament));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.state_version).toBe(1);
  });

  it('erro de domínio vira RpcError com details', () => {
    const r = parseEnvelope({
      ok: false,
      error: { code: 'VERSION_CONFLICT', message: 'mudou', retryable: true, details: { current_version: 4 } },
    }, () => null);
    expect(r).toEqual({
      ok: false,
      error: { code: 'VERSION_CONFLICT', message: 'mudou', retryable: true, details: { current_version: 4 } },
    });
  });

  it('erro sem details/retryable recebe defaults', () => {
    const r = parseEnvelope({ ok: false, error: { code: 'NOT_FOUND' } }, () => null);
    expect(r).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: '', retryable: false, details: {} } });
  });

  it('código fora do catálogo é quebra de contrato', () => {
    expect(() => parseEnvelope({ ok: false, error: { code: 'SOMETHING_NEW' } }, () => null)).toThrow(ContractError);
  });

  it('resposta sem envelope é quebra de contrato', () => {
    expect(() => parseEnvelope(null, () => null)).toThrow(ContractError);
    expect(() => parseEnvelope('uuid-cru', () => null)).toThrow(ContractError);
    expect(() => parseEnvelope({ data: {} }, () => null)).toThrow(ContractError);
    expect(() => parseEnvelope({ ok: false }, () => null)).toThrow(ContractError);
  });

  it('o catálogo tem os 23 códigos do contrato v1', () => {
    expect(RPC_ERROR_CODES).toHaveLength(23);
    expect(new Set(RPC_ERROR_CODES).size).toBe(23);
  });
});

describe('conflitos', () => {
  it('só VERSION_CONFLICT e REQUEST_SET_CHANGED pedem recarga', () => {
    expect(RPC_ERROR_CODES.filter(needsReload)).toEqual(['VERSION_CONFLICT', 'REQUEST_SET_CHANGED']);
  });

  it('mensagens dependem do code e do reason, não do texto do servidor', () => {
    const base = { message: 'qualquer', retryable: false };
    expect(describeError({ ...base, code: 'TOURNAMENT_STATE_CONFLICT', details: { reason: 'another_public_tournament' } }))
      .toMatch(/outro torneio público/);
    expect(describeError({ ...base, code: 'INVALID_ARGUMENT', details: { field: 'name' } })).toBe('Dado inválido: name.');
    expect(describeError({ ...base, code: 'VERSION_CONFLICT', details: {} })).toMatch(/recarregado/);
  });
});

describe('dinheiro', () => {
  it('number → texto com duas casas', () => {
    expect(toMoneyText(15)).toBe('15.00');
    expect(toMoneyText(17.5)).toBe('17.50');
    expect(() => toMoneyText(-1)).toThrow(RangeError);
    expect(() => toMoneyText(Number.NaN)).toThrow(RangeError);
  });

  it('texto → number; number cru é quebra de contrato', () => {
    expect(parseMoney('35.00', 'p')).toBe(35);
    expect(() => parseMoney(35, 'p')).toThrow(ContractError);
    expect(() => parseMoney('35,00', 'p')).toThrow(ContractError);
  });
});

describe('parseSnapshot', () => {
  const snapshot = {
    tournament: { ...TOURNAMENT, public_id: 't-abc', public_status: 'published', state_version: 2, is_public_current: true },
    runtime: {
      schedule: [], clock_status: 'idle', anchor_ms: 0, paused_elapsed_ms: 0,
      registration_closes_at: null, rebuy_closes_at: null, addon_closes_at: null,
      version: 1, updated_at: '2026-09-23T21:00:00Z',
    },
    payment: { pix_key_type: 'email', pix_key: 'a@b.c', receiver_name: 'Rod', instructions: null, version: 1 },
    offers: [OFFER],
    participants: [{
      id: 'p1', player_id: 'pl1', display_name: 'Ana', status: 'active', table_number: null, seat_number: null,
      final_placement: null, version: 1, confirmed_rebuy_units: 0, reserved_rebuy_units: 2, confirmed_addons: 0,
      eligible_offer_ids: [],
    }],
    pending_sessions: [],
    requests: [],
    authorizations: [],
  };

  it('lê o formato de get_operational_tournament', () => {
    const s = parseSnapshot(snapshot);
    expect(s.tournament.public_id).toBe('t-abc');
    expect(s.offers[0]).toMatchObject({ price: 35, rebuy_units: 2, eligible_after_units: [0] });
    expect(s.participants[0].reserved_rebuy_units).toBe(2);
    expect(s.payment?.pix_key).toBe('a@b.c');
  });

  it('status fora do domínio é quebra de contrato', () => {
    expect(() => parseSnapshot({ ...snapshot, tournament: { ...snapshot.tournament, public_status: 'open' } }))
      .toThrow(ContractError);
  });

  it('state_version não inteiro é quebra de contrato', () => {
    expect(() => parseSnapshot({ ...snapshot, tournament: { ...snapshot.tournament, state_version: '2' } }))
      .toThrow(ContractError);
  });
});

describe('toCreatePayload', () => {
  it('segue o cabeçalho de create_operational_tournament', () => {
    const p = toCreatePayload({
      name: '  Home Game ',
      start_time: '2026-09-23T22:00:00.000Z',
      initial_stack: 3000,
      curve_params: { smallest_chip: 5 },
      payout_structure: [],
      offers: [
        { kind: 'buyin', name: 'Buy-in', price: 10, chips_granted: 3000 },
        { kind: 'rebuy', name: 'Rebuy duplo', price: 35, chips_granted: 6000, rebuy_units: 2, eligible_after_units: [0], max_uses: 1 },
      ],
      payment: { pix_key_type: 'random', pix_key: ' chave ', receiver_name: ' Rod ', instructions: '  ' },
    });
    expect(p.name).toBe('Home Game');
    expect(p.offers).toEqual([
      { kind: 'buyin', name: 'Buy-in', price: '10.00', chips_granted: 3000, sort_order: 1 },
      { kind: 'rebuy', name: 'Rebuy duplo', price: '35.00', chips_granted: 6000, rebuy_units: 2, eligible_after_units: [0], max_uses: 1, sort_order: 2 },
    ]);
    // Instrução vazia não viaja; chave e nome vão aparados.
    expect(p.payment).toEqual({ pix_key_type: 'random', pix_key: 'chave', receiver_name: 'Rod' });
    expect(p).not.toHaveProperty('schedule');
  });
});
