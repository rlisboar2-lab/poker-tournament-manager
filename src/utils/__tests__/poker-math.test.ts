import { describe, it, expect } from 'vitest';
import {
  CHIP_DENOMINATIONS,
  minChipForBB,
  quantizeBlind,
  bandStep,
  sbForBb,
  calcularCurvaBlinds,
  inserirNivelContinuando,
  buildSchedule,
  type CurveParams,
  type BlindLevel,
  type ScheduleParams,
  type ScheduleLevel,
} from '../poker-math';

// ── minChipForBB / color-up ─────────────────────────────────────────────
describe('minChipForBB', () => {
  it('cresce em degraus conforme o BB sobe', () => {
    expect(minChipForBB(10)).toBe(5);
    expect(minChipForBB(29)).toBe(5);
    expect(minChipForBB(30)).toBe(25);
    expect(minChipForBB(199)).toBe(25);
    expect(minChipForBB(200)).toBe(50);
    expect(minChipForBB(600)).toBe(100);
    expect(minChipForBB(1500)).toBe(500);
    expect(minChipForBB(999999)).toBe(500);
  });

  it('respeita o floorChip', () => {
    expect(minChipForBB(10, 25)).toBe(25);
  });

  it('só usa denominações que existem em jogo', () => {
    for (const bb of [10, 50, 250, 800, 2000, 50000]) {
      expect(CHIP_DENOMINATIONS).toContain(minChipForBB(bb) as (typeof CHIP_DENOMINATIONS)[number]);
    }
  });
});

// ── quantizeBlind ───────────────────────────────────────────────────────
describe('quantizeBlind', () => {
  it('arredonda para múltiplo de 2×minChip', () => {
    for (const bb of [7, 13, 44, 137, 640, 2100, 9999]) {
      const q = quantizeBlind(bb, 5);
      expect(q % bandStep(q, 5)).toBe(0);
    }
  });

  it('mantém SB inteiro em minChip', () => {
    for (const bb of [10, 55, 220, 810, 2400]) {
      const q = quantizeBlind(bb, 5);
      const sb = sbForBb(q);
      expect(sb * 2).toBe(q);
      expect(sb % minChipForBB(q)).toBe(0);
    }
  });

  it('nunca devolve menos que um passo', () => {
    expect(quantizeBlind(1, 5)).toBeGreaterThanOrEqual(bandStep(1, 5));
    expect(quantizeBlind(0, 5)).toBeGreaterThan(0);
  });
});

// ── calcularCurvaBlinds ─────────────────────────────────────────────────
const baseCurve: CurveParams = {
  qnt_entradas_primarias: 20,
  valor_fichas_inicial: 5000,
  qnt_acumulada_rebuys: 10,
  fichas_por_rebuy: 5000,
  qnt_acumulada_addons: 8,
  fichas_por_addon: 6000,
  target_time_minutos: 240,
  duracao_bloco_nivel: 20,
};

describe('calcularCurvaBlinds', () => {
  it('gera curva estritamente monotônica', () => {
    const { niveis } = calcularCurvaBlinds(baseCurve);
    expect(niveis.length).toBeGreaterThan(2);
    for (let i = 1; i < niveis.length; i++) {
      expect(niveis[i].big_blind).toBeGreaterThan(niveis[i - 1].big_blind);
    }
  });

  it('mantém monotonicidade mesmo com parâmetros degenerados', () => {
    const { niveis } = calcularCurvaBlinds({
      ...baseCurve,
      qnt_entradas_primarias: 1,
      valor_fichas_inicial: 100,
      qnt_acumulada_rebuys: 0,
      qnt_acumulada_addons: 0,
      target_time_minutos: 600,
      duracao_bloco_nivel: 10,
    });
    for (let i = 1; i < niveis.length; i++) {
      expect(niveis[i].big_blind).toBeGreaterThan(niveis[i - 1].big_blind);
    }
  });

  it('todos os níveis são pagáveis com fichas reais (SB múltiplo do minChip)', () => {
    const { niveis } = calcularCurvaBlinds(baseCurve);
    for (const n of niveis) {
      expect(n.small_blind * 2).toBe(n.big_blind);
      expect(n.small_blind % minChipForBB(n.big_blind)).toBe(0);
    }
  });

  it('primeiro nível respeita o initial_bb', () => {
    const { niveis } = calcularCurvaBlinds({ ...baseCurve, initial_bb: 50 });
    expect(niveis[0].big_blind).toBeGreaterThanOrEqual(50);
  });

  it('projeta ao menos 2 níveis', () => {
    const { niveis } = calcularCurvaBlinds({ ...baseCurve, target_time_minutos: 1, duracao_bloco_nivel: 100 });
    expect(niveis.length).toBeGreaterThanOrEqual(2);
  });
});

