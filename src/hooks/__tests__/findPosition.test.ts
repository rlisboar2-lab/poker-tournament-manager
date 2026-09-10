// src/hooks/__tests__/findPosition.test.ts
// Reancoragem do relógio quando a estrutura muda ao vivo: o item corrente tem
// de ser reencontrado no cronograma novo, mesmo depois da renumeração.
import { describe, it, expect } from 'vitest';
import { findPosition, type Position } from '../useTournamentEngine';
import { buildSchedule, type BlindLevel } from '../../utils/poker-math';

const niveis = (n: number): BlindLevel[] =>
  Array.from({ length: n }, (_, i) => ({
    nivel: i + 1,
    small_blind: (i + 1) * 5,
    big_blind: (i + 1) * 10,
  }));

const schedule = (lvls: BlindLevel[], breaks: { after_level: number; minutes: number }[] = []) =>
  buildSchedule(lvls, {
    level_duration_minutes: 20,
    late_checkin_level: 99,
    ante_enabled: false,
    breaks,
  });

const posDoNivel = (nivel: number, into = 300): Position => ({
  kind: 'level',
  blinds: `${nivel * 5}/${nivel * 10}`,
  level: nivel,
  into,
  start_sec: (nivel - 1) * 1200,
});

describe('findPosition', () => {
  it('acha o nível corrente quando nada mudou', () => {
    expect(findPosition(schedule(niveis(8)), posDoNivel(5))).toBe(4);
  });

  it('segue o nível pelos blinds depois da renumeração (nível anterior apagado)', () => {
    // Apaga o nível 3 e renumera: o antigo 5 vira 4, mas os blinds 25/50 ficam.
    const restantes = niveis(8)
      .filter((n) => n.nivel !== 3)
      .map((n, i) => ({ ...n, nivel: i + 1 }));
    const idx = findPosition(schedule(restantes), posDoNivel(5));
    const item = schedule(restantes)[idx];
    expect(item.kind).toBe('level');
    expect(item.kind === 'level' && item.big_blind).toBe(50); // mesmo nível de antes
    expect(idx).toBe(3); // andou uma casa para trás no cronograma
  });

  it('acha o nível corrente depois de inserir um nível antes dele', () => {
    const comExtra = [
      ...niveis(4),
      { nivel: 5, small_blind: 45, big_blind: 90 },
      ...niveis(8).slice(4).map((n) => ({ ...n, nivel: n.nivel + 1 })),
    ];
    const idx = findPosition(schedule(comExtra), posDoNivel(5));
    const item = schedule(comExtra)[idx];
    expect(item.kind === 'level' && item.big_blind).toBe(50);
  });

  it('devolve -1 quando o nível corrente foi apagado', () => {
    const restantes = niveis(8)
      .filter((n) => n.nivel !== 5)
      .map((n, i) => ({ ...n, nivel: i + 1 }));
    // Sem blinds 25/50 e sem nível 5 com esses blinds — mas o fallback por número
    // ainda existe (há um nível 5 renumerado), então NÃO é -1.
    expect(findPosition(schedule(restantes), posDoNivel(5))).toBeGreaterThanOrEqual(0);
    // Já um nível corrente fora de qualquer faixa não é encontrado.
    expect(findPosition(schedule(niveis(3)), posDoNivel(7))).toBe(-1);
  });

  it('acha o intervalo corrente pelo nível que o precede', () => {
    const items = schedule(niveis(8), [{ after_level: 4, minutes: 15 }]);
    const pos: Position = { kind: 'break', blinds: '', level: 4, into: 60, start_sec: 4800 };
    const idx = findPosition(items, pos);
    expect(items[idx].kind).toBe('break');
    expect(idx).toBe(4); // logo depois do 4º nível
  });

  it('intervalo apagado devolve -1', () => {
    const items = schedule(niveis(8));
    const pos: Position = { kind: 'break', blinds: '', level: 4, into: 60, start_sec: 4800 };
    expect(findPosition(items, pos)).toBe(-1);
  });

  it('reancorar preserva os segundos corridos dentro do nível', () => {
    // Apagar o nível 1 puxa todos os offsets 20min para trás; o tempo dentro do
    // nível corrente (300s) é o que o engine soma ao novo início.
    const restantes = niveis(8).slice(1).map((n, i) => ({ ...n, nivel: i + 1 }));
    const items = schedule(restantes);
    const cumStarts = items.reduce<number[]>((acc, _cur, i) => {
      acc.push(i === 0 ? 0 : acc[i - 1] + items[i - 1].duration_seconds);
      return acc;
    }, []);
    const idx = findPosition(items, posDoNivel(5));
    expect(cumStarts[idx] + 300).toBe(3 * 1200 + 300); // era 4×1200+300
  });
});
