// src/utils/poker-math.ts
// Núcleo matemático puro — sem side-effects, sem I/O, sem dependências externas.

// ── Denominações físicas reais das maletas ──────────────────────────────
export const CHIP_DENOMINATIONS = [5, 25, 50, 100, 1000] as const;
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
  ante?: number; // ante explícito (estrutura fixa); se ausente, é calculado
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

// ── Color-up: a ficha mínima usada nos blinds CRESCE com o BB ────────────
// Assim, conforme o torneio avança, elimina-se a necessidade das fichas
// menores (5 → 25 → 50 → 100 → 500). Como o BB é sempre múltiplo de 2×minChip,
// o SB (= BB/2) e o ante (= BB) são pagáveis só com fichas ≥ minChip.
const COLORUP: { minBB: number; chip: number }[] = [
  { minBB: 0, chip: 5 },      // 5/10, 10/20  → precisa de 5
  { minBB: 30, chip: 25 },    // 50,100,150   → elimina 5
  { minBB: 200, chip: 50 },   // 200,300,...  → elimina 25
  { minBB: 600, chip: 100 },  // 600,800,...  → elimina 50
  { minBB: 1500, chip: 500 }, // 2000,3000,.. → elimina 100 (só 500/1000)
];

export function minChipForBB(bb: number, floorChip = 5): number {
  let mc = COLORUP[0].chip;
  for (const b of COLORUP) if (bb >= b.minBB) mc = b.chip;
  return Math.max(floorChip, mc);
}

export function quantizeBlind(bb: number, floorChip: number): number {
  const step = 2 * minChipForBB(bb, floorChip); // BB múltiplo de 2×minChip → SB inteiro em minChip
  return Math.max(step, Math.round(bb / step) * step);
}

export function bandStep(bb: number, floorChip = 5): number {
  return 2 * minChipForBB(bb, floorChip);
}

export function sbForBb(bb: number): number {
  return Math.round(bb / 2); // BB é múltiplo de 2×minChip, então SB é limpo
}

// Gera um nível para inserir manualmente entre dois níveis (ou após o último).
export function novoNivelEntre(
  cur: BlindLevel,
  next: BlindLevel | undefined,
  chip: number
): { small_blind: number; big_blind: number } {
  let bb = next
    ? quantizeBlind((cur.big_blind + next.big_blind) / 2, chip)
    : quantizeBlind(cur.big_blind * 1.4, chip);
  if (bb <= cur.big_blind) bb = quantizeBlind(cur.big_blind + bandStep(cur.big_blind, chip), chip);
  return { small_blind: sbForBb(bb), big_blind: bb };
}

// Adiciona um nível após `afterLevelNumber` e RE-PROJETA toda a cauda:
// mantém os níveis até o clicado, e recalcula os seguintes como uma nova
// progressão geométrica (com +1 nível) até o mesmo BB final. Assim o torneio
// ganha um nível de duração e a curva continua suave até o encerramento.
export function inserirNivelContinuando(
  levels: BlindLevel[],
  afterLevelNumber: number,
  chip: number
): BlindLevel[] {
  const i = levels.findIndex((l) => l.nivel === afterLevelNumber);
  if (i < 0) return levels;

  const kept = levels.slice(0, i + 1).map((l) => ({ ...l }));
  const startBB = kept[kept.length - 1].big_blind;
  const tail = levels.slice(i + 1);
  const finalBB = tail.length ? tail[tail.length - 1].big_blind : quantizeBlind(startBB * 1.5, chip);
  const newCount = tail.length + 1; // um nível a mais que antes
  const ratio = finalBB > startBB ? Math.pow(finalBB / startBB, 1 / newCount) : 1;

  const rebuilt: BlindLevel[] = [];
  let prev = startBB;
  for (let k = 1; k <= newCount; k++) {
    let bb = quantizeBlind(startBB * Math.pow(ratio, k), chip);
    if (bb <= prev) bb = quantizeBlind(prev + bandStep(prev, chip), chip);
    if (bb <= prev) bb = prev + bandStep(prev, chip);
    prev = bb;
    rebuilt.push({ nivel: 0, small_blind: sbForBb(bb), big_blind: bb });
  }

  return [...kept, ...rebuilt].map((l, idx) => ({ ...l, nivel: idx + 1 }));
}

// ── Cálculo de Curva e Recálculo (Feedback Loop) ────────────────────────
export function calcularCurvaBlinds(p: CurveParams): CurveResult {
  const chip = Math.max(1, p.smallest_chip || DEFAULTS.smallest_chip);
  const initial_bb = Math.max(chip * 2, p.initial_bb || DEFAULTS.initial_bb);
  const ratio = p.end_bb_ratio || DEFAULTS.end_bb_ratio;
  const dur = Math.max(1, p.duracao_bloco_nivel || 1);

  const c_total =
    Math.max(1, p.qnt_entradas_primarias) * p.valor_fichas_inicial +
    p.qnt_acumulada_rebuys * p.fichas_por_rebuy +
    p.qnt_acumulada_addons * p.fichas_por_addon;

  const alvo_big_blind = c_total * ratio;
  const qnt_niveis_projetados = Math.max(
    2,
    Math.round((p.target_time_minutos || dur) / dur)
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
      bb = quantizeBlind(anterior + bandStep(anterior, chip), chip);
      if (bb <= anterior) bb = anterior + bandStep(anterior, chip);
    }

    anterior = bb;
    niveis.push({ nivel: i + 1, small_blind: sbForBb(bb), big_blind: bb });
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

// ── Cronograma (níveis + intervalos + ante + late check-in) ──────────────
export interface BreakConfig {
  after_level: number; // intervalo inserido depois deste nível
  minutes: number;
}

export interface ScheduleParams {
  level_duration_minutes: number;
  late_checkin_level: number; // late check-in fecha ao fim deste nível
  ante_enabled: boolean;      // BB paga dobrado (ante = BB) a partir do late check-in
  breaks: BreakConfig[];
}

export interface ScheduleLevel {
  kind: 'level';
  level: number;
  small_blind: number;
  big_blind: number;
  ante: number;
  duration_seconds: number;
  is_late_checkin: boolean; // último nível com late check-in aberto
}

export interface ScheduleBreak {
  kind: 'break';
  label: string;
  duration_seconds: number;
}

export type ScheduleItem = ScheduleLevel | ScheduleBreak;

export function buildSchedule(niveis: BlindLevel[], sp: ScheduleParams): ScheduleItem[] {
  const dur = Math.round(Math.max(1, sp.level_duration_minutes) * 60);
  const items: ScheduleItem[] = [];
  for (const n of niveis) {
    // Ante explícito (estrutura fixa) tem prioridade; senão, calcula pelo late check-in.
    const ante = n.ante != null
      ? n.ante
      : (sp.ante_enabled && n.nivel >= sp.late_checkin_level ? n.big_blind : 0);
    items.push({
      kind: 'level',
      level: n.nivel,
      small_blind: n.small_blind,
      big_blind: n.big_blind,
      ante,
      duration_seconds: dur,
      is_late_checkin: n.nivel === sp.late_checkin_level,
    });
    const brk = sp.breaks.find((b) => b.after_level === n.nivel && b.minutes > 0);
    if (brk) {
      items.push({
        kind: 'break',
        label: 'Intervalo',
        duration_seconds: Math.round(brk.minutes * 60),
      });
    }
  }
  return items;
}
