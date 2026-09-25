// src/services/__tests__/publicPortal.integration.test.ts
// Serviço público (portal do jogador) + supabase-js contra o Supabase LOCAL (0013).
// Pulado por padrão. Rodar com `bash supabase/tests/s23-portal-rest.sh`, que cria o
// admin local e exporta as variáveis. Recusa qualquer URL que não seja local.

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { RpcResult } from '../operational';
import {
  cancelPurchaseRequest,
  generateDeviceToken,
  getPlayerPortal,
  getPublicTournament,
  identifyPlayer,
  newIdempotencyKey,
  reportPayment,
  requestBuyin,
  revokeDeviceSession,
} from '../publicPortal';

// Roda no Node (vitest); o tsconfig do app não carrega os tipos do Node.
declare const process: { env: Record<string, string | undefined> };

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const email = process.env.S22_ADMIN_EMAIL;
const password = process.env.S22_ADMIN_PASSWORD;
const isLocal = !!url && /^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(url);
const enabled = process.env.S23_LOCAL === '1' && isLocal && !!email && !!password;

function must<T>(r: RpcResult<T>): T {
  if (!r.ok) throw new Error(`${r.error.code}: ${JSON.stringify(r.error.details)}`);
  return r.data;
}

const code = <T,>(r: RpcResult<T>) => (r.ok ? 'ok' : r.error.code);

describe.skipIf(!enabled)('portal do jogador contra o Supabase local', () => {
  // Admin num cliente próprio; o serviço público usa o cliente anônimo do app.
  const admin = createClient(url ?? 'http://127.0.0.1:1', anonKey ?? 'x', { auth: { persistSession: false } });
  const arpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw error;
    if (!data.ok) throw new Error(`${fn}: ${data.error.code}`);
    return data.data;
  };

  beforeAll(async () => {
    const { error } = await admin.auth.signInWithPassword({ email: email!, password: password! });
    if (error) throw error;
  });

  it('identifica, espera validação, pede buy-in sem mexer em fichas/pote e troca de jogador', async () => {
    const created = await arpc('create_operational_tournament', {
      payload: {
        name: 'S23 portal', start_time: new Date().toISOString(), initial_stack: 3000,
        curve_params: { smallest_chip: 5 }, payout_structure: [{ posicao: 1, percentual: 1 }],
        offers: [{ kind: 'buyin', name: 'Buy-in', price: '10.00', chips_granted: 3000, sort_order: 1 }],
        payment: { pix_key_type: 'email', pix_key: 'pix@exemplo.test', receiver_name: 'Teste' },
      },
    });
    const tid: string = created.tournament.id;
    const published = await arpc('publish_tournament', { tournament_id: tid, expected_version: 1 });
    const publicId: string = published.tournament.public_id;

    // Página pública: sem id, o torneio atual; com id, o mesmo.
    const pub = must(await getPublicTournament(null));
    expect(pub.tournament.id).toBe(tid);
    expect(must(await getPublicTournament(publicId)).payment?.pix_key).toBe('pix@exemplo.test');
    expect(code(await getPublicTournament('t-nao-existe'))).toBe('NOT_FOUND');

    // Token nunca registrado: portal não reconhece.
    const a = generateDeviceToken();
    expect(code(await getPlayerPortal(a, publicId))).toBe('NOT_FOUND');

    // Identificação cria sessão pendente; repetir a chave devolve a mesma resposta.
    const key = newIdempotencyKey();
    const ident = must(await identifyPlayer(publicId, '  Bia S23 ', a, key));
    expect(ident.next_action).toBe('await_validation');
    expect(ident.session).toMatchObject({ status: 'pending', claimed_name: 'Bia S23', player_id: null });
    expect(must(await identifyPlayer(publicId, 'Bia S23', a, key)).session.id).toBe(ident.session.id);

    // Recarga (mesmo token): continua pendente, com a sessão nos details.
    const pending = await getPlayerPortal(a, publicId);
    expect(!pending.ok && pending.error.code).toBe('SESSION_PENDING');
    if (!pending.ok) expect(pending.error.details.session).toMatchObject({ id: ident.session.id });

    // Outro navegador (outro token) não herda a identidade.
    expect(code(await getPlayerPortal(generateDeviceToken(), publicId))).toBe('NOT_FOUND');

    // Mesmo token com outro nome: conflito, não troca silenciosa.
    const other = await identifyPlayer(publicId, 'Outro Nome', a, newIdempotencyKey());
    expect(!other.ok && other.error).toMatchObject({ code: 'IDENTITY_CONFLICT', details: { reason: 'session_has_other_identity' } });

    await arpc('resolve_player_claim', { session_id: ident.session.id, player_id: null, new_display_name: 'Bia S23' });

    const ready = must(await getPlayerPortal(a, publicId));
    expect(ready.next_action).toBe('request_buyin');
    // Validar o nome já inscreve o participante, ainda sem buy-in.
    expect(ready.participant).toMatchObject({ status: 'pending_buyin', display_name: 'Bia S23' });
    expect(ready.session.display_name).toBe('Bia S23');

    // Pedido de buy-in: idempotente e sem transação.
    const offer = ready.offers.find((o) => o.kind === 'buyin')!;
    const bkey = newIdempotencyKey();
    const req = must(await requestBuyin(a, offer.id, bkey));
    expect(req).toMatchObject({ status: 'requested', price: 10, chips_granted: 3000 });
    expect(req.payment?.pix_key).toBe('pix@exemplo.test');
    expect(must(await requestBuyin(a, offer.id, bkey)).id).toBe(req.id);
    expect(code(await requestBuyin(a, offer.id, newIdempotencyKey()))).toBe('PURCHASE_PENDING');

    const reported = must(await reportPayment(a, req.id));
    expect(reported.status).toBe('payment_reported');
    expect(code(await cancelPurchaseRequest(a, req.id))).toBe('REQUEST_STATE_CONFLICT');

    const waiting = must(await getPlayerPortal(a, publicId));
    expect(waiting.next_action).toBe('await_buyin_confirmation');
    expect(waiting.participant).toMatchObject({ status: 'pending_buyin', confirmed_rebuy_units: 0, confirmed_addons: 0 });

    // "Informei o pagamento" não gera transação (fichas/pote intactos).
    const { count, error: txErr } = await admin.from('transactions')
      .select('id', { count: 'exact', head: true }).eq('tournament_id', tid);
    if (txErr) throw txErr;
    expect(count).toBe(0);

    // Trocar de jogador revoga o token no servidor.
    must(await revokeDeviceSession(a));
    expect(code(await getPlayerPortal(a, publicId))).toBe('SESSION_REVOKED');
    expect(code(await identifyPlayer(publicId, 'Bia S23', a, newIdempotencyKey()))).toBe('SESSION_REVOKED');
    expect(code(await revokeDeviceSession(a))).toBe('SESSION_REVOKED');

    // Token novo no mesmo navegador: nova sessão pendente (o admin valida de novo).
    const b = generateDeviceToken();
    const again = must(await identifyPlayer(publicId, 'Bia S23', b, newIdempotencyKey()));
    expect(again.session.id).not.toBe(ident.session.id);
    expect(again.next_action).toBe('await_validation');
  });
});
