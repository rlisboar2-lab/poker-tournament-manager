// src/utils/__tests__/seating.test.ts
// Integridade do cadastro ao vivo (REDESIGN.md S17): guarda antiduplicata e
// reentrada de eliminado pelo rebuy.
import { describe, it, expect } from 'vitest';
import { addAndSeat, hasPlayerNamed, nameKey, seatEntry, MAX_PER_TABLE } from '../seating';
import { applyElimination } from '../placements';
import type { LocalEntry } from '../../services/tournaments';

const POOL = 1000;
const PCT = [0.5, 0.3, 0.2];

const mesa = (nomes: string[]): LocalEntry[] =>
  nomes.reduce<LocalEntry[]>((acc, n) => addAndSeat(acc, n), []);

const acha = (list: LocalEntry[], nome: string) => list.find((e) => e.name === nome)!;
const idx = (list: LocalEntry[], nome: string) => list.findIndex((e) => e.name === nome);

describe('nameKey / hasPlayerNamed', () => {
  it('ignora caixa, acento e espaços extras', () => {
    expect(nameKey('  José   da Silva ')).toBe(nameKey('jose da silva'));
    expect(nameKey('ANA')).toBe(nameKey('Ana'));
  });

  it('enxerga também quem já foi eliminado', () => {
    const eliminado: LocalEntry[] = [
      { name: 'Ana', buyins: 1, rebuys: 0, addons: 0, eliminated: true },
    ];
    expect(hasPlayerNamed(eliminado, 'ana')).toBe(true);
  });
});

describe('addAndSeat — guarda antiduplicata', () => {
  it('rejeita nome repetido com diferença de caixa ou acento', () => {
    const list = mesa(['José', 'Bia']);
    expect(addAndSeat(list, 'jose')).toBe(list);
    expect(addAndSeat(list, 'JOSE ')).toBe(list);
    expect(addAndSeat(list, 'bia')).toBe(list);
    expect(list).toHaveLength(2);
  });

  it('rejeita nome de jogador eliminado', () => {
    const list = applyElimination(mesa(['Ana', 'Bia', 'Caio']), 0, true, POOL, PCT);
    expect(addAndSeat(list, 'ANA')).toBe(list);
  });

  it('aceita nome novo e o acomoda numa mesa', () => {
    const list = addAndSeat(mesa(['Ana', 'Bia']), 'Caio');
    expect(list).toHaveLength(3);
    expect(acha(list, 'Caio').table).toBeGreaterThanOrEqual(1);
    expect(acha(list, 'Caio').seat).toBeGreaterThanOrEqual(1);
  });

  it('rebalanceia quando a quebra de mesa muda a contagem', () => {
    const cheia = mesa(Array.from({ length: MAX_PER_TABLE }, (_, i) => `P${i}`));
    expect(new Set(cheia.map((e) => e.table)).size).toBe(1);
    const dez = addAndSeat(cheia, 'P9');
    expect(new Set(dez.map((e) => e.table)).size).toBe(2);
  });
});

describe('reentrada de eliminado (rebuy)', () => {
  // Fluxo do App: rebuys + 1, applyElimination(false), seatEntry de volta.
  const reentrar = (list: LocalEntry[], nome: string): LocalEntry[] => {
    const i = idx(list, nome);
    const bumped = list.map((e, j) => (j === i ? { ...e, rebuys: e.rebuys + 1 } : e));
    return seatEntry(applyElimination(bumped, i, false, POOL, PCT), i);
  };

  it('devolve o jogador à mesa e renumera quem caiu antes', () => {
    let list = mesa(['Ana', 'Bia', 'Caio', 'Duda']);
    list = applyElimination(list, idx(list, 'Ana'), true, POOL, PCT);  // 4º
    list = applyElimination(list, idx(list, 'Bia'), true, POOL, PCT);  // 3º
    expect(acha(list, 'Ana').final_placement).toBe(4);
    expect(acha(list, 'Bia').final_placement).toBe(3);

    list = reentrar(list, 'Bia');
    const bia = acha(list, 'Bia');
    expect(bia.eliminated).toBe(false);
    expect(bia.rebuys).toBe(1);
    expect(bia.table).toBeGreaterThanOrEqual(1);
    expect(bia.seat).toBeGreaterThanOrEqual(1);
    expect(bia.final_placement).toBeUndefined();
    // Ana era 4ª com 4 jogadores; com a Bia de volta ela volta a ser 4ª — mas
    // se estivesse sozinha entre eliminados a renumeração a puxaria para cima.
    expect(acha(list, 'Ana').final_placement).toBe(4);
  });

  it('renumera para cima quem caiu depois do que voltou', () => {
    let list = mesa(['Ana', 'Bia', 'Caio']);
    list = applyElimination(list, idx(list, 'Ana'), true, POOL, PCT);  // 3º
    list = applyElimination(list, idx(list, 'Bia'), true, POOL, PCT);  // 2º
    // Sobrou só o Caio: ele é campeão enquanto ninguém volta.
    expect(acha(list, 'Caio').final_placement).toBe(1);

    list = reentrar(list, 'Ana');
    expect(acha(list, 'Caio').final_placement).toBeUndefined();
    expect(acha(list, 'Bia').final_placement).toBe(3);
    expect(acha(list, 'Ana').eliminated).toBe(false);
  });

  it('não dá assento a quem segue eliminado', () => {
    let list = mesa(['Ana', 'Bia', 'Caio']);
    list = applyElimination(list, idx(list, 'Ana'), true, POOL, PCT);
    const igual = seatEntry(list, idx(list, 'Ana'));
    expect(igual).toBe(list);
    expect(acha(list, 'Ana').table).toBeUndefined();
  });
});

describe('elegibilidade ao rebuy', () => {
  // Mesma expressão do LiveActions: limite de rebuys, independente de eliminated.
  const elegiveis = (list: LocalEntry[], maxRebuys: number) =>
    list.filter((e) => maxRebuys <= 0 || e.rebuys < maxRebuys).map((e) => e.name);

  it('inclui eliminado que ainda não atingiu o limite', () => {
    const list = applyElimination(mesa(['Ana', 'Bia']), 0, true, POOL, PCT);
    expect(elegiveis(list, 1)).toContain('Ana');
  });

  it('exclui quem já atingiu max_rebuys, vivo ou eliminado', () => {
    const list: LocalEntry[] = [
      { name: 'Ana', buyins: 1, rebuys: 1, addons: 0, eliminated: true },
      { name: 'Bia', buyins: 1, rebuys: 1, addons: 0 },
      { name: 'Caio', buyins: 1, rebuys: 0, addons: 0 },
    ];
    expect(elegiveis(list, 1)).toEqual(['Caio']);
    expect(elegiveis(list, 0)).toEqual(['Ana', 'Bia', 'Caio']); // 0 = ilimitado
  });
});
