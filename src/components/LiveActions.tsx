// src/components/LiveActions.tsx
// Console ao vivo (REDESIGN.md S13): barra fixa de 4 ações no rodapé, alcance
// de polegar no celular. Eliminar é imediato — sem confirm(); o desfazer é o
// toast do App. Adicionar/Rebuy/Add-on passam por CobrancaPix e só aplicam a
// transação no "Pago".
// Torneio persistente (`remote`, S24): Rebuy/Add-on só liberam a compra no
// servidor; o jogador pede e paga pelo link e as fichas entram quando o admin
// confirma o pagamento na aba Pedidos. Entrada tardia não existe: a inscrição
// fecha no início.
import { useState } from 'react';
import type { LocalEntry } from '../services/tournaments';
import type { OperationalSnapshot } from '../services/operational';
import type { PurchaseKind } from '../types/database';
import { hasPlayerNamed } from '../utils/seating';
import { activeAuthorizations, eligibleOffers, isOpenRequest, participantByName } from '../utils/operational-live';
import CobrancaPix from './CobrancaPix';
import { PlusIcon, ResetIcon, UserMinusIcon, UserPlusIcon } from './Icons';

interface Props {
  entries: LocalEntry[];
  buyInValue: number;
  rebuyValue: number;
  addonValue: number;
  maxRebuys: number;        // por jogador; 0 = sem limite
  knownPlayers?: string[];  // nomes já cadastrados (chips de 1 clique + datalist)
  inactivePlayers?: string[];
  addonEnabled: boolean;
  lateCheckinOpen: boolean; // false = late check-in fechado (bloqueia + Jogador / Rebuy)
  onAddPlayer: (name: string) => boolean; // false = nome já no torneio
  onRebuy: (index: number) => void;
  onAddon: (index: number) => void;
  onEliminate: (index: number) => void;
  remote?: {
    snapshot: OperationalSnapshot | null; // null = ainda não lido: tudo bloqueado
    busy: boolean;
    onAuthorize: (participantId: string, kind: Exclude<PurchaseKind, 'buyin'>, offerIds: string[]) => void;
  };
}

type RemoteState = { participantId: string; offerIds: string[] } | { blocked: string };

/** O que o servidor permite liberar para esta entrada agora. */
function remoteState(remote: NonNullable<Props['remote']>, e: LocalEntry, kind: Exclude<PurchaseKind, 'buyin'>): RemoteState {
  const s = remote.snapshot;
  if (!s) return { blocked: 'Carregando do servidor…' };
  const p = participantByName(s.participants, e.name);
  if (!p) return { blocked: 'Sem inscrição no servidor' };
  if (s.requests.some((r) => r.participant_id === p.id && r.kind !== 'buyin' && isOpenRequest(r))) {
    return { blocked: 'Pedido em aberto — veja Pedidos' };
  }
  if (activeAuthorizations(s).some((a) => a.participant_id === p.id && a.kind === kind)) {
    return { blocked: 'Já liberado, esperando o jogador pedir' };
  }
  const offers = eligibleOffers(s, p, kind);
  if (offers.length === 0) return { blocked: kind === 'rebuy' ? 'Sem rebuy disponível (limite ou janela)' : 'Sem add-on disponível' };
  return { participantId: p.id, offerIds: offers.map((o) => o.id) };
}

type Sheet = 'add' | 'eliminate' | 'rebuy' | 'addon' | null;
type Pending = { tipo: 'buyin' | 'rebuy' | 'addon'; index?: number; nome: string };

