// src/services/__tests__/operational-admin.test.ts
// Wrappers administrativos da S24: nomes de parâmetro exatos do contrato e
// parsers das respostas (dinheiro em texto, runtime obrigatório no início).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn();
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) }, isSupabaseConfigured: true }));

import {
  ContractError,
  authorizePurchase,
  cancelOperationalTournament,
  confirmBuyinsAndStart,
  confirmPurchase,
  describeError,
  parseAuthorized,
  parseConfirmedPurchase,
  parseResolvedClaim,
  parseStarted,
  parseTransaction,
  rejectPurchase,
  resolvePlayerClaim,
  revokePurchaseAuthorization,
  updateTournamentSetup,
} from '../operational';

const TOURNAMENT = {
  id: 't1', public_id: 'pub', name: 'Home Game', public_status: 'running', state_version: 3,
  start_time: '2026-09-25T22:00:00Z', started_at: '2026-09-25T22:05:00Z',
  registration_closed_at: '2026-09-25T22:05:00Z', is_public_current: true,
};
const RUNTIME = {
  schedule: [], clock_status: 'running', anchor_ms: 1_790_000_000_000, paused_elapsed_ms: 0,
  registration_closes_at: null, rebuy_closes_at: null, addon_closes_at: null,
  version: 2, updated_at: '2026-09-25T22:05:00Z',
};
const REQUEST = {
  id: 'r1', kind: 'rebuy', status: 'confirmed', offer_id: 'o2', offer_name: 'Rebuy duplo', price: '35.00',
  chips_granted: 6000, rebuy_units: 2, authorization_id: 'a1', payment: {}, version: 3,
  payment_reported_at: '2026-09-25T22:30:00Z', rejection_reason: null,
  created_at: '2026-09-25T22:20:00Z', updated_at: '2026-09-25T22:31:00Z',
  participant_id: 'p1', player_id: 'pl1', display_name: 'Ana', session_id: 's1', resolved_at: '2026-09-25T22:31:00Z',
};
const TX = {
  id: 'x1', request_id: 'r1', kind: 'rebuy', player_id: 'pl1', amount: '35.00',
  rebuy_units: 2, chips_granted: 6000, confirmed_at: '2026-09-25T22:31:00Z',
};
const PARTICIPANT = {
  id: 'p1', player_id: 'pl1', display_name: 'Ana', status: 'active', table_number: null, seat_number: null,
  final_placement: null, version: 4, confirmed_rebuy_units: 2, reserved_rebuy_units: 0, confirmed_addons: 0,
  eligible_offer_ids: [],
};
const SESSION = {
  id: 's1', status: 'active', claimed_name: 'ana', player_id: 'pl1', display_name: 'Ana',
  expires_at: '2026-10-25T22:00:00Z', created_at: '2026-09-25T21:00:00Z',
  claimed_in_tournament_id: 't1', validated_at: '2026-09-25T21:10:00Z', last_used_at: null,
};
const AUTH = {
  id: 'a1', participant_id: 'p1', kind: 'addon', status: 'active', expires_at: null,
  created_at: '2026-09-25T23:00:00Z', consumed_at: null, revoked_at: null, revoke_reason: null, offer_ids: ['o3'],
};
const OFFER = {
  id: 'o3', kind: 'addon', name: 'Add-on', price: '20.00', chips_granted: 3000, rebuy_units: 0,
  eligible_after_units: [], max_uses: 1,
};

const ok = (data: unknown) => ({ data: { ok: true, data }, error: null });

