// src/hooks/useTournamentEngine.ts
// Relógio sincronizado ancorado em Unix Epoch (sem decréscimo por setInterval).
// Imune a background sleep / focus drop: o estado deriva sempre de Date.now().
//
// Os parâmetros são props puros: quem chama passa `params` já memoizado e o hook
// deriva curva/agenda deles. Não há cópia em `useState` nem `update_curve`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  calcularCurvaBlinds,
  buildSchedule,
  type CurveParams,
  type BreakConfig,
  type BlindLevel,
  type ScheduleItem,
} from '../utils/poker-math';

export type ClockStatus = 'idle' | 'running' | 'paused' | 'finished';

export interface EngineParams extends CurveParams {
  total_chips_in_play?: number;
  players_remaining?: number;
  late_checkin_level: number;
  ante_enabled: boolean;
  breaks: BreakConfig[];
  override_levels?: BlindLevel[] | null; // estrutura editada manualmente (ao vivo)
}

// Âncora do relógio. É estado (não ref) porque o render depende dela:
// `anchorMs` vale quando `running`; `pausedElapsedMs`, nos demais status.
export interface ClockSnapshot {
  status: ClockStatus;
  anchorMs: number;
  pausedElapsedMs: number;
}

const IDLE_CLOCK: ClockSnapshot = { status: 'idle', anchorMs: 0, pausedElapsedMs: 0 };

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

// Posição lógica no cronograma, usada para reancorar quando a estrutura muda.
export interface Position {
  kind: 'level' | 'break';
  blinds: string;    // "sb/bb" — sobrevive à renumeração dos níveis
  level: number;     // nº do nível (ou do nível anterior, se intervalo)
  into: number;      // segundos já corridos dentro do item
  start_sec: number; // offset do item no cronograma antigo
}

// Acha o mesmo item no cronograma novo. Prioriza os blinds (imunes à
// renumeração feita por `deleteLevel`); cai para o número do nível se não achar.
export function findPosition(items: ScheduleItem[], pos: Position): number {
  let lastLevel = 0;
  let fallback = -1;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'level') {
      lastLevel = it.level;
      if (pos.kind !== 'level') continue;
      if (`${it.small_blind}/${it.big_blind}` === pos.blinds) return i;
      if (it.level === pos.level && fallback < 0) fallback = i;
    } else if (pos.kind === 'break' && lastLevel === pos.level && fallback < 0) {
      fallback = i;
    }
  }
  return fallback;
}

