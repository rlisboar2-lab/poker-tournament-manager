// src/services/__tests__/finance.integration.test.ts
// S25 — pacotes, finanças, histórico e ranking + alteração de ofertas/PIX e
// cancelamento (0014) contra o Supabase LOCAL. Pulado por padrão. Rodar com
// `bash supabase/tests/s25-finance-rest.sh`. Recusa qualquer URL que não seja local.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import {
  authorizePurchase,
  cancelOperationalTournament,
  confirmBuyinsAndStart,
  confirmPurchase,
  createOperationalTournament,
  finishOperationalTournament,
  getOperationalTournament,
  publishTournament,
  rejectPurchase,
  resolvePlayerClaim,
  updateTournamentSetup,
  type OfferInput,
  type RpcResult,
} from '../operational';
import { generateDeviceToken } from '../publicPortal';
import { getTournamentResults, listTournaments, playerLeaderboard } from '../tournaments';
import { buildFinishResults, buildOffers } from '../../utils/operational-config';
import { eligibleOffers, entriesFromParticipants, openBuyins, pendingClaims } from '../../utils/operational-live';
import { buildLedger, playerLedger } from '../../utils/ledger';

declare const process: { env: Record<string, string | undefined> };

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const email = process.env.S22_ADMIN_EMAIL;
const password = process.env.S22_ADMIN_PASSWORD;
const isLocal = !!url && /^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(url);
const enabled = process.env.S25_LOCAL === '1' && isLocal && !!email && !!password;

