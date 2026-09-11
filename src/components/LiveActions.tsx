// src/components/LiveActions.tsx
// Console ao vivo (REDESIGN.md S13): barra fixa de 4 ações no rodapé, alcance
// de polegar no celular. Eliminar é imediato — sem confirm(); o desfazer é o
// toast do App. Adicionar/Rebuy/Add-on passam por CobrancaPix e só aplicam a
// transação no "Pago".
import { useState } from 'react';
import type { LocalEntry } from '../services/tournaments';
import { hasPlayerNamed } from '../utils/seating';
import CobrancaPix from './CobrancaPix';

interface Props {
  entries: LocalEntry[];
  buyInValue: number;
  rebuyValue: number;
  addonValue: number;
  maxRebuys: number;        // por jogador; 0 = sem limite
  knownPlayers?: string[];  // nomes já cadastrados (chips de 1 clique + datalist)
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
  knownPlayers = [], onAddPlayer, onRebuy, onAddon, onEliminate,
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
      <div className="live-actions-bar">
        <button className="ghost" disabled={!lateCheckinOpen}
          title={!lateCheckinOpen ? 'Late check-in fechado' : undefined}
          onClick={() => setSheet('add')}>+ Jogador</button>
        <button className="danger" disabled={active.length === 0}
          onClick={() => setSheet('eliminate')}>✗ Eliminar</button>
        <button className="ghost" disabled={!lateCheckinOpen || rebuyable.length === 0}
          title={!lateCheckinOpen ? 'Late check-in fechado' : undefined}
          onClick={() => setSheet('rebuy')}>↻ Rebuy</button>
        {addonEnabled && (
          <button className="ghost" disabled={active.length === 0}
            onClick={() => setSheet('addon')}>＋ Add-on</button>
        )}
      </div>

      {sheet === 'add' && (
        <div className="qr-overlay" onClick={close}>
          <div className="qr-card" onClick={(e) => e.stopPropagation()}>
            <h2>Entrada tardia</h2>
            <datalist id="known-players-live">
              {knownPlayers.map((n) => <option key={n} value={n} />)}
            </datalist>
            <input autoFocus list="known-players-live" placeholder="Nome do jogador" value={name}
              onChange={(e) => { setName(e.target.value); setAddError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && confirmAdd()} />
            {disponiveis.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <label>Adicionar cadastrados (1 clique)</label>
                <div className="quick-add">
                  {disponiveis.map((n) => (
                    <button key={n} className="chip" onClick={() => cobrarBuyIn(n)}>+ {n}</button>
                  ))}
                </div>
              </div>
            )}
            {addError && (
              <p className="notice" style={{ marginTop: 10, color: 'var(--danger)' }}>⚠ {addError}</p>
            )}
            <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
              <button className="ghost" onClick={close}>Cancelar</button>
              <button className="primary" disabled={!name.trim()} onClick={confirmAdd}>Cobrar buy-in</button>
            </div>
          </div>
        </div>
      )}

      {sheet === 'eliminate' && (
        <div className="qr-overlay" onClick={close}>
          <div className="qr-card" onClick={(e) => e.stopPropagation()}>
            <h2>Eliminar</h2>
            {active.length === 0 ? <p className="notice">Ninguém na mesa.</p> : (
              <div className="sheet-list">
                {active.map(({ e, i }) => (
                  <button key={i} className="ghost sheet-item" onClick={() => { onEliminate(i); close(); }}>
                    {e.table ? `Mesa ${e.table} · ${e.seat ?? '—'} — ` : ''}{e.name}
                  </button>
                ))}
              </div>
            )}
            <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
              <button className="ghost" onClick={close}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {sheet === 'rebuy' && (
        <div className="qr-overlay" onClick={close}>
          <div className="qr-card" onClick={(e) => e.stopPropagation()}>
            <h2>Rebuy</h2>
            {rebuyable.length === 0 ? <p className="notice">Ninguém elegível (limite de rebuys atingido).</p> : (
              <div className="sheet-list">
                {rebuyable.map(({ e, i }) => (
                  <button key={i} className="ghost sheet-item"
                    onClick={() => { setPending({ tipo: 'rebuy', index: i, nome: e.name }); setSheet(null); }}>
                    {e.name} {maxRebuys > 0 ? `(${e.rebuys}/${maxRebuys})` : `(${e.rebuys})`}
                    {e.eliminated && <span className="notice"> — eliminado, volta pagando rebuy</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
              <button className="ghost" onClick={close}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {sheet === 'addon' && (
        <div className="qr-overlay" onClick={close}>
          <div className="qr-card" onClick={(e) => e.stopPropagation()}>
            <h2>Add-on</h2>
            {active.length === 0 ? <p className="notice">Ninguém na mesa.</p> : (
              <div className="sheet-list">
                {active.map(({ e, i }) => (
                  <button key={i} className="ghost sheet-item"
                    onClick={() => { setPending({ tipo: 'addon', index: i, nome: e.name }); setSheet(null); }}>
                    {e.name} ({e.addons})
                  </button>
                ))}
              </div>
            )}
            <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
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
