// src/components/StatsPanel.tsx
import { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  listTournaments,
  playerLeaderboard,
  listKnownPlayers,
  renamePlayer,
  renameTournament,
  deleteTournament,
  getTournamentResults,
  updateTournamentResults,
  type PlayerStat,
  type KnownPlayer,
  type TournamentResultRow,
} from '../services/tournaments';
import type { BaseTournament } from '../types/database';
import { brl, pct } from '../utils/format';

interface Props {
  onSave: () => Promise<void>;
}

export default function StatsPanel({ onSave }: Props) {
  const [tournaments, setTournaments] = useState<BaseTournament[]>([]);
  const [board, setBoard] = useState<PlayerStat[]>([]);
  const [players, setPlayers] = useState<KnownPlayer[]>([]);
  const [editing, setEditing] = useState<{ t: BaseTournament; rows: TournamentResultRow[] } | null>(null);
  const [msg, setMsg] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setTournaments(await listTournaments());
      setBoard(await playerLeaderboard());
      setPlayers(await listKnownPlayers());
    } catch (e) {
      setMsg(`Erro ao carregar: ${(e as Error).message}`);
    }
  };

  useEffect(() => { if (isSupabaseConfigured) refresh(); }, []);

  const doRenamePlayer = async (p: KnownPlayer) => {
    const nome = prompt('Novo nome do jogador:', p.display_name);
    if (!nome || nome.trim() === p.display_name) return;
    try { await renamePlayer(p.id, nome.trim()); await refresh(); }
    catch (e) { setMsg(`Erro: ${(e as Error).message}`); }
  };
  const doRenameTournament = async (t: BaseTournament) => {
    const nome = prompt('Novo nome do torneio:', t.name);
    if (!nome || nome.trim() === t.name) return;
    try { await renameTournament(t.id, nome.trim()); await refresh(); }
    catch (e) { setMsg(`Erro: ${(e as Error).message}`); }
  };
  const doDeleteTournament = async (t: BaseTournament) => {
    if (!confirm(`Excluir o torneio "${t.name}"? Isso apaga suas entradas e recalcula o ranking. Não dá pra desfazer.`)) return;
    try { await deleteTournament(t.id); await refresh(); }
    catch (e) { setMsg(`Erro: ${(e as Error).message}`); }
  };
  const openEditor = async (t: BaseTournament) => {
    try { setEditing({ t, rows: await getTournamentResults(t.id) }); }
    catch (e) { setMsg(`Erro: ${(e as Error).message}`); }
  };
  const setRow = (i: number, p: Partial<TournamentResultRow>) =>
    setEditing((cur) => cur && ({ ...cur, rows: cur.rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)) }));
  const saveEditor = async () => {
    if (!editing) return;
    setBusy(true); setMsg('');
    try {
      await updateTournamentResults(editing.t.id, editing.rows.map((r) => ({
        player_id: r.player_id, final_placement: r.final_placement, payout_amount: r.payout_amount,
      })));
      setEditing(null);
      await refresh();
      setMsg('Resultado atualizado.');
    } catch (e) { setMsg(`Erro ao salvar: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

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
            <thead><tr><th>Nome</th><th>Início</th><th>Prêmio</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {tournaments.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td>{new Date(t.start_time).toLocaleString('pt-BR')}</td>
                  <td>{brl(Number(t.total_prize_pool))}</td>
                  <td><span className="pill">{t.status}</span></td>
                  <td className="row" style={{ flexWrap: 'nowrap' }}>
                    <button className="ghost" onClick={() => openEditor(t)}>✏ Resultado</button>
                    <button className="ghost" onClick={() => doRenameTournament(t)} title="Renomear">✎</button>
                    <button className="danger" onClick={() => doDeleteTournament(t)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="panel" style={{ marginTop: 12 }}>
          <h2>Editar resultado — {editing.t.name}</h2>
          <p className="notice">Ajuste a colocação e o prêmio (R$) de cada jogador. Isso recalcula pontos e ROI.</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Jogador</th><th>Entradas</th><th>Colocação</th><th>Prêmio (R$)</th></tr></thead>
              <tbody>
                {editing.rows.map((r, i) => (
                  <tr key={r.player_id}>
                    <td>{r.display_name}</td>
                    <td className="notice">{r.buyins}bi · {r.rebuys}re · {r.addons}ad</td>
                    <td style={{ width: 100 }}>
                      <input type="number" min={1} value={r.final_placement ?? ''}
                        onChange={(e) => setRow(i, { final_placement: e.target.value ? Number(e.target.value) : null })} />
                    </td>
                    <td style={{ width: 130 }}>
                      <input type="number" step="1" value={Number((r.payout_amount ?? 0).toFixed(2))}
                        onChange={(e) => setRow(i, { payout_amount: Number(e.target.value) })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={busy} onClick={saveEditor}>{busy ? 'Salvando…' : 'Salvar resultado'}</button>
            <button className="ghost" onClick={() => setEditing(null)}>Cancelar</button>
          </div>
        </div>
      )}

      <h2 style={{ marginTop: 20 }}>Jogadores cadastrados</h2>
      {players.length === 0 ? <p className="notice">Sem jogadores salvos.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nome</th><th></th></tr></thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td>{p.display_name}</td>
                  <td><button className="ghost" onClick={() => doRenamePlayer(p)}>✏ Renomear</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
