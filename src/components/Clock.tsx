// src/components/Clock.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { useTournamentEngine } from '../hooks/useTournamentEngine';
import { useWakeLock } from '../hooks/useWakeLock';
import { chips, clock, brl } from '../utils/format';
import { adjustClockZoom } from '../theme';
import { colorUpPoints, sugerirBreaksParaColorUp, type BlindLevel, type BreakConfig } from '../utils/poker-math';
import PixQr from './PixQr';

type Engine = ReturnType<typeof useTournamentEngine>;

interface Props {
  engine: Engine;
  editable?: boolean;
  onAddLevelAfter?: (levelNumber: number) => void;
  onDeleteLevel?: (levelNumber: number) => void;
  onDeleteBreak?: (afterLevelNumber: number) => void;
  // KPIs no relógio (REDESIGN.md S13): pote e nº na mesa não vinham do engine.
  prizePool?: number;
  playersRemaining?: number;
  // Color-up no cronograma: ficha mínima em jogo e intervalos já configurados,
  // para marcar os níveis de troca e sugerir onde encaixar um intervalo.
  smallestChip?: number;
  breaksConfig?: BreakConfig[];
  onAddBreakAfter?: (afterLevelNumber: number) => void;
}

// Alarme via Web Audio + vibração. Os osciladores ficam referenciados para
// que "Parar alarme" realmente interrompa a sequência agendada.
function makeAlarm() {
  let ctx: AudioContext | null = null;
  let active: OscillatorNode[] = [];
  const ensure = () => {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  };
  const tone = (freq: number, at: number, dur: number, vol = 0.35) => {
    const c = ensure();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'square';
    o.frequency.value = freq;
    o.connect(g); g.connect(c.destination);
    const t0 = c.currentTime + at;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.start(t0); o.stop(t0 + dur);
    active.push(o);
    o.onended = () => { active = active.filter((x) => x !== o); };
  };
  const vibrate = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* noop */ } };
  const stop = () => {
    active.forEach((o) => { try { o.stop(); } catch { /* noop */ } });
    active = [];
    vibrate(0);
  };
  const siren = (seconds: number, f1: number, f2: number) => {
    ensure(); stop();
    const n = Math.floor(seconds / 0.5);
    for (let i = 0; i < n; i++) tone(i % 2 ? f2 : f1, i * 0.5, 0.45);
    const vp: number[] = [];
    for (let i = 0; i < n; i++) vp.push(300, 200);
    vibrate(vp);
  };
  // Libera o hardware de áudio: sem isso o AudioContext fica aberto após o
  // unmount (navegadores limitam quantos contextos simultâneos existem).
  const close = () => {
    stop();
    const c = ctx;
    ctx = null;
    if (c) { try { void c.close(); } catch { /* já fechado */ } }
  };
  return {
    arm: () => ensure(),
    test: () => { ensure(); stop(); tone(880, 0, 0.2); tone(1100, 0.28, 0.32); vibrate([200]); },
    stop,
    close,
    oneMinute: () => { ensure(); stop(); tone(900, 0, 0.25); tone(900, 0.35, 0.25); vibrate([200, 100, 200]); },
    levelChange: () => siren(8, 700, 1050),
    lateWarning: () => siren(10, 520, 780),
  };
}

