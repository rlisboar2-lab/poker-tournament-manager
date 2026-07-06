// src/presets.ts
// Estruturas prontas de torneio (editáveis depois de aplicadas).
import type { AppConfig } from './App';
import type { BlindLevel } from './utils/poker-math';

export interface Preset {
  config: AppConfig;
  manualLevels: BlindLevel[] | null; // null = usar a curva geométrica (Personalizado)
  payoutPct?: number[];
}

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// FREEPLAY 1K GTD (Clube Quadra) — SB/BB/ANTE explícitos por nível.
const QUADRA_LEVELS: BlindLevel[] = [
  { nivel: 1, small_blind: 100, big_blind: 300, ante: 300 },
  { nivel: 2, small_blind: 200, big_blind: 400, ante: 400 },
  { nivel: 3, small_blind: 200, big_blind: 500, ante: 500 },
  { nivel: 4, small_blind: 300, big_blind: 600, ante: 600 },
  { nivel: 5, small_blind: 400, big_blind: 800, ante: 800 },
  { nivel: 6, small_blind: 500, big_blind: 1000, ante: 1000 },
  { nivel: 7, small_blind: 500, big_blind: 1500, ante: 1500 },
  { nivel: 8, small_blind: 1000, big_blind: 1500, ante: 1500 },
  { nivel: 9, small_blind: 1000, big_blind: 2000, ante: 2000 },
  { nivel: 10, small_blind: 1000, big_blind: 2500, ante: 2500 },
  { nivel: 11, small_blind: 1000, big_blind: 3000, ante: 3000 },
  { nivel: 12, small_blind: 2000, big_blind: 4000, ante: 4000 },
  { nivel: 13, small_blind: 3000, big_blind: 6000, ante: 6000 },
  { nivel: 14, small_blind: 4000, big_blind: 8000, ante: 8000 },
  { nivel: 15, small_blind: 5000, big_blind: 10000, ante: 10000 },
  { nivel: 16, small_blind: 6000, big_blind: 12000, ante: 12000 },
  { nivel: 17, small_blind: 8000, big_blind: 16000, ante: 16000 },
  { nivel: 18, small_blind: 10000, big_blind: 20000, ante: 20000 },
  { nivel: 19, small_blind: 10000, big_blind: 25000, ante: 25000 },
  { nivel: 20, small_blind: 15000, big_blind: 30000, ante: 30000 },
  { nivel: 21, small_blind: 20000, big_blind: 40000, ante: 40000 },
  { nivel: 22, small_blind: 25000, big_blind: 50000, ante: 50000 },
  { nivel: 23, small_blind: 30000, big_blind: 60000, ante: 60000 },
  { nivel: 24, small_blind: 40000, big_blind: 80000, ante: 80000 },
  { nivel: 25, small_blind: 50000, big_blind: 100000, ante: 100000 },
];

export function quadraPreset(): Preset {
  const setup = { smallest_chip: 25, initial_sb: 50, initial_bb: 100, stack_bb: 100 }; // stack 10.000
  return {
    config: {
      name: 'FREEPLAY 1K GTD',
      start_time: nowLocal(),
      setup,
      target_time_minutos: 500,
      duracao_bloco_nivel: 20,
      buy_in_value: 0,          // FREE
      rebuy_value: 20,          // reentrada
      addon_value: 30,
      chips_per_rebuy: 20000,
      chips_per_addon: 75000,
      max_rebuys: 0,            // ilimitada
      addon_enabled: true,
      late_checkin_level: 10,   // fim do registro após o nível 10
      ante_enabled: true,
      breaks: [
        { after_level: 5, minutes: 10 },
        { after_level: 10, minutes: 20 },
        { after_level: 17, minutes: 10 },
      ],
    },
    manualLevels: QUADRA_LEVELS.map((l) => ({ ...l })),
    payoutPct: [0.5, 0.3, 0.2],
  };
}
