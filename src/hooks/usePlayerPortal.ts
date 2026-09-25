// src/hooks/usePlayerPortal.ts
// Estado do portal do jogador (/jogar). O servidor decide tudo: este hook só
// guarda o token do navegador, chama as RPCs públicas e relê o portal depois de
// cada ação e em polling curto enquanto a aba está visível.

import { useCallback, useEffect, useRef, useState } from 'react';
import { isMissingRpc, parsePendingSession, type PendingSession, type RpcError, type RpcResult } from '../services/operational';
import {
  cancelPurchaseRequest,
  clearDeviceToken,
  describePublicError,
  ensureDeviceToken,
  getPlayerPortal,
  getPublicTournament,
  identifyPlayer,
  isSessionEnded,
  loadDeviceToken,
  newIdempotencyKey,
  reportPayment,
  requestBuyin,
  requestPurchase,
  revokeDeviceSession,
  type PlayerPortal,
  type PublicTournament,
} from '../services/publicPortal';

export type PortalPhase =
  | { kind: 'loading' }
  | { kind: 'unavailable'; message: string }
  | { kind: 'identify' }
  | { kind: 'pending'; session: PendingSession | null }
  | { kind: 'portal'; portal: PlayerPortal };

const POLL_MS = 5000;

const OFFLINE = 'Sem conexão com o servidor. Tentando de novo…';

const NO_TOKEN = 'sem token';

/** Comando que precisa do token salvo. Sem token, a releitura leva de volta à identificação. */
const withToken = <T,>(fn: (token: string) => Promise<RpcResult<T>>) => () => {
  const token = loadDeviceToken();
  return token ? fn(token) : Promise.reject(new Error(NO_TOKEN));
};

function keyFor(keys: Map<string, string>, command: string): string {
  let k = keys.get(command);
  if (!k) { k = newIdempotencyKey(); keys.set(command, k); }
  return k;
}

function unavailableMessage(e: RpcError): string {
  if (e.code === 'NOT_FOUND') return 'Torneio não encontrado. Confira o link com o organizador.';
  if (e.code === 'NOT_PUBLIC') return 'Este torneio ainda não está aberto para os jogadores.';
  return describePublicError(e);
}

