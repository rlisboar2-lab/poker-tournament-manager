// src/components/WatchView.tsx
// Página de telespectador (sem login). Lê o estado ao vivo via Supabase e
// exibe o relógio, recalculando o countdown localmente a partir da âncora.
import { useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { deriveClockView } from '../utils/clockView';
import type { ScheduleItem } from '../utils/poker-math';
import { chips, clock } from '../utils/format';

interface LiveRow {
  id: string;
  name: string;
  schedule: ScheduleItem[];
  status: string;
  anchor_ms: number;
  paused_elapsed_ms: number;
  players_remaining: number;
  total_chips: number;
}

const STATUS_LABELS: Record<string, string> = {
  idle: 'Pronto',
  running: 'Em andamento',
  paused: 'Pausado',
  finished: 'Encerrado',
};

export default function WatchView({ id }: { id: string }) {
  const [row, setRow] = useState<LiveRow | null>(null);
  const [error, setError] = useState<string>('');
  const [now, setNow] = useState(() => Date.now());
  const timerRef = useRef<number | null>(null);

  // Ticker local (250ms) só para reavaliar o countdown.
  useEffect(() => {
    const loop = () => { setNow(Date.now()); timerRef.current = window.setTimeout(loop, 250); };
    loop();
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  // Carrega + assina realtime + poll de segurança.
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) { setError('Transmissão indisponível.'); return; }
    let active = true;

    const fetchRow = async () => {
      const { data, error } = await supabase!.from('live_state').select('*').eq('id', id).maybeSingle();
      if (!active) return;
      if (error) { setError(error.message); return; }
      if (!data) { setError('Torneio não encontrado ou transmissão encerrada.'); return; }
      setError('');
      setRow(data as LiveRow);
    };
    fetchRow();

    const channel = supabase.channel(`live:${id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'live_state', filter: `id=eq.${id}` },
        (payload) => { if (active && payload.new) setRow(payload.new as LiveRow); })
      .subscribe();

    const poll = window.setInterval(fetchRow, 4000);

    return () => { active = false; clearInterval(poll); supabase!.removeChannel(channel); };
  }, [id]);

  if (error) return (
    <main className="app watch watch--message">
      <section className="panel watch-connection" role="alert">
        <span className="watch-connection-label">Transmissão ao vivo</span>
        <h1>Não foi possível abrir a transmissão</h1>
        <p className="warn">{error}</p>
      </section>
    </main>
  );
  if (!row) return (
    <main className="app watch watch--message">
      <section className="panel watch-connection" role="status" aria-live="polite">
        <span className="watch-connection-label">Transmissão ao vivo</span>
        <h1>Conectando ao torneio</h1>
        <p className="notice">Aguardando o primeiro estado do relógio…</p>
      </section>
    </main>
  );

  const elapsed = (row.status === 'running' ? now - row.anchor_ms : row.paused_elapsed_ms) / 1000;
  const v = deriveClockView(row.schedule, elapsed, row.status, {
    total_chips: Number(row.total_chips), players: row.players_remaining,
  });
  const inBreak = v.kind === 'break';
  const statusLabel = STATUS_LABELS[v.status] ?? v.status;

  return (
    <main className="app watch">
      <section className="panel clock-panel fs-watch" aria-label={`Transmissão ao vivo de ${row.name || 'Torneio'}`}>
        <header className="clock-top watch-header">
          <span className="pill watch-title">{row.name || 'Torneio'}</span>
          <span className="pill">{inBreak ? 'Intervalo' : `Nível ${v.level_number}`} / {v.total_levels}</span>
          <span className="pill">{statusLabel}</span>
          {v.is_late_checkin && <span className="pill late">Late check-in</span>}
        </header>

        <section className="clock-stage watch-stage" aria-label="Relógio e blinds">
          <div className="clock-readout">
            {inBreak ? (
              <>
                <div className="break-label">Intervalo</div>
                <div className="clock-big">{clock(v.seconds_until_next)}</div>
                <div className="sub">
                  Volta no Nível {v.level_number + 1} —{' '}
                  {v.next_big_blind != null ? `${chips(v.next_small_blind ?? 0)} / ${chips(v.next_big_blind)}` : '—'}
                </div>
              </>
            ) : (
              <>
                <div className="clock-big">{clock(v.seconds_until_next)}</div>
                <div className="blinds" aria-label={`Blinds ${chips(v.small_blind)} e ${chips(v.big_blind)}`}>
                  {chips(v.small_blind)} / {chips(v.big_blind)}
                </div>
                {v.ante > 0 && <div className="ante">Ante (BB dobrado): {chips(v.ante)}</div>}
                <div className="sub">
                  Próximo:&nbsp;
                  {v.next_big_blind != null
                    ? `${chips(v.next_small_blind ?? 0)} / ${chips(v.next_big_blind)}${v.next_ante ? ` + ante ${chips(v.next_ante)}` : ''}`
                    : '— (último nível)'}
                </div>
              </>
            )}
          </div>
        </section>

        <footer className="watch-footer">
          <div className="kpis watch-kpis" aria-label="Indicadores do torneio">
            <div className="kpi-box"><span className="kpi-label">Jogadores</span><div className="kpi">{row.players_remaining}</div></div>
            <div className="kpi-box"><span className="kpi-label">Stack médio</span><div className="kpi">{chips(v.average_stack)}</div></div>
            <div className="kpi-box"><span className="kpi-label">Pressão</span><div className="kpi">{v.pressure_bb.toFixed(1)} BB</div></div>
          </div>

          <div className="corner-qr">
            <img src="/pix-qr.png" alt="QR PIX para pagamentos" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
            <span>PIX</span>
          </div>
        </footer>
      </section>
    </main>
  );
}