export default function LiveActions({
  entries, buyInValue, rebuyValue, addonValue, maxRebuys, addonEnabled, lateCheckinOpen,
  knownPlayers = [], inactivePlayers = [], onAddPlayer, onRebuy, onAddon, onEliminate, remote,
}: Props) {
  const [sheet, setSheet] = useState<Sheet>(null);
  const [name, setName] = useState('');
  const [addError, setAddError] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);

  const active = entries
    .map((e, i) => ({ e, i }))
    .filter((x) => !x.e.eliminated)
    .sort((a, b) => (a.e.table ?? 0) - (b.e.table ?? 0) || (a.e.seat ?? 0) - (b.e.seat ?? 0));
  // Rebuy enxerga o torneio inteiro: eliminado que volta é reentrada paga como
  // rebuy, não como buy-in novo (REDESIGN.md S17). Elegibilidade é só o limite
  // de rebuys — `active` continua governando Eliminar e Add-on.
  const rebuyable = entries
    .map((e, i) => ({ e, i }))
    .filter((x) => maxRebuys <= 0 || x.e.rebuys < maxRebuys)
    .sort((a, b) =>
      Number(!!a.e.eliminated) - Number(!!b.e.eliminated) ||
      (a.e.table ?? 0) - (b.e.table ?? 0) || (a.e.seat ?? 0) - (b.e.seat ?? 0));

  // Cadastrados que ainda não estão neste torneio (mesma regra do PlayersPanel).
  const disponiveis = knownPlayers.filter((n) => !hasPlayerNamed(entries, n));

  const close = () => { setSheet(null); setName(''); setAddError(''); };

  const cobrarBuyIn = (n: string) => {
    const nome = n.trim();
    if (!nome) return;
    if (inactivePlayers.some((p) => p.localeCompare(nome, 'pt-BR', { sensitivity: 'accent' }) === 0)) {
      setAddError(`${nome} está inativo e não pode participar de novos torneios.`);
      return;
    }
    if (hasPlayerNamed(entries, nome)) {
      setAddError(`${nome} já está no torneio — use ↻ Rebuy para a reentrada.`);
      return;
    }
    setAddError('');
    setPending({ tipo: 'buyin', nome });
    setSheet(null);
  };

  const confirmAdd = () => cobrarBuyIn(name);

  // Remoto: escolher o jogador libera a compra no servidor (nada de fichas aqui).
  const pick = (kind: Exclude<PurchaseKind, 'buyin'>, e: LocalEntry, i: number) => {
    if (!remote) {
      setPending({ tipo: kind, index: i, nome: e.name });
      setSheet(null);
      return;
    }
    const st = remoteState(remote, e, kind);
    if ('blocked' in st) return;
    remote.onAuthorize(st.participantId, kind, st.offerIds);
    setSheet(null);
  };
  const remoteNote = (kind: Exclude<PurchaseKind, 'buyin'>, e: LocalEntry) => {
    if (!remote) return null;
    const st = remoteState(remote, e, kind);
    return 'blocked' in st ? <span className="pill">{st.blocked}</span> : null;
  };
  const remoteBlocked = (kind: Exclude<PurchaseKind, 'buyin'>, e: LocalEntry) =>
    !!remote && (remote.busy || 'blocked' in remoteState(remote, e, kind));
  const remoteHelp = remote && (
    <p className="notice live-sheet-help">
      Libera a compra no link do jogador. Ele pede e paga; as fichas só entram quando você confirmar o pagamento em Pedidos.
    </p>
  );

  return (
    <>
      <div className="live-actions-bar" role="toolbar" aria-label="Ações rápidas do torneio">
        <button className="ghost" disabled={!lateCheckinOpen || !!remote}
          title={remote ? 'Torneio persistente: a inscrição fechou no início' : !lateCheckinOpen ? 'Late check-in fechado' : undefined}
          onClick={() => setSheet('add')}><UserPlusIcon size={19} /> Jogador</button>
        <button className="danger" disabled={active.length === 0}
          onClick={() => setSheet('eliminate')}><UserMinusIcon size={19} /> Eliminar</button>
        <button className="ghost" disabled={!lateCheckinOpen || rebuyable.length === 0}
          title={!lateCheckinOpen ? 'Late check-in fechado' : undefined}
          onClick={() => setSheet('rebuy')}><ResetIcon size={19} /> Rebuy</button>
        {addonEnabled && (
          <button className="ghost" disabled={active.length === 0}
            onClick={() => setSheet('addon')}><PlusIcon size={19} /> Add-on</button>
        )}
      </div>

      {sheet === 'add' && (
        <div className="qr-overlay live-sheet-overlay" onClick={close}>
          <div className="qr-card live-sheet" role="dialog" aria-modal="true" aria-labelledby="live-add-title" onClick={(e) => e.stopPropagation()}>
            <span className="setup-eyebrow">Ação rápida</span>
            <h2 id="live-add-title">Entrada tardia</h2>
            <datalist id="known-players-live">
              {knownPlayers.map((n) => <option key={n} value={n} />)}
            </datalist>
            <label htmlFor="live-player-name">Nome do jogador</label>
            <input id="live-player-name" autoFocus list="known-players-live" placeholder="Digite um nome" value={name}
              onChange={(e) => { setName(e.target.value); setAddError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && confirmAdd()} />
            {disponiveis.length > 0 && (
              <div className="live-known-players">
                <p className="known-players-label">Adicionar cadastrados (1 clique)</p>
                <div className="quick-add">
                  {disponiveis.map((n) => (
                    <button key={n} className="chip" onClick={() => cobrarBuyIn(n)}>+ {n}</button>
                  ))}
                </div>
              </div>
            )}
            {addError && (
              <p className="notice live-sheet-error" role="alert">{addError}</p>
            )}
            <div className="live-sheet-actions">
              <button className="ghost" onClick={close}>Cancelar</button>
              <button className="primary" disabled={!name.trim()} onClick={confirmAdd}>Cobrar buy-in</button>
            </div>
          </div>
        </div>
      )}

      {sheet === 'eliminate' && (
        <div className="qr-overlay live-sheet-overlay" onClick={close}>
          <div className="qr-card live-sheet" role="dialog" aria-modal="true" aria-labelledby="live-eliminate-title" onClick={(e) => e.stopPropagation()}>
            <span className="setup-eyebrow">Ação imediata</span>
            <h2 id="live-eliminate-title">Eliminar jogador</h2>
            <p className="notice live-sheet-help">A eliminação é aplicada ao escolher um nome. Você poderá desfazer por 5 segundos.</p>
            {active.length === 0 ? <p className="notice">Ninguém na mesa.</p> : (
              <div className="sheet-list">
                {active.map(({ e, i }) => (
                  <button key={i} className="ghost sheet-item" onClick={() => { onEliminate(i); close(); }}>
                    <strong>{e.name}</strong>
                    <span>{e.table ? `Mesa ${e.table} · Assento ${e.seat ?? '—'}` : 'Sem posição de mesa'}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="live-sheet-actions live-sheet-actions--single">
              <button className="ghost" onClick={close}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {sheet === 'rebuy' && (
        <div className="qr-overlay live-sheet-overlay" onClick={close}>
          <div className="qr-card live-sheet" role="dialog" aria-modal="true" aria-labelledby="live-rebuy-title" onClick={(e) => e.stopPropagation()}>
            <span className="setup-eyebrow">{remote ? 'Liberação' : 'Cobrança'}</span>
            <h2 id="live-rebuy-title">Rebuy</h2>
            {remoteHelp}
            {rebuyable.length === 0 ? <p className="notice">Ninguém elegível (limite de rebuys atingido).</p> : (
              <div className="sheet-list">
                {rebuyable.map(({ e, i }) => (
                  <button key={i} className="ghost sheet-item" disabled={remoteBlocked('rebuy', e)}
                    onClick={() => pick('rebuy', e, i)}>
                    <strong>{e.name}</strong>
                    <span>{maxRebuys > 0 ? `${e.rebuys} de ${maxRebuys} rebuys` : `${e.rebuys} rebuys`}</span>
                    {e.eliminated && <span className="pill late">Eliminado · volta após o pagamento</span>}
                    {remoteNote('rebuy', e)}
                  </button>
                ))}
              </div>
            )}
            <div className="live-sheet-actions live-sheet-actions--single">
              <button className="ghost" onClick={close}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {sheet === 'addon' && (
        <div className="qr-overlay live-sheet-overlay" onClick={close}>
          <div className="qr-card live-sheet" role="dialog" aria-modal="true" aria-labelledby="live-addon-title" onClick={(e) => e.stopPropagation()}>
            <span className="setup-eyebrow">{remote ? 'Liberação' : 'Cobrança'}</span>
            <h2 id="live-addon-title">Add-on</h2>
            {remoteHelp}
            {active.length === 0 ? <p className="notice">Ninguém na mesa.</p> : (
              <div className="sheet-list">
                {active.map(({ e, i }) => (
                  <button key={i} className="ghost sheet-item" disabled={remoteBlocked('addon', e)}
                    onClick={() => pick('addon', e, i)}>
                    <strong>{e.name}</strong>
                    <span>{e.addons} add-on{e.addons === 1 ? '' : 's'}</span>
                    {remoteNote('addon', e)}
                  </button>
                ))}
              </div>
            )}
            <div className="live-sheet-actions live-sheet-actions--single">
              <button className="ghost" onClick={close}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {pending && !remote && (
        <CobrancaPix
          tipo={pending.tipo}
          jogador={pending.nome}
          valor={pending.tipo === 'buyin' ? buyInValue : pending.tipo === 'rebuy' ? rebuyValue : addonValue}
          onCancelar={() => setPending(null)}
          onPago={() => {
            if (pending.tipo === 'buyin') {
              // Corrida improvável (nome entrou por outro caminho durante a
              // cobrança): reabre o sheet com o erro em vez de engolir o pago.
              if (!onAddPlayer(pending.nome)) {
                setAddError(`${pending.nome} já está no torneio — use ↻ Rebuy para a reentrada.`);
                setPending(null);
                setSheet('add');
                return;
              }
            }
            else if (pending.tipo === 'rebuy') onRebuy(pending.index!);
            else onAddon(pending.index!);
            setPending(null);
            setName('');
          }}
        />
      )}
    </>
  );
}
