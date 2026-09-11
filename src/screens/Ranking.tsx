// src/screens/Ranking.tsx
// Pódio + histórico foram separados do StatsPanel (REDESIGN.md S14). Esta tela
// só lê o ranking (services/tournaments.playerLeaderboard, sem mudança de serviço).
import { useEffect, useState } from 'react';
import { playerLeaderboard, type PlayerStat } from '../services/tournaments';
import { isSupabaseConfigured } from '../lib/supabase';
import { brl, pct } from '../utils/format';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function Ranking() {
  const [board, setBoard] = useState<PlayerStat[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) { setLoaded(true); return; }
    playerLeaderboard().then((b) => { setBoard(b); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);

  const podio = board.slice(0, 3);
  const meio = board.slice(3, 9);
  // Ordem visual do pódio: 2º, 1º, 3º — 1º ao centro e maior.
  const podioOrdenado = [
    podio[1] && { p: podio[1], place: 2 },
    podio[0] && { p: podio[0], place: 1 },
    podio[2] && { p: podio[2], place: 3 },
  ].filter((x): x is { p: PlayerStat; place: number } => !!x);

  return (
    <div className="panel">
      <h2>Ranking de jogadores</h2>

      {!isSupabaseConfigured && (
        <p className="warn">Supabase não configurado — sem dados de ranking.</p>
      )}
      {loaded && isSupabaseConfigured && board.length === 0 && (
        <p className="notice">Sem dados ainda.</p>
      )}

      {podioOrdenado.length > 0 && (
        <div className="ranking-podium">
          {podioOrdenado.map(({ p, place }) => {
            const net = p.total_winnings - p.total_invested;
            return (
              <div key={p.display_name} className={`ranking-podium-card place-${place}`}>
                <span className="ranking-podium-medal">{MEDALS[place - 1]}</span>
                <span className="ranking-podium-name">{p.display_name}</span>
                <span className="ranking-podium-points">{p.points} pts</span>
                <span className="ranking-podium-net" style={{ color: net >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                  {brl(net)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {meio.length > 0 && (
        <div className="ranking-mid">
          {meio.map((p, i) => {
            const net = p.total_winnings - p.total_invested;
            return (
              <div key={p.display_name} className="ranking-mid-row">
                <span className="ranking-mid-rank">{i + 4}º</span>
                <span className="ranking-mid-name">{p.display_name}</span>
                <span className="ranking-mid-points">{p.points} pts</span>
                <span className="ranking-mid-net" style={{ color: net >= 0 ? 'var(--accent)' : 'var(--danger)' }}>
                  {brl(net)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {board.length > 0 && (
        <>
          <h2 style={{ marginTop: 20 }}>Tabela geral</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>Jogador</th><th>Pontos</th><th>Eventos</th><th>Investido</th><th>Ganhos</th><th>Líquido</th><th>ROI</th></tr>
              </thead>
              <tbody>
                {board.map((p, i) => {
                  const net = p.total_winnings - p.total_invested;
                  return (
                    <tr key={p.display_name}>
                      <td>{i + 1}º</td>
                      <td>{p.display_name}</td>
                      <td style={{ fontWeight: 700, color: 'var(--gold)' }}>{p.points}</td>
                      <td>{p.events}</td>
                      <td>{brl(p.total_invested)}</td>
                      <td>{brl(p.total_winnings)}</td>
                      <td style={{ color: net >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{brl(net)}</td>
                      <td style={{ color: p.roi >= 0 ? 'var(--accent)' : 'var(--danger)' }}>{pct(p.roi)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
