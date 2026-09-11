// src/hooks/useTournamentEngine.ts
// Relógio sincronizado ancorado em Unix Epoch (sem decréscimo por setInterval).
// Imune a background sleep / focus drop: o estado deriva sempre de Date.now().
//
// Os parâmetros são props puros: quem chama passa `params` já memoizado e o hook
// deriva curva/agenda deles. Não há cópia em `useState` nem `update_curve`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  recalibrarCurva,
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
  // Nível a partir do qual o ante entra — desacoplado do late check-in (S9).
  // Ausente, cai no `late_checkin_level` (comportamento anterior).
  ante_start_level?: number;
  breaks: BreakConfig[];
  override_levels?: BlindLevel[] | null; // estrutura editada manualmente (ao vivo)
  // Passado congelado: níveis já jogados, copiados intactos pela recalibração.
  frozen_levels?: BlindLevel[];
  // Piso publicado por índice: o BB de um nível nunca desce do que a mesa já viu.
  published_floor?: number[] | null;
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
//
// `minIndex` é o piso da busca: com ele definido a função nunca devolve um índice
// menor. Serve para a RECALIBRAÇÃO, em que os blinds mudam de lugar na curva —
// o par "sb/bb" do nível corrente passa a casar num índice anterior e o relógio
// voltaria de nível. Na EDIÇÃO MANUAL o piso não é passado: apagar o nível
// corrente legitimamente move o relógio para trás.
export function findPosition(items: ScheduleItem[], pos: Position, minIndex?: number): number {
  const from = minIndex != null ? Math.max(0, minIndex) : 0;
  let lastLevel = 0;
  let fallback = -1;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'level') {
      lastLevel = it.level; // rastreado mesmo abaixo do piso: o intervalo pode casar por ele
      if (i < from) continue;
      if (pos.kind !== 'level') continue;
      if (`${it.small_blind}/${it.big_blind}` === pos.blinds) return i;
      if (it.level === pos.level && fallback < 0) fallback = i;
    } else if (i >= from && pos.kind === 'break' && lastLevel === pos.level && fallback < 0) {
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

  // Curva com passado congelado e piso publicado: recalibrar nunca reescreve um
  // nível já jogado nem baixa o BB de um índice que a mesa já viu.
  const curve = useMemo(
    () => recalibrarCurva(params, {
      frozen: params.frozen_levels,
      floor: params.published_floor ?? undefined,
    }),
    [params]
  );

  // Uma recalibração foi barrada pelo piso quando a curva sem piso sairia
  // diferente. Com estrutura editada à mão a curva calculada não vai para a
  // tela, então não há o que avisar.
  const floorHeld = useMemo(() => {
    if (params.override_levels?.length) return false;
    if (!params.published_floor?.length) return false;
    const semPiso = recalibrarCurva(params, { frozen: params.frozen_levels });
    return (
      semPiso.niveis.length !== curve.niveis.length ||
      curve.niveis.some((n, i) => n.big_blind !== semPiso.niveis[i].big_blind)
    );
  }, [params, curve]);
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
        ante_start_level: params.ante_start_level,
        breaks: params.breaks,
      }),
    [
      niveis, params.duracao_bloco_nivel, params.late_checkin_level,
      params.ante_enabled, params.ante_start_level, params.breaks,
    ]
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
  const overrideRef = useRef(params.override_levels);

  useEffect(() => {
    const pos = posRef.current;
    const changed = itemsRef.current !== items;
    // Origem da mudança: `override_levels` trocou de identidade → edição manual
    // (inserir/apagar nível ou intervalo). Só `items` mudou → recalibração da
    // curva (rebuy, add-on, jogador novo), que jamais pode recuar o relógio.
    const manualEdit = overrideRef.current !== params.override_levels;
    itemsRef.current = items;
    overrideRef.current = params.override_levels;
    if (!changed || !pos || status === 'idle') return;
    const idx = findPosition(items, pos, manualEdit ? undefined : state.item_index);
    if (idx < 0) return;                          // item removido: mantém o elapsed
    if (cumStarts[idx] === pos.start_sec) return; // nada se moveu
    const into = Math.min(pos.into, Math.max(0, items[idx].duration_seconds - 1));
    setElapsedMs((cumStarts[idx] + into) * 1000);
  }, [items, cumStarts, status, setElapsedMs, params.override_levels, state.item_index]);

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

  // Passado congelado: os níveis até o corrente (inclusive), materializados. O
  // App guarda isso em estado e devolve em `frozen_levels` — é o que impede a
  // recalibração de reescrever nível já jogado. Vazio enquanto o relógio é `idle`:
  // antes de começar, a estrutura tem de ser livre para subir e descer.
  const frozenLevels = useMemo<BlindLevel[]>(
    () => (status === 'idle' ? [] : niveis.slice(0, state.level_number).map((n) => ({ ...n }))),
    [status, niveis, state.level_number]
  );

  // Persistência do relógio (retomar após fechar): ancora em epoch absoluto.
  const restore = useCallback((s: ClockSnapshot) => commit(Date.now(), () => ({ ...s })), [commit]);

  return {
    state, items, curve, params, frozenLevels, floorHeld,
    start, pause, reset, addSeconds, goToIndex, next, prev,
    snapshot: clock, restore,
  };
}
