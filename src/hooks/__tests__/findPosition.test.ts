// src/hooks/__tests__/findPosition.test.ts
// Reancoragem do relógio quando a estrutura muda ao vivo: o item corrente tem
// de ser reencontrado no cronograma novo, mesmo depois da renumeração.
import { describe, it, expect } from 'vitest';
import { findPosition, type Position } from '../useTournamentEngine';
import {
  buildSchedule,
  recalibrarCurva,
  type BlindLevel,
  type CurveParams,
} from '../../utils/poker-math';

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

// ── Piso da busca: recalibração não pode recuar o relógio ────────────────
describe('findPosition com piso (minIndex)', () => {
  it('nunca devolve índice menor que o piso, mesmo com blinds repetidos', () => {
    const repetidos: BlindLevel[] = [
      { nivel: 1, small_blind: 10, big_blind: 20 },
      { nivel: 2, small_blind: 20, big_blind: 40 },
      { nivel: 3, small_blind: 30, big_blind: 60 },
      { nivel: 4, small_blind: 20, big_blind: 40 }, // mesmo par do nível 2
      { nivel: 5, small_blind: 50, big_blind: 100 },
    ];
    const items = schedule(repetidos);
    const pos: Position = { kind: 'level', blinds: '20/40', level: 4, into: 120, start_sec: 3600 };
    expect(findPosition(items, pos)).toBe(1);        // sem piso: casa no primeiro
    expect(findPosition(items, pos, 3)).toBe(3);     // com piso: fica onde está
  });

  it('com piso, cai no número do nível quando os blinds mudaram', () => {
    const novos = niveis(8).map((n) => (n.nivel === 5 ? { ...n, small_blind: 60, big_blind: 120 } : n));
    // 25/50 não existe mais a partir do índice 4; o fallback por nº de nível pega o 5.
    expect(findPosition(schedule(novos), posDoNivel(5), 4)).toBe(4);
  });

  it('sem piso, segue achando o item renumerado (regressão da S1)', () => {
    const restantes = niveis(8)
      .filter((n) => n.nivel !== 3)
      .map((n, i) => ({ ...n, nivel: i + 1 }));
    expect(findPosition(schedule(restantes), posDoNivel(5))).toBe(3);
  });
});

// ── Cenário do bug ponta a ponta ─────────────────────────────────────────
// Rebuy no meio do torneio sobe a curva. O par "sb/bb" do nível em jogo passa a
// ocupar um índice anterior e o relógio voltava de nível (REDESIGN.md S10).
const CURVA_BASE: CurveParams = {
  qnt_entradas_primarias: 8,
  valor_fichas_inicial: 3000,
  qnt_acumulada_rebuys: 0,
  fichas_por_rebuy: 3000,
  qnt_acumulada_addons: 0,
  fichas_por_addon: 3000,
  target_time_minutos: 180,
  duracao_bloco_nivel: 15,
  initial_bb: 10,
  smallest_chip: 5,
};
const EM_JOGO = 10; // nível em jogo (sem intervalos, índice = nível − 1)

describe('recalibração ao vivo', () => {
  it('nível 10 com +6 rebuys: o relógio não retrocede', () => {
    const antes = recalibrarCurva(CURVA_BASE);
    const lvl = antes.niveis[EM_JOGO - 1];
    expect(`${lvl.small_blind}/${lvl.big_blind}`).toBe('300/600');

    const idxAtual = EM_JOGO - 1;
    const pos: Position = {
      kind: 'level',
      blinds: `${lvl.small_blind}/${lvl.big_blind}`,
      level: EM_JOGO,
      into: 300,
      start_sec: idxAtual * 1200,
    };

    // Comportamento antigo (sem passado congelado e sem piso na busca):
    // "300/600" reaparece antes e o relógio voltaria para o nível 9.
    const semGuarda = recalibrarCurva({ ...CURVA_BASE, qnt_acumulada_rebuys: 6 });
    expect(findPosition(schedule(semGuarda.niveis), pos)).toBeLessThan(idxAtual);

    // Com as duas travas da S10: o nível em jogo sai intacto e o índice é o mesmo.
    const depois = recalibrarCurva(
      { ...CURVA_BASE, qnt_acumulada_rebuys: 6 },
      { frozen: antes.niveis.slice(0, EM_JOGO), floor: antes.niveis.map((n) => n.big_blind) }
    );
    const items = schedule(depois.niveis);
    const idx = findPosition(items, pos, idxAtual);
    expect(idx).toBe(idxAtual);
    const item = items[idx];
    expect(item.kind === 'level' && item.level).toBe(EM_JOGO);
    expect(item.kind === 'level' && item.big_blind).toBe(600);
    // A cauda sobe; o passado fica byte-idêntico.
    expect(depois.niveis.slice(0, EM_JOGO)).toEqual(antes.niveis.slice(0, EM_JOGO));
  });

  it('remover o rebuy não baixa a estrutura já publicada', () => {
    const antes = recalibrarCurva(CURVA_BASE);
    const comRebuys = recalibrarCurva(
      { ...CURVA_BASE, qnt_acumulada_rebuys: 6 },
      { frozen: antes.niveis.slice(0, EM_JOGO), floor: antes.niveis.map((n) => n.big_blind) }
    );
    const piso = comRebuys.niveis.map((n) => n.big_blind);
    const semRebuys = recalibrarCurva(CURVA_BASE, {
      frozen: comRebuys.niveis.slice(0, EM_JOGO),
      floor: piso,
    });
    semRebuys.niveis.forEach((n, i) => expect(n.big_blind).toBeGreaterThanOrEqual(piso[i]));
  });
});
