// src/utils/__tests__/liveState.test.ts
import { describe, it, expect } from 'vitest';
import { liveClockFields } from '../liveState';

describe('liveClockFields', () => {
  it('repassa o relógio enquanto o torneio não foi salvo', () => {
    const out = liveClockFields({ status: 'paused', anchorMs: 1000.4, pausedElapsedMs: 5000.6 }, false, 99_999);
    expect(out).toEqual({ status: 'paused', anchor_ms: 1000, paused_elapsed_ms: 5001 });
  });

  it('salvo e pausado: publica finished no tempo em que parou', () => {
    // Smoke S28: o /watch seguia "Pausado" depois de salvar.
    const out = liveClockFields({ status: 'paused', anchorMs: 1000, pausedElapsedMs: 60_000 }, true, 99_999);
    expect(out).toEqual({ status: 'finished', anchor_ms: 1000, paused_elapsed_ms: 60_000 });
  });

  it('salvo com o relógio correndo: congela no tempo decorrido de agora', () => {
    const out = liveClockFields({ status: 'running', anchorMs: 10_000, pausedElapsedMs: 0 }, true, 70_000);
    expect(out.status).toBe('finished');
    expect(out.paused_elapsed_ms).toBe(60_000);
  });
});
