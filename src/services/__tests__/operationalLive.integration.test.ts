// src/services/__tests__/operationalLive.integration.test.ts
// S24 — filas do admin (identificação, lote inicial, rebuy/add-on) + supabase-js
// contra o Supabase LOCAL (0013). Pulado por padrão. Rodar com
// `bash supabase/tests/s24-live-rest.sh`. Recusa qualquer URL que não seja local.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import {
  authorizePurchase,
  confirmBuyinsAndStart,
  confirmPurchase,
  createOperationalTournament,
  finishOperationalTournament,
  getOperationalTournament,
  publishTournament,
  rejectPurchase,
  resolvePlayerClaim,
  revokePurchaseAuthorization,
  type RpcResult,
} from '../operational';
import { generateDeviceToken } from '../publicPortal';
import { buildFinishResults, buildOffers } from '../../utils/operational-config';
import {
  eligibleOffers, entriesFromParticipants, openBuyins, pendingClaims, pendingReentries, reconcileEntries,
} from '../../utils/operational-live';

declare const process: { env: Record<string, string | undefined> };

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const email = process.env.S22_ADMIN_EMAIL;
const password = process.env.S22_ADMIN_PASSWORD;
const isLocal = !!url && /^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(url);
const enabled = process.env.S24_LOCAL === '1' && isLocal && !!email && !!password;

