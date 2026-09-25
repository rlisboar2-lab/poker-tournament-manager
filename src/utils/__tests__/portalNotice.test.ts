// src/utils/__tests__/portalNotice.test.ts
import { describe, it, expect } from 'vitest';
import { portalNotice, type PortalNoticeInput } from '../portalNotice';

const base: PortalNoticeInput = {
  publicStatus: 'running',
  nextAction: 'open_portal',
  participantStatus: 'active',
  lastBuyinConfirmed: true,
  hasOpenExtra: false,
};

describe('portalNotice', () => {
  it('em andamento, com buy-in confirmado, deseja boa sorte', () => {
    expect(portalNotice(base)).toBe('Buy-in confirmado. Você está no torneio. Boa sorte!');
  });

  it('encerrado não diz mais que o jogador está no torneio', () => {
    // Smoke S28: portal "Encerrado" ainda dizia "Você está no torneio. Boa sorte!".
    expect(portalNotice({ ...base, publicStatus: 'finished' }))
      .toBe('Este torneio terminou. Obrigado por jogar!');
    expect(portalNotice({ ...base, publicStatus: 'finished', participantStatus: 'eliminated' }))
      .toBe('Este torneio terminou. Obrigado por jogar!');
  });

  it('encerrado sem participante não mostra aviso', () => {
    expect(portalNotice({ ...base, publicStatus: 'finished', participantStatus: undefined })).toBeNull();
  });

  it('sem participante e inscrições fechadas avisa o fechamento', () => {
    expect(portalNotice({ ...base, participantStatus: undefined })).toBe('As inscrições deste torneio fecharam.');
  });

  it('pedido extra aberto ou buy-in não confirmado: sem aviso', () => {
    expect(portalNotice({ ...base, hasOpenExtra: true })).toBeNull();
    expect(portalNotice({ ...base, lastBuyinConfirmed: false })).toBeNull();
    expect(portalNotice({ ...base, nextAction: 'request_buyin' })).toBeNull();
  });
});
