// src/components/BlindClock.tsx
import type { useTournamentEngine } from '../hooks/useTournamentEngine';
import { chips, clock } from '../utils/format';

type Engine = ReturnType<typeof useTournamentEngine>;

export default function BlindClock({ engine }: { engine: Engine }) {
  const { state, levels, start, pause, reset } = engine;

  return (
    <div className="panel">
      <h2>Relógio — Nível {state.level_index} / {state.total_levels}
        {' '}<span className="pill">{state.status}</span>
      </h2>

      <div className="clock-big">{clock(state.seconds_until_next)}</div>
      <div className="blinds">{chips(state.small_blind)} / {chips(state.big_blind)}</div>
      <div className="sub">
        Próximo:&nbsp;
        {state.next_big_blind != null
          ? `${chips(state.next_small_blind ?? 0)} / ${chips(state.next_big_blind)}`
          : '— (último nível)'}
      </div>

      <div className="grid" style={{ marginTop: 20 }}>
        <div className="panel" style={{ margin: 0 }}>
          <label>Stack médio</label>
          <div className="kpi">{chips(state.average_stack)}</div>
        </div>
        <div className="panel" style={{ margin: 0 }}>
          <label>Pressão (stack médio em BBs)</label>
          <div className="kpi">{state.pressure_bb.toFixed(1)} BB</div>
        </div>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        {state.status !== 'running'
          ? <button className="primary" onClick={start}>▶ Iniciar</button>
          : <button className="ghost" onClick={pause}>⏸ Pausar</button>}
        <button className="danger" onClick={reset}>↺ Reiniciar</button>
      </div>

      <h2 style={{ marginTop: 24 }}>Estrutura projetada</h2>
      <table>
        <thead><tr><th>Nível</th><th>SB</th><th>BB</th></tr></thead>
        <tbody>
          {levels.map((l) => (
            <tr key={l.nivel} style={l.nivel === state.level_index ? { color: 'var(--gold)', fontWeight: 700 } : undefined}>
              <td>{l.nivel}</td><td>{chips(l.small_blind)}</td><td>{chips(l.big_blind)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
