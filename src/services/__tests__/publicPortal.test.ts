// src/services/__tests__/publicPortal.test.ts
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { ContractError } from '../operational';
import {
  DEVICE_TOKEN_KEY,
  clearDeviceToken,
  describePublicError,
  ensureDeviceToken,
  generateDeviceToken,
  isDeviceToken,
  isSessionEnded,
  loadDeviceToken,
  parseIdentify,
  parsePlayerPortal,
  parsePublicRequest,
  parsePublicTournament,
  toBase64Url,
} from '../publicPortal';

const TOURNAMENT = {
  id: '00000000-0000-4000-8000-000000000001',
  public_id: 'abc123',
  name: 'Home Game',
  public_status: 'published',
  state_version: 3,
  start_time: '2026-09-25T22:00:00Z',
  started_at: null,
  registration_closed_at: null,
  is_public_current: true,
};

const OFFER = {
  id: '00000000-0000-4000-8000-0000000000a1',
  kind: 'buyin',
  name: 'Buy-in',
  price: '30.00',
  chips_granted: 10000,
  rebuy_units: 0,
  eligible_after_units: [],
  max_uses: null,
};

const PAYMENT = {
  pix_key_type: 'email',
  pix_key: 'pix@example.com',
  receiver_name: 'Organizador',
  instructions: null,
  version: 1,
};

const SESSION = {
  id: '00000000-0000-4000-8000-0000000000b1',
  status: 'active',
  claimed_name: 'Ana',
  player_id: '00000000-0000-4000-8000-0000000000c1',
  display_name: 'Ana',
  expires_at: '2027-03-24T22:00:00Z',
  created_at: '2026-09-25T21:00:00Z',
};

const REQUEST = {
  id: '00000000-0000-4000-8000-0000000000d1',
  kind: 'buyin',
  status: 'requested',
  offer_id: OFFER.id,
  offer_name: 'Buy-in',
  price: '30.00',
  chips_granted: 10000,
  rebuy_units: 0,
  authorization_id: null,
  payment: PAYMENT,
  version: 1,
  payment_reported_at: null,
  rejection_reason: null,
  created_at: '2026-09-25T21:05:00Z',
  updated_at: '2026-09-25T21:05:00Z',
};

// ── Token ────────────────────────────────────────────────────────────────