describe('parsers S24', () => {
  it('transação: dinheiro em texto vira number; number cru é quebra', () => {
    expect(parseTransaction(TX)).toMatchObject({ amount: 35, rebuy_units: 2, chips_granted: 6000 });
    expect(() => parseTransaction({ ...TX, amount: 35 })).toThrow(ContractError);
  });

  it('claim resolvido com e sem participante', () => {
    expect(parseResolvedClaim({ session: SESSION, participant: PARTICIPANT }).participant?.id).toBe('p1');
    expect(parseResolvedClaim({ session: SESSION, participant: null }).participant).toBeNull();
  });

  it('início exige runtime do servidor (âncora)', () => {
    const s = parseStarted({ tournament: TOURNAMENT, runtime: RUNTIME, confirmed_requests: [REQUEST], transactions: [TX] });
    expect(s.runtime.anchor_ms).toBe(1_790_000_000_000);
    expect(s.transactions[0].amount).toBe(35);
    expect(() => parseStarted({ tournament: TOURNAMENT, runtime: null, confirmed_requests: [], transactions: [] }))
      .toThrow(ContractError);
  });

  it('compra confirmada traz pedido, transação, participante e torneio', () => {
    const c = parseConfirmedPurchase({ request: REQUEST, transaction: TX, participant: PARTICIPANT, tournament: TOURNAMENT });
    expect(c.request.price).toBe(35);
    expect(c.participant.confirmed_rebuy_units).toBe(2);
    expect(c.tournament.state_version).toBe(3);
  });

  it('autorização com ofertas', () => {
    const a = parseAuthorized({ authorization: AUTH, offers: [OFFER] });
    expect(a.authorization.offer_ids).toEqual(['o3']);
    expect(a.offers[0].price).toBe(20);
  });
});

describe('wrappers S24 enviam os nomes do contrato', () => {
  beforeEach(() => rpc.mockReset());

  it('resolve_player_claim: player_id XOR new_display_name', async () => {
    rpc.mockResolvedValue(ok({ session: SESSION, participant: PARTICIPANT }));
    await resolvePlayerClaim('s1', { playerId: 'pl1' });
    expect(rpc).toHaveBeenLastCalledWith('resolve_player_claim', { session_id: 's1', player_id: 'pl1', new_display_name: null });
    await resolvePlayerClaim('s1', { newDisplayName: '  Ana Paula ' });
    expect(rpc).toHaveBeenLastCalledWith('resolve_player_claim', { session_id: 's1', player_id: null, new_display_name: 'Ana Paula' });
  });

  it('confirm_buyins_and_start envia o lote revisado e a versão vista', async () => {
    rpc.mockResolvedValue(ok({ tournament: TOURNAMENT, runtime: RUNTIME, confirmed_requests: [], transactions: [] }));
    const r = await confirmBuyinsAndStart('t1', 2, ['r1', 'r2']);
    expect(rpc).toHaveBeenLastCalledWith('confirm_buyins_and_start', {
      tournament_id: 't1', expected_version: 2, reviewed_request_ids: ['r1', 'r2'],
    });
    expect(r.ok).toBe(true);
  });

  it('REQUEST_SET_CHANGED volta como erro de domínio com details', async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: {
      code: 'REQUEST_SET_CHANGED', message: 'x', retryable: true, details: { added: ['r3'], removed: [] },
    } }, error: null });
    const r = await confirmBuyinsAndStart('t1', 2, ['r1']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.details.added).toEqual(['r3']);
  });

  it('authorize_purchase / confirm / reject / revoke', async () => {
    rpc.mockResolvedValue(ok({ authorization: AUTH, offers: [OFFER] }));
    await authorizePurchase('p1', 'addon', ['o3'], null);
    expect(rpc).toHaveBeenLastCalledWith('authorize_purchase', { participant_id: 'p1', kind: 'addon', offer_ids: ['o3'], expires_at: null });

    rpc.mockResolvedValue(ok({ request: REQUEST, transaction: TX, participant: PARTICIPANT, tournament: TOURNAMENT }));
    await confirmPurchase('r1', 2);
    expect(rpc).toHaveBeenLastCalledWith('confirm_purchase', { request_id: 'r1', expected_version: 2 });

    rpc.mockResolvedValue(ok({ request: { ...REQUEST, status: 'rejected', rejection_reason: 'PIX não caiu' } }));
    const rj = await rejectPurchase('r1', ' PIX não caiu ');
    expect(rpc).toHaveBeenLastCalledWith('reject_purchase', { request_id: 'r1', reason: 'PIX não caiu' });
    if (rj.ok) expect(rj.data.request.rejection_reason).toBe('PIX não caiu');

    rpc.mockResolvedValue(ok({ authorization: { ...AUTH, status: 'revoked' } }));
    await revokePurchaseAuthorization('a1', 'engano');
    expect(rpc).toHaveBeenLastCalledWith('revoke_purchase_authorization', { authorization_id: 'a1', reason: 'engano' });
  });

  it('erro de infraestrutura sobe como exceção', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(confirmPurchase('r1', 1)).rejects.toMatchObject({ code: 'PGRST202' });
  });
});

