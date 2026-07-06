// src/utils/clockView.ts
// Deriva o "visor" do relógio a partir do cronograma + tempo decorrido.
// Puro (sem side-effects) — usado pela página de telespectador (/watch).
import type { ScheduleItem } from './poker-math';

export interface ClockView {
  status: string;
  item_index: number;
  kind: 'level' | 'break';
  level_number: number;
  total_levels: number;
  small_blind: number;
  big_blind: number;
  ante: number;
  break_label: string | null;
  is_late_checkin: boolean;
  next_small_blind: number | null;
  next_big_blind: number | null;
  next_ante: number | null;
  seconds_until_next: number;
  average_stack: number;
  pressure_bb: number;
}

export function deriveClockView(
  items: ScheduleItem[],
  elapsedSeconds: number,
  status: string,
  opts: { total_chips: number; players: number }
): ClockView {
  const cum: number[] = [];
  let acc = 0;
  for (const it of items) { cum.push(acc); acc += it.duration_seconds; }
  const totalDuration = acc;

  const elapsed = Math.max(0, elapsedSeconds);
  let idx = Math.max(0, items.length - 1);
  for (let i = 0; i < items.length; i++) {
    if (elapsed < cum[i] + items[i].duration_seconds) { idx = i; break; }
  }
  const finished = items.length > 0 && elapsed >= totalDuration && status !== 'idle';
  const cur = items[idx];

  const into = !cur ? 0 : finished ? cur.duration_seconds : Math.floor(elapsed - cum[idx]);
  const until = !cur ? 0 : finished ? 0 : cur.duration_seconds - into;

  let nextLevel: Extract<ScheduleItem, { kind: 'level' }> | null = null;
  for (let i = idx + 1; i < items.length; i++) {
    if (items[i].kind === 'level') { nextLevel = items[i] as Extract<ScheduleItem, { kind: 'level' }>; break; }
  }
  let lastLevel: Extract<ScheduleItem, { kind: 'level' }> | null = null;
  for (let i = idx; i >= 0; i--) {
    if (items[i]?.kind === 'level') { lastLevel = items[i] as Extract<ScheduleItem, { kind: 'level' }>; break; }
  }
  const lvl = cur && cur.kind === 'level' ? cur : lastLevel;

  const players = Math.max(1, opts.players);
  const average_stack = opts.total_chips / players;
  const bb = lvl ? lvl.big_blind : 0;
  const total_levels = items.filter((i) => i.kind === 'level').length;

  return {
    status: finished ? 'finished' : status,
    item_index: idx,
    kind: cur ? cur.kind : 'level',
    level_number: lvl ? lvl.level : 0,
    total_levels,
    small_blind: lvl ? lvl.small_blind : 0,
    big_blind: bb,
    ante: lvl ? lvl.ante : 0,
    break_label: cur && cur.kind === 'break' ? cur.label : null,
    is_late_checkin: cur && cur.kind === 'level' ? cur.is_late_checkin : false,
    next_small_blind: nextLevel ? nextLevel.small_blind : null,
    next_big_blind: nextLevel ? nextLevel.big_blind : null,
    next_ante: nextLevel ? nextLevel.ante : null,
    seconds_until_next: until,
    average_stack,
    pressure_bb: bb > 0 ? average_stack / bb : 0,
  };
}
