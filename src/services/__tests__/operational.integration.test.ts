// src/services/__tests__/operational.integration.test.ts
// Serviço operacional + supabase-js contra o Supabase LOCAL (PostgREST real, 0013).
// Pulado por padrão. Rodar com `bash supabase/tests/s22-admin-rest.sh`, que cria
// o admin local e exporta as variáveis. Recusa qualquer URL que não seja local.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import {
  createOperationalTournament,
  finishOperationalTournament,
  getOperationalTournament,
  publishTournament,
  updateTournamentRuntime,
  type RpcResult,
} from '../operational';
import { listTournaments } from '../tournaments';
import { buildFinishResults, buildOffers } from '../../utils/operational-config';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const email = process.env.S22_ADMIN_EMAIL;
const password = process.env.S22_ADMIN_PASSWORD;
const isLocal = !!url && /^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(url);
const enabled = process.env.S22_LOCAL === '1' && isLocal && !!email && !!password;

function must<T>(r: RpcResult<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${JSON.stringify(r.error.details)}`);
  return r.data;
}

const token = () => {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Buffer.from(b).toString('base64url');
};

describe.skipIf(!enabled)('operacional contra o Supabase local', () => {
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

  it('cria, publica, inicia, recusa versão velha, finaliza o mesmo registro', async () => {
    // Estado limpo: nenhum torneio do fluxo 2 aberto.
    const before = await getOperationalTournament(null);
    expect(before.ok ? before.data.tournament.public_status : before.error.code).toBe('NOT_FOUND');

    const offers = buildOffers({
      buy_in_value: 10, rebuy_value: 15, addon_value: 20, chips_per_rebuy: 3000, chips_per_addon: 3000,
      max_rebuys: 2, addon_enabled: true, double_rebuy_value: 35,
    }, 3000);
    const created = must(await createOperationalTournament({
      name: 'S22 integração', start_time: new Date().toISOString(), initial_stack: 3000,
      curve_params: { smallest_chip: 5 }, payout_structure: [{ posicao: 1, percentual: 1 }],
      offers, payment: { pix_key_type: 'email', pix_key: 'pix@exemplo.test', receiver_name: 'Teste', instructions: '' },
    }));
    const tid = created.tournament.id;
    expect(created.tournament).toMatchObject({ public_status: 'draft', state_version: 1, public_id: null });
    expect(created.offers.find((o) => o.rebuy_units === 2)).toMatchObject({ price: 35, chips_granted: 6000 });

    // Versão velha: conflito com a versão atual nos details, nada muda.
    const stale = await publishTournament(tid, 99);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toMatchObject({ code: 'VERSION_CONFLICT', retryable: true, details: { current_version: 1 } });

    const pub = must(await publishTournament(tid, 1)).tournament;
    expect(pub.public_status).toBe('published');
    expect(pub.public_id).toMatch(/^t-/);

    // Retomada: sem id, o servidor devolve este mesmo torneio aberto.
    expect(must(await getOperationalTournament(null)).tournament.id).toBe(tid);

    // Rascunho/publicado não aparece no Histórico.
    expect((await listTournaments()).some((t) => t.id === tid)).toBe(false);

    // Jogador pelo caminho público (anon) até o buy-in confirmado em lote.
    const dt = token();
    const ident = await prpc('identify_player', {
      public_id: pub.public_id, claimed_name: 'Ana S22', device_token: dt, idempotency_key: crypto.randomUUID(),
    });
    const { error: rErr, data: resolved } = await supabase!.rpc('resolve_player_claim', {
      session_id: ident.session.id, player_id: null, new_display_name: 'Ana S22',
    });
    if (rErr || !resolved.ok) throw rErr ?? new Error(resolved.error.code);
    const buyinOffer = created.offers.find((o) => o.kind === 'buyin')!;
    const req = await prpc('request_buyin', { device_token: dt, offer_id: buyinOffer.id, idempotency_key: crypto.randomUUID() });
    await prpc('report_payment', { device_token: dt, request_id: req.request.id });

    const snap = must(await getOperationalTournament(tid));
    const { data: started, error: sErr } = await supabase!.rpc('confirm_buyins_and_start', {
      tournament_id: tid, expected_version: snap.tournament.state_version, reviewed_request_ids: [req.request.id],
    });
    if (sErr || !started.ok) throw sErr ?? new Error(started.error.code);

    const running = must(await getOperationalTournament(tid));
    expect(running.tournament.public_status).toBe('running');
    const v = running.tournament.state_version;

    const staleRt = await updateTournamentRuntime(tid, v - 1, { clock_status: 'paused' });
    expect(!staleRt.ok && staleRt.error.code).toBe('VERSION_CONFLICT');
    const rt = must(await updateTournamentRuntime(tid, v, { clock_status: 'paused', paused_elapsed_ms: 1000 }));
    expect(rt.runtime?.clock_status).toBe('paused');
    expect(rt.tournament.state_version).toBe(v + 1);

    const { results, unmatched } = buildFinishResults(
      [{ name: 'ana s22', buyins: 1, rebuys: 0, addons: 0, final_placement: 1, payout_amount: 10 }],
      running.participants,
    );
    expect(unmatched).toEqual([]);
    const done = must(await finishOperationalTournament(tid, rt.tournament.state_version, results));
    expect(done.tournament.public_status).toBe('finished');
    expect(done.tournament.id).toBe(tid);

    // Finalizado entra no Histórico uma vez só, e não há outro aberto.
    expect((await listTournaments()).filter((t) => t.id === tid)).toHaveLength(1);
    const after = await getOperationalTournament(null);
    expect(!after.ok && after.error.code).toBe('NOT_FOUND');
  });
});
