// src/screens/Home.tsx
import { useEffect, useState } from 'react';
import { playerLeaderboard, type PlayerStat } from '../services/tournaments';
import { isSupabaseConfigured } from '../lib/supabase';

export interface ResumeInfo {
  name: string;
  levelNumber: number;
  totalLevels: number;
  playersRemaining: number;
}

interface Props {
  resume: ResumeInfo | null;
  onResume: () => void;
  onCreate: () => void;
  onOpenRanking: () => void;
  onOpenHistorico: () => void;
}

const MEDALS = ['🥇', '🥈', '🥉'];

export default function Home({ resume, onResume, onCreate, onOpenRanking, onOpenHistorico }: Props) {
  const [top3, setTop3] = useState<PlayerStat[]>([]);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    playerLeaderboard().then((board) => setTop3(board.slice(0, 3))).catch(() => {});
  }, []);

  return (
    <div className="home">
      {resume && (
        <button className="panel home-resume" onClick={onResume}>
          <span className="home-resume-label">▶ Retomar torneio</span>
          <span className="notice">
            {resume.name} · nível {resume.levelNumber}/{resume.totalLevels} · {resume.playersRemaining} na mesa
          </span>
        </button>
      )}

      {top3.length > 0 && (
        <div
          className="panel podium-mini"
          role="button"
          tabIndex={0}
          onClick={onOpenRanking}
          onKeyDown={(e) => { if (e.key === 'Enter') onOpenRanking(); }}
        >
          <h2>Pódio</h2>
          <div className="podium-mini-row">
            {top3.map((p, i) => (
              <div key={p.display_name} className="podium-mini-card">
                <span className="podium-mini-medal">{MEDALS[i]}</span>
                <span className="podium-mini-name">{p.display_name}</span>
                <span className="podium-mini-points">{p.points} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button className="primary home-create" onClick={onCreate}>● Criar torneio</button>

      <div className="row home-secondary">
        <button className="ghost" onClick={onOpenRanking}>Ranking completo</button>
        <button className="ghost" onClick={onOpenHistorico}>Torneios finalizados</button>
      </div>
    </div>
  );
}
