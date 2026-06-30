// src/hooks/useTournamentEngine.ts
// Relógio sincronizado ancorado em Unix Epoch (sem decréscimo por setInterval).
// Imune a background sleep / focus drop: o estado deriva sempre de Date.now().

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  calcularCurvaBlinds,
  type CurveParams,
  type BlindLevel,
} from '../utils/poker-math';

export type ClockStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface EngineLevel extends BlindLevel {
  duration_seconds: number;
}

export interface EngineParams extends CurveParams {
  total_chips_in_play?: number; // sobrepõe c_total se houver injeção tardia
  players_remaining?: number;
}

export interface EngineState {
  status: ClockStatus;
  level_index: number;
  small_blind: number;
  big_blind: number;
  next_small_blind: number | null;
  next_big_blind: number | null;
  seconds_into_level: number;
  seconds_until_next: number;
  total_levels: number;
  average_stack: number;   // c_total / jogadores restantes
  pressure_bb: number;     // stack médio expresso em big blinds
}

function buildLevels(p: CurveParams, durationSeconds: number): EngineLevel[] {
  return calcularCurvaBlinds(p).niveis.map((n) => ({
    ...n,
    duration_seconds: durationSeconds,
  }));
}

export function useTournamentEngine(initial: EngineParams) {
  const [params, setParams] = useState<EngineParams>(initial);
  const [status, setStatus] = useState<ClockStatus>('idle');
  const [now, setNow] = useState<number>(() => Date.now());

  const anchorRef = useRef<number>(Date.now());   // epoch do início do segmento
  const pausedElapsedRef = useRef<number>(0);      // ms acumulados quando pausado
  const timerRef = useRef<number | null>(null);

  // Ticker leve: apenas força reavaliação; o valor real vem do epoch.
  useEffect(() => {
    let active = true;
    const loop = () => {
      if (!active) return;
      setNow(Date.now());
      timerRef.current = window.setTimeout(loop, 250);
    };
    loop();
    return () => {
      active = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const durationSeconds = Math.round((params.duracao_bloco_nivel ?? 0) * 60);
  const curve = useMemo(() => calcularCurvaBlinds(params), [params]);
  const levels = useMemo(
    () => buildLevels(params, durationSeconds),
    [params, durationSeconds]
  );

  const elapsedSeconds =
    (status === 'running' ? now - anchorRef.current : pausedElapsedRef.current) / 1000;

  const state = useMemo<EngineState>(() => {
    const elapsed = Math.max(0, elapsedSeconds);
    let acc = 0;
    let idx = Math.max(0, levels.length - 1);
    for (let i = 0; i < levels.length; i++) {
      if (elapsed < acc + levels[i].duration_seconds) {
        idx = i;
        break;
      }
      acc += levels[i].duration_seconds;
    }

    const totalDuration = levels.reduce((s, l) => s + l.duration_seconds, 0);
    const finished = elapsed >= totalDuration && status !== 'idle';
    const cur = levels[idx];
    const nxt = levels[idx + 1] ?? null;

    const into = finished ? cur.duration_seconds : Math.floor(elapsed - acc);
    const until = finished ? 0 : cur.duration_seconds - into;

    const c_total = params.total_chips_in_play ?? curve.c_total;
    const players = Math.max(1, params.players_remaining ?? 1);
    const average_stack = c_total / players;

    return {
      status: finished ? 'finished' : status,
      level_index: cur.nivel,
      small_blind: cur.small_blind,
      big_blind: cur.big_blind,
      next_small_blind: nxt ? nxt.small_blind : null,
      next_big_blind: nxt ? nxt.big_blind : null,
      seconds_into_level: into,
      seconds_until_next: until,
      total_levels: levels.length,
      average_stack,
      pressure_bb: average_stack / cur.big_blind,
    };
  }, [elapsedSeconds, levels, params, curve, status]);

  const start = useCallback(() => {
    anchorRef.current = Date.now() - pausedElapsedRef.current;
    setStatus('running');
  }, []);

  const pause = useCallback(() => {
    pausedElapsedRef.current = Date.now() - anchorRef.current;
    setStatus('paused');
  }, []);

  const reset = useCallback(() => {
    pausedElapsedRef.current = 0;
    anchorRef.current = Date.now();
    setStatus('idle');
  }, []);

  // Trigger remoto: relança a Fase 1 integralmente e recalcula níveis futuros,
  // preservando o tempo já decorrido.
  const update_curve = useCallback((patch: Partial<EngineParams>) => {
    setParams((prev) => ({ ...prev, ...patch }));
  }, []);

  return { state, levels, curve, start, pause, reset, update_curve, params };
}