// ── inserirNivelContinuando ─────────────────────────────────────────────
function mkLevels(bbs: number[]): BlindLevel[] {
  return bbs.map((bb, i) => ({ nivel: i + 1, small_blind: bb / 2, big_blind: bb }));
}

describe('inserirNivelContinuando', () => {
  it('adiciona exatamente um nível e renumera', () => {
    const levels = mkLevels([100, 200, 400, 800, 1600]);
    const out = inserirNivelContinuando(levels, 2, 5);
    expect(out.length).toBe(levels.length + 1);
    out.forEach((l, i) => expect(l.nivel).toBe(i + 1));
  });

  it('mantém os níveis até o ponto de inserção', () => {
    const levels = mkLevels([100, 200, 400, 800, 1600]);
    const out = inserirNivelContinuando(levels, 2, 5);
    expect(out[0].big_blind).toBe(100);
    expect(out[1].big_blind).toBe(200);
  });

  it('preserva o BB final (a menos de arredondamento) e a monotonicidade', () => {
    const levels = mkLevels([100, 200, 400, 800, 1600]);
    const out = inserirNivelContinuando(levels, 2, 5);
    const last = out[out.length - 1].big_blind;
    // A quantização em blinds altos (minChip 500) pode arredondar o alvo para cima.
    expect(last).toBeGreaterThanOrEqual(1600);
    expect(last).toBeLessThanOrEqual(1600 + bandStep(1600, 5));
    for (let i = 1; i < out.length; i++) {
      expect(out[i].big_blind).toBeGreaterThan(out[i - 1].big_blind);
    }
  });

  it('devolve a lista intacta se o nível não existe', () => {
    const levels = mkLevels([100, 200, 400]);
    expect(inserirNivelContinuando(levels, 99, 5)).toBe(levels);
  });

  it('funciona inserindo após o último nível', () => {
    const levels = mkLevels([100, 200, 400]);
    const out = inserirNivelContinuando(levels, 3, 5);
    expect(out.length).toBe(4);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].big_blind).toBeGreaterThan(out[i - 1].big_blind);
    }
  });
});

// ── buildSchedule ───────────────────────────────────────────────────────
const niveis3: BlindLevel[] = mkLevels([100, 200, 400, 800]);

const baseSp: ScheduleParams = {
  level_duration_minutes: 20,
  late_checkin_level: 2,
  ante_enabled: true,
  breaks: [{ after_level: 2, minutes: 15 }],
};

describe('buildSchedule', () => {
  it('converte duração de nível para segundos', () => {
    const items = buildSchedule(niveis3, { ...baseSp, breaks: [] });
    expect(items.every((i) => i.kind === 'level')).toBe(true);
    expect((items[0] as ScheduleLevel).duration_seconds).toBe(20 * 60);
  });

  it('ante = BB a partir do late check-in quando habilitado', () => {
    const items = buildSchedule(niveis3, { ...baseSp, breaks: [] }) as ScheduleLevel[];
    expect(items[0].ante).toBe(0); // nível 1 < late_checkin_level
    expect(items[1].ante).toBe(200); // nível 2 == late_checkin_level
    expect(items[2].ante).toBe(400); // nível 3 > late_checkin_level
  });

  it('ante = 0 em todos os níveis quando desabilitado', () => {
    const items = buildSchedule(niveis3, { ...baseSp, ante_enabled: false, breaks: [] }) as ScheduleLevel[];
    expect(items.every((i) => i.ante === 0)).toBe(true);
  });

  it('ante explícito do nível tem prioridade sobre o cálculo', () => {
    const comAnte: BlindLevel[] = [{ nivel: 1, small_blind: 50, big_blind: 100, ante: 25 }];
    const items = buildSchedule(comAnte, { ...baseSp, ante_enabled: false, breaks: [] }) as ScheduleLevel[];
    expect(items[0].ante).toBe(25);
  });

  it('insere intervalo após o nível configurado', () => {
    const items = buildSchedule(niveis3, baseSp);
    expect(items.length).toBe(niveis3.length + 1);
    const brk = items[2];
    expect(brk.kind).toBe('break');
    expect(brk.duration_seconds).toBe(15 * 60);
  });

  it('ignora intervalos com minutes <= 0', () => {
    const items = buildSchedule(niveis3, { ...baseSp, breaks: [{ after_level: 1, minutes: 0 }] });
    expect(items.every((i) => i.kind === 'level')).toBe(true);
  });

  it('marca is_late_checkin apenas no nível certo', () => {
    const items = buildSchedule(niveis3, { ...baseSp, breaks: [] }) as ScheduleLevel[];
    expect(items.filter((i) => i.is_late_checkin).map((i) => i.level)).toEqual([2]);
  });
});