function must<T>(r: RpcResult<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${JSON.stringify(r.error.details)}`);
  return r.data;
}
const code = <T,>(r: RpcResult<T>) => (r.ok ? 'ok' : r.error.code);
const reason = <T,>(r: RpcResult<T>) => (r.ok ? null : r.error.details.reason);
const key = () => crypto.randomUUID();

const CFG = {
  buy_in_value: 10, rebuy_value: 15, addon_value: 20, chips_per_rebuy: 3000, chips_per_addon: 3000,
  max_rebuys: 2, addon_enabled: true, double_rebuy_value: 35,
};
const PAYMENT = { pix_key_type: 'email' as const, pix_key: 'pix@exemplo.test', receiver_name: 'Teste', instructions: '' };
const base = (name: string, offers: OfferInput[]) => ({
  name, start_time: new Date().toISOString(), initial_stack: 3000,
  curve_params: { smallest_chip: 5 }, payout_structure: [{ posicao: 1, percentual: 1 }], offers, payment: PAYMENT,
});

describe.skipIf(!enabled)('finanças, ranking e preparação contra o Supabase local', () => {
  const player = createClient(url ?? 'http://127.0.0.1:1', anonKey ?? 'x', { auth: { persistSession: false } });
  const prpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await player.rpc(fn, args);
    if (error) throw error;
    if (!data.ok) throw new Error(`${fn}: ${data.error.code}`);
    return data.data;
  };
  const suffix = Date.now().toString(36);

  // Identifica, valida e pede buy-in; devolve os tokens na ordem dos nomes.
  async function enroll(publicId: string, tid: string, names: string[], buyinOfferId: string) {
    const tokens = names.map(() => generateDeviceToken());
    for (let i = 0; i < names.length; i++) {
      await prpc('identify_player', { public_id: publicId, claimed_name: names[i], device_token: tokens[i], idempotency_key: key() });
    }
    for (const c of pendingClaims(must(await getOperationalTournament(tid)))) {
      must(await resolvePlayerClaim(c.id, { newDisplayName: c.claimed_name }));
    }
    const requests: string[] = [];
    for (const t of tokens) {
      const r = await prpc('request_buyin', { device_token: t, offer_id: buyinOfferId, idempotency_key: key() });
      requests.push(r.request.id);
    }
    return { tokens, requests };
  }

  beforeAll(async () => {
    const { error } = await supabase!.auth.signInWithPassword({ email: email!, password: password! });
    if (error) throw error;
  });

  it('altera ofertas/PIX só quando permitido e cancela antes do início sem deixar rastro no ranking', async () => {
    expect(code(await getOperationalTournament(null))).toBe('NOT_FOUND');

    // Rascunho criado com o buy-in errado (R$ 10) e corrigido para R$ 12,50.
    const created = must(await createOperationalTournament(base(`S25 cancelado ${suffix}`, buildOffers(CFG, 3000))));
    const tid = created.tournament.id;
    const fixed = buildOffers({ ...CFG, buy_in_value: 12.5 }, 3000);
    const stale = await updateTournamentSetup(tid, created.tournament.state_version - 1, { offers: fixed });
    expect(code(stale)).toBe('VERSION_CONFLICT');
    const up = must(await updateTournamentSetup(tid, created.tournament.state_version, { offers: fixed }));
    expect(up.tournament.state_version).toBe(created.tournament.state_version + 1);
    expect(up.offers.find((o) => o.kind === 'buyin')?.price).toBe(12.5);
    expect(up.offers).toHaveLength(created.offers.length);
    // Oferta inválida não muda nada (validação no banco).
    const bad = await updateTournamentSetup(tid, up.tournament.state_version, {
      offers: [{ kind: 'buyin', name: 'Buy-in', price: 10, chips_granted: 0 }],
    });
    expect(code(bad)).toBe('INVALID_ARGUMENT');
    const noBuyin = await updateTournamentSetup(tid, up.tournament.state_version, {
      offers: fixed.filter((o) => o.kind !== 'buyin'),
    });
    expect(reason(noBuyin)).toBe('buyin_required');
    let snap = must(await getOperationalTournament(tid));
    expect(snap.offers.find((o) => o.kind === 'buyin')?.price).toBe(12.5);
    expect(snap.transactions).toEqual([]);

    const pub = must(await publishTournament(tid, snap.tournament.state_version)).tournament;
    // Publicado e sem pedido: ofertas ainda mudam.
    const up2 = must(await updateTournamentSetup(tid, pub.state_version, { offers: buildOffers({ ...CFG, buy_in_value: 15 }, 3000) }));
    const buyin = up2.offers.find((o) => o.kind === 'buyin')!;
    expect(buyin.price).toBe(15);

    const names = [`Ana S25c ${suffix}`, `Bia S25c ${suffix}`];
    const { tokens, requests } = await enroll(pub.public_id!, tid, names, buyin.id);
    await prpc('report_payment', { device_token: tokens[0], request_id: requests[0] });

    // Com pedido vivo, ofertas travam; o PIX continua trocável.
    snap = must(await getOperationalTournament(tid));
    const locked = await updateTournamentSetup(tid, snap.tournament.state_version, { offers: fixed });
    expect(code(locked)).toBe('TOURNAMENT_STATE_CONFLICT');
    expect(reason(locked)).toBe('offers_locked');
    const pix = must(await updateTournamentSetup(tid, snap.tournament.state_version, {
      payment: { ...PAYMENT, pix_key: 'novo@exemplo.test', instructions: 'Mande o comprovante' },
    }));
    expect(pix.payment).toMatchObject({ pix_key: 'novo@exemplo.test', instructions: 'Mande o comprovante', version: 2 });
    const pubView = await prpc('get_public_tournament', { public_id: pub.public_id });
    expect(pubView.payment.pix_key).toBe('novo@exemplo.test');

    // PIX informado bloqueia o cancelamento; o admin rejeita com motivo antes.
    snap = must(await getOperationalTournament(tid));
    const blocked = await cancelOperationalTournament(tid, snap.tournament.state_version);
    expect(code(blocked)).toBe('PENDING_PAYMENT');
    must(await rejectPurchase(requests[0], 'torneio cancelado, PIX devolvido'));
    snap = must(await getOperationalTournament(tid));
    const cancelled = must(await cancelOperationalTournament(tid, snap.tournament.state_version));
    expect(cancelled.tournament).toMatchObject({ public_status: 'cancelled', is_public_current: false });

    snap = must(await getOperationalTournament(tid));
    expect(snap.participants.every((p) => p.status === 'withdrawn')).toBe(true);
    expect(snap.requests.find((r) => r.id === requests[1])?.status).toBe('expired');
    expect(code(await getOperationalTournament(null))).toBe('NOT_FOUND');
    const { data: gone } = await player.rpc('get_public_tournament', { public_id: pub.public_id });
    expect(gone.ok).toBe(false);
    expect(code(await cancelOperationalTournament(tid, snap.tournament.state_version))).toBe('TOURNAMENT_STATE_CONFLICT');
    expect(code(await updateTournamentSetup(tid, snap.tournament.state_version, { payment: PAYMENT }))).toBe('TOURNAMENT_STATE_CONFLICT');

    expect((await listTournaments()).some((t) => t.id === tid)).toBe(false);
  });

  it('duplo = R$ 35, duas unidades e uma compra; ranking só conta depois de finalizar', async () => {
    const created = must(await createOperationalTournament(base(`S25 duplo ${suffix}`, buildOffers(CFG, 3000))));
    const tid = created.tournament.id;
    const pub = must(await publishTournament(tid, created.tournament.state_version)).tournament;
    const names = [`Ana S25 ${suffix}`, `Bia S25 ${suffix}`];
    const buyin = created.offers.find((o) => o.kind === 'buyin')!;
    const { tokens } = await enroll(pub.public_id!, tid, names, buyin.id);

    let snap = must(await getOperationalTournament(tid));
    must(await confirmBuyinsAndStart(tid, snap.tournament.state_version, openBuyins(snap).map((r) => r.id)));
    const started = must(await getOperationalTournament(tid));
    expect(code(await cancelOperationalTournament(tid, started.tournament.state_version))).toBe('TOURNAMENT_STATE_CONFLICT');
    // Em andamento, ofertas travadas; PIX muda.
    expect(reason(await updateTournamentSetup(tid, started.tournament.state_version, { offers: buildOffers(CFG, 3000) })))
      .toBe('offers_locked');

    // Ana compra o duplo.
    const ana = started.participants.find((p) => p.display_name === names[0])!;
    const double = eligibleOffers(started, ana, 'rebuy').find((o) => o.rebuy_units === 2)!;
    const auth = must(await authorizePurchase(ana.id, 'rebuy', [double.id], null));
    const pr = await prpc('request_purchase', {
      device_token: tokens[0], authorization_id: auth.authorization.id, offer_id: double.id, idempotency_key: key(),
    });
    await prpc('report_payment', { device_token: tokens[0], request_id: pr.request.id });
    snap = must(await getOperationalTournament(tid));
    must(await confirmPurchase(pr.request.id, snap.requests.find((r) => r.id === pr.request.id)!.version));

    snap = must(await getOperationalTournament(tid));
    expect(snap.transactions).toHaveLength(3);
    const rebuys = snap.transactions.filter((t) => t.kind === 'rebuy');
    expect(rebuys).toHaveLength(1);
    expect(rebuys[0]).toMatchObject({ amount: 35, rebuy_units: 2, chips_granted: 6000 });

    const ledger = buildLedger(snap);
    expect(ledger.pool).toBe(55); // 10 + 10 + 35, não 10 + 10 + 2 × 15
    expect(ledger.chips).toEqual({ buyin: 6000, rebuy: 6000, addon: 0 });
    expect(playerLedger(ledger, names[0])).toMatchObject({ invested: 45, chips: 9000 });
    expect(playerLedger(ledger, names[0])!.purchases.map((p) => p.name)).toEqual(['Buy-in', 'Rebuy duplo']);

    // Em andamento: fora do ranking e do Histórico.
    const board = async () => (await playerLeaderboard()).find((r) => r.display_name === names[0]);
    expect(await board()).toBeUndefined();
    expect((await listTournaments()).some((t) => t.id === tid)).toBe(false);

    const entries = entriesFromParticipants(snap.participants)
      .map((e) => ({ ...e, final_placement: e.name === names[0] ? 1 : 2, payout_amount: e.name === names[0] ? 55 : 0 }));
    const { results } = buildFinishResults(entries, snap.participants);
    must(await finishOperationalTournament(tid, snap.tournament.state_version, results));

    // Finalizado: entra no ranking pelo amount real.
    expect(await board()).toMatchObject({ total_invested: 45, total_winnings: 55, events: 1, points: 2 });
    const hist = (await listTournaments()).find((t) => t.id === tid)!;
    expect(Number(hist.total_prize_pool)).toBe(55);
    const rows = await getTournamentResults(tid);
    const anaRow = rows.find((r) => r.display_name === names[0])!;
    expect(anaRow).toMatchObject({ buyins: 1, rebuys: 2, addons: 0, invested: 45, final_placement: 1 });
    expect(anaRow.packages).toHaveLength(2);
    expect(anaRow.packages).toEqual(expect.arrayContaining([
      { kind: 'buyin', rebuy_units: 0, amount: 10 },
      { kind: 'rebuy', rebuy_units: 2, amount: 35 },
    ]));
  });
});
