// src/components/PortalPanel.tsx
// Torneio persistente (fluxo 2) na preparação: PIX, criação, publicação, retomada,
// alteração de ofertas/PIX e cancelamento antes do início (0014). Ofertas só
// mudam antes do primeiro pedido de buy-in; o PIX, até o fim.

import type { OperationalState } from '../hooks/useOperationalTournament';
import type { OfferInput } from '../services/operational';
import type { PixKeyType, PublicStatus } from '../types/database';
import { validatePix, type PixConfig } from '../utils/operational-config';
import { brl } from '../utils/format';

interface Props {
  op: OperationalState;
  pix: PixConfig;
  onPixChange: (p: PixConfig) => void;
  offers: OfferInput[];
  onCreate: () => void;
}

const PIX_TYPES: { value: PixKeyType; label: string }[] = [
  { value: 'random', label: 'Chave aleatória' },
  { value: 'cpf', label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
  { value: 'email', label: 'E-mail' },
  { value: 'phone', label: 'Telefone' },
];

const STATUS_LABEL: Record<PublicStatus, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
  registration_closed: 'Inscrição fechada',
  running: 'Em andamento',
  finished: 'Finalizado',
  cancelled: 'Cancelado',
};

const PIX_EDITABLE: readonly PublicStatus[] = ['draft', 'published', 'registration_closed', 'running'];
const CANCELLABLE: readonly PublicStatus[] = ['draft', 'published', 'registration_closed'];
const LIVE_REQUEST = new Set(['requested', 'payment_reported', 'confirmed']);

const offerKey = (o: { kind: string; name: string; price: number; chips_granted: number; rebuy_units?: number }) =>
  `${o.kind}|${o.name.trim()}|${o.price.toFixed(2)}|${o.chips_granted}|${o.rebuy_units ?? 0}`;

