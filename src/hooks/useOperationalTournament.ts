// src/hooks/useOperationalTournament.ts
// Estado do torneio persistente (fluxo 2) no admin. O servidor é a fonte de
// verdade: o cache local só guarda IDs e a última state_version vista, para
// retomar depois de fechar o app. Conflito de versão recarrega do servidor e
// devolve a decisão ao admin — nunca reenvia o comando com o cache.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createOperationalTournament,
  describeError,
  finishOperationalTournament,
  getOperationalTournament,
  isMissingRpc,
  needsReload,
  publishTournament,
  type CreateTournamentInput,
  type OperationalSnapshot,
  type RpcError,
  type RpcResult,
  type TournamentSummary,
} from '../services/operational';
import { buildFinishResults } from '../utils/operational-config';
import type { LocalEntry } from '../services/tournaments';
import type { PublicStatus } from '../types/database';

export interface OperationalRef {
  tournamentId: string;
  publicId: string | null;
  publicStatus: PublicStatus;
  stateVersion: number;
  name: string;
}

const toRef = (t: TournamentSummary): OperationalRef => ({
  tournamentId: t.id,
  publicId: t.public_id,
  publicStatus: t.public_status,
  stateVersion: t.state_version,
  name: t.name,
});

export type FinishOutcome = { ok: true } | { ok: false; message: string };

export function useOperationalTournament(enabled: boolean, initial: OperationalRef | null) {
  const [ref, setRef] = useState<OperationalRef | null>(initial);
  const [snapshot, setSnapshot] = useState<OperationalSnapshot | null>(null);
  // Torneio aberto no servidor que este aparelho ainda não conhece (outro aparelho, cache limpo).
  const [candidate, setCandidate] = useState<TournamentSummary | null>(null);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busyRef = useRef(false);

  const refId = ref?.tournamentId ?? null;

  // Falha de infraestrutura (rede, função ausente). Erro de domínio vem no envelope.
  const onThrown = useCallback((e: unknown) => {
    if (isMissingRpc(e)) { setAvailable(false); return; }
    setError((e as Error)?.message ?? String(e));
  }, []);

  const apply = useCallback((id: string | null, r: RpcResult<OperationalSnapshot>): OperationalSnapshot | null => {
    if (r.ok) {
      setSnapshot(r.data);
      if (id) { setRef(toRef(r.data.tournament)); setCandidate(null); }
      else setCandidate(r.data.tournament);
      return r.data;
    }
    if (r.error.code === 'NOT_FOUND') {
      if (id) {
        setRef(null);
        setSnapshot(null);
        setNotice('O torneio persistente deste aparelho não existe mais no servidor. O vínculo local foi removido.');
      } else setCandidate(null);
      return null;
    }
    setError(describeError(r.error));
    return null;
  }, []);

  const load = useCallback(
    async (id: string | null) => apply(id, await getOperationalTournament(id)),
    [apply],
  );

  // Uma ação por vez: toque duplo não dispara dois comandos.
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try { return await fn(); }
    catch (e) { onThrown(e); return undefined; }
    finally { busyRef.current = false; setBusy(false); }
  }, [onThrown]);

  const onDomainError = useCallback(async (e: RpcError) => {
    setError(describeError(e));
    if (needsReload(e.code) && refId) await load(refId);
  }, [load, refId]);

  const refresh = useCallback(() => run(() => load(refId)), [run, load, refId]);

  // Ao entrar (ou trocar de sessão): confirma o vínculo salvo ou procura um torneio aberto.
  useEffect(() => {
    if (!enabled) return;
    getOperationalTournament(refId).then((r) => apply(refId, r)).catch(onThrown);
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const create = useCallback((input: CreateTournamentInput) => run(async () => {
    if (refId) return;
    // Nunca dois torneios abertos: se o servidor já tem um, o admin retoma aquele.
    const existing = await load(null);
    if (existing) {
      setError(`Já existe um torneio persistente aberto no servidor ("${existing.tournament.name}"). Retome-o em vez de criar outro.`);
      return;
    }
    const r = await createOperationalTournament(input);
    if (!r.ok) { await onDomainError(r.error); return; }
    setRef(toRef(r.data.tournament));
    setCandidate(null);
    await load(r.data.tournament.id);
    setNotice('Torneio persistente criado como rascunho. Publique para abrir o link aos jogadores.');
  }), [run, load, refId, onDomainError]);

  const adopt = useCallback(() => run(async () => {
    if (!candidate) return;
    await load(candidate.id);
    setNotice('Torneio persistente retomado a partir do servidor.');
  }), [run, load, candidate]);

  const publish = useCallback(() => run(async () => {
    if (!ref) return;
    const r = await publishTournament(ref.tournamentId, ref.stateVersion);
    if (!r.ok) { await onDomainError(r.error); return; }
    setRef(toRef(r.data.tournament));
    await load(r.data.tournament.id);
    setNotice('Torneio publicado. O link /jogar já mostra este torneio (portal ainda fechado até a S23).');
  }), [run, load, ref, onDomainError]);

  /**
   * Fecha o torneio existente (nada de criar outro registro). Usa a última
   * state_version vista; se o servidor mudou, recarrega e pede revisão.
   */
  const finish = useCallback(async (entries: LocalEntry[]): Promise<FinishOutcome> => {
    const out = await run(async (): Promise<FinishOutcome> => {
      if (!ref) return { ok: false, message: 'Sem torneio persistente vinculado.' };
      const snap = snapshot?.tournament.id === ref.tournamentId ? snapshot : await load(ref.tournamentId);
      if (!snap) return { ok: false, message: 'Não foi possível ler o torneio no servidor.' };
      const { results, unmatched } = buildFinishResults(entries, snap.participants);
      if (unmatched.length) {
        return { ok: false, message: `Jogadores sem inscrição no torneio persistente: ${unmatched.join(', ')}.` };
      }
      const r = await finishOperationalTournament(ref.tournamentId, ref.stateVersion, results);
      if (!r.ok) { await onDomainError(r.error); return { ok: false, message: describeError(r.error) }; }
      setRef(toRef(r.data.tournament));
      return { ok: true };
    });
    return out ?? { ok: false, message: 'Outra ação em andamento, ou falha de conexão.' };
  }, [run, load, ref, snapshot, onDomainError]);

  /** Solta o vínculo local (novo torneio). O registro no servidor continua. */
  const clear = useCallback(() => {
    setRef(null);
    setSnapshot(null);
    setError(null);
    setNotice(null);
    if (enabled) load(null).catch(onThrown);
  }, [enabled, load, onThrown]);

  return { ref, snapshot, candidate, available, busy, error, notice, create, publish, adopt, refresh, finish, clear };
}

export type OperationalState = ReturnType<typeof useOperationalTournament>;