describe('mensagens S24', () => {
  const base = { message: 'ignorado', retryable: false, details: {} };
  it('usam code/reason', () => {
    expect(describeError({ ...base, code: 'IDENTITY_CONFLICT', details: { reason: 'display_name_taken' } })).toMatch(/Vincule/);
    expect(describeError({ ...base, code: 'TOURNAMENT_STATE_CONFLICT', details: { reason: 'no_buyins' } })).toMatch(/Nenhum buy-in/);
    expect(describeError({ ...base, code: 'PURCHASE_PENDING' })).toMatch(/compra em aberto/);
    expect(describeError({ ...base, code: 'OFFER_NOT_ELIGIBLE', details: { reason: 'window_closed' } })).toMatch(/janela/);
  });
});

describe('wrappers S25 (0014)', () => {
  beforeEach(() => rpc.mockReset());
  const PAYMENT = { pix_key_type: 'email', pix_key: 'novo@pix.test', receiver_name: 'Rod', instructions: null, version: 2 };

  it('update_tournament_setup envia só o que mudou, no formato da criação', async () => {
    rpc.mockResolvedValue(ok({ tournament: TOURNAMENT, offers: [OFFER], payment: PAYMENT }));
    const r = await updateTournamentSetup('t1', 3, { payment: { pix_key_type: 'email', pix_key: ' novo@pix.test ', receiver_name: 'Rod ' } });
    expect(rpc).toHaveBeenLastCalledWith('update_tournament_setup', {
      tournament_id: 't1', expected_version: 3,
      payload: { payment: { pix_key_type: 'email', pix_key: 'novo@pix.test', receiver_name: 'Rod' } },
    });
    if (r.ok) expect(r.data.payment?.version).toBe(2);

    await updateTournamentSetup('t1', 4, { offers: [{ kind: 'buyin', name: ' Buy-in ', price: 12.5, chips_granted: 3000 }] });
    expect(rpc).toHaveBeenLastCalledWith('update_tournament_setup', {
      tournament_id: 't1', expected_version: 4,
      payload: { offers: [{ kind: 'buyin', name: 'Buy-in', price: '12.50', chips_granted: 3000, sort_order: 1 }] },
    });
  });

  it('cancel_operational_tournament envia a versão vista', async () => {
    rpc.mockResolvedValue(ok({ tournament: { ...TOURNAMENT, public_status: 'cancelled', is_public_current: false } }));
    const r = await cancelOperationalTournament('t1', 5);
    expect(rpc).toHaveBeenLastCalledWith('cancel_operational_tournament', { tournament_id: 't1', expected_version: 5 });
    if (r.ok) expect(r.data.tournament.public_status).toBe('cancelled');
  });

  it('permission denied (0015, anon sem JWT) em RPC admin vira AUTH_REQUIRED', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for function cancel_operational_tournament' } });
    const r = await cancelOperationalTournament('t1', 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('AUTH_REQUIRED');
  });

  it('permission denied em RPC pública não é disfarçado de sessão expirada', async () => {
    const { getPublicTournament } = await import('../publicPortal');
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied for function get_public_tournament' } });
    await expect(getPublicTournament(null)).rejects.toMatchObject({ code: '42501' });
  });

  it('outros erros de infraestrutura continuam lançando', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } });
    await expect(cancelOperationalTournament('t1', 5)).rejects.toMatchObject({ code: 'PGRST301' });
  });

  it('mensagens dos motivos novos', () => {
    const base = { message: 'x', retryable: false };
    expect(describeError({ ...base, code: 'TOURNAMENT_STATE_CONFLICT', details: { reason: 'offers_locked' } })).toMatch(/Só o PIX/);
    expect(describeError({ ...base, code: 'TOURNAMENT_STATE_CONFLICT', details: { reason: 'has_transactions' } })).toMatch(/lançamentos/);
  });
});
