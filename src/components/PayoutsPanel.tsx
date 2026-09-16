// src/components/PayoutsPanel.tsx
import { aplicarPayouts, tabelaPadraoPayouts } from '../utils/poker-math';
import { brl, pct } from '../utils/format';
import { PlusIcon, TrashIcon } from './Icons';

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
    <div className="panel payout-panel">
      <div className="payout-header">
        <div>
          <span className="setup-eyebrow">Distribuição</span>
          <h2>Premiação</h2>
        </div>
        <div className="payout-total">
          <div className="kpi">{brl(prizePool)}</div>
          <span className="notice">prêmio total · {playerCount} jogadores</span>
        </div>
      </div>

      <div className="payout-actions">
        <button type="button" className="ghost" onClick={auto}>Sugerir por nº de jogadores</button>
        <button type="button" className="ghost" onClick={add}><PlusIcon size={18} /> Posição</button>
        <span className={`payout-sum ${Math.abs(soma - 1) > 0.001 ? 'warn' : 'notice'}`} role="status">
          Soma: {pct(soma)} {Math.abs(soma - 1) > 0.001 ? '(ajuste para 100%)' : '✓'}
        </span>
      </div>

      <p className="notice payout-help">Edite a % <b>ou</b> o valor em R$ — um ajusta o outro.</p>
      <div className="table-wrap payout-table-wrap">
        <table className="payout-table responsive-card-table">
          <thead><tr><th>Posição</th><th>%</th><th>Prêmio (R$)</th><th></th></tr></thead>
          <tbody>
            {slices.map((sl, i) => (
              <tr key={i}>
                <td data-label="Posição"><strong>{sl.posicao}º</strong></td>
                <td data-label="Percentual">
                  <label className="sr-only" htmlFor={`payout-percent-${i}`}>Percentual da {sl.posicao}ª posição</label>
                  <input id={`payout-percent-${i}`} type="number" value={Number((sl.percentual * 100).toFixed(2))}
                    onChange={(e) => setPct(i, Number(e.target.value))} />
                </td>
                <td data-label="Prêmio (R$)">
                  <label className="sr-only" htmlFor={`payout-value-${i}`}>Prêmio em reais da {sl.posicao}ª posição</label>
                  <input id={`payout-value-${i}`} type="number" step="1" value={Number(sl.premio.toFixed(2))}
                    onChange={(e) => setValor(i, Number(e.target.value))} />
                </td>
                <td data-label="Ação">
                  <button type="button" className="danger icon-button" aria-label={`Remover ${sl.posicao}ª posição`}
                    title="Remover posição" onClick={() => remove(i)}><TrashIcon size={18} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
