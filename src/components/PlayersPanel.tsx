// src/components/PlayersPanel.tsx
import { useState } from 'react';
import type { LocalEntry } from '../services/tournaments';

interface Props {
  entries: LocalEntry[];
  onChange: (entries: LocalEntry[]) => void;
}

export default function PlayersPanel({ entries, onChange }: Props) {
  const [name, setName] = useState('');

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

  return (
    <div className="panel">
      <h2>Participantes & Entradas</h2>
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="Nome do jogador" value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="primary" onClick={add}>Adicionar</button>
      </div>

      {entries.length === 0 ? (
        <p className="notice">Nenhum jogador ainda. As alterações de rebuy/add-on recalculam os blinds automaticamente.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Jogador</th><th>Buy-ins</th><th>Rebuys</th><th>Add-ons</th>
              <th>Colocação</th><th>Prêmio (R$)</th><th></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i}>
                <td>{e.name}</td>
                <td><Stepper value={e.buyins} onMinus={() => step(i, 'buyins', -1)} onPlus={() => step(i, 'buyins', 1)} /></td>
                <td><Stepper value={e.rebuys} onMinus={() => step(i, 'rebuys', -1)} onPlus={() => step(i, 'rebuys', 1)} /></td>
                <td><Stepper value={e.addons} onMinus={() => step(i, 'addons', -1)} onPlus={() => step(i, 'addons', 1)} /></td>
                <td style={{ width: 90 }}>
                  <input type="number" value={e.final_placement ?? ''} placeholder="-"
                    onChange={(ev) => patch(i, { final_placement: ev.target.value ? Number(ev.target.value) : undefined })} />
                </td>
                <td style={{ width: 120 }}>
                  <input type="number" value={e.payout_amount ?? ''} placeholder="0"
                    onChange={(ev) => patch(i, { payout_amount: ev.target.value ? Number(ev.target.value) : undefined })} />
                </td>
                <td><button className="danger" onClick={() => remove(i)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
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
