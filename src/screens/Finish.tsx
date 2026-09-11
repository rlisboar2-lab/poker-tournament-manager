// src/screens/Finish.tsx
// Tela de fim de torneio (REDESIGN.md S13). Migra e aposenta ResultsPanel.tsx.
// Não-destrutiva e reversível: "↩ Não acabou" revive o penúltimo eliminado e
// devolve ao relógio — toque errado no console não pode encerrar o torneio.
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
  onUndoFinish: () => void;
  onSave: () => void;
  saved: boolean;
  saving: boolean;
  onDiscard: () => void;
  onNewTournament: () => void;
}

export default function Finish({
  entries, onChange, payoutPct, prizePool, buyInValue, rebuyValue, addonValue,
  onUndoFinish, onSave, saved, saving, onDiscard, onNewTournament,
}: Props) {
  const invested = (e: LocalEntry) =>
    e.buyins * buyInValue + e.rebuys * rebuyValue + e.addons * addonValue;

  const setPlacement = (i: number, place: number | undefined) =>
    onChange(entries.map((e, idx) => (idx !== i ? e : {
      ...e,
      final_placement: place,
      payout_amount: place ? prizePool * (payoutPct[place - 1] ?? 0) : undefined,
    })));

  const setPrize = (i: number, valor: number) =>
    onChange(entries.map((e, idx) => (idx === i ? { ...e, payout_amount: valor } : e)));

  // O campeão só existe quando resta 1 ativo (renumberPlacements); o penúltimo
  // é quem caiu por último — reviver ele é o que desfaz o fim do torneio.
  const champion = entries.find((e) => !e.eliminated && e.final_placement === 1);
  const runnerUp = entries.find((e) => e.eliminated && e.final_placement === 2);

  const ranked = [...entries].sort((a, b) => (a.final_placement ?? 999) - (b.final_placement ?? 999));

  return (
    <div className="panel">
      <h2>Torneio finalizado</h2>

      {champion && <div className="finish-champion">🏆 {champion.name} é o campeão!</div>}

      {runnerUp && (
        <p className="notice">
          Toque errado?{' '}
          <button className="ghost" onClick={onUndoFinish}>↩ Não acabou — revive {runnerUp.name}</button>
        </p>
      )}

      <h2 style={{ marginTop: 22 }}>Confirmar colocações e prêmios</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Jogador</th><th>Colocação</th><th>Investido</th><th>Prêmio</th><th>Líquido</th></tr>
          </thead>
          <tbody>
            {entries.map((e, i) => {
              const inv = invested(e);
              const prize = e.payout_amount ?? 0;
              return (
                <tr key={i}>
                  <td>{e.name}</td>
                  <td style={{ width: 100 }}>
                    <input type="number" min={1} max={entries.length}
                      value={e.final_placement ?? ''} placeholder="-"
                      onChange={(ev) => setPlacement(i, ev.target.value ? Number(ev.target.value) : undefined)} />
                  </td>
                  <td>{brl(inv)}</td>
                  <td style={{ width: 130 }}>
                    <input type="number" step="1" value={Number(prize.toFixed(2))}
                      onChange={(ev) => setPrize(i, Number(ev.target.value))} />
                  </td>
                  <td style={{ color: prize - inv >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                    {brl(prize - inv)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 style={{ marginTop: 22 }}>Ranking do torneio</h2>
      {ranked.filter((e) => e.final_placement).length === 0 ? (
        <p className="notice">Defina as colocações acima.</p>
      ) : (
        <ol className="ranking">
          {ranked.filter((e) => e.final_placement).map((e) => {
            const net = (e.payout_amount ?? 0) - invested(e);
            return (
              <li key={e.name}>
                <b>{e.final_placement}º {e.name}</b> — {e.payout_amount ? brl(e.payout_amount) : 'sem prêmio'}
                <span className="notice"> (saldo {brl(net)})</span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="row" style={{ marginTop: 18, justifyContent: 'space-between' }}>
        <button className="primary" disabled={saved || saving} onClick={onSave}>
          {saved ? '✓ Salvo' : saving ? 'Salvando…' : '💾 Salvar torneio'}
        </button>
        <button className="danger" onClick={onDiscard}>🗑 Descartar resultados</button>
        <button className="ghost" onClick={onNewTournament}>＋ Novo torneio</button>
      </div>
    </div>
  );
}
