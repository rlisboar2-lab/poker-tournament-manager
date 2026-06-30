// src/components/PlayersPanel.tsx
import { useState } from 'react';
import type { LocalEntry } from '../services/tournaments';

interface Props {
  entries: LocalEntry[];
  onChange: (entries: LocalEntry[]) => void;
  mode?: 'setup' | 'live';
}

export default function PlayersPanel({ entries, onChange, mode = 'setup' }: Props) {
  const [name, setName] = useState('');
  const live = mode === 'live';

  const add = () => {
    const n = name.trim();
    if (!n) return;
    onChange([...entries, { name: n, buyins: 1, rebuys: 0, addons: 0 }]);
    setName('');
  };

  const patch = (i: number, p: Partial<LocalEntry>) =>
    onChange(entries.map((e, idx) => (idx === i ? { ...e, ...p } : e)));

  const remove = (i: number) => onChange(entries.filter((_, idx) => idx !== i));

  const step = (i: number, key: 'rebuys' | 'addons' | 'buyins', d: number) =>
    patch(i, { [key]: Math.max(0, entries[i][key] + d) } as Partial<LocalEntry>);

  const remaining = entries.filter((e) => !e.eliminated).length;

  return (
    <div className="panel">
      <h2>
        {live ? 'Mesa ao vivo' : 'Participantes & Entradas'}
        {live && <span className="pill" style={{ marginLeft: 8 }}>{remaining} na mesa</span>}
      </h2>
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder={live ? 'Entrada tardia (nome)' : 'Nome do jogador'} value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="primary" onClick={add}>{live ? 'Entrar agora' : 'Adicionar'}</button>
      </div>

      {entries.length === 0 ? (
        <p className="notice">Nenhum jogador ainda.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Jogador</th><th>Buy-ins</th><th>Rebuys</th><th>Add-ons</th>
                {live && <th>Status</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} style={e.eliminated ? { opacity: 0.5 } : undefined}>
                  <td>{e.name}</td>
                  <td><Stepper value={e.buyins} onMinus={() => step(i, 'buyins', -1)} onPlus={() => step(i, 'buyins', 1)} /></td>
                  <td><Stepper value={e.rebuys} onMinus={() => step(i, 'rebuys', -1)} onPlus={() => step(i, 'rebuys', 1)} /></td>
                  <td><Stepper value={e.addons} onMinus={() => step(i, 'addons', -1)} onPlus={() => step(i, 'addons', 1)} /></td>
                  {live && (
                    <td>
                      <button className={e.eliminated ? 'ghost' : 'danger'}
                        onClick={() => patch(i, { eliminated: !e.eliminated })}>
                        {e.eliminated ? '↩ Reentrar' : '✗ Eliminar'}
                      </button>
                    </td>
                  )}
                  <td><button className="danger" onClick={() => remove(i)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stepper({ value, onMinus, onPlus }: { value: number; onMinus: () => void; onPlus: () => void }) {
  return (
    <div className="row">
      <button className="ghost" onClick={onMinus}>−</button>
      <span style={{ minWidth: 20, textAlign: 'center' }}>{value}</span>
      <button className="ghost" onClick={onPlus}>+</button>
    </div>
  );
}
