// src/screens/Historico.tsx
// Torneios finalizados, separados do StatsPanel (REDESIGN.md S14). Escopo
// travado: só edita resultados (colocação/prêmio) — sem adicionar/remover
// jogador de torneio salvo (exigiria migração).
import { useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured } from '../lib/supabase';
import {
  listTournaments,
  listKnownPlayers,
  renamePlayer,
  renameTournament,
  deleteTournament,
  getTournamentResults,
  updateTournamentResults,
  type KnownPlayer,
  type TournamentResultRow,
} from '../services/tournaments';
import type { BaseTournament } from '../types/database';
import { brl } from '../utils/format';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function Historico() {
  const [tournaments, setTournaments] = useState<BaseTournament[]>([]);
  const [podiums, setPodiums] = useState<Record<string, TournamentResultRow[]>>({});
  const [players, setPlayers] = useState<KnownPlayer[]>([]);
  const [editing, setEditing] = useState<{ t: BaseTournament; rows: TournamentResultRow[] } | null>(null);
  const [msg, setMsg] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const editingId = editing?.t.id ?? null;
  useEffect(() => {
    if (editingId) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [editingId]);

  const refresh = async () => {
    try {
      const list = await listTournaments();
      setTournaments(list);
      setPlayers(await listKnownPlayers());
      const pairs = await Promise.all(
        list.map(async (t) => [t.id, (await getTournamentResults(t.id)).slice(0, 3)] as const)
      );
      setPodiums(Object.fromEntries(pairs));
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
    setMsg('');
    try {
      setEditing({ t, rows: await getTournamentResults(t.id) });
    } catch (e) {
      console.error('[Historico] falha ao abrir o editor de resultado', e);
      setMsg(`Erro ao abrir o resultado: ${(e as Error).message}`);
    }
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
    } catch (e) {
      console.error('[Historico] falha ao salvar o resultado', e);
      setMsg(`Erro ao salvar: ${(e as Error).message}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="panel">
      <h2>Torneios finalizados</h2>

      {!isSupabaseConfigured && (
        <p className="warn">
          Supabase não configurado. Copie <code>.env.example</code> para <code>.env.local</code>,
          preencha as chaves e rode a migração em <code>supabase/migrations</code> para habilitar o histórico.
        </p>
      )}
      {msg && <p className="notice">{msg}</p>}

      {tournaments.length === 0 ? <p className="notice">Sem dados.</p> : (
        <div className="historico-list">
          {tournaments.map((t) => (
            <div className="historico-card" key={t.id}>
              <div className="historico-card-header">
                <div>
                  <div className="historico-card-name">{t.name}</div>
                  <p className="notice" style={{ margin: '2px 0 0' }}>
                    {new Date(t.start_time).toLocaleString('pt-BR')} · {brl(Number(t.total_prize_pool))}
                    {' '}<span className="pill">{t.status}</span>
                  </p>
                </div>
                <div className="row" style={{ flexWrap: 'nowrap' }}>
                  <button className="ghost" onClick={() => openEditor(t)}>✏ Resultado</button>
                  <button className="ghost" onClick={() => doRenameTournament(t)} title="Renomear">✎</button>
                  <button className="danger" onClick={() => doDeleteTournament(t)}>🗑</button>
                </div>
              </div>
              {(podiums[t.id]?.length ?? 0) > 0 && (
                <div className="historico-podium">
                  {podiums[t.id].map((r, i) => (
                    <span key={r.player_id} className="historico-podium-item">
                      {MEDALS[i]} {r.display_name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="panel" style={{ marginTop: 12 }} ref={editorRef}>
          <h2>Editar resultado — {editing.t.name}</h2>
          {editing.rows.length === 0 ? (
            <p className="warn">
              Este torneio não tem nenhuma entrada gravada — o salvamento parou antes de escrever os
              jogadores (bug de atomicidade corrigido na S7, migração <code>0008</code>). Não há
              resultado para editar: exclua o torneio e salve de novo.
            </p>
          ) : (
          <>
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
          </>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            {editing.rows.length > 0 && (
              <button className="primary" disabled={busy} onClick={saveEditor}>
                {busy ? 'Salvando…' : 'Salvar resultado'}
              </button>
            )}
            <button className="ghost" onClick={() => setEditing(null)}>Fechar</button>
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