export function useTournamentEngine(params: EngineParams) {
  const [clock, setClock] = useState<ClockSnapshot>(IDLE_CLOCK);
  const [now, setNow] = useState<number>(() => Date.now());
  const status = clock.status;

  // Ticker só existe enquanto roda: pausado/parado não re-renderiza a 4×/s.
  useEffect(() => {
    if (status !== 'running') return;
    let timer = 0;
    let active = true;
    const loop = () => {
      if (!active) return;
      setNow(Date.now());
      timer = window.setTimeout(loop, 250);
    };
    loop();
    return () => { active = false; clearTimeout(timer); };
  }, [status]);

  const curve = useMemo(() => calcularCurvaBlinds(params), [params]);
  const niveis = useMemo(
    () => (params.override_levels && params.override_levels.length
      ? params.override_levels
      : curve.niveis),
    [params.override_levels, curve]
  );
  const items: ScheduleItem[] = useMemo(
    () =>
      buildSchedule(niveis, {
        level_duration_minutes: params.duracao_bloco_nivel,
        late_checkin_level: params.late_checkin_level,
        ante_enabled: params.ante_enabled,
        breaks: params.breaks,
      }),
    [niveis, params.duracao_bloco_nivel, params.late_checkin_level, params.ante_enabled, params.breaks]
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
    (status === 'running' ? now - clock.anchorMs : clock.pausedElapsedMs) / 1000;

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
  }, [
    elapsedSeconds, items, cumStarts, status, curve,
    params.total_chips_in_play, params.players_remaining,
  ]);

  // ── Controles ───────────────────────────────────────────────────────────
  // `commit` move o relógio e o `now` do render no MESMO instante `t`. Sem
  // avançar o `now`, o render seguinte ainda usaria o do último tick (até 250ms
  // atrás) e o alvo cairia um pouco antes — o bastante para "Avançar nível"
  // parar no fim do nível anterior. Os updaters recebem `t` pronto e ficam puros.
  const commit = useCallback((t: number, fn: (c: ClockSnapshot) => ClockSnapshot) => {
    setNow(t);
    setClock(fn);
  }, []);

  const setElapsedMs = useCallback((ms: number) => {
    const target = Math.max(0, ms);
    const t = Date.now();
    commit(t, (c) => (c.status === 'running'
      ? { ...c, anchorMs: t - target }
      : { ...c, pausedElapsedMs: target }));
  }, [commit]);

  const start = useCallback(() => {
    const t = Date.now();
    commit(t, (c) => ({
      status: 'running',
      anchorMs: t - c.pausedElapsedMs,
      pausedElapsedMs: c.pausedElapsedMs,
    }));
  }, [commit]);

  const pause = useCallback(() => {
    const t = Date.now();
    commit(t, (c) => (c.status === 'running'
      ? { status: 'paused', anchorMs: c.anchorMs, pausedElapsedMs: t - c.anchorMs }
      : { ...c, status: 'paused' }));
  }, [commit]);

  const reset = useCallback(() => setClock(IDLE_CLOCK), []);

  // Soma (positivo) ou subtrai (negativo) tempo do nível atual.
  const addSeconds = useCallback((delta: number) => {
    const t = Date.now();
    commit(t, (c) => {
      const cur = c.status === 'running' ? t - c.anchorMs : c.pausedElapsedMs;
      const target = Math.max(0, cur - delta * 1000);
      return c.status === 'running'
        ? { ...c, anchorMs: t - target }
        : { ...c, pausedElapsedMs: target };
    });
  }, [commit]);

  const goToIndex = useCallback(
    (i: number) => {
      const clampedIdx = Math.min(Math.max(0, i), items.length - 1);
      const target = cumStarts[clampedIdx] * 1000;
      const t = Date.now();
      commit(t, (c) => {
        const st: ClockStatus = c.status === 'idle' ? 'paused' : c.status;
        return st === 'running'
          ? { status: st, anchorMs: t - target, pausedElapsedMs: c.pausedElapsedMs }
          : { status: st, anchorMs: c.anchorMs, pausedElapsedMs: target };
      });
    },
    [items.length, cumStarts, commit]
  );

  const next = useCallback(() => goToIndex(state.item_index + 1), [goToIndex, state.item_index]);
  const prev = useCallback(() => goToIndex(state.item_index - 1), [goToIndex, state.item_index]);

  // ── Reancoragem ao editar a estrutura ao vivo ───────────────────────────
  // Inserir/remover nível ou intervalo muda `items` com o elapsed congelado, o
  // que faria o nível atual pular sem aviso. A posição lógica é guardada em um
  // effect (nunca no render) e, quando `items` troca, o relógio é reancorado no
  // mesmo ponto do item equivalente da estrutura nova.
  const posRef = useRef<Position | null>(null);
  const itemsRef = useRef(items);

  useEffect(() => {
    const pos = posRef.current;
    const changed = itemsRef.current !== items;
    itemsRef.current = items;
    if (!changed || !pos || status === 'idle') return;
    const idx = findPosition(items, pos);
    if (idx < 0) return;                          // item removido: mantém o elapsed
    if (cumStarts[idx] === pos.start_sec) return; // nada se moveu
    const into = Math.min(pos.into, Math.max(0, items[idx].duration_seconds - 1));
    setElapsedMs((cumStarts[idx] + into) * 1000);
  }, [items, cumStarts, status, setElapsedMs]);

  // Declarado DEPOIS de propósito: no commit em que `items` muda, o effect acima
  // ainda lê a posição gravada no commit anterior — a da estrutura antiga.
  useEffect(() => {
    const cur = items[state.item_index];
    if (!cur) return;
    posRef.current = {
      kind: cur.kind,
      blinds: cur.kind === 'level' ? `${cur.small_blind}/${cur.big_blind}` : '',
      level: state.level_number,
      into: state.seconds_into_item,
      start_sec: cumStarts[state.item_index] ?? 0,
    };
  });

  // Persistência do relógio (retomar após fechar): ancora em epoch absoluto.
  const restore = useCallback((s: ClockSnapshot) => commit(Date.now(), () => ({ ...s })), [commit]);

  return {
    state, items, curve, params,
    start, pause, reset, addSeconds, goToIndex, next, prev,
    snapshot: clock, restore,
  };
}
