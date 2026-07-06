// src/components/PayoutsPanel.tsx
import { aplicarPayouts, tabelaPadraoPayouts } from '../utils/poker-math';
import { brl, pct } from '../utils/format';

interface Props {
  prizePool: number;
  playerCount: number;
  percentuais: number[];
  onChange: (p: number[]) => void;
}

export default function PayoutsPanel({ prizePool, playerCount, percentuais, onChange }: Props) {
  const soma = percentuais.reduce((s, p) => s + p, 0);
  const slices = aplicarPayouts(prizePool, percentuais);

  const setPct = (i: number, v: number) =>
    onChange(percentuais.map((p, idx) => (idx === i ? v / 100 : p)));
  // Editar o valor em R$ → converte para % do pote (mantém tudo consistente).
  const setValor = (i: number, valor: number) =>
    onChange(percentuais.map((p, idx) => (idx === i ? (prizePool > 0 ? valor / prizePool : 0) : p)));
  const add = () => onChange([...percentuais, 0]);
  const remove = (i: number) => onChange(percentuais.filter((_, idx) => idx !== i));
  const auto = () => onChange(tabelaPadraoPayouts(playerCount));

  return (
    <div className="panel">
      <h2>Premiação</h2>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="kpi">{brl(prizePool)}</div>
        <span className="notice">prêmio total · {playerCount} jogadores</span>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="ghost" onClick={auto}>Sugerir por nº de jogadores</button>
        <button className="ghost" onClick={add}>+ Posição</button>
        <span className={Math.abs(soma - 1) > 0.001 ? 'warn' : 'notice'}>
          Soma: {pct(soma)} {Math.abs(soma - 1) > 0.001 ? '(ajuste para 100%)' : '✓'}
        </span>
      </div>

      <p className="notice" style={{ marginBottom: 8 }}>Edite a % <b>ou</b> o valor em R$ — um ajusta o outro.</p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Posição</th><th>%</th><th>Prêmio (R$)</th><th></th></tr></thead>
          <tbody>
            {slices.map((sl, i) => (
              <tr key={i}>
                <td>{sl.posicao}º</td>
                <td style={{ width: 110 }}>
                  <input type="number" value={Number((sl.percentual * 100).toFixed(2))}
                    onChange={(e) => setPct(i, Number(e.target.value))} />
                </td>
                <td style={{ width: 130 }}>
                  <input type="number" step="1" value={Number(sl.premio.toFixed(2))}
                    onChange={(e) => setValor(i, Number(e.target.value))} />
                </td>
                <td><button className="danger" onClick={() => remove(i)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
