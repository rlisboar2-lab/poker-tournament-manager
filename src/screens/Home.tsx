// src/screens/Home.tsx
import { useEffect, useState } from 'react';
import { playerLeaderboard, type PlayerStat } from '../services/tournaments';
import { isSupabaseConfigured } from '../lib/supabase';
import { PlayIcon, PlusIcon } from '../components/Icons';

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

const PLACES = ['1º lugar', '2º lugar', '3º lugar'];

export default function Home({ resume, onResume, onCreate, onOpenRanking, onOpenHistorico }: Props) {
  const [top3, setTop3] = useState<PlayerStat[]>([]);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    playerLeaderboard().then((board) => setTop3(board.slice(0, 3))).catch(() => {});
  }, []);

  const createButton = (
    <button className="primary home-create" onClick={onCreate}>
      <PlusIcon size={18} />
      Criar torneio
    </button>
  );

  return (
    <main className={`home ${resume ? 'home-with-resume' : 'home-without-resume'}`}>
      {resume && (
        <button className="panel home-resume" onClick={onResume}>
          <span className="home-resume-label"><PlayIcon size={26} /> Retomar torneio</span>
          <span className="home-resume-copy">
            <strong className="home-resume-name">{resume.name}</strong>
            <span className="notice">Nível {resume.levelNumber}/{resume.totalLevels} · {resume.playersRemaining} na mesa</span>
          </span>
        </button>
      )}

      {!resume && createButton}

      {top3.length > 0 && (
        <div
          className="panel podium-mini"
          role="button"
          tabIndex={0}
          onClick={onOpenRanking}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpenRanking();
            }
          }}
        >
          <div className="podium-mini-heading">
            <h2>Pódio</h2>
            <span className="notice">Ver ranking completo</span>
          </div>
          <div className="podium-mini-row">
            {top3.map((p, i) => (
              <div key={p.display_name} className="podium-mini-card">
                <span className="podium-mini-medal">{PLACES[i]}</span>
                <span className="podium-mini-name">{p.display_name}</span>
                <span className="podium-mini-points">{p.points} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {resume && createButton}

      <nav className="home-secondary" aria-label="Outras áreas">
        <button className="ghost" onClick={onOpenRanking}>Ranking completo</button>
        <button className="ghost" onClick={onOpenHistorico}>Torneios finalizados</button>
      </nav>
    </main>
  );
}
