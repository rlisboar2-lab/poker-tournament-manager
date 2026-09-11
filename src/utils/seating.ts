// src/utils/seating.ts
// Distribuição de jogadores em mesas (máx. 9 por mesa) com assentos aleatórios.
import type { LocalEntry } from '../services/tournaments';

export const MAX_PER_TABLE = 9;

export function tableCountFor(activeCount: number): number {
  return Math.max(1, Math.ceil(activeCount / MAX_PER_TABLE));
}

// Chave de comparação de nomes: case- e acento-insensível, espaços colapsados.
// Dois "José" digitados de jeitos diferentes são o MESMO jogador (REDESIGN.md S17).
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

// Nome já presente no torneio — inclusive eliminados: o caminho de quem já
// entrou é o Rebuy, nunca um cadastro novo.
export function hasPlayerNamed(entries: LocalEntry[], name: string): boolean {
  const k = nameKey(name);
  return entries.some((e) => nameKey(e.name) === k);
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

// Acomoda o ativo em `index` (recém-adicionado ou recém-revivido por rebuy):
// se a quebra de mesa muda a contagem de mesas (ex.: 9 -> 10), redistribui
// tudo; senão preenche a mesa mais vazia.
export function seatEntry(entries: LocalEntry[], index: number): LocalEntry[] {
  const alvo = entries[index];
  if (!alvo || alvo.eliminated) return entries;

  const others = entries.filter((_, i) => i !== index);
  const beforeActive = others.filter((e) => !e.eliminated).length;
  const afterActive = beforeActive + 1;

  if (!someSeated(others) || tableCountFor(afterActive) !== tableCountFor(beforeActive)) {
    return rebalanceSeating(entries);
  }

  const tables = tableCountFor(afterActive);
  const counts = new Array(tables).fill(0);
  others.forEach((e) => {
    if (!e.eliminated && e.table && e.table <= tables) counts[e.table - 1] += 1;
  });
  let target = 0;
  for (let i = 1; i < tables; i++) if (counts[i] < counts[target]) target = i;
  // Assentos vagos por eliminação não são renumerados: contar ativos daria um
  // número já ocupado. Pega o menor assento livre da mesa (1..MAX_PER_TABLE).
  const seat = firstFreeSeat(others, target + 1);
  return entries.map((e, i) => (i === index ? { ...e, table: target + 1, seat } : e));
}

// Adiciona um jogador e o acomoda. Nome já presente devolve a lista intacta —
// a guarda visível fica no chamador (REDESIGN.md S17); aqui ela só garante que
// nenhum caminho crie duplicata silenciosa.
export function addAndSeat(entries: LocalEntry[], name: string): LocalEntry[] {
  const nome = name.trim();
  if (!nome || hasPlayerNamed(entries, nome)) return entries;
  const next: LocalEntry[] = [...entries, { name: nome, buyins: 1, rebuys: 0, addons: 0 }];
  return seatEntry(next, next.length - 1);
}

// Menor assento não ocupado por um ativo na mesa. Se os MAX_PER_TABLE assentos
// estiverem tomados (não deveria ocorrer: a quebra de mesa cai no rebalance),
// devolve o maior ocupado + 1 para nunca duplicar.
function firstFreeSeat(entries: LocalEntry[], table: number): number {
  const taken = new Set<number>();
  for (const e of entries) {
    if (!e.eliminated && e.table === table && e.seat) taken.add(e.seat);
  }
  for (let s = 1; s <= MAX_PER_TABLE; s++) if (!taken.has(s)) return s;
  return Math.max(0, ...taken) + 1;
}
