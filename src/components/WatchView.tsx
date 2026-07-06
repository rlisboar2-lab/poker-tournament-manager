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

  if (error) return <div className="app watch"><p className="warn">{error}</p></div>;
  if (!row) return <div className="app watch"><p className="notice">Conectando à transmissão…</p></div>;

  const elapsed = (row.status === 'running' ? now - row.anchor_ms : row.paused_elapsed_ms) / 1000;
  const v = deriveClockView(row.schedule, elapsed, row.status, {
    total_chips: Number(row.total_chips), players: row.players_remaining,
  });
  const inBreak = v.kind === 'break';

  return (
    <div className="app watch">
      <div className="panel clock-panel fs-watch">
        <div className="clock-top">
          <span className="pill">{row.name || 'Torneio'}</span>
          <span className="pill">{inBreak ? 'Intervalo' : `Nível ${v.level_number}`} / {v.total_levels}</span>
          <span className="pill">{v.status}</span>
          {v.is_late_checkin && <span className="pill late">⚑ Late check-in</span>}
        </div>

        {inBreak ? (
          <>
            <div className="break-label">☕ INTERVALO</div>
            <div className="clock-big">{clock(v.seconds_until_next)}</div>
            <div className="sub">
              Volta no Nível {v.level_number + 1} —{' '}
              {v.next_big_blind != null ? `${chips(v.next_small_blind ?? 0)} / ${chips(v.next_big_blind)}` : '—'}
            </div>
          </>
        ) : (
          <>
            <div className="clock-big">{clock(v.seconds_until_next)}</div>
            <div className="blinds">{chips(v.small_blind)} / {chips(v.big_blind)}</div>
            {v.ante > 0 && <div className="ante">ante: {chips(v.ante)}</div>}
            <div className="sub">
              Próximo:&nbsp;
              {v.next_big_blind != null
                ? `${chips(v.next_small_blind ?? 0)} / ${chips(v.next_big_blind)}${v.next_ante ? ` + ante ${chips(v.next_ante)}` : ''}`
                : '— (último nível)'}
            </div>
          </>
        )}

        <div className="kpis">
          <div className="kpi-box"><label>Jogadores</label><div className="kpi">{row.players_remaining}</div></div>
          <div className="kpi-box"><label>Stack médio</label><div className="kpi">{chips(v.average_stack)}</div></div>
          <div className="kpi-box"><label>Pressão</label><div className="kpi">{v.pressure_bb.toFixed(1)} BB</div></div>
        </div>
      </div>
    </div>
  );
}
