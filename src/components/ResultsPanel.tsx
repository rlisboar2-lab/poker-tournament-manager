// src/components/ResultsPanel.tsx
import type { LocalEntry } from '../services/tournaments';
import { brl } from '../utils/format';

interface Props {
  entries: LocalEntry[];
  onChange: (entries: LocalEntry[]) => void;
  payoutPct: number[];
  prizePool: number;
  buyInValue: number;
  rebuyValue: number;
  addonValue: number;
}

export default function ResultsPanel({
  entries, onChange, payoutPct, prizePool, buyInValue, rebuyValue, addonValue,
}: Props) {
  const invested = (e: LocalEntry) =>
    e.buyins * buyInValue + e.rebuys * rebuyValue + e.addons * addonValue;

  const setPlacement = (i: number, place: number | undefined) =>
    onChange(entries.map((e, idx) => (idx === i ? { ...e, final_placement: place } : e)));

  const calcular = () => {
    onChange(entries.map((e) => {
      const pos = e.final_placement;
      const pct = pos && pos >= 1 ? payoutPct[pos - 1] ?? 0 : 0;
      return { ...e, payout_amount: prizePool * pct };
    }));
  };

  const ranked = [...entries].sort(
    (a, b) => (a.final_placement ?? 999) - (b.final_placement ?? 999)
  );

  return (
    <div className="panel">
      <h2>Resultado final</h2>
      <p className="notice">
        Defina a colocação de cada jogador e clique em <b>Calcular prêmios</b>. Os valores saem da
        premiação configurada ({prizePool > 0 ? brl(prizePool) : 'R$ 0'} no pote).
      </p>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Jogador</th><th>Colocação</th><th>Investido</th><th>Prêmio</th><th>Saldo</th></tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const inv = invested(e);
              const prize = e.payout_amount ?? 0;
              return (
                <tr key={i}>
                  <td>{e.name}</td>
                  <td style={{ width: 110 }}>
                    <input type="number" min={1} max={entries.length}
                      value={e.final_placement ?? ''} placeholder="-"
                      onChange={(ev) => setPlacement(i, ev.target.value ? Number(ev.target.value) : undefined)} />
                  </td>
                  <td>{brl(inv)}</td>
                  <td>{brl(prize)}</td>
                  <td style={{ color: prize - inv >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                    {brl(prize - inv)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <button className="primary" onClick={calcular}>Calcular prêmios</button>
      </div>

      <h2 style={{ marginTop: 22 }}>Ranking do torneio</h2>
      {ranked.filter((e) => e.final_placement).length === 0 ? (
        <p className="notice">Defina as colocações acima e clique em Calcular prêmios.</p>
      ) : (
        <ol className="ranking">
          {ranked.filter((e) => e.final_placement).map((e) => {
            const net = (e.payout_amount ?? 0) - invested(e);
            return (
              <li key={e.name}>
                <b>{e.name}</b> — {e.payout_amount ? brl(e.payout_amount) : 'sem prêmio'}
                <span className="notice"> (saldo {brl(net)})</span>
              </li>
            );
          })}
        </ol>
      )}
      <p className="notice">
        O ranking histórico por nome (acumulado entre torneios) fica na aba <b>6. Estatísticas</b>,
        após salvar.
      </p>
    </div>
  );
}
