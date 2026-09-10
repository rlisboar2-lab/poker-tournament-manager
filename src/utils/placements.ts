// src/utils/placements.ts
// Colocações derivam da ORDEM de eliminação: quem cai primeiro fica em último.
// Reviver um jogador muda a colocação de todos os que caíram antes dele, então
// a lista inteira é renumerada a cada eliminação/revivida — nunca só a linha
// que foi mexida.

export interface PlacementEntry {
  eliminated?: boolean;
  final_placement?: number;
  payout_amount?: number;
}

/**
 * Renumera colocações e prêmios de toda a lista.
 *
 * A própria colocação codifica a ordem de eliminação (menor = caiu depois).
 * Quem acabou de ser eliminado entra com a sentinela `0`, ordenando como o mais
 * recente. Sobrando um único jogador ativo, ele é o campeão (1º); com mais de um,
 * ninguém é 1º ainda.
 */
export function renumberPlacements<T extends PlacementEntry>(
  list: T[],
  prizePool: number,
  payoutPct: number[]
): T[] {
  const out = list.map((e) => ({ ...e }));
  const eliminados = out
    .filter((e) => e.eliminated)
    .sort((a, b) => (a.final_placement ?? 0) - (b.final_placement ?? 0));

  // O último a cair fica logo abaixo dos que seguem em jogo.
  let place = out.length - eliminados.length + 1;
  for (const e of eliminados) {
    e.final_placement = place;
    e.payout_amount = prizePool * (payoutPct[place - 1] ?? 0);
    place++;
  }

  const ativos = out.filter((e) => !e.eliminated);
  for (const e of ativos) {
    const campeao = ativos.length === 1;
    e.final_placement = campeao ? 1 : undefined;
    e.payout_amount = campeao ? prizePool * (payoutPct[0] ?? 0) : undefined;
  }
  return out;
}

/** Marca eliminado (sentinela 0 = o mais recente) ou revive, e renumera tudo. */
export function applyElimination<T extends PlacementEntry & { table?: number; seat?: number }>(
  list: T[],
  index: number,
  eliminate: boolean,
  prizePool: number,
  payoutPct: number[]
): T[] {
  const marked = list.map((e, i) => {
    if (i !== index) return e;
    return eliminate
      ? { ...e, eliminated: true, table: undefined, seat: undefined,
          final_placement: 0, payout_amount: undefined }
      : { ...e, eliminated: false, final_placement: undefined, payout_amount: undefined };
  });
  return renumberPlacements(marked, prizePool, payoutPct);
}
