// src/components/Clock.tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import type { useTournamentEngine } from '../hooks/useTournamentEngine';
import { useWakeLock } from '../hooks/useWakeLock';
import { chips, clock, brl, pct } from '../utils/format';
import { adjustClockZoom } from '../theme';
import { aplicarPayouts, colorUpPoints, sugerirBreaksParaColorUp, type BlindLevel, type BreakConfig } from '../utils/poker-math';
import PixQr from './PixQr';
import {
  BellIcon,
  FullscreenIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  PreviousIcon,
  QrIcon,
  ResetIcon,
  ScreenIcon,
  TrashIcon,
  VolumeIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from './Icons';

type Engine = ReturnType<typeof useTournamentEngine>;

const STATUS_LABELS: Record<string, string> = {
  idle: 'Pronto',
  running: 'Em andamento',
  paused: 'Pausado',
  finished: 'Encerrado',
};

interface Props {
  engine: Engine;
  editable?: boolean;
  onAddLevelAfter?: (levelNumber: number) => void;
  onDeleteLevel?: (levelNumber: number) => void;
  onDeleteBreak?: (afterLevelNumber: number) => void;
  // KPIs no relógio (REDESIGN.md S13): pote e nº na mesa não vinham do engine.
  prizePool?: number;
  playersRemaining?: number;
  // Percentuais da premiação — o relógio mostra o prêmio de cada colocação,
  // não só o pote total.
  payoutPct?: number[];
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
  prizePool = 0, playersRemaining = 0, payoutPct, smallestChip = 5, breaksConfig = [], onAddBreakAfter,
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

  // Premiação por colocação. Mesma fonte do PayoutsPanel, então o que a mesa vê
  // no relógio é exatamente o que será pago na tela de fim.
  const premios = useMemo(
    () => aplicarPayouts(prizePool, payoutPct ?? []),
    [prizePool, payoutPct]
  );
  const statusLabel = STATUS_LABELS[state.status] ?? state.status;

  return (
    <div className={`panel clock-panel ${isFs ? 'fs' : ''}`} ref={fsRef}>
      {!audioReady && !isFs && (
        <button className="primary enable-audio" onClick={enableAudio}>
          <VolumeIcon size={20} /> Ativar som dos alarmes (toque para liberar áudio)
        </button>
      )}

      <section className="clock-stage" aria-label="Relógio e blinds">
        <div className="clock-top">
          <span className="pill">{statusLabel}</span>
          <span className="pill">
            {inBreak ? 'Intervalo' : `Nível ${state.level_number}`} / {state.total_levels} níveis
          </span>
          {state.is_late_checkin && <span className="pill late">Late check-in fecha neste nível</span>}
        </div>

        <div className="clock-readout">
          {inBreak ? (
            <>
              <div className="break-label">Intervalo</div>
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
              <div className="blinds" aria-label={`Blinds ${chips(state.small_blind)} e ${chips(state.big_blind)}`}>
                {chips(state.small_blind)} / {chips(state.big_blind)}
              </div>
              {state.ante > 0 && <div className="ante">Ante (BB dobrado): {chips(state.ante)}</div>}
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
        </div>
      </section>

      {alarming && (
        <button className="danger alarm-stop" onClick={stopAlarm}>
          <BellIcon size={20} /> Parar alarme
        </button>
      )}

      {!isFs && (
        <section className="clock-summary" aria-label="Indicadores do torneio">
          <div className="kpis clock-kpis">
            <div className="kpi-box"><span className="kpi-label">Pote</span><div className="kpi">{brl(prizePool)}</div></div>
            <div className="kpi-box"><span className="kpi-label">Na mesa</span><div className="kpi">{playersRemaining}</div></div>
            <div className="kpi-box"><span className="kpi-label">Stack médio</span><div className="kpi">{chips(state.average_stack)}</div></div>
            <div className="kpi-box"><span className="kpi-label">Pressão</span><div className="kpi">{state.pressure_bb.toFixed(1)} BB</div></div>
          </div>

          {premios.length > 0 && (
            <div className="kpis payout-kpis" aria-label="Premiação">
              {premios.map((p) => (
                <div className="kpi-box payout" key={p.posicao}>
                  <span className="kpi-label">{p.posicao}º lugar · {pct(p.percentual)}</span>
                  <div className="kpi">{brl(p.premio)}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="clock-command-deck">
        <div className="clock-controls clock-controls--primary" aria-label="Controles principais do relógio">
        <button className="ghost icon-button" onClick={prev} title="Voltar nível" aria-label="Voltar nível">
          <PreviousIcon size={20} />
        </button>
        {state.status !== 'running'
          ? <button className="primary clock-run" onClick={onStart}><PlayIcon size={20} /> Iniciar</button>
          : <button className="ghost clock-run" onClick={pause}><PauseIcon size={20} /> Pausar</button>}
        <button className="ghost icon-button" onClick={next} title="Avançar nível" aria-label="Avançar nível">
          <NextIcon size={20} />
        </button>
        {!isFs && <button className="ghost" onClick={() => addSeconds(-60)} title="−1 min">−1m</button>}
        {!isFs && <button className="ghost" onClick={() => addSeconds(60)} title="+1 min">+1m</button>}
        {!isFs && (
          <button className="danger icon-button" onClick={onReset} title="Reiniciar relógio" aria-label="Reiniciar relógio">
            <ResetIcon size={20} />
          </button>
        )}
        <button className="ghost icon-button" onClick={() => adjustClockZoom(-0.1)} title="Diminuir o visor" aria-label="Diminuir o visor">
          <ZoomOutIcon size={20} />
        </button>
        <button className="ghost icon-button" onClick={() => adjustClockZoom(+0.1)} title="Aumentar o visor" aria-label="Aumentar o visor">
          <ZoomInIcon size={20} />
        </button>
        <button className="ghost" onClick={toggleFs}>
          <FullscreenIcon size={20} /> {isFs ? 'Sair' : 'Tela cheia'}
        </button>
        </div>

        {!isFs && (
          <div className="clock-controls clock-controls--secondary" aria-label="Utilidades do relógio">
          <button className={`ghost ${alarms ? 'on' : ''}`} aria-pressed={alarms} onClick={() => setAlarms((v) => !v)}>
            <BellIcon size={19} /> {alarms ? 'Alarmes ligados' : 'Alarmes desligados'}
          </button>
          <button className="ghost" onClick={() => ensureAlarm().test()}><VolumeIcon size={19} /> Testar som</button>
          {wake.supported && (
            <button className={`ghost ${wake.enabled ? 'on' : ''}`} aria-pressed={wake.enabled} onClick={() => wake.setEnabled((v) => !v)}>
              <ScreenIcon size={19} /> {wake.enabled ? 'Tela ligada' : 'Manter tela'}
            </button>
          )}
          <button className="ghost qr-toggle" onClick={() => setShowQr(true)}><QrIcon size={19} /> Mostrar QR</button>
          </div>
        )}
      </div>

      {showQr && <PixQr onClose={() => setShowQr(false)} />}

      {/* Em tela cheia o QR fica sempre visível num canto reservado. */}
      {isFs && (
        <div className="corner-qr">
          <img src="/pix-qr.png" alt="QR PIX para pagamentos" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
          <span>PIX</span>
        </div>
      )}

      {!isFs && (
        <section className="clock-schedule" aria-labelledby="clock-schedule-title">
          <h2 id="clock-schedule-title">Cronograma</h2>
          <div className="table-wrap">
            <table className="schedule-table">
              <caption className="sr-only">Níveis, blinds, ante, marcos e ações de edição do cronograma</caption>
              <thead><tr><th scope="col">#</th><th scope="col">Nível</th><th scope="col">SB</th><th scope="col">BB</th><th scope="col">Ante</th><th scope="col">Marcos</th>{editable && <th scope="col">Ações</th>}</tr></thead>
              <tbody>
                {(() => {
                  let lastLevel = 0;
                  return items.map((it, i) => {
                    const rowClass = i === state.item_index ? 'schedule-row--current' : undefined;
                    if (it.kind === 'break') {
                      const afterLvl = lastLevel;
                      return (
                        <tr key={i} className={rowClass}>
                          <td>{i + 1}</td>
                          <td colSpan={4}><strong>Intervalo</strong> ({clock(it.duration_seconds)})</td>
                          <td></td>
                          {editable && <td className="schedule-actions">
                            <button className="danger icon-button" title="Excluir intervalo" aria-label={`Excluir intervalo após o nível ${afterLvl}`}
                              onClick={() => onDeleteBreak?.(afterLvl)}><TrashIcon size={18} /></button>
                          </td>}
                        </tr>
                      );
                    }
                    lastLevel = it.level;
                    const colorUp = colorUps.find((p) => p.nivel === it.level);
                    const suggestBreak = colorUp && colorUpSuggestions.has(it.level - 1);
                    return (
                      <tr key={i} className={rowClass}>
                        <td>{i + 1}</td>
                        <td>{it.level}</td>
                        <td>{chips(it.small_blind)}</td>
                        <td>{chips(it.big_blind)}</td>
                        <td>{it.ante ? chips(it.ante) : '—'}</td>
                        <td>
                          <div className="schedule-markers">
                          {it.is_late_checkin && <span className="pill late">Late</span>}
                          {colorUp && (
                            <span className="pill schedule-color-up"
                              title={`Retira a ficha ${chips(colorUp.retira)}, passa a usar ${chips(colorUp.passa_a_usar)}`}>
                              Retirar ficha de {chips(colorUp.retira)}
                            </span>
                          )}
                          {suggestBreak && (
                            <button className="ghost schedule-break-action"
                              onClick={() => onAddBreakAfter?.(it.level - 1)}>
                              <PlusIcon size={17} /> Intervalo aqui
                            </button>
                          )}
                          </div>
                        </td>
                        {editable && <td>
                          <div className="schedule-actions">
                          <button className="ghost icon-button" title="Adicionar nível abaixo" aria-label={`Adicionar nível abaixo do nível ${it.level}`}
                            onClick={() => onAddLevelAfter?.(it.level)}><PlusIcon size={18} /></button>
                          <button className="danger icon-button" title="Excluir nível" aria-label={`Excluir nível ${it.level}`}
                            onClick={() => onDeleteLevel?.(it.level)}><TrashIcon size={18} /></button>
                          </div>
                        </td>}
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
