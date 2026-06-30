// src/utils/poker-math.ts
// Núcleo matemático puro — sem side-effects, sem I/O, sem dependências externas.

// ── Denominações físicas reais das maletas ──────────────────────────────
export const CHIP_DENOMINATIONS = [25, 50, 100, 1000] as const;
export type ChipDenomination = (typeof CHIP_DENOMINATIONS)[number];

// ── Setup paramétrico base (todos sobrescrevíveis pela UI) ───────────────
export const DEFAULTS = {
  smallest_chip: 25,
  initial_sb: 25,
  initial_bb: 50,
  stack_bb: 75,
  end_bb_ratio: 0.06,
} as const;

export interface BaseSetup {
  smallest_chip: number;
  initial_sb: number;
  initial_bb: number;
  stack_bb: number;
}

export function defaultSetup(): BaseSetup {
  return {
    smallest_chip: DEFAULTS.smallest_chip,
    initial_sb: DEFAULTS.initial_sb,
    initial_bb: DEFAULTS.initial_bb,
    stack_bb: DEFAULTS.stack_bb,
  };
}

export function initialStack(setup: BaseSetup): number {
  return setup.stack_bb * setup.initial_bb;
}

// ── Tipos ───────────────────────────────────────────────────────────────
export interface CurveParams {
  qnt_entradas_primarias: number;
  valor_fichas_inicial: number;
  qnt_acumulada_rebuys: number;
  fichas_por_rebuy: number;
  qnt_acumulada_addons: number;
  fichas_por_addon: number;
  target_time_minutos: number;
  duracao_bloco_nivel: number;
  initial_bb?: number;     // default DEFAULTS.initial_bb
  end_bb_ratio?: number;   // default DEFAULTS.end_bb_ratio
  smallest_chip?: number;  // default DEFAULTS.smallest_chip
}

export interface BlindLevel {
  nivel: number;
  small_blind: number;
  big_blind: number;
}

export interface CurveResult {
  c_total: number;
  alvo_big_blind: number;
  qnt_niveis_projetados: number;
  multiplicador_r: number;
  niveis: BlindLevel[];
}

export interface PayoutSlice {
  posicao: number;
  percentual: number;
  premio: number;
}

// ── Quantização (arredondamento por faixa) ──────────────────────────────
function quantizeBlind(bb: number, chip: number): number {
  let v: number;
  if (bb < 200) v = Math.round(bb / 50) * 50;
  else if (bb < 1000) v = Math.round(bb / 100) * 100;
  else {
    const m500 = Math.round(bb / 500) * 500;
    const m1000 = Math.round(bb / 1000) * 1000;
    v = Math.abs(bb - m500) <= Math.abs(bb - m1000) ? m500 : m1000;
  }
  // Garante pagabilidade com a ficha mínima.
  return Math.max(chip * 2, Math.round(v / chip) * chip);
}

function bandStep(bb: number): number {
  if (bb < 200) return 50;
  if (bb < 1000) return 100;
  return 500;
}

// ── Cálculo de Curva e Recálculo (Feedback Loop) ────────────────────────
export function calcularCurvaBlinds(p: CurveParams): CurveResult {
  const initial_bb = p.initial_bb ?? DEFAULTS.initial_bb;
  const ratio = p.end_bb_ratio ?? DEFAULTS.end_bb_ratio;
  const chip = p.smallest_chip ?? DEFAULTS.smallest_chip;

  const c_total =
    p.qnt_entradas_primarias * p.valor_fichas_inicial +
    p.qnt_acumulada_rebuys * p.fichas_por_rebuy +
    p.qnt_acumulada_addons * p.fichas_por_addon;

  const alvo_big_blind = c_total * ratio;
  const qnt_niveis_projetados = Math.max(
    2,
    Math.round(p.target_time_minutos / p.duracao_bloco_nivel)
  );

  const multiplicador_r = Math.pow(
    Math.max(alvo_big_blind, initial_bb) / initial_bb,
    1 / (qnt_niveis_projetados - 1)
  );

  const niveis: BlindLevel[] = [];
  let anterior = 0;

  for (let i = 0; i < qnt_niveis_projetados; i++) {
    const cru = initial_bb * Math.pow(multiplicador_r, i);
    let bb = quantizeBlind(cru, chip);

    // Impede dois níveis consecutivos idênticos após arredondamento.
    if (bb <= anterior) {
      bb = quantizeBlind(anterior + bandStep(anterior), chip);
      if (bb <= anterior) bb = anterior + bandStep(anterior);
    }

    anterior = bb;
    const small_blind = Math.max(chip, Math.round(bb / 2 / chip) * chip);
    niveis.push({ nivel: i + 1, small_blind, big_blind: bb });
  }

  return { c_total, alvo_big_blind, qnt_niveis_projetados, multiplicador_r, niveis };
}

// ── Distribuição Financeira (Payouts) ───────────────────────────────────
// Regra padrão por nº de jogadores; sobrescrevível via aplicarPayouts.
export function tabelaPadraoPayouts(total_jogadores: number): number[] {
  if (total_jogadores <= 5) return [1.0];
  if (total_jogadores <= 10) return [0.65, 0.35];
  if (total_jogadores <= 20) return [0.5, 0.3, 0.2];
  return [0.45, 0.27, 0.18, 0.1];
}

export function aplicarPayouts(
  total_arrecadado: number,
  percentuais: number[]
): PayoutSlice[] {
  return percentuais.map((pct, idx) => ({
    posicao: idx + 1,
    percentual: pct,
    premio: total_arrecadado * pct,
  }));
}

export function calcularPayouts(
  total_arrecadado: number,
  total_jogadores: number
): PayoutSlice[] {
  return aplicarPayouts(total_arrecadado, tabelaPadraoPayouts(total_jogadores));
}
