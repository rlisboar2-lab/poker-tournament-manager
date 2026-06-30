// src/components/StatsPanel.tsx
import { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  listTournaments,
  playerLeaderboard,
  type PlayerStat,
} from '../services/tournaments';
import type { BaseTournament } from '../types/database';
import { brl, pct } from '../utils/format';

interface Props {
  onSave: () => Promise<void>;
}

export default function StatsPanel({ onSave }: Props) {
  const [tournaments, setTournaments] = useState<BaseTournament[]>([]);
  const [board, setBoard] = useState<PlayerStat[]>([]);
  const [msg, setMsg] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setTournaments(await listTournaments());
      setBoard(await playerLeaderboard());
    } catch (e) {
      setMsg(`Erro ao carregar: ${(e as Error).message}`);
    }
  };

  useEffect(() => { if (isSupabaseConfigured) refresh(); }, []);

  const save = async () => {
    setBusy(true); setMsg('');
    try {
      await onSave();
      setMsg('Torneio salvo com sucesso.');
      await refresh();
    } catch (e) {
      setMsg(`Falha ao salvar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <h2>Estatísticas & Persistência</h2>

      {!isSupabaseConfigured && (
        <p className="warn">
          Supabase não configurado. Copie <code>.env.example</code> para <code>.env.local</code>,
          preencha as chaves e rode a migração em <code>supabase/migrations</code> para habilitar o salvamento.
        </p>
      )}

      <div className="row" style={{ marginBottom: 8 }}>
        <button className="primary" disabled={busy || !isSupabaseConfigured} onClick={save}>
          {busy ? 'Salvando…' : '💾 Salvar torneio atual'}
        </button>
        <button className="ghost" disabled={!isSupabaseConfigured} onClick={refresh}>Atualizar</button>
      </div>
      {msg && <p className="notice">{msg}</p>}

      <h2 style={{ marginTop: 20 }}>Ranking de jogadores (por pontos)</h2>
      {board.length === 0 ? <p className="notice">Sem dados.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Jogador</th><th>Pontos</th><th>Eventos</th><th>Investido</th><th>Ganhos</th><th>Líquido</th><th>ROI</th></tr></thead>
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
      )}

      <h2 style={{ marginTop: 20 }}>Torneios anteriores</h2>
      {tournaments.length === 0 ? <p className="notice">Sem dados.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nome</th><th>Início</th><th>Prêmio</th><th>Status</th></tr></thead>
            <tbody>
              {tournaments.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{new Date(t.start_time).toLocaleString('pt-BR')}</td>
                  <td>{brl(Number(t.total_prize_pool))}</td>
                  <td><span className="pill">{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
