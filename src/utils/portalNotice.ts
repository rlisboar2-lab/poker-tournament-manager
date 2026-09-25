// src/utils/portalNotice.ts
// Aviso de situação no portal do jogador. Puro para ser testável.
import type { NextAction } from '../services/publicPortal';
import type { ParticipantStatus, PublicStatus } from '../types/database';

export interface PortalNoticeInput {
  publicStatus: PublicStatus;
  nextAction: NextAction;
  participantStatus?: ParticipantStatus;
  lastBuyinConfirmed: boolean;
  hasOpenExtra: boolean;
}

/**
 * Torneio encerrado tem precedência: o participante continua `active` no banco
 * (o campeão, por exemplo), mas "Você está no torneio" deixou de ser verdade.
 */
export function portalNotice(i: PortalNoticeInput): string | null {
  if (i.publicStatus === 'finished') {
    return i.participantStatus ? 'Este torneio terminou. Obrigado por jogar!' : null;
  }
  if (i.nextAction !== 'open_portal') return null;
  if (!i.participantStatus) return 'As inscrições deste torneio fecharam.';
  if (!i.hasOpenExtra && i.participantStatus === 'active' && i.lastBuyinConfirmed) {
    return 'Buy-in confirmado. Você está no torneio. Boa sorte!';
  }
  return null;
}
