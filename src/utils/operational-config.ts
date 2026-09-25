// src/utils/operational-config.ts
// Tradução pura da configuração do Setup para o torneio persistente (fluxo 2).
// Sem Supabase nem React: testável isoladamente.

import type { OfferInput, Participant, FinishResult } from '../services/operational';
import type { LocalEntry } from '../services/tournaments';
import type { PixKeyType } from '../types/database';

export interface PixConfig {
  pix_key_type: PixKeyType;
  pix_key: string;
  receiver_name: string;
  instructions: string;
}

export const emptyPix = (): PixConfig => ({ pix_key_type: 'random', pix_key: '', receiver_name: '', instructions: '' });

/** Campos da config que definem as ofertas. Espelha o subconjunto de `AppConfig`. */
export interface OfferConfig {
  buy_in_value: number;
  rebuy_value: number;
  addon_value: number;
  chips_per_rebuy: number;
  chips_per_addon: number;
  max_rebuys: number; // 0 = sem limite
  addon_enabled: boolean;
  /** Pacote de 2 rebuys de uma vez; 0 = não oferece. */
  double_rebuy_value?: number;
}

// O banco aceita no máximo 20 contagens por oferta (purchase_offers_eligible_chk).
// "Sem limite" vira 20 rebuys por jogador — acima disso o admin reconfigura.
export const UNLIMITED_REBUY_CAP = 20;

export function buildOffers(c: OfferConfig, initialStackChips: number): OfferInput[] {
  const offers: OfferInput[] = [
    { kind: 'buyin', name: 'Buy-in', price: c.buy_in_value, chips_granted: initialStackChips, eligible_after_units: [0], max_uses: 1 },
  ];
  const cap = c.max_rebuys > 0 ? Math.min(c.max_rebuys, UNLIMITED_REBUY_CAP) : UNLIMITED_REBUY_CAP;
  if (c.max_rebuys > 0) {
    for (let i = 0; i < cap; i++) {
      offers.push({
        kind: 'rebuy', name: `${i + 1}º rebuy`, price: c.rebuy_value, chips_granted: c.chips_per_rebuy,
        rebuy_units: 1, eligible_after_units: [i], max_uses: 1,
      });
    }
  } else {
    offers.push({
      kind: 'rebuy', name: 'Rebuy', price: c.rebuy_value, chips_granted: c.chips_per_rebuy,
      rebuy_units: 1, eligible_after_units: Array.from({ length: cap }, (_, i) => i), max_uses: null,
    });
  }
  // Duplo: duas unidades de uma vez, só valendo com zero usadas (plano, tabela de ofertas).
  if ((c.double_rebuy_value ?? 0) > 0 && cap >= 2) {
    offers.push({
      kind: 'rebuy', name: 'Rebuy duplo', price: c.double_rebuy_value as number, chips_granted: c.chips_per_rebuy * 2,
      rebuy_units: 2, eligible_after_units: [0], max_uses: 1,
    });
  }
  if (c.addon_enabled) {
    offers.push({ kind: 'addon', name: 'Add-on', price: c.addon_value, chips_granted: c.chips_per_addon, eligible_after_units: [0], max_uses: 1 });
  }
  return offers.map((o, i) => ({ ...o, sort_order: i + 1 }));
}

/** Motivos que impedem criar o torneio persistente; vazio = pode criar. */
export function validatePix(p: PixConfig): string[] {
  const out: string[] = [];
  const key = p.pix_key.trim();
  if (!key) out.push('Informe a chave PIX.');
  else if (key.length > 140) out.push('Chave PIX com mais de 140 caracteres.');
  const name = p.receiver_name.trim();
  if (!name) out.push('Informe o nome de quem recebe.');
  else if (name.length > 100) out.push('Nome do recebedor com mais de 100 caracteres.');
  if (p.instructions.length > 500) out.push('Instruções com mais de 500 caracteres.');
  return out;
}

const norm = (s: string) => s.trim().toLocaleLowerCase('pt-BR');

/**
 * Colocação/prêmio locais → resultados por participant_id. Casamento pelo nome
 * exibido (único em sub_players). Devolve quem não casou para o chamador avisar,
 * em vez de mandar um resultado parcial em silêncio.
 */
export function buildFinishResults(
  entries: LocalEntry[],
  participants: Participant[],
): { results: FinishResult[]; unmatched: string[] } {
  const byName = new Map(
    participants.filter((p) => p.status === 'active' || p.status === 'eliminated').map((p) => [norm(p.display_name), p]),
  );
  const results: FinishResult[] = [];
  const unmatched: string[] = [];
  for (const e of entries) {
    const p = byName.get(norm(e.name));
    if (!p) { unmatched.push(e.name); continue; }
    results.push({
      participant_id: p.id,
      ...(e.final_placement ? { final_placement: e.final_placement } : {}),
      ...(e.payout_amount ? { payout_amount: e.payout_amount } : {}),
    });
  }
  return { results, unmatched };
}