export default function Clock({
  engine, editable, onAddLevelAfter, onDeleteLevel, onDeleteBreak,
  prizePool = 0, playersRemaining = 0, smallestChip = 5, breaksConfig = [], onAddBreakAfter,
}: Props) {
  const { state, items, start, pause, reset, addSeconds, next, prev } = engine;
  const wake = useWakeLock();
  const [alarms, setAlarms] = useState(true);
  const [audioReady, setAudioReady] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [alarming, setAlarming] = useState(false);
  const fsRef = useRef<HTMLDivElement>(null);
  const alarmRef = useRef<ReturnType<typeof makeAlarm> | null>(null);
  const wasNativeRef = useRef(false);

  const prevIndexRef = useRef(state.item_index);
  const minuteFiredRef = useRef<number>(-1);
  const lateFiredRef = useRef<number>(-1);

  const ensureAlarm = () => {
    if (!alarmRef.current) alarmRef.current = makeAlarm();
    alarmRef.current.arm();
    return alarmRef.current;
  };

  const enableAudio = () => { ensureAlarm().test(); setAudioReady(true); };

  const fireAlarm = (kind: 'oneMinute' | 'levelChange' | 'lateWarning') => {
    const a = alarmRef.current;
    if (!a) return;
    a[kind]();
    setAlarming(true);
    window.setTimeout(() => setAlarming(false), kind === 'oneMinute' ? 1500 : 9000);
  };

  useEffect(() => {
    if (!alarms || state.status !== 'running') {
      prevIndexRef.current = state.item_index;
      return;
    }
    if (state.item_index > prevIndexRef.current) fireAlarm('levelChange');
    prevIndexRef.current = state.item_index;

    // −1m/+1m podem jogar o tempo restante de volta acima de 1 min no MESMO
    // nível: rearma o alarme para ele tocar outra vez ao cruzar 60s.
    if (state.seconds_until_next > 60 && minuteFiredRef.current === state.item_index) {
      minuteFiredRef.current = -1;
    }

    if (state.kind === 'level' && state.seconds_until_next <= 60 && state.seconds_until_next > 0
        && minuteFiredRef.current !== state.item_index) {
      minuteFiredRef.current = state.item_index;
      fireAlarm('oneMinute');
    }
    if (state.is_late_checkin && lateFiredRef.current !== state.item_index) {
      lateFiredRef.current = state.item_index;
      fireAlarm('lateWarning');
    }
  }, [state.item_index, state.seconds_until_next, state.kind, state.is_late_checkin, state.status, alarms]);

  const onStart = () => { ensureAlarm(); setAudioReady(true); start(); };
  const stopAlarm = () => { alarmRef.current?.stop(); setAlarming(false); };
  const onReset = () => { if (confirm('Reiniciar o relógio para o início? O tempo decorrido será zerado.')) reset(); };

  const toggleFs = async () => {
    const nextFs = !isFs;
    setIsFs(nextFs);
    try {
      if (nextFs && fsRef.current?.requestFullscreen) {
        await fsRef.current.requestFullscreen();
        wasNativeRef.current = true;
      } else if (!nextFs && document.fullscreenElement) {
        await document.exitFullscreen();
        wasNativeRef.current = false;
      }
    } catch { /* celular sem API nativa: overlay CSS cobre */ }
  };
  // Fecha o AudioContext ao desmontar o relógio (troca de aba/estágio).
  useEffect(() => () => {
    alarmRef.current?.close();
    alarmRef.current = null;
  }, []);

  useEffect(() => {
    const h = () => {
      if (!document.fullscreenElement && wasNativeRef.current) {
        wasNativeRef.current = false;
        setIsFs(false);
      }
    };
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);

  const inBreak = state.kind === 'break';

  // Níveis crus (sem intervalos) para o color-up — direto do cronograma
  // exibido, então casa com o que está na tabela mesmo com estrutura editada.
  const rawLevels = useMemo<BlindLevel[]>(() => items
    .filter((it): it is Extract<typeof it, { kind: 'level' }> => it.kind === 'level')
    .map((it) => ({ nivel: it.level, small_blind: it.small_blind, big_blind: it.big_blind })),
    [items]);
  const colorUps = useMemo(() => colorUpPoints(rawLevels, smallestChip), [rawLevels, smallestChip]);
  const colorUpSuggestions = useMemo(
    () => new Set(sugerirBreaksParaColorUp(rawLevels, breaksConfig)),
    [rawLevels, breaksConfig]
  );

  return (
    <div className={`panel clock-panel ${isFs ? 'fs' : ''}`} ref={fsRef}>
      {!audioReady && !isFs && (
        <button className="primary enable-audio" onClick={enableAudio}>
          🔊 Ativar som dos alarmes (toque para liberar áudio)
        </button>
      )}

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
          <div className="blinds">{chips(state.small_blind)} / {chips(state.big_blind)}</div>
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

      {alarming && <button className="danger alarm-stop" onClick={stopAlarm}>🔔 Parar alarme</button>}

      {!isFs && (
        <div className="kpis">
          <div className="kpi-box"><label>Pote</label><div className="kpi">{brl(prizePool)}</div></div>
          <div className="kpi-box"><label>Na mesa</label><div className="kpi">{playersRemaining}</div></div>
          <div className="kpi-box"><label>Stack médio</label><div className="kpi">{chips(state.average_stack)}</div></div>
          <div className="kpi-box"><label>Pressão</label><div className="kpi">{state.pressure_bb.toFixed(1)} BB</div></div>
        </div>
      )}

      <div className="clock-controls">
        <button className="ghost" onClick={prev} title="Voltar nível">⏮</button>
        {state.status !== 'running'
          ? <button className="primary" onClick={onStart}>▶ Iniciar</button>
          : <button className="ghost" onClick={pause}>⏸ Pausar</button>}
        <button className="ghost" onClick={next} title="Avançar nível">⏭</button>
        {!isFs && <button className="ghost" onClick={() => addSeconds(-60)} title="−1 min">−1m</button>}
        {!isFs && <button className="ghost" onClick={() => addSeconds(60)} title="+1 min">+1m</button>}
        {!isFs && <button className="danger" onClick={onReset} title="Reiniciar">↺</button>}
        <button className="ghost" onClick={() => adjustClockZoom(-0.1)} title="Diminuir o visor">🔍−</button>
        <button className="ghost" onClick={() => adjustClockZoom(+0.1)} title="Aumentar o visor">🔍＋</button>
        <button className="ghost" onClick={toggleFs}>{isFs ? '✕ Sair' : '⛶ Tela cheia'}</button>
      </div>
      {!isFs && (
        <div className="clock-controls">
          <button className={`ghost ${alarms ? 'on' : ''}`} onClick={() => setAlarms((v) => !v)}>
            {alarms ? '🔔 Alarmes' : '🔕 Alarmes'}
          </button>
          <button className="ghost" onClick={() => ensureAlarm().test()}>🔉 Testar som</button>
          {wake.supported && (
            <button className={`ghost ${wake.enabled ? 'on' : ''}`} onClick={() => wake.setEnabled((v) => !v)}>
              {wake.enabled ? '📱 Tela ligada' : '📱 Manter tela'}
            </button>
          )}
          <button className="ghost qr-toggle" onClick={() => setShowQr(true)}>Mostrar QR</button>
        </div>
      )}

      {showQr && <PixQr onClose={() => setShowQr(false)} />}

      {/* Em tela cheia o QR fica sempre visível num canto reservado. */}
      {isFs && (
        <div className="corner-qr">
          <img src="/pix-qr.png" alt="PIX" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
          <span>PIX</span>
        </div>
      )}

      {!isFs && (
        <>
          <h2 style={{ marginTop: 22 }}>Cronograma</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Nível</th><th>SB</th><th>BB</th><th>Ante</th><th></th>{editable && <th></th>}</tr></thead>
              <tbody>
                {(() => {
                  let lastLevel = 0;
                  return items.map((it, i) => {
                    const cls = i === state.item_index ? { color: 'var(--gold)', fontWeight: 700 } : undefined;
                    if (it.kind === 'break') {
                      const afterLvl = lastLevel;
                      return (
                        <tr key={i} style={cls}>
                          <td>{i + 1}</td>
                          <td colSpan={4}>☕ Intervalo ({clock(it.duration_seconds)})</td>
                          <td></td>
                          {editable && <td>
                            <button className="danger" title="Excluir intervalo"
                              onClick={() => onDeleteBreak?.(afterLvl)}>🗑</button>
                          </td>}
                        </tr>
                      );
                    }
                    lastLevel = it.level;
                    const colorUp = colorUps.find((p) => p.nivel === it.level);
                    const suggestBreak = colorUp && colorUpSuggestions.has(it.level - 1);
                    return (
                      <tr key={i} style={cls}>
                        <td>{i + 1}</td>
                        <td>{it.level}</td>
                        <td>{chips(it.small_blind)}</td>
                        <td>{chips(it.big_blind)}</td>
                        <td>{it.ante ? chips(it.ante) : '—'}</td>
                        <td>
                          {it.is_late_checkin && <span className="pill late">⚑ late</span>}
                          {colorUp && (
                            <span className="pill" style={{ borderColor: 'var(--gold)', color: 'var(--gold)', marginLeft: 4 }}
                              title={`Retira a ficha ${chips(colorUp.retira)}, passa a usar ${chips(colorUp.passa_a_usar)}`}>
                              🎨 retirar ficha de {chips(colorUp.retira)}
                            </span>
                          )}
                          {suggestBreak && (
                            <button className="ghost" style={{ marginLeft: 4 }}
                              onClick={() => onAddBreakAfter?.(it.level - 1)}>
                              + intervalo aqui
                            </button>
                          )}
                        </td>
                        {editable && <td className="row" style={{ flexWrap: 'nowrap' }}>
                          <button className="ghost" title="Adicionar nível abaixo"
                            onClick={() => onAddLevelAfter?.(it.level)}>＋</button>
                          <button className="danger" title="Excluir nível"
                            onClick={() => onDeleteLevel?.(it.level)}>🗑</button>
                        </td>}
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
