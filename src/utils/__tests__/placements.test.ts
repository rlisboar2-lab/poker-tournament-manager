// src/utils/__tests__/placements.test.ts
import { describe, it, expect } from 'vitest';
import { applyElimination, renumberPlacements, type PlacementEntry } from '../placements';

interface P extends PlacementEntry { name: string }

const POOL = 1000;
const PCT = [0.5, 0.3, 0.2];

const jogadores = (n: number): P[] =>
  Array.from({ length: n }, (_, i) => ({ name: String.fromCharCode(65 + i) }));

/** Elimina, em sequência, os jogadores nomeados. */
function eliminarEmOrdem(list: P[], nomes: string[]): P[] {
  let cur = list;
  for (const nome of nomes) {
    cur = applyElimination(cur, cur.findIndex((e) => e.name === nome), true, POOL, PCT);
  }
  return cur;
}

const colocacao = (list: P[], nome: string) =>
  list.find((e) => e.name === nome)?.final_placement;

describe('renumberPlacements', () => {
  it('não dá colocação a ninguém enquanto há mais de um ativo', () => {
    const out = renumberPlacements(jogadores(5), POOL, PCT);
    expect(out.every((e) => e.final_placement === undefined)).toBe(true);
  });

  it('quem cai primeiro fica em último', () => {
    const out = eliminarEmOrdem(jogadores(5), ['A', 'B']);
    expect(colocacao(out, 'A')).toBe(5);
    expect(colocacao(out, 'B')).toBe(4);
    expect(colocacao(out, 'C')).toBeUndefined();
  });

  it('o último de pé é o campeão e recebe o 1º prêmio', () => {
    const out = eliminarEmOrdem(jogadores(5), ['A', 'B', 'C', 'D']);
    expect(colocacao(out, 'E')).toBe(1);
    expect(out.find((e) => e.name === 'E')?.payout_amount).toBe(POOL * PCT[0]);
    expect(colocacao(out, 'D')).toBe(2);
    expect(colocacao(out, 'A')).toBe(5);
  });

  it('reviver o último eliminado devolve as colocações ao estado anterior', () => {
    const out = eliminarEmOrdem(jogadores(5), ['A', 'B']);
    const revivido = applyElimination(out, out.findIndex((e) => e.name === 'B'), false, POOL, PCT);
    expect(colocacao(revivido, 'B')).toBeUndefined();
    expect(colocacao(revivido, 'A')).toBe(5); // inalterado
  });

  it('reviver alguém do meio corrige a colocação de quem caiu antes dele', () => {
    // A(5) B(4) C(3) fora; revive B → C passa a 4 e A segue em 5.
    const out = eliminarEmOrdem(jogadores(5), ['A', 'B', 'C']);
    expect([colocacao(out, 'A'), colocacao(out, 'B'), colocacao(out, 'C')]).toEqual([5, 4, 3]);
    const revivido = applyElimination(out, out.findIndex((e) => e.name === 'B'), false, POOL, PCT);
    expect(colocacao(revivido, 'B')).toBeUndefined();
    expect(colocacao(revivido, 'C')).toBe(4);
    expect(colocacao(revivido, 'A')).toBe(5);
  });

  it('reviver o primeiro eliminado renumera todos os demais', () => {
    // A(5) B(4) fora; revive A → B, único fora de 5, é o 5º.
    const out = eliminarEmOrdem(jogadores(5), ['A', 'B']);
    const revivido = applyElimination(out, out.findIndex((e) => e.name === 'A'), false, POOL, PCT);
    expect(colocacao(revivido, 'A')).toBeUndefined();
    expect(colocacao(revivido, 'B')).toBe(5);
  });

  it('reviver o campeão tira o 1º lugar e o prêmio dele', () => {
    const out = eliminarEmOrdem(jogadores(3), ['A', 'B']);
    expect(colocacao(out, 'C')).toBe(1);
    const revivido = applyElimination(out, out.findIndex((e) => e.name === 'B'), false, POOL, PCT);
    expect(colocacao(revivido, 'C')).toBeUndefined();
    expect(revivido.find((e) => e.name === 'C')?.payout_amount).toBeUndefined();
    expect(colocacao(revivido, 'A')).toBe(3);
  });

  it('as colocações são sempre um bloco contíguo terminando no total', () => {
    const out = eliminarEmOrdem(jogadores(6), ['A', 'B', 'C']);
    const fora = out.filter((e) => e.eliminated).map((e) => e.final_placement).sort();
    expect(fora).toEqual([4, 5, 6]);
  });

  it('eliminar limpa mesa e assento', () => {
    const list = [{ name: 'A', table: 1, seat: 3 }, { name: 'B', table: 1, seat: 4 }];
    const out = applyElimination(list, 0, true, POOL, PCT);
    expect(out[0].table).toBeUndefined();
    expect(out[0].seat).toBeUndefined();
  });

  it('prêmio acompanha a colocação renumerada', () => {
    const out = eliminarEmOrdem(jogadores(3), ['A']);
    expect(out.find((e) => e.name === 'A')?.payout_amount).toBe(POOL * PCT[2]); // 3º
    const revivido = applyElimination(out, out.findIndex((e) => e.name === 'A'), false, POOL, PCT);
    expect(revivido.find((e) => e.name === 'A')?.payout_amount).toBeUndefined();
  });

  it('não muta a lista original', () => {
    const list = jogadores(3);
    applyElimination(list, 0, true, POOL, PCT);
    expect(list[0].eliminated).toBeUndefined();
  });
});
