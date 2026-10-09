import { describe, expect, it } from 'vitest';
import { aniversarioPreset } from '../../presets';
import { buildSchedule, resolveBreaks } from '../poker-math';

describe('aniversarioPreset', () => {
  const { config, manualLevels } = aniversarioPreset();
  const late = config.late_checkin_level as number;
  const items = buildSchedule(manualLevels!, {
    level_duration_minutes: config.duracao_bloco_nivel,
    late_checkin_level: late,
    ante_enabled: config.ante_enabled,
    ante_start_level: late + 1, // sentinela 'late'
    breaks: resolveBreaks(config.breaks, late),
  });
  // Minuto em que termina o item (nível ou intervalo) de índice i.
  const endAt = (i: number) => items.slice(0, i + 1).reduce((s, it) => s + it.duration_seconds, 0) / 60;
  const levelIdx = (n: number) => items.findIndex((it) => it.kind === 'level' && it.level === n);

  it('stack inicial de 300 BB', () => {
    expect(config.setup.stack_bb * config.setup.initial_bb).toBe(3000);
    expect(manualLevels![0].big_blind).toBe(config.setup.initial_bb);
  });

  it('late check-in fecha na metade do torneio', () => {
    expect(endAt(levelIdx(late))).toBe(config.target_time_minutos / 2);
  });

  it('nível 19 termina dentro de 7 horas', () => {
    expect(endAt(levelIdx(19))).toBeLessThanOrEqual(420);
  });

  it('ante só depois do late check-in', () => {
    expect(config.ante_start_level).toBe('late');
    for (const it of items) {
      if (it.kind === 'level') expect(it.ante > 0).toBe(it.level > late);
    }
  });

  it('blinds sempre sobem', () => {
    manualLevels!.forEach((l, i) => {
      if (i) expect(l.big_blind).toBeGreaterThan(manualLevels![i - 1].big_blind);
    });
  });
});