export function usePlayerPortal(publicId: string | null) {
  const [phase, setPhase] = useState<PortalPhase>({ kind: 'loading' });
  const [tournament, setTournament] = useState<PublicTournament | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [persisted, setPersisted] = useState(true);

  const busyRef = useRef(false);
  // Resposta de leitura antiga não sobrescreve estado mais novo.
  const seq = useRef(0);
  // Mesma chave enquanto o jogador repete o mesmo pedido (rede caiu no meio).
  const pendingKeys = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    const my = ++seq.current;
    const token = loadDeviceToken();
    try {
      const [pub, portal] = await Promise.all([
        getPublicTournament(publicId),
        token ? getPlayerPortal(token, publicId) : Promise.resolve(null),
      ]);
      if (my !== seq.current) return;
      if (!pub.ok) { setPhase({ kind: 'unavailable', message: unavailableMessage(pub.error) }); return; }
      setTournament(pub.data);
      setError((e) => (e === OFFLINE ? null : e));

      if (!portal) { setPhase({ kind: 'identify' }); return; }
      if (portal.ok) { setPhase({ kind: 'portal', portal: portal.data }); return; }
      const code = portal.error.code;
      if (code === 'SESSION_PENDING') {
        let session: PendingSession | null = null;
        try { session = parsePendingSession(portal.error.details.session); } catch { /* sem detalhe */ }
        setPhase({ kind: 'pending', session });
      } else if (isSessionEnded(code)) {
        clearDeviceToken();
        setNotice(describePublicError(portal.error));
        setPhase({ kind: 'identify' });
      } else if (code === 'NOT_FOUND' || code === 'INVALID_ARGUMENT') {
        // O torneio existe (pub ok): o token nunca foi registrado. Identificar de novo.
        setPhase({ kind: 'identify' });
      } else {
        setError(describePublicError(portal.error));
      }
    } catch (e) {
      if (my !== seq.current) return;
      if (isMissingRpc(e)) { setPhase({ kind: 'unavailable', message: 'O portal dos jogadores ainda não está disponível.' }); return; }
      if (/não configurado/.test((e as Error)?.message ?? '')) {
        setPhase({ kind: 'unavailable', message: 'O portal dos jogadores está indisponível neste endereço.' });
        return;
      }
      setError(OFFLINE);
      setPhase((p) => (p.kind === 'loading' ? { kind: 'unavailable', message: OFFLINE } : p));
    }
  }, [publicId]);

  /** Uma ação por vez; relê o portal no fim, com ou sem sucesso. */
  const run = useCallback(async <T,>(command: string | null, action: () => Promise<RpcResult<T>>,
    onOk?: (data: T) => void, onErr?: (e: RpcError) => boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await action();
      if (command) pendingKeys.current.delete(command); // resposta chegou: próxima tentativa é comando novo
      if (r.ok) onOk?.(r.data);
      else if (!onErr?.(r.error)) {
        if (isSessionEnded(r.error.code)) clearDeviceToken();
        setError(describePublicError(r.error));
      }
    } catch (e) {
      if ((e as Error)?.message !== NO_TOKEN) {
        setError(isMissingRpc(e) ? 'O portal dos jogadores ainda não está disponível.' : OFFLINE);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
    await refresh();
  }, [refresh]);

  const identify = useCallback(async (name: string) => {
    const cmd = `identify:${name.trim().toLowerCase()}`;
    const attempt = async () => {
      const t = ensureDeviceToken();
      setPersisted(t.persisted);
      return identifyPlayer(publicId, name, t.token, keyFor(pendingKeys.current, cmd));
    };
    await run(cmd, async () => {
      const r = await attempt();
      // Token antigo encerrado (troca de jogador em outro momento): gera outro e tenta uma vez.
      if (!r.ok && isSessionEnded(r.error.code)) {
        clearDeviceToken();
        pendingKeys.current.clear();
        return attempt();
      }
      return r;
    });
  }, [publicId, run]);

  const buyin = useCallback((offerId: string) =>
    run(`buyin:${offerId}`, withToken((t) => requestBuyin(t, offerId, keyFor(pendingKeys.current, `buyin:${offerId}`))),
      undefined, (e) => e.code === 'PURCHASE_PENDING'), // já existe: a releitura mostra o pedido
  [run]);

  const purchase = useCallback((authorizationId: string, offerId: string) => {
    const cmd = `purchase:${authorizationId}:${offerId}`;
    return run(cmd, withToken((t) => requestPurchase(t, authorizationId, offerId, keyFor(pendingKeys.current, cmd))));
  }, [run]);

  const report = useCallback((requestId: string) =>
    run(null, withToken((t) => reportPayment(t, requestId)),
      () => setNotice('Aviso enviado. Aguarde o organizador conferir o PIX.')),
  [run]);

  const cancel = useCallback((requestId: string) =>
    run(null, withToken((t) => cancelPurchaseRequest(t, requestId)), () => setNotice('Pedido cancelado.')),
  [run]);

  /** Revoga a sessão no servidor e só então esquece o token deste navegador. */
  const switchPlayer = useCallback(() =>
    run(null, withToken(revokeDeviceSession), () => {
      clearDeviceToken();
      pendingKeys.current.clear();
      setNotice('Pronto. Este navegador não está mais identificado.');
    }, (e) => {
      if (isSessionEnded(e.code) || e.code === 'NOT_FOUND') { clearDeviceToken(); return true; }
      return false;
    }),
  [run]);

  // Primeira leitura, fora do corpo do efeito (o StrictMode monta duas vezes e cancela a primeira).
  useEffect(() => {
    const t = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(t);
  }, [refresh]);

  // Polling curto só com a aba visível e sessão em andamento; relê ao voltar para a aba.
  const polling = phase.kind === 'pending' || phase.kind === 'portal' || (phase.kind === 'unavailable' && phase.message === OFFLINE);
  useEffect(() => {
    if (!polling) return;
    let timer: number | undefined;
    const tick = async () => {
      if (!document.hidden && !busyRef.current) await refresh();
      timer = window.setTimeout(tick, POLL_MS);
    };
    timer = window.setTimeout(tick, POLL_MS);
    const onVisible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [polling, refresh]);

  return { phase, tournament, busy, error, notice, persisted, identify, buyin, purchase, report, cancel, switchPlayer, refresh };
}
