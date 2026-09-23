// src/components/LiveActions.tsx
// Console ao vivo (REDESIGN.md S13): barra fixa de 4 ações no rodapé, alcance
// de polegar no celular. Eliminar é imediato — sem confirm(); o desfazer é o
// toast do App. Adicionar/Rebuy/Add-on passam por CobrancaPix e só aplicam a
// transação no "Pago".
import { useState } from 'react';
import type { LocalEntry } from '../services/tournaments';
import { hasPlayerNamed } from '../utils/seating';
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
}

type Sheet = 'add' | 'eliminate' | 'rebuy' | 'addon' | null;
type Pending = { tipo: 'buyin' | 'rebuy' | 'addon'; index?: number; nome: string };

export default function LiveActions({
  entries, buyInValue, rebuyValue, addonValue, maxRebuys, addonEnabled, lateCheckinOpen,
  knownPlayers = [], inactivePlayers = [], onAddPlayer, onRebuy, onAddon, onEliminate,
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

  return (
    <>
      <div className="live-actions-bar" role="toolbar" aria-label="Ações rápidas do torneio">
        <button className="ghost" disabled={!lateCheckinOpen}
          title={!lateCheckinOpen ? 'Late check-in fechado' : undefined}
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
            <span className="setup-eyebrow">Cobrança</span>
            <h2 id="live-rebuy-title">Rebuy</h2>
            {rebuyable.length === 0 ? <p className="notice">Ninguém elegível (limite de rebuys atingido).</p> : (
              <div className="sheet-list">
                {rebuyable.map(({ e, i }) => (
                  <button key={i} className="ghost sheet-item"
                    onClick={() => { setPending({ tipo: 'rebuy', index: i, nome: e.name }); setSheet(null); }}>
                    <strong>{e.name}</strong>
                    <span>{maxRebuys > 0 ? `${e.rebuys} de ${maxRebuys} rebuys` : `${e.rebuys} rebuys`}</span>
                    {e.eliminated && <span className="pill late">Eliminado · volta após o pagamento</span>}
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
            <span className="setup-eyebrow">Cobrança</span>
            <h2 id="live-addon-title">Add-on</h2>
            {active.length === 0 ? <p className="notice">Ninguém na mesa.</p> : (
              <div className="sheet-list">
                {active.map(({ e, i }) => (
                  <button key={i} className="ghost sheet-item"
                    onClick={() => { setPending({ tipo: 'addon', index: i, nome: e.name }); setSheet(null); }}>
                    <strong>{e.name}</strong>
                    <span>{e.addons} add-on{e.addons === 1 ? '' : 's'}</span>
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

      {pending && (
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
