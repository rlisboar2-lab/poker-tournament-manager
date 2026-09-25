// src/utils/ledger.ts
// Dinheiro e fichas do torneio persistente (fluxo 2) a partir dos lançamentos
// confirmados no banco: `amount`, `rebuy_units` e `chips_granted`. Nada de
// quantidade × preço da config — um rebuy duplo é uma compra de R$ 35 com duas
// unidades, não 2 × rebuy_value. O fluxo legado continua em `legacyInvested`.

import type { LocalEntry } from '../services/tournaments';
import type { OperationalSnapshot } from '../services/operational';
import type { PurchaseKind } from '../types/database';
import { brl } from './format';
import { nameKey } from './seating';

export interface Purchase {
  kind: PurchaseKind;
  name: string;
  amount: number;
  rebuy_units: number;
  chips: number;
}

export interface PlayerLedger {
  invested: number;
  chips: number;
  purchases: Purchase[];
}

export interface Ledger {
  pool: number;
  chips: Record<PurchaseKind, number>;
  /** Por nameKey(display_name): as entradas locais do fluxo 2 nascem desse nome. */
  byName: Map<string, PlayerLedger>;
}

// Soma em centavos: 0.1 + 0.2 não pode virar prêmio de R$ 0,30000000000000004.
const cents = (n: number) => Math.round(n * 100);

const KIND_NAME: Record<PurchaseKind, string> = { buyin: 'Buy-in', rebuy: 'Rebuy', addon: 'Add-on' };

/** Nome de pacote sem o nome da oferta (Histórico só tem o lançamento). */
export function packageName(kind: PurchaseKind, rebuyUnits: number): string {
  return kind === 'rebuy' && rebuyUnits > 1 ? `Rebuy ×${rebuyUnits}` : KIND_NAME[kind];
}

export function buildLedger(s: OperationalSnapshot): Ledger {
  const nameByPlayer = new Map(s.participants.map((p) => [p.player_id, p.display_name]));
  const offerByRequest = new Map(s.requests.map((r) => [r.id, r.offer_name]));
  const byName = new Map<string, PlayerLedger & { investedCents: number }>();
  const chips: Record<PurchaseKind, number> = { buyin: 0, rebuy: 0, addon: 0 };
  let poolCents = 0;

  for (const t of s.transactions) {
    const granted = t.chips_granted ?? 0;
    poolCents += cents(t.amount);
    chips[t.kind] += granted;
    const name = nameByPlayer.get(t.player_id);
    if (name == null) continue;
    const k = nameKey(name);
    const acc = byName.get(k) ?? { invested: 0, investedCents: 0, chips: 0, purchases: [] };
    acc.investedCents += cents(t.amount);
    acc.invested = acc.investedCents / 100;
    acc.chips += granted;
    acc.purchases.push({
      kind: t.kind,
      name: offerByRequest.get(t.request_id) ?? packageName(t.kind, t.rebuy_units),
      amount: t.amount,
      rebuy_units: t.rebuy_units,
      chips: granted,
    });
    byName.set(k, acc);
  }

  return {
    pool: poolCents / 100,
    chips,
    byName: new Map([...byName].map(([k, { invested, chips: c, purchases }]) => [k, { invested, chips: c, purchases }])),
  };
}

export const playerLedger = (l: Ledger, name: string): PlayerLedger | undefined => l.byName.get(nameKey(name));

/** "Buy-in R$ 10,00 · Rebuy duplo R$ 35,00" — uma linha por compra confirmada. */
export function describePurchases(purchases: Purchase[]): string {
  return purchases.map((p) => `${p.name} ${brl(p.amount)}`).join(' · ');
}

/**
 * Entradas do motor da curva. Ele só usa o produto quantidade × fichas; com
 * pacotes o total vem pronto, então vai como 1 × total de cada tipo.
 */
export function chipCurveInputs(l: Ledger) {
  return {
    qnt_entradas_primarias: 1,
    valor_fichas_inicial: l.chips.buyin,
    qnt_acumulada_rebuys: 1,
    fichas_por_rebuy: l.chips.rebuy,
    qnt_acumulada_addons: 1,
    fichas_por_addon: l.chips.addon,
  };
}

/** Fluxo legado (sem torneio persistente): contagem × preço da config, como sempre foi. */
export function legacyInvested(
  e: LocalEntry, prices: { buy_in_value: number; rebuy_value: number; addon_value: number },
): number {
  return e.buyins * prices.buy_in_value + e.rebuys * prices.rebuy_value + e.addons * prices.addon_value;
}
