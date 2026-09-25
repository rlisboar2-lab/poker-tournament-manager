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
import { packageName } from '../utils/ledger';

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
    <div className="panel historico-screen">
      <header className="historico-header">
        <p className="historico-eyebrow">Consulta e manutenção</p>
        <h2>Torneios finalizados</h2>
        <p className="notice">Consulte o pódio ou ajuste os resultados já salvos.</p>
      </header>

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
                <div className="historico-card-summary">
                  <div className="historico-card-name">{t.name}</div>
                  <p className="historico-card-meta">
                    <time dateTime={t.start_time}>{new Date(t.start_time).toLocaleString('pt-BR')}</time>
                    <span aria-hidden="true">·</span>
                    <strong>{brl(Number(t.total_prize_pool))}</strong>
                    <span className="pill">{t.status}</span>
                  </p>
                </div>
                <div className="historico-card-actions">
                  <button className="primary" onClick={() => openEditor(t)}>Editar resultado</button>
                  <button className="ghost" onClick={() => doRenameTournament(t)}>Renomear</button>
                  <button className="danger" onClick={() => doDeleteTournament(t)}>Excluir</button>
                </div>
              </div>
              {(podiums[t.id]?.length ?? 0) > 0 && (
                <div className="historico-podium" aria-label="Resumo do pódio">
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
        <section className="panel historico-editor" ref={editorRef} aria-labelledby="historico-editor-heading">
          <header className="historico-editor-header">
            <p className="historico-eyebrow">Manutenção do resultado</p>
            <h2 id="historico-editor-heading">Editar resultado</h2>
            <p className="notice">{editing.t.name}</p>
          </header>
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
            <table className="responsive-card-table historico-editor-table">
              <thead><tr><th>Jogador</th><th>Entradas</th><th>Colocação</th><th>Prêmio (R$)</th></tr></thead>
              <tbody>
                {editing.rows.map((r, i) => (
                  <tr key={r.player_id}>
                    <td data-label="Jogador"><strong>{r.display_name}</strong></td>
                    <td data-label="Entradas" className="notice">
                      {r.buyins}bi · {r.rebuys}re · {r.addons}ad · {brl(r.invested)}
                      <div className="historico-packages">
                        {r.packages.map((p) => `${packageName(p.kind, p.rebuy_units)} ${brl(p.amount)}`).join(' · ')}
                      </div>
                    </td>
                    <td data-label="Colocação" style={{ width: 100 }}>
                      <input type="number" min={1} value={r.final_placement ?? ''}
                        onChange={(e) => setRow(i, { final_placement: e.target.value ? Number(e.target.value) : null })} />
                    </td>
                    <td data-label="Prêmio (R$)" style={{ width: 130 }}>
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
          <div className="historico-editor-actions">
            {editing.rows.length > 0 && (
              <button className="primary" disabled={busy} onClick={saveEditor}>
                {busy ? 'Salvando…' : 'Salvar resultado'}
              </button>
            )}
            <button className="ghost" onClick={() => setEditing(null)}>Fechar</button>
          </div>
        </section>
      )}

      <section className="historico-players" aria-labelledby="historico-players-heading">
      <h2 id="historico-players-heading">Jogadores cadastrados</h2>
      {players.length === 0 ? <p className="notice">Sem jogadores salvos.</p> : (
        <div className="table-wrap historico-players-wrap">
          <table className="responsive-card-table historico-players-table">
            <thead><tr><th>Nome</th><th></th></tr></thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td data-label="Jogador"><strong>{p.display_name}</strong></td>
                  <td data-label="Ação"><button className="ghost" onClick={() => doRenamePlayer(p)}>Renomear</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </section>
    </div>
  );
}