export default function PortalPanel({ op, pix, onPixChange, offers, onCreate }: Props) {
  if (!op.available) return null;
  const { ref, snapshot, candidate, busy, error, notice } = op;
  const pixProblems = validatePix(pix);
  const setPix = (patch: Partial<PixConfig>) => onPixChange({ ...pix, ...patch });

  // Com o torneio já criado, o que vale é o que está no servidor. Avisa se a
  // configuração local mudou depois — ela não é reenviada.
  const serverOffers = snapshot && ref && snapshot.tournament.id === ref.tournamentId ? snapshot.offers : null;
  const offersDiverge = serverOffers != null && (
    serverOffers.length !== offers.length ||
    serverOffers.some((o, i) => offerKey(o) !== offerKey(offers[i]))
  );
  const serverPix = serverOffers ? snapshot?.payment ?? null : null;
  const pixDiverges = serverPix != null && (
    serverPix.pix_key !== pix.pix_key.trim() || serverPix.receiver_name !== pix.receiver_name.trim() ||
    serverPix.pix_key_type !== pix.pix_key_type || (serverPix.instructions ?? '') !== pix.instructions.trim()
  );
  const pixEditable = !ref || PIX_EDITABLE.includes(ref.publicStatus);
  // Mesma regra do banco: rascunho, ou publicado sem nenhum pedido vivo.
  const offersEditable = !!ref && serverOffers != null && (
    ref.publicStatus === 'draft' ||
    (ref.publicStatus === 'published' && !snapshot!.requests.some((r) => LIVE_REQUEST.has(r.status)))
  );
  const sendOffers = offersDiverge && offersEditable;
  const sendPix = pixDiverges && pixEditable && pixProblems.length === 0;
  const pushSetup = () => op.updateSetup({
    ...(sendOffers ? { offers } : {}),
    ...(sendPix ? { payment: pix } : {}),
  });
  const cancelTournament = () => {
    if (!confirm(
      'Cancelar o torneio persistente? O link dos jogadores deixa de valer e os pedidos de buy-in em aberto ' +
      'expiram. Nada foi cobrado pelo app (buy-in só vira lançamento no início). Não dá pra desfazer.'
    )) return;
    op.cancel();
  };

  return (
    <section className="panel setup-panel" aria-labelledby="portal-heading">
      <div className="setup-header">
        <div>
          <span className="setup-eyebrow">Portal dos jogadores</span>
          <h2 id="portal-heading">Torneio persistente e PIX</h2>
        </div>
        {ref && <span className="pill">{STATUS_LABEL[ref.publicStatus]}</span>}
      </div>

      {!ref && (
        <p className="notice">
          Opcional. Grava o torneio no servidor com as ofertas e a chave PIX, para os jogadores pedirem
          buy-in pelo link. Sem isso, o torneio segue só neste aparelho e é salvo no fim, como antes.
        </p>
      )}

      <div className="setup-section setup-section--first">
        <h3 className="setup-section-title">Chave PIX</h3>
        <div className="setup-grid">
          <div className="setup-field">
            <label htmlFor="pix-type">Tipo da chave</label>
            <select id="pix-type" value={pix.pix_key_type} disabled={!pixEditable}
              onChange={(e) => setPix({ pix_key_type: e.target.value as PixKeyType })}>
              {PIX_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="setup-field">
            <label htmlFor="pix-key">Chave</label>
            <input id="pix-key" value={pix.pix_key} maxLength={140} disabled={!pixEditable}
              onChange={(e) => setPix({ pix_key: e.target.value })} />
          </div>
          <div className="setup-field">
            <label htmlFor="pix-receiver">Nome de quem recebe</label>
            <input id="pix-receiver" value={pix.receiver_name} maxLength={100} disabled={!pixEditable}
              onChange={(e) => setPix({ receiver_name: e.target.value })} />
          </div>
          <div className="setup-field">
            <label htmlFor="pix-instructions">Instruções (opcional)</label>
            <input id="pix-instructions" value={pix.instructions} maxLength={500} disabled={!pixEditable}
              onChange={(e) => setPix({ instructions: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="setup-section">
        <h3 className="setup-section-title">Ofertas {ref ? 'gravadas' : 'que serão gravadas'}</h3>
        <ul className="notice" style={{ margin: 0, paddingLeft: 18 }}>
          {(serverOffers ?? offers).map((o, i) => (
            <li key={i}>
              {o.name}: {brl(o.price)} · {o.chips_granted.toLocaleString('pt-BR')} fichas
              {o.kind === 'rebuy' && (o.rebuy_units ?? 1) > 1 ? ` · ${o.rebuy_units} unidades` : ''}
            </li>
          ))}
        </ul>
        {(sendOffers || sendPix) && (
          <p className="notice" style={{ color: 'var(--gold)' }}>
            ⚠ A configuração local mudou depois da criação ({[sendOffers && 'ofertas', sendPix && 'PIX'].filter(Boolean).join(' e ')}).
            O servidor continua com o que está gravado até você enviar as alterações.
          </p>
        )}
        {offersDiverge && !offersEditable && (
          <p className="notice" style={{ color: 'var(--gold)' }}>
            ⚠ As ofertas locais mudaram, mas o servidor não aceita trocar ofertas depois do primeiro pedido de
            buy-in. Valem as gravadas acima.
          </p>
        )}
      </div>

      {candidate && !ref && (
        <div className="panel" style={{ borderColor: 'var(--gold)' }}>
          <p className="notice" style={{ margin: 0 }}>
            Há um torneio persistente aberto no servidor: <strong>{candidate.name}</strong> ({STATUS_LABEL[candidate.public_status]}).
          </p>
          <button type="button" className="primary" disabled={busy} onClick={op.adopt} style={{ marginTop: 8 }}>
            Retomar este torneio
          </button>
        </div>
      )}

      {error && <p className="notice" role="alert" style={{ color: 'var(--danger)' }}>⚠ {error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}

      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        {!ref && (
          <button type="button" className="primary" disabled={busy || pixProblems.length > 0 || !!candidate}
            title={pixProblems.join(' ')} onClick={onCreate}>
            {busy ? 'Gravando…' : 'Criar torneio persistente'}
          </button>
        )}
        {ref?.publicStatus === 'draft' && (
          <button type="button" className="primary" disabled={busy} onClick={op.publish}>
            {busy ? 'Publicando…' : 'Publicar para os jogadores'}
          </button>
        )}
        {(sendOffers || sendPix) && (
          <button type="button" className="primary" disabled={busy} onClick={pushSetup}>
            {busy ? 'Enviando…' : 'Enviar alterações ao servidor'}
          </button>
        )}
        {ref && (
          <button type="button" className="ghost" disabled={busy} onClick={op.refresh}>Recarregar do servidor</button>
        )}
        {ref && CANCELLABLE.includes(ref.publicStatus) && (
          <button type="button" className="danger" disabled={busy} onClick={cancelTournament}>
            Cancelar torneio persistente
          </button>
        )}
      </div>
      {!ref && pixProblems.length > 0 && !candidate && (
        <p className="notice setup-helper">{pixProblems.join(' ')}</p>
      )}
      {ref?.publicId && ref.publicStatus !== 'finished' && (
        <p className="notice setup-helper">
          Link para os jogadores: <code>{`${window.location.origin}/jogar/${ref.publicId}`}</code>
        </p>
      )}
    </section>
  );
}