function must<T>(r: RpcResult<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${JSON.stringify(r.error.details)}`);
  return r.data;
}
const code = <T,>(r: RpcResult<T>) => (r.ok ? 'ok' : r.error.code);
const key = () => crypto.randomUUID();

describe.skipIf(!enabled)('filas do admin contra o Supabase local', () => {
  const player = createClient(url ?? 'http://127.0.0.1:1', anonKey ?? 'x', { auth: { persistSession: false } });
  const prpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await player.rpc(fn, args);
    if (error) throw error;
    if (!data.ok) throw new Error(`${fn}: ${data.error.code}`);
    return data.data;
  };

  beforeAll(async () => {
    const { error } = await supabase!.auth.signInWithPassword({ email: email!, password: password! });
    if (error) throw error;
  });

  it('valida nomes, confirma o lote revisado, libera/confirma/rejeita compras e só então concede fichas', async () => {
    const before = await getOperationalTournament(null);
    expect(code(before)).toBe('NOT_FOUND');

    const offers = buildOffers({
      buy_in_value: 10, rebuy_value: 15, addon_value: 20, chips_per_rebuy: 3000, chips_per_addon: 3000,
      max_rebuys: 2, addon_enabled: true, double_rebuy_value: 35,
    }, 3000);
    const created = must(await createOperationalTournament({
      name: 'S24 filas', start_time: new Date().toISOString(), initial_stack: 3000,
      curve_params: { smallest_chip: 5 }, payout_structure: [{ posicao: 1, percentual: 0.7 }, { posicao: 2, percentual: 0.3 }],
      offers, payment: { pix_key_type: 'email', pix_key: 'pix@exemplo.test', receiver_name: 'Teste', instructions: '' },
    }));
    const tid = created.tournament.id;
    const pub = must(await publishTournament(tid, created.tournament.state_version)).tournament;

    // Três jogadores pelo portal; o admin valida pela fila.
    const suffix = Date.now().toString(36);
    const names = [`Ana ${suffix}`, `Bia ${suffix}`, `Caio ${suffix}`];
    const tokens = names.map(() => generateDeviceToken());
    for (let i = 0; i < names.length; i++) {
      await prpc('identify_player', { public_id: pub.public_id, claimed_name: names[i], device_token: tokens[i], idempotency_key: key() });
    }
    let snap = must(await getOperationalTournament(tid));
    const claims = pendingClaims(snap);
    expect(claims.map((c) => c.claimed_name).sort()).toEqual([...names].sort());
    for (const c of claims) {
      const r = must(await resolvePlayerClaim(c.id, { newDisplayName: c.claimed_name }));
      expect(r.participant?.status).toBe('pending_buyin');
    }
    // Nome já cadastrado não vira cadastro duplicado.
    const dupToken = generateDeviceToken();
    await prpc('identify_player', { public_id: pub.public_id, claimed_name: `outro ${suffix}`, device_token: dupToken, idempotency_key: key() });
    snap = must(await getOperationalTournament(tid));
    const dup = pendingClaims(snap)[0];
    const taken = await resolvePlayerClaim(dup.id, { newDisplayName: names[0] });
    expect(!taken.ok && taken.error.code).toBe('IDENTITY_CONFLICT');

    const buyin = created.offers.find((o) => o.kind === 'buyin')!;
    const reqs = [];
    for (const t of tokens.slice(0, 2)) {
      const r = await prpc('request_buyin', { device_token: t, offer_id: buyin.id, idempotency_key: key() });
      await prpc('report_payment', { device_token: t, request_id: r.request.id });
      reqs.push(r.request.id as string);
    }

    // Admin revisa 2; um 3º chega antes do botão: lote desatualizado.
    snap = must(await getOperationalTournament(tid));
    const reviewed = openBuyins(snap).map((r) => r.id);
    expect(reviewed.sort()).toEqual([...reqs].sort());
    const late = await prpc('request_buyin', { device_token: tokens[2], offer_id: buyin.id, idempotency_key: key() });
    const changed = await confirmBuyinsAndStart(tid, snap.tournament.state_version, reviewed);
    expect(changed.ok).toBe(false);
    if (!changed.ok) {
      expect(changed.error.code).toBe('REQUEST_SET_CHANGED');
      expect(changed.error.details.added).toEqual([late.request.id]);
    }
    // Nada foi confirmado: continua publicado, ninguém com fichas.
    snap = must(await getOperationalTournament(tid));
    expect(snap.tournament.public_status).toBe('published');
    expect(snap.participants.every((p) => p.status === 'pending_buyin')).toBe(true);

    // Admin rejeita o atrasado e confirma o lote revisado de novo.
    must(await rejectPurchase(late.request.id, 'chegou depois do início'));
    snap = must(await getOperationalTournament(tid));
    const before2 = Date.now();
    const started = must(await confirmBuyinsAndStart(tid, snap.tournament.state_version, openBuyins(snap).map((r) => r.id)));
    expect(started.tournament.public_status).toBe('running');
    expect(started.runtime.clock_status).toBe('running');
    // Âncora do servidor (relógios no mesmo host local; tolerância de 60 s).
    expect(Math.abs(started.runtime.anchor_ms - before2)).toBeLessThan(60_000);
    expect(started.transactions.map((t) => t.amount)).toEqual([10, 10]);

    snap = must(await getOperationalTournament(tid));
    let entries = entriesFromParticipants(snap.participants);
    expect(entries.map((e) => e.name).sort()).toEqual(names.slice(0, 2).sort());
    expect(snap.participants.find((p) => p.display_name === names[2])?.status).toBe('withdrawn');

    // Bia cai; o admin libera o rebuy duplo, ela pede e informa o PIX.
    const bia = snap.participants.find((p) => p.display_name === names[1])!;
    const biaIdx = entries.findIndex((e) => e.name === names[1]);
    entries = entries.map((e, i) => (i === biaIdx ? { ...e, eliminated: true, final_placement: 2, table: undefined, seat: undefined } : e));
    const double = eligibleOffers(snap, bia, 'rebuy').find((o) => o.rebuy_units === 2)!;
    expect(double.price).toBe(35);
    const auth = must(await authorizePurchase(bia.id, 'rebuy', eligibleOffers(snap, bia, 'rebuy').map((o) => o.id), null));
    snap = must(await getOperationalTournament(tid));
    // Liberação ativa segura o campeão.
    expect(pendingReentries(snap, entries)).toEqual([names[1]]);

    const pr = await prpc('request_purchase', {
      device_token: tokens[1], authorization_id: auth.authorization.id, offer_id: double.id, idempotency_key: key(),
    });
    await prpc('report_payment', { device_token: tokens[1], request_id: pr.request.id });
    snap = must(await getOperationalTournament(tid));
    // Pedido informado ainda não mexe em nada.
    expect(reconcileEntries(entries, snap.participants, 20, [0.7, 0.3])).toBe(entries);
    const open = snap.requests.find((r) => r.id === pr.request.id)!;

    const stale = await confirmPurchase(open.id, open.version - 1);
    expect(code(stale)).toBe('VERSION_CONFLICT');
    const conf = must(await confirmPurchase(open.id, open.version));
    expect(conf.transaction).toMatchObject({ amount: 35, rebuy_units: 2, chips_granted: 6000, kind: 'rebuy' });
    // Repetição devolve o mesmo resultado, sem segunda transação.
    const again = must(await confirmPurchase(open.id, open.version));
    expect(again.transaction.id).toBe(conf.transaction.id);

    snap = must(await getOperationalTournament(tid));
    entries = reconcileEntries(entries, snap.participants, 55, [0.7, 0.3]);
    const biaEntry = entries.find((e) => e.name === names[1])!;
    expect(biaEntry).toMatchObject({ rebuys: 2, eliminated: false });
    expect(biaEntry.table).toBeGreaterThan(0);
    expect(pendingReentries(snap, entries)).toEqual([]);

    // Add-on da Ana: liberado e revogado; liberado de novo, pedido e rejeitado com motivo.
    const ana = snap.participants.find((p) => p.display_name === names[0])!;
    const addonIds = eligibleOffers(snap, ana, 'addon').map((o) => o.id);
    const a1 = must(await authorizePurchase(ana.id, 'addon', addonIds, null));
    expect(must(await revokePurchaseAuthorization(a1.authorization.id, 'engano')).authorization.status).toBe('revoked');
    const a2 = must(await authorizePurchase(ana.id, 'addon', addonIds, null));
    const ar = await prpc('request_purchase', {
      device_token: tokens[0], authorization_id: a2.authorization.id, offer_id: addonIds[0], idempotency_key: key(),
    });
    const rj = must(await rejectPurchase(ar.request.id, 'PIX não caiu'));
    expect(rj.request).toMatchObject({ status: 'rejected', rejection_reason: 'PIX não caiu' });
    snap = must(await getOperationalTournament(tid));
    expect(snap.participants.find((p) => p.id === ana.id)?.confirmed_addons).toBe(0);
    expect(reconcileEntries(entries, snap.participants, 55, [0.7, 0.3])).toBe(entries);

    // Fecha o registro para o banco ficar limpo para os próximos scripts.
    const { results } = buildFinishResults(
      entries.map((e, i) => ({ ...e, final_placement: i + 1, payout_amount: i === 0 ? 38.5 : 16.5 })),
      snap.participants,
    );
    must(await finishOperationalTournament(tid, snap.tournament.state_version, results));
  });
});