describe('token do dispositivo', () => {
  it('base64url sem padding nem + /', () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-');
    expect(toBase64Url(new Uint8Array([0]))).toBe('AA');
  });

  it('gera 32 bytes em 43 caracteres no formato aceito pelo banco', () => {
    const t = generateDeviceToken();
    expect(t).toHaveLength(43);
    expect(isDeviceToken(t)).toBe(true);
    expect(generateDeviceToken()).not.toBe(t);
  });

  it('recusa formatos fora de base64url 43–128', () => {
    expect(isDeviceToken('a'.repeat(42))).toBe(false);
    expect(isDeviceToken('a'.repeat(129))).toBe(false);
    expect(isDeviceToken('a'.repeat(42) + '=')).toBe(false);
    expect(isDeviceToken(null)).toBe(false);
  });

  it('não usa Math.random quando falta getRandomValues', () => {
    vi.stubGlobal('crypto', {});
    try {
      expect(() => generateDeviceToken()).toThrow(/aleatórios seguros/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('guarda do token', () => {
  let mem: Map<string, string>;
  beforeEach(() => {
    mem = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('cria uma vez e reaproveita na recarga', () => {
    const a = ensureDeviceToken();
    expect(a.persisted).toBe(true);
    expect(mem.get(DEVICE_TOKEN_KEY)).toBe(a.token);
    expect(ensureDeviceToken().token).toBe(a.token);
    expect(loadDeviceToken()).toBe(a.token);
  });

  it('valor corrompido é ignorado e substituído', () => {
    mem.set(DEVICE_TOKEN_KEY, 'curto');
    expect(loadDeviceToken()).toBeNull();
    const t = ensureDeviceToken().token;
    expect(t).not.toBe('curto');
    expect(isDeviceToken(t)).toBe(true);
  });

  it('limpar faz o próximo token ser novo (troca de jogador)', () => {
    const a = ensureDeviceToken().token;
    clearDeviceToken();
    expect(loadDeviceToken()).toBeNull();
    expect(ensureDeviceToken().token).not.toBe(a);
  });

  it('armazenamento bloqueado: token só em memória, avisando', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('bloqueado'); },
      setItem: () => { throw new Error('bloqueado'); },
      removeItem: () => { throw new Error('bloqueado'); },
    });
    const r = ensureDeviceToken();
    expect(r.persisted).toBe(false);
    expect(isDeviceToken(r.token)).toBe(true);
    expect(() => clearDeviceToken()).not.toThrow();
  });
});

// ── Parsers ──────────────────────────────────────────────────────────────

describe('parsers públicos', () => {
  it('torneio público com PIX', () => {
    const r = parsePublicTournament({ tournament: TOURNAMENT, offers: [OFFER], payment: PAYMENT });
    expect(r.offers[0].price).toBe(30);
    expect(r.payment?.pix_key).toBe('pix@example.com');
  });

  it('torneio finalizado vem sem PIX', () => {
    const r = parsePublicTournament({ tournament: { ...TOURNAMENT, public_status: 'finished' }, offers: [], payment: null });
    expect(r.payment).toBeNull();
  });

  it('identify traz next_action do catálogo', () => {
    const r = parseIdentify({ session: { ...SESSION, status: 'pending', player_id: null, display_name: null }, tournament: TOURNAMENT, next_action: 'await_validation' });
    expect(r.next_action).toBe('await_validation');
    expect(r.session.player_id).toBeNull();
    expect(() => parseIdentify({ session: SESSION, tournament: TOURNAMENT, next_action: 'pay_now' })).toThrow(ContractError);
  });

  it('pedido: snapshot PIX vazio vira null e dinheiro vira número', () => {
    const r = parsePublicRequest({ ...REQUEST, payment: {} });
    expect(r.payment).toBeNull();
    expect(r.price).toBe(30);
    expect(parsePublicRequest(REQUEST).payment?.receiver_name).toBe('Organizador');
    expect(() => parsePublicRequest({ ...REQUEST, price: 30 })).toThrow(ContractError);
  });

  it('portal sem participante (ainda não pediu buy-in)', () => {
    const r = parsePlayerPortal({
      session: SESSION, tournament: TOURNAMENT, participant: null, requests: [], authorizations: [],
      offers: [OFFER], payment: PAYMENT, next_action: 'request_buyin',
    });
    expect(r.participant).toBeNull();
    expect(r.next_action).toBe('request_buyin');
  });

  it('portal com participante e pedido em espera', () => {
    const r = parsePlayerPortal({
      session: SESSION, tournament: TOURNAMENT,
      participant: {
        id: '00000000-0000-4000-8000-0000000000e1', player_id: SESSION.player_id, display_name: 'Ana',
        status: 'pending_buyin', table_number: null, seat_number: null, final_placement: null, version: 1,
        confirmed_rebuy_units: 0, reserved_rebuy_units: 0, confirmed_addons: 0, eligible_offer_ids: [],
      },
      requests: [{ ...REQUEST, status: 'payment_reported', payment_reported_at: '2026-09-25T21:06:00Z' }],
      authorizations: [], offers: [OFFER], payment: PAYMENT, next_action: 'await_buyin_confirmation',
    });
    expect(r.participant?.status).toBe('pending_buyin');
    expect(r.requests[0].status).toBe('payment_reported');
  });
});

describe('mensagens', () => {
  const err = (code: Parameters<typeof describePublicError>[0]['code'], details = {}) =>
    ({ code, message: '', retryable: false, details });

  it('sessão encerrada pede nova identificação', () => {
    expect(isSessionEnded('SESSION_REVOKED')).toBe(true);
    expect(isSessionEnded('SESSION_EXPIRED')).toBe(true);
    expect(isSessionEnded('SESSION_PENDING')).toBe(false);
  });

  it('conflito de identidade orienta a trocar de jogador', () => {
    expect(describePublicError(err('IDENTITY_CONFLICT', { reason: 'session_has_other_identity' }))).toMatch(/Trocar de jogador/);
    expect(describePublicError(err('IDENTITY_CONFLICT', { reason: 'player_inactive' }))).toMatch(/inativo/);
  });

  it('não depende da message do servidor', () => {
    expect(describePublicError({ code: 'REGISTRATION_CLOSED', message: 'qualquer coisa', retryable: false, details: {} }))
      .toMatch(/inscrições/);
  });
});
