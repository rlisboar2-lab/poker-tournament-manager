// src/utils/liveState.ts
// Campos do relógio publicados em `live_state` (/watch). Puro para ser testável.
import type { ClockSnapshot } from '../hooks/useTournamentEngine';

export interface LiveClockFields {
  status: ClockSnapshot['status'];
  anchor_ms: number;
  paused_elapsed_ms: number;
}

/**
 * Com o torneio salvo, a transmissão passa a `finished` e o relógio congela no
 * tempo decorrido daquele instante — o /watch mostra "Encerrado" em vez de
 * seguir "Pausado" ou contando.
 */
export function liveClockFields(snap: ClockSnapshot, finished: boolean, nowMs: number): LiveClockFields {
  if (!finished) {
    return {
      status: snap.status,
      anchor_ms: Math.round(snap.anchorMs),
      paused_elapsed_ms: Math.round(snap.pausedElapsedMs),
    };
  }
  const elapsed = snap.status === 'running' ? nowMs - snap.anchorMs : snap.pausedElapsedMs;
  return {
    status: 'finished',
    anchor_ms: Math.round(snap.anchorMs),
    paused_elapsed_ms: Math.round(Math.max(0, elapsed)),
  };
}
