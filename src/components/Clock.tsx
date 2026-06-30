// src/components/Clock.tsx
import { useEffect, useRef, useState } from 'react';
import type { useTournamentEngine } from '../hooks/useTournamentEngine';
import { useWakeLock } from '../hooks/useWakeLock';
import { chips, clock } from '../utils/format';
import PixQr from './PixQr';

type Engine = ReturnType<typeof useTournamentEngine>;

// Beeps via Web Audio (sem arquivos externos).
function makeBeeper() {
  let ctx: AudioContext | null = null;
  const ensure = () => {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  const beep = (freq: number, t0: number, dur: number) => {
    const c = ensure();
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = freq;
    o.connect(g);
    g.connect(c.destination);
    g.gain.setValueAtTime(0.0001, c.currentTime + t0);
    g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
    o.start(c.currentTime + t0);
    o.stop(c.currentTime + t0 + dur);
  };
  return {
    arm: () => ensure(),
    oneMinute: () => beep(880, 0, 0.25),
    levelChange: () => { beep(660, 0, 0.2); beep(990, 0.25, 0.3); },
    lateWarning: () => { beep(520, 0, 0.18); beep(520, 0.22, 0.18); beep(520, 0.44, 0.3); },
  };
}

export default function Clock({ engine }: { engine: Engine }) {
  const { state, items, start, pause, reset, addSeconds, next, prev } = engine;
  const wake = useWakeLock();
  const [alarms, setAlarms] = useState(true);
  const [showQr, setShowQr] = useState(true);
  const [isFs, setIsFs] = useState(false);
  const fsRef = useRef<HTMLDivElement>(null);
  const beeperRef = useRef<ReturnType<typeof makeBeeper> | null>(null);

  // Refs de transição para alarmes.
  const prevIndexRef = useRef(state.item_index);
  const minuteFiredRef = useRef<number>(-1);
  const lateFiredRef = useRef<number>(-1);

  useEffect(() => {
    if (!alarms || state.status !== 'running') {
      prevIndexRef.current = state.item_index;
      return;
    }
    const b = beeperRef.current;
    if (!b) return;

    if (state.item_index > prevIndexRef.current) b.levelChange();
    prevIndexRef.current = state.item_index;

    if (state.kind === 'level' && state.seconds_until_next <= 60 && state.seconds_until_next > 0) {
      if (minuteFiredRef.current !== state.item_index) {
        minuteFiredRef.current = state.item_index;
        b.oneMinute();
      }
    }
    if (state.is_late_checkin && lateFiredRef.current !== state.item_index) {
      lateFiredRef.current = state.item_index;
      b.lateWarning();
    }
  }, [state.item_index, state.seconds_until_next, state.kind, state.is_late_checkin, state.status, alarms]);

  const onStart = () => {
    if (!beeperRef.current) beeperRef.current = makeBeeper();
    beeperRef.current.arm();
    start();
  };

  const toggleFs = async () => {
    if (!document.fullscreenElement) {
      await fsRef.current?.requestFullscreen?.();
      setIsFs(true);
    } else {
      await document.exitFullscreen?.();
      setIsFs(false);
    }
  };
  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const inBreak = state.kind === 'break';

  return (
    <div className={`panel clock-panel ${isFs ? 'fs' : ''}`} ref={fsRef}>
      <div className="clock-top">
        <span className="pill">{state.status}</span>
        <span className="pill">
          {inBreak ? 'Intervalo' : `Nível ${state.level_number}`} / {state.total_levels} níveis
        </span>
        {state.is_late_checkin && <span className="pill late">⚑ Late check-in fecha neste nível</span>}
      </div>

      {inBreak ? (
        <>
          <div className="break-label">☕ INTERVALO</div>
          <div className="clock-big">{clock(state.seconds_until_next)}</div>
          <div className="sub">
            Volta no Nível {state.level_number + 1} —{' '}
            {state.next_big_blind != null
              ? `${chips(state.next_small_blind ?? 0)} / ${chips(state.next_big_blind)}`
              : '—'}
          </div>
        </>
      ) : (
        <>
          <div className="clock-big">{clock(state.seconds_until_next)}</div>
          <div className="blinds">
            {chips(state.small_blind)} / {chips(state.big_blind)}
          </div>
          {state.ante > 0 && <div className="ante">ante (BB dobrado): {chips(state.ante)}</div>}
          <div className="sub">
            Próximo:&nbsp;
            {state.next_big_blind != null
              ? `${chips(state.next_small_blind ?? 0)} / ${chips(state.next_big_blind)}${
                  state.next_ante ? ` + ante ${chips(state.next_ante)}` : ''
                }`
              : '— (último nível)'}
          </div>
        </>
      )}

      <div className="kpis">
        <div className="kpi-box">
          <label>Stack médio</label>
          <div className="kpi">{chips(state.average_stack)}</div>
        </div>
        <div className="kpi-box">
          <label>Pressão</label>
          <div className="kpi">{state.pressure_bb.toFixed(1)} BB</div>
        </div>
      </div>

      {/* Controles */}
      <div className="clock-controls">
        <button className="ghost" onClick={prev} title="Voltar nível">⏮</button>
        {state.status !== 'running'
          ? <button className="primary" onClick={onStart}>▶ Iniciar</button>
          : <button className="ghost" onClick={pause}>⏸ Pausar</button>}
        <button className="ghost" onClick={next} title="Avançar nível">⏭</button>
        <button className="ghost" onClick={() => addSeconds(-60)} title="−1 min">−1m</button>
        <button className="ghost" onClick={() => addSeconds(60)} title="+1 min">+1m</button>
        <button className="danger" onClick={reset}>↺</button>
      </div>
      <div className="clock-controls">
        <button className="ghost" onClick={toggleFs}>{isFs ? '✕ Sair tela cheia' : '⛶ Tela cheia'}</button>
        <button className={`ghost ${alarms ? 'on' : ''}`} onClick={() => setAlarms((v) => !v)}>
          {alarms ? '🔔 Alarmes' : '🔕 Alarmes'}
        </button>
        {wake.supported && (
          <button className={`ghost ${wake.enabled ? 'on' : ''}`} onClick={() => wake.setEnabled((v) => !v)}>
            {wake.enabled ? '📱 Tela ligada' : '📱 Manter tela'}
          </button>
        )}
        <button className="ghost qr-toggle" onClick={() => setShowQr((v) => !v)}>
          {showQr ? 'Ocultar QR' : 'Mostrar QR'}
        </button>
      </div>

      {showQr && <PixQr size={isFs ? 120 : 88} />}

      {/* Cronograma com marcação de intervalos e late check-in */}
      {!isFs && (
        <>
          <h2 style={{ marginTop: 22 }}>Cronograma</h2>
          <table>
            <thead><tr><th>#</th><th>Nível</th><th>SB</th><th>BB</th><th>Ante</th><th></th></tr></thead>
            <tbody>
              {items.map((it, i) => {
                const cls = i === state.item_index ? { color: 'var(--gold)', fontWeight: 700 } : undefined;
                if (it.kind === 'break') {
                  return (
                    <tr key={i} style={cls}>
                      <td>{i + 1}</td>
                      <td colSpan={4}>☕ Intervalo ({clock(it.duration_seconds)})</td>
                      <td></td>
                    </tr>
                  );
                }
                return (
                  <tr key={i} style={cls}>
                    <td>{i + 1}</td>
                    <td>{it.level}</td>
                    <td>{chips(it.small_blind)}</td>
                    <td>{chips(it.big_blind)}</td>
                    <td>{it.ante ? chips(it.ante) : '—'}</td>
                    <td>{it.is_late_checkin ? '⚑ late' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
