// src/components/PlayersPanel.tsx
import { useState } from 'react';
import type { LocalEntry } from '../services/tournaments';
import { hasPlayerNamed } from '../utils/seating';
import { PlusIcon, ResetIcon, TableIcon, TrashIcon, UserMinusIcon } from './Icons';

interface Props {
  entries: LocalEntry[];
  onChange: (entries: LocalEntry[]) => void;
  mode?: 'setup' | 'live';
  knownPlayers?: string[];               // nomes já cadastrados (autocompletar)
  maxRebuys?: number;                    // por jogador; 0 = sem limite
  addonEnabled?: boolean;               // torneio oferece add-on?
  onAddLive?: (name: string) => boolean; // adiciona + acomoda na mesa (live); false = duplicata
  onRebalance?: () => void;              // recalcula posições nas mesas
  onEliminate?: (index: number, eliminate: boolean) => void; // colocação automática
}

export default function PlayersPanel({ entries, onChange, mode = 'setup', knownPlayers = [], maxRebuys = 0, addonEnabled = true, onAddLive, onRebalance, onEliminate }: Props) {
  const [name, setName] = useState('');
  const [erro, setErro] = useState('');
  const live = mode === 'live';

  // Nome repetido é erro bloqueante, não aviso (REDESIGN.md S17): comparação
  // case- e acento-insensível, contando também quem já foi eliminado — a volta
  // desse jogador é pelo Rebuy, nunca por um cadastro novo.
  const addByName = (n: string): boolean => {
    const nome = n.trim();
    if (!nome) return false;
    if (hasPlayerNamed(entries, nome)) {
      setErro(live
        ? `${nome} já está no torneio — use ↻ Rebuy para a reentrada.`
        : `${nome} já está na lista.`);
      return false;
    }
    setErro('');
    if (live && onAddLive) return onAddLive(nome);
    onChange([...entries, { name: nome, buyins: 1, rebuys: 0, addons: 0 }]);
    return true;
  };

  const add = () => { if (addByName(name)) setName(''); };

  // Cadastrados que ainda não estão neste torneio (para adição com 1 clique).
  const disponiveis = knownPlayers.filter((n) => !hasPlayerNamed(entries, n));

  const patch = (i: number, p: Partial<LocalEntry>) =>
    onChange(entries.map((e, idx) => (idx === i ? { ...e, ...p } : e)));

  const remove = (i: number) => onChange(entries.filter((_, idx) => idx !== i));

  const step = (i: number, key: 'rebuys' | 'addons' | 'buyins', d: number) => {
    let v = Math.max(0, entries[i][key] + d);
    if (key === 'rebuys' && maxRebuys > 0) v = Math.min(v, maxRebuys);
    patch(i, { [key]: v } as Partial<LocalEntry>);
  };

  const remaining = entries.filter((e) => !e.eliminated).length;
  const tables = Array.from(
    new Set(entries.filter((e) => !e.eliminated && e.table).map((e) => e.table as number))
  ).sort((a, b) => a - b);

  return (
    <div className={`panel players-panel players-panel--${mode}`}>
      <h2>
        {live ? 'Mesa ao vivo' : 'Participantes e entradas'}
        {live && <span className="pill" style={{ marginLeft: 8 }}>{remaining} na mesa</span>}
        {live && tables.length > 0 && <span className="pill" style={{ marginLeft: 6 }}>{tables.length} mesa(s)</span>}
      </h2>
      <datalist id="known-players">
        {knownPlayers.map((n) => <option key={n} value={n} />)}
      </datalist>
      <div className="player-add-row">
        <div className="player-name-field">
          <label htmlFor="player-name">{live ? 'Entrada tardia (nome)' : 'Nome do jogador'}</label>
          <input id="player-name" list="known-players" placeholder="Digite um nome" value={name}
            onChange={(e) => { setName(e.target.value); setErro(''); }}
            onKeyDown={(e) => e.key === 'Enter' && add()} />
        </div>
        <button type="button" className="primary player-add-button" onClick={add}>
          <PlusIcon size={18} /> {live ? 'Entrar agora' : 'Adicionar'}
        </button>
        {live && onRebalance && (
          <button type="button" className="ghost player-rebalance" onClick={onRebalance}>
            <TableIcon size={18} /> Calcular posições na mesa
          </button>
        )}
      </div>

      {erro && (
        <p className="notice player-error" role="alert">{erro}</p>
      )}

      {disponiveis.length > 0 && (
        <div className="known-players">
          <p className="known-players-label">Adicionar cadastrados (1 clique)</p>
          <div className="quick-add">
            {disponiveis.map((n) => (
              <button type="button" key={n} className="chip" onClick={() => addByName(n)}>+ {n}</button>
            ))}
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="notice">Nenhum jogador ainda.</p>
      ) : (
        <div className={`table-wrap players-table-wrap players-table-wrap--${mode}`}>
          <table className={`players-table players-table--${mode}${live ? '' : ' responsive-card-table'}`}>
            <thead>
              <tr>
                <th>Jogador</th>
                {live && <th>Mesa</th>}
                {live && <th>Assento</th>}
                <th>Buy-ins</th>
                {live && <th>Rebuys{maxRebuys > 0 ? ` (máx ${maxRebuys})` : ''}</th>}
                {live && addonEnabled && <th>Add-ons</th>}
                {live && <th>Status</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} className={e.eliminated ? 'player-row--eliminated' : undefined}>
                  <td data-label="Jogador"><strong>{e.name}</strong></td>
                  {live && <td data-label="Mesa">{e.table ? `Mesa ${e.table}` : '—'}</td>}
                  {live && <td data-label="Assento">{e.seat ?? '—'}</td>}
                  <td data-label="Buy-ins"><Stepper value={e.buyins} label={`Buy-ins de ${e.name}`} onMinus={() => step(i, 'buyins', -1)} onPlus={() => step(i, 'buyins', 1)} /></td>
                  {live && <td data-label="Rebuys"><Stepper value={e.rebuys} label={`Rebuys de ${e.name}`} onMinus={() => step(i, 'rebuys', -1)} onPlus={() => step(i, 'rebuys', 1)} /></td>}
                  {live && addonEnabled && <td data-label="Add-ons"><Stepper value={e.addons} label={`Add-ons de ${e.name}`} onMinus={() => step(i, 'addons', -1)} onPlus={() => step(i, 'addons', 1)} /></td>}
                  {live && (
                    <td data-label="Status">
                      <button className={e.eliminated ? 'ghost' : 'danger'}
                        onClick={() => onEliminate
                          ? onEliminate(i, !e.eliminated)
                          : patch(i, { eliminated: !e.eliminated, table: undefined, seat: undefined })}>
                        {e.eliminated ? <><ResetIcon size={18} /> {e.final_placement ?? ''}º · Reentrar</> : <><UserMinusIcon size={18} /> Eliminar</>}
                      </button>
                    </td>
                  )}
                  <td data-label="Ação"><button type="button" className="danger icon-button" aria-label={`Remover ${e.name}`}
                    title="Remover jogador" onClick={() => remove(i)}><TrashIcon size={18} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {live && tables.length > 0 && (
        <div className="seating">
          {tables.map((t) => {
            const seated = entries
              .filter((e) => !e.eliminated && e.table === t)
              .sort((a, b) => (a.seat ?? 0) - (b.seat ?? 0));
            return (
              <div className="seating-table" key={t}>
                <h3>Mesa {t} <span className="notice">({seated.length})</span></h3>
                <ol>
                  {seated.map((e) => <li key={e.name}>{e.name}</li>)}
                </ol>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stepper({ value, label, onMinus, onPlus }: { value: number; label: string; onMinus: () => void; onPlus: () => void }) {
  return (
    <div className="stepper" aria-label={label}>
      <button type="button" className="ghost icon-button" aria-label={`Diminuir ${label}`} onClick={onMinus}>−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" className="ghost icon-button" aria-label={`Aumentar ${label}`} onClick={onPlus}>+</button>
    </div>
  );
}
