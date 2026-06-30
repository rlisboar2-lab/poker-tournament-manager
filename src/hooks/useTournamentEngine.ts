// src/hooks/useTournamentEngine.ts
// Relógio sincronizado ancorado em Unix Epoch (sem decréscimo por setInterval).
// Imune a background sleep / focus drop: o estado deriva sempre de Date.now().

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  calcularCurvaBlinds,
  buildSchedule,
  type CurveParams,
  type BreakConfig,
  type ScheduleItem,
} from '../utils/poker-math';

export type ClockStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface EngineParams extends CurveParams {
  total_chips_in_play?: number;
  players_remaining?: number;
  late_checkin_level: number;
  ante_enabled: boolean;
  breaks: BreakConfig[];
}

export interface EngineState {
  status: ClockStatus;
  item_index: number;
  total_items: number;
  kind: 'level' | 'break';
  level_number: number;          // nº do nível de poker atual (último, se em intervalo)
  total_levels: number;
  small_blind: number;
  big_blind: number;
  ante: number;
  break_label: string | null;
  is_late_checkin: boolean;
  next_small_blind: number | null;
  next_big_blind: number | null;
  next_ante: number | null;
  seconds_into_item: number;
  seconds_until_next: number;
  average_stack: number;
  pressure_bb: number;
}

export function useTournamentEngine(initial: EngineParams) {
  const [params, setParams] = useState<EngineParams>(initial);
  const [status, setStatus] = useState<ClockStatus>('idle');
  const [now, setNow] = useState<number>(() => Date.now());

  const anchorRef = useRef<number>(Date.now());  // epoch do início do segmento
  const pausedElapsedRef = useRef<number>(0);     // ms acumulados quando pausado
  const timerRef = useRef<number | null>(null);

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

  const curve = useMemo(() => calcularCurvaBlinds(params), [params]);
  const items: ScheduleItem[] = useMemo(
    () =>
      buildSchedule(curve.niveis, {
        level_duration_minutes: params.duracao_bloco_nivel,
        late_checkin_level: params.late_checkin_level,
        ante_enabled: params.ante_enabled,
        breaks: params.breaks,
      }),
    [curve, params]
  );

  const cumStarts = useMemo(() => {
    const arr: number[] = [];
    let acc = 0;
    for (const it of items) {
      arr.push(acc);
      acc += it.duration_seconds;
    }
    return arr;
  }, [items]);

  const elapsedSeconds =
    (status === 'running' ? now - anchorRef.current : pausedElapsedRef.current) / 1000;

  const state = useMemo<EngineState>(() => {
    const elapsed = Math.max(0, elapsedSeconds);
    let idx = Math.max(0, items.length - 1);
    for (let i = 0; i < items.length; i++) {
      if (elapsed < cumStarts[i] + items[i].duration_seconds) {
        idx = i;
        break;
      }
    }
    const totalDuration = items.reduce((s, it) => s + it.duration_seconds, 0);
    const finished = elapsed >= totalDuration && status !== 'idle';

    const cur = items[idx];
    const into = finished
      ? cur.duration_seconds
      : Math.floor(elapsed - cumStarts[idx]);
    const until = finished ? 0 : cur.duration_seconds - into;

    // Próximo NÍVEL (pulando intervalos).
    let nextLevel: Extract<ScheduleItem, { kind: 'level' }> | null = null;
    for (let i = idx + 1; i < items.length; i++) {
      if (items[i].kind === 'level') {
        nextLevel = items[i] as Extract<ScheduleItem, { kind: 'level' }>;
        break;
      }
    }
    // Último nível conhecido (para exibir durante intervalo).
    let lastLevel: Extract<ScheduleItem, { kind: 'level' }> | null = null;
    for (let i = idx; i >= 0; i--) {
      if (items[i].kind === 'level') {
        lastLevel = items[i] as Extract<ScheduleItem, { kind: 'level' }>;
        break;
      }
    }
    const lvl = cur.kind === 'level' ? cur : lastLevel;

    const c_total = params.total_chips_in_play ?? curve.c_total;
    const players = Math.max(1, params.players_remaining ?? 1);
    const average_stack = c_total / players;
    const bb = lvl ? lvl.big_blind : 0;
    const total_levels = items.filter((i) => i.kind === 'level').length;

    return {
      status: finished ? 'finished' : status,
      item_index: idx,
      total_items: items.length,
      kind: cur.kind,
      level_number: lvl ? lvl.level : 0,
      total_levels,
      small_blind: lvl ? lvl.small_blind : 0,
      big_blind: bb,
      ante: lvl ? lvl.ante : 0,
      break_label: cur.kind === 'break' ? cur.label : null,
      is_late_checkin: cur.kind === 'level' ? cur.is_late_checkin : false,
      next_small_blind: nextLevel ? nextLevel.small_blind : null,
      next_big_blind: nextLevel ? nextLevel.big_blind : null,
      next_ante: nextLevel ? nextLevel.ante : null,
      seconds_into_item: into,
      seconds_until_next: until,
      average_stack,
      pressure_bb: bb > 0 ? average_stack / bb : 0,
    };
  }, [elapsedSeconds, items, cumStarts, params, curve, status]);

  // ── Controles ───────────────────────────────────────────────────────────
  const setElapsedMs = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, ms);
      if (status === 'running') anchorRef.current = Date.now() - clamped;
      else pausedElapsedRef.current = clamped;
      setNow(Date.now());
    },
    [status]
  );

  const currentElapsedMs = () =>
    status === 'running' ? Date.now() - anchorRef.current : pausedElapsedRef.current;

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

  // Soma (positivo) ou subtrai (negativo) tempo do nível atual.
  const addSeconds = useCallback(
    (delta: number) => setElapsedMs(currentElapsedMs() - delta * 1000),
    [setElapsedMs] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const goToIndex = useCallback(
    (i: number) => {
      const clampedIdx = Math.min(Math.max(0, i), items.length - 1);
      if (status === 'idle') setStatus('paused');
      setElapsedMs(cumStarts[clampedIdx] * 1000);
    },
    [items.length, cumStarts, setElapsedMs, status]
  );

  const next = useCallback(() => goToIndex(state.item_index + 1), [goToIndex, state.item_index]);
  const prev = useCallback(() => goToIndex(state.item_index - 1), [goToIndex, state.item_index]);

  const update_curve = useCallback((patch: Partial<EngineParams>) => {
    setParams((p) => ({ ...p, ...patch }));
  }, []);

  return {
    state, items, curve, params,
    start, pause, reset, addSeconds, goToIndex, next, prev, update_curve,
  };
}
