import { describe, it, expect } from 'vitest';
import {
  CHIP_DENOMINATIONS,
  minChipForBB,
  quantizeBlind,
  bandStep,
  sbForBb,
  calcularCurvaBlinds,
  recalibrarCurva,
  colorUpPoints,
  sugerirBreaksParaColorUp,
  nivelAuto,
  inserirNivelContinuando,
  buildSchedule,
  resolveBreaks,
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

// ── recalibrarCurva (ratchet) ────────────────────────────────────────────
describe('recalibrarCurva', () => {
  it('sem opts é idêntica a calcularCurvaBlinds', () => {
    expect(recalibrarCurva(baseCurve)).toEqual(calcularCurvaBlinds(baseCurve));
  });

  it('recalibrar com c_total menor nunca produz BB abaixo do floor', () => {
    const cheia = calcularCurvaBlinds(baseCurve);
    const floor = cheia.niveis.map((n) => n.big_blind);
    const menor = recalibrarCurva(
      { ...baseCurve, qnt_acumulada_rebuys: 0, qnt_acumulada_addons: 0 },
      { floor }
    );
    menor.niveis.forEach((n, i) => {
      expect(n.big_blind).toBeGreaterThanOrEqual(floor[i]);
    });
  });

  it('nível em `frozen` sai byte-idêntico da recalibração', () => {
    const cheia = calcularCurvaBlinds(baseCurve);
    const frozen = cheia.niveis.slice(0, 4).map((l) => ({ ...l }));
    const out = recalibrarCurva(
      { ...baseCurve, qnt_acumulada_rebuys: 0, qnt_acumulada_addons: 0 },
      { frozen }
    );
    frozen.forEach((f, i) => expect(out.niveis[i]).toEqual(f));
  });

  it('mantém monotonicidade e curva pagável mesmo com frozen + floor', () => {
    const cheia = calcularCurvaBlinds(baseCurve);
    const frozen = cheia.niveis.slice(0, 3).map((l) => ({ ...l }));
    const floor = cheia.niveis.map((n) => n.big_blind);
    const out = recalibrarCurva(
      { ...baseCurve, qnt_acumulada_rebuys: 4, qnt_acumulada_addons: 0 },
      { frozen, floor }
    );
    for (let i = 1; i < out.niveis.length; i++) {
      expect(out.niveis[i].big_blind).toBeGreaterThan(out.niveis[i - 1].big_blind);
    }
    for (const n of out.niveis) {
      expect(n.small_blind * 2).toBe(n.big_blind);
      expect(n.small_blind % minChipForBB(n.big_blind)).toBe(0);
    }
  });

  it('color-up monótono: nenhuma sequência exige ficha menor que uma já retirada', () => {
    const cheia = calcularCurvaBlinds(baseCurve);
    const frozen = cheia.niveis.slice(0, 5).map((l) => ({ ...l }));
    const out = recalibrarCurva(
      { ...baseCurve, qnt_acumulada_rebuys: 0, qnt_acumulada_addons: 0 },
      { frozen }
    );
    let maxChip = 0;
    for (const n of out.niveis) {
      const mc = minChipForBB(n.big_blind);
      expect(mc).toBeGreaterThanOrEqual(maxChip);
      maxChip = Math.max(maxChip, mc);
    }
  });
});

// ── colorUpPoints / sugerirBreaksParaColorUp ─────────────────────────────
const niveisFaixaCompleta: BlindLevel[] = [10, 40, 250, 700, 2000].map((bb, i) => ({
  nivel: i + 1,
  small_blind: bb / 2,
  big_blind: bb,
}));

describe('colorUpPoints', () => {
  it('acha as 4 fronteiras da escada de COLORUP numa curva que cobre toda a faixa', () => {
    const pontos = colorUpPoints(niveisFaixaCompleta, 5);
    expect(pontos.length).toBe(4);
    expect(pontos.map((p) => p.passa_a_usar)).toEqual([25, 50, 100, 500]);
  });

  it('lista vazia sem transição', () => {
    expect(colorUpPoints([], 5)).toEqual([]);
  });
});

describe('sugerirBreaksParaColorUp', () => {
  it('sugere o intervalo logo antes de cada fronteira ainda não coberta', () => {
    const pontos = colorUpPoints(niveisFaixaCompleta, 5);
    const sugestoes = sugerirBreaksParaColorUp(niveisFaixaCompleta, []);
    expect(sugestoes).toEqual(pontos.map((p) => p.nivel - 1));
  });

  it('não repete sugestão de um intervalo já configurado', () => {
    const pontos = colorUpPoints(niveisFaixaCompleta, 5);
    const jaConfigurado = pontos[0].nivel - 1;
    const sugestoes = sugerirBreaksParaColorUp(niveisFaixaCompleta, [{ after_level: jaConfigurado, minutes: 10 }]);
    expect(sugestoes).not.toContain(jaConfigurado);
  });
});

// ── nivelAuto ─────────────────────────────────────────────────────────────
describe('nivelAuto', () => {
  it('arredonda para cima a fração de níveis', () => {
    expect(nivelAuto(11, 0.75)).toBe(9);
    expect(nivelAuto(11, 0.5)).toBe(6);
  });

  it('nunca devolve menos que 1', () => {
    expect(nivelAuto(1, 0.1)).toBe(1);
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

  it('ante_start_level desacoplado do late_checkin_level', () => {
    const items = buildSchedule(niveis3, {
      ...baseSp,
      late_checkin_level: 1,
      ante_start_level: 3,
      breaks: [],
    }) as ScheduleLevel[];
    expect(items.filter((i) => i.is_late_checkin).map((i) => i.level)).toEqual([1]);
    expect(items.map((i) => i.ante)).toEqual([0, 0, 400, 800]);
  });

  it('sem ante_start_level, cai no late_checkin_level (compat)', () => {
    const items = buildSchedule(niveis3, { ...baseSp, breaks: [] }) as ScheduleLevel[];
    const semAnteStart = buildSchedule(niveis3, {
      level_duration_minutes: baseSp.level_duration_minutes,
      late_checkin_level: baseSp.late_checkin_level,
      ante_enabled: baseSp.ante_enabled,
      breaks: [],
    }) as ScheduleLevel[];
    expect(semAnteStart.map((i) => i.ante)).toEqual(items.map((i) => i.ante));
  });

  it('ante_start_level: auto (0,75 de 11 níveis = 9) reproduz a agenda de hoje com late_checkin_level: 9', () => {
    const niveis11 = mkLevels([10, 20, 30, 50, 100, 150, 200, 300, 500, 800, 1400]);
    const anteAuto = nivelAuto(11, 0.75);
    expect(anteAuto).toBe(9);
    const hoje = buildSchedule(niveis11, {
      level_duration_minutes: 20,
      late_checkin_level: 9,
      ante_enabled: true,
      breaks: [],
    }) as ScheduleLevel[];
    const novo = buildSchedule(niveis11, {
      level_duration_minutes: 20,
      late_checkin_level: nivelAuto(11, 0.5),
      ante_start_level: anteAuto,
      ante_enabled: true,
      breaks: [],
    }) as ScheduleLevel[];
    expect(novo.map((i) => i.ante)).toEqual(hoje.map((i) => i.ante));
  });
});

// ── Intervalo colado no late check-in (REDESIGN.md S18) ─────────────────
describe('resolveBreaks', () => {
  // O nº de níveis projetados sai do orçamento de tempo (alvo menos intervalos),
  // não do nº de jogadores: entradas mexem no valor dos blinds, não no tamanho
  // da curva. Quem move o late — e com ele o intervalo default — é a curva.
  const niveisCom = (target: number, entradas: number) => calcularCurvaBlinds({
    qnt_entradas_primarias: entradas,
    valor_fichas_inicial: 3000,
    qnt_acumulada_rebuys: 0,
    fichas_por_rebuy: 3000,
    qnt_acumulada_addons: 0,
    fichas_por_addon: 3000,
    target_time_minutos: target,
    duracao_bloco_nivel: 20,
    initial_bb: 10,
    smallest_chip: 5,
  }).qnt_niveis_projetados;

  it('gruda o intervalo default no late quando a curva muda de tamanho', () => {
    const breaks = [{ after_level: 'late' as const, minutes: 15 }];
    const curta = niveisCom(285, 6);   // 300 de alvo menos os 15 do intervalo
    const longa = niveisCom(585, 30);
    expect(longa).toBeGreaterThan(curta);

    const lateCurta = nivelAuto(curta, 0.5);
    const lateLonga = nivelAuto(longa, 0.5);
    expect(lateLonga).not.toBe(lateCurta);
    expect(resolveBreaks(breaks, lateCurta)).toEqual([{ after_level: lateCurta, minutes: 15 }]);
    expect(resolveBreaks(breaks, lateLonga)).toEqual([{ after_level: lateLonga, minutes: 15 }]);
  });

  it('não mexe em intervalo editado à mão', () => {
    const breaks = [{ after_level: 4, minutes: 10 }, { after_level: 'late' as const, minutes: 15 }];
    expect(resolveBreaks(breaks, 9)).toEqual([
      { after_level: 4, minutes: 10 },
      { after_level: 9, minutes: 15 },
    ]);
  });

  it('quando o late cai sobre um intervalo manual, o primeiro da lista vence', () => {
    const breaks = [{ after_level: 'late' as const, minutes: 15 }, { after_level: 7, minutes: 10 }];
    expect(resolveBreaks(breaks, 7)).toEqual([{ after_level: 7, minutes: 15 }]);
  });

  it('nunca devolve nível menor que 1', () => {
    expect(resolveBreaks([{ after_level: 'late', minutes: 15 }], 0))
      .toEqual([{ after_level: 1, minutes: 15 }]);
  });
});
