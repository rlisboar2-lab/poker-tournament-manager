// src/utils/seating.ts
// Distribuição de jogadores em mesas (máx. 9 por mesa) com assentos aleatórios.
import type { LocalEntry } from '../services/tournaments';

export const MAX_PER_TABLE = 9;

export function tableCountFor(activeCount: number): number {
  return Math.max(1, Math.ceil(activeCount / MAX_PER_TABLE));
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Redistribui TODOS os ativos em mesas equilibradas, com assentos aleatórios.
export function rebalanceSeating(entries: LocalEntry[]): LocalEntry[] {
  const active = entries.filter((e) => !e.eliminated);
  const tables = tableCountFor(active.length);
  const order = shuffle(active);
  const seatCounter = new Array(tables).fill(0);
  const assign = new Map<LocalEntry, { table: number; seat: number }>();
  order.forEach((e, i) => {
    const t = i % tables;
    seatCounter[t] += 1;
    assign.set(e, { table: t + 1, seat: seatCounter[t] });
  });
  return entries.map((e) => {
    if (e.eliminated) return { ...e, table: undefined, seat: undefined };
    const a = assign.get(e);
    return a ? { ...e, table: a.table, seat: a.seat } : e;
  });
}

const someSeated = (entries: LocalEntry[]) =>
  entries.some((e) => !e.eliminated && e.table);

// Adiciona um jogador e o acomoda: se a quebra de mesa muda a contagem de
// mesas (ex.: 9 -> 10), redistribui tudo; senão preenche a mesa mais vazia.
export function addAndSeat(entries: LocalEntry[], name: string): LocalEntry[] {
  const beforeActive = entries.filter((e) => !e.eliminated).length;
  const next: LocalEntry[] = [...entries, { name, buyins: 1, rebuys: 0, addons: 0 }];
  const afterActive = beforeActive + 1;

  if (!someSeated(entries) || tableCountFor(afterActive) !== tableCountFor(beforeActive)) {
    return rebalanceSeating(next);
  }

  const tables = tableCountFor(afterActive);
  const counts = new Array(tables).fill(0);
  next.forEach((e) => {
    if (!e.eliminated && e.table && e.table <= tables) counts[e.table - 1] += 1;
  });
  // remove o recém-adicionado da contagem (ele ainda não tem mesa)
  let target = 0;
  for (let i = 1; i < tables; i++) if (counts[i] < counts[target]) target = i;
  const seat = counts[target]; // já inclui contagens; novo assento = atual+1 menos o próprio
  const idx = next.length - 1;
  return next.map((e, i) => (i === idx ? { ...e, table: target + 1, seat: seat + 1 } : e));
}
