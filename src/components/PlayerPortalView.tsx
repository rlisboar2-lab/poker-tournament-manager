// src/components/PlayerPortalView.tsx
// Portal do jogador (/jogar e /jogar/:publicId), sem login. Identifica o
// jogador neste navegador, mostra o PIX e registra pedidos. Nada aqui concede
// fichas nem mexe no pote: só o organizador confirma, no banco.
import { useState, type FormEvent } from 'react';
import { usePlayerPortal } from '../hooks/usePlayerPortal';
import type { Authorization, Offer, PaymentSettings } from '../services/operational';
import type { PlayerPortal, PublicPurchaseRequest } from '../services/publicPortal';
import type { ParticipantStatus, PixKeyType, PublicStatus, PurchaseRequestStatus } from '../types/database';
import { brl, chips } from '../utils/format';

const TOURNAMENT_STATUS: Partial<Record<PublicStatus, string>> = {
  published: 'Inscrições abertas',
  registration_closed: 'Inscrições fechadas',
  running: 'Em andamento',
  finished: 'Encerrado',
};

const REQUEST_STATUS: Record<PurchaseRequestStatus, string> = {
  requested: 'Aguardando seu PIX',
  payment_reported: 'Aguardando o organizador conferir',
  confirmed: 'Confirmado',
  rejected: 'Recusado',
  cancelled: 'Cancelado',
  expired: 'Expirado',
};

const PARTICIPANT_STATUS: Record<ParticipantStatus, string> = {
  pending_buyin: 'Aguardando buy-in',
  active: 'No torneio',
  eliminated: 'Eliminado',
  withdrawn: 'Fora do torneio',
};

const PIX_TYPE: Record<PixKeyType, string> = {
  cpf: 'CPF', cnpj: 'CNPJ', email: 'E-mail', phone: 'Telefone', random: 'Chave aleatória',
};

const isOpen = (r: PublicPurchaseRequest) => r.status === 'requested' || r.status === 'payment_reported';

/** Clipboard API só existe em contexto seguro; no HTTP do IP local cai no execCommand. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* tenta o método antigo */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok: boolean;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

function PixBox({ payment }: { payment: PaymentSettings }) {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const onCopy = async () => {
    setCopied((await copyText(payment.pix_key)) ? 'ok' : 'fail');
    window.setTimeout(() => setCopied(null), 2500);
  };
  return (
    <div className="portal-pix">
      <span className="portal-label">PIX · {PIX_TYPE[payment.pix_key_type]}</span>
      <code className="portal-pix-key">{payment.pix_key}</code>
      <span className="notice">Recebedor: <strong>{payment.receiver_name}</strong></span>
      {payment.instructions && <span className="notice">{payment.instructions}</span>}
      <button type="button" className="ghost" onClick={onCopy}>
        {copied === 'ok' ? 'Chave copiada' : 'Copiar chave PIX'}
      </button>
      {copied === 'fail' && <span className="notice warn" role="status">Não deu para copiar. Selecione a chave e copie manualmente.</span>}
    </div>
  );
}

function RequestCard({ request, fallbackPayment, busy, onReport, onCancel }: {
  request: PublicPurchaseRequest;
  fallbackPayment: PaymentSettings | null;
  busy: boolean;
  onReport: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const payment = request.payment ?? fallbackPayment;
  return (
    <div className="portal-card">
      <div className="portal-card-head">
        <strong>{request.offer_name}</strong>
        <span className="pill">{REQUEST_STATUS[request.status]}</span>
      </div>
      <div className="portal-amount">{brl(request.price)}</div>
      <p className="notice portal-tight">{chips(request.chips_granted)} fichas depois da confirmação.</p>

      {request.status === 'requested' && (
        <>
          {payment ? <PixBox payment={payment} /> : <p className="notice warn">O organizador não configurou o PIX. Fale com ele.</p>}
          <p className="notice portal-disclaimer">
            Pague {brl(request.price)} pelo app do seu banco e depois toque no botão abaixo. Isso só avisa o
            organizador: o pedido vale quando ele conferir o PIX e confirmar.
          </p>
          <div className="portal-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => onReport(request.id)}>
              Já fiz o PIX, avisar o organizador
            </button>
            <button type="button" className="ghost" disabled={busy} onClick={() => onCancel(request.id)}>
              Cancelar pedido
            </button>
          </div>
        </>
      )}
      {request.status === 'payment_reported' && (
        <p className="notice portal-disclaimer">
          Você avisou que pagou. O organizador ainda vai conferir o PIX; as fichas só entram depois da confirmação.
          Se precisar desfazer, fale com ele.
        </p>
      )}
    </div>
  );
}

function IdentifyForm({ busy, onSubmit, registrationOpen }: {
  busy: boolean; registrationOpen: boolean; onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSubmit(name);
  };
  return (
    <form className="portal-card" onSubmit={submit}>
      <label htmlFor="portal-name">Seu nome</label>
      <input id="portal-name" value={name} maxLength={80} autoComplete="name" autoCapitalize="words"
        onChange={(e) => setName(e.target.value)} placeholder="Como o organizador te conhece" />
      <p className="notice portal-tight">
        Use o mesmo nome das outras vezes. O organizador confirma quem é você antes do primeiro pedido.
        {!registrationOpen && ' As inscrições fecharam: só dá para entrar com um nome já inscrito.'}
      </p>
      <button type="submit" className="primary" disabled={busy || !name.trim()}>
        {busy ? 'Enviando…' : 'Entrar'}
      </button>
    </form>
  );
}

function SwitchPlayer({ label, busy, onConfirm }: { label: string; busy: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return <button type="button" className="ghost portal-switch" disabled={busy} onClick={() => setAsking(true)}>Trocar de jogador</button>;
  }
  return (
    <div className="portal-card portal-confirm" role="alertdialog" aria-label="Confirmar troca de jogador">
      <p className="notice portal-tight">
        Este navegador deixa de ser <strong>{label}</strong>. Pedidos já feitos continuam valendo. Para voltar,
        informe o nome de novo e aguarde o organizador validar.
      </p>
      <div className="portal-actions">
        <button type="button" className="danger" disabled={busy} onClick={() => { setAsking(false); onConfirm(); }}>
          Trocar de jogador
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={() => setAsking(false)}>Voltar</button>
      </div>
    </div>
  );
}

function AuthorizedOffers({ authorizations, offers, busy, onPick }: {
  authorizations: Authorization[]; offers: Offer[]; busy: boolean; onPick: (authId: string, offerId: string) => void;
}) {
  const byId = new Map(offers.map((o) => [o.id, o]));
  return (
    <>
      {authorizations.map((a) => (
        <div key={a.id} className="portal-card">
          <strong>{a.kind === 'rebuy' ? 'Rebuy liberado' : 'Add-on liberado'}</strong>
          <p className="notice portal-tight">O organizador liberou esta compra para você. Escolha uma opção:</p>
          <div className="portal-actions">
            {a.offer_ids.map((id) => byId.get(id)).filter((o): o is Offer => !!o).map((o) => (
              <button key={o.id} type="button" className="primary" disabled={busy} onClick={() => onPick(a.id, o.id)}>
                {o.name} · {brl(o.price)} · {chips(o.chips_granted)} fichas
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function PortalBody({ portal, busy, actions }: {
  portal: PlayerPortal;
  busy: boolean;
  actions: ReturnType<typeof usePlayerPortal>;
}) {
  const { participant, requests, offers, payment, next_action } = portal;
  const open = requests.filter(isOpen);
  const openBuyin = open.find((r) => r.kind === 'buyin');
  const openExtra = open.find((r) => r.kind !== 'buyin');
  const buyinOffers = offers.filter((o) => o.kind === 'buyin');
  const lastBuyin = [...requests].reverse().find((r) => r.kind === 'buyin');
  const history = requests.filter((r) => !isOpen(r)).reverse();
  const card = (r: PublicPurchaseRequest) => (
    <RequestCard request={r} fallbackPayment={payment} busy={busy} onReport={actions.report} onCancel={actions.cancel} />
  );

  return (
    <>
      {participant && (
        <p className="notice portal-tight">
          Situação: <strong>{PARTICIPANT_STATUS[participant.status]}</strong>
          {participant.confirmed_rebuy_units > 0 && ` · ${participant.confirmed_rebuy_units} rebuy(s)`}
          {participant.confirmed_addons > 0 && ` · ${participant.confirmed_addons} add-on(s)`}
        </p>
      )}

      {next_action === 'request_buyin' && !openBuyin && (
        <div className="portal-card">
          <strong>Pedir buy-in</strong>
          {lastBuyin?.status === 'rejected' && (
            <p className="notice warn portal-tight">
              Seu pedido anterior foi recusado{lastBuyin.rejection_reason ? `: ${lastBuyin.rejection_reason}` : '.'}
            </p>
          )}
          <p className="notice portal-tight">O pedido não entra no torneio sozinho: o organizador confirma depois do PIX.</p>
          <div className="portal-actions">
            {buyinOffers.map((o) => (
              <button key={o.id} type="button" className="primary" disabled={busy} onClick={() => actions.buyin(o.id)}>
                {o.name} · {brl(o.price)} · {chips(o.chips_granted)} fichas
              </button>
            ))}
          </div>
          {buyinOffers.length === 0 && <p className="notice warn">Nenhum buy-in disponível. Fale com o organizador.</p>}
        </div>
      )}

      {openBuyin && card(openBuyin)}
      {openExtra && card(openExtra)}

      {next_action === 'open_portal' && !openExtra && participant?.status === 'active' && lastBuyin?.status === 'confirmed' && (
        <p className="notice">Buy-in confirmado. Você está no torneio. Boa sorte!</p>
      )}
      {next_action === 'open_portal' && !participant && portal.tournament.public_status !== 'finished' && (
        <p className="notice">As inscrições deste torneio fecharam.</p>
      )}

      {!openExtra && portal.authorizations.length > 0 && (
        <AuthorizedOffers authorizations={portal.authorizations} offers={offers} busy={busy} onPick={actions.purchase} />
      )}

      {history.length > 0 && (
        <details className="portal-history">
          <summary>Pedidos anteriores ({history.length})</summary>
          <ul>
            {history.map((r) => (
              <li key={r.id}>
                {r.offer_name} · {brl(r.price)} · {REQUEST_STATUS[r.status]}
                {r.status === 'rejected' && r.rejection_reason ? ` (${r.rejection_reason})` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export default function PlayerPortalView({ publicId }: { publicId: string | null }) {
  const p = usePlayerPortal(publicId);
  const { phase, tournament, busy, error, notice } = p;
  const t = phase.kind === 'portal' ? phase.portal.tournament : tournament?.tournament;
  const registrationOpen = t?.public_status === 'published';

  const who = phase.kind === 'portal'
    ? phase.portal.session.display_name ?? phase.portal.session.claimed_name
    : phase.kind === 'pending' ? phase.session?.claimed_name ?? 'você' : null;

  return (
    <main className="app portal">
      <section className="panel portal-panel" aria-labelledby="portal-title">
        <span className="portal-eyebrow">Portal do jogador</span>
        <h1 id="portal-title" className="portal-title">{t?.name ?? 'Torneio'}</h1>
        {t && TOURNAMENT_STATUS[t.public_status] && <span className="pill">{TOURNAMENT_STATUS[t.public_status]}</span>}
        {who && <p className="notice portal-who">Neste navegador: <strong>{who}</strong></p>}

        {error && <p className="notice portal-error" role="alert">⚠ {error}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}

        {phase.kind === 'loading' && <p className="notice" role="status">Carregando…</p>}
        {phase.kind === 'unavailable' && <p className="notice warn" role="alert">{phase.message}</p>}

        {phase.kind === 'identify' && (
          t?.public_status === 'finished'
            ? <p className="notice">Este torneio já terminou.</p>
            : <>
                <IdentifyForm busy={busy} registrationOpen={registrationOpen} onSubmit={p.identify} />
                {!p.persisted && (
                  <p className="notice warn">
                    Este navegador não deixa salvar dados (modo privado?). Se recarregar a página, terá de se identificar de novo.
                  </p>
                )}
              </>
        )}

        {phase.kind === 'pending' && (
          <div className="portal-card" role="status" aria-live="polite">
            <strong>Aguardando o organizador</strong>
            <p className="notice portal-tight">
              Pedimos para o organizador confirmar que você é <strong>{phase.session?.claimed_name ?? 'você'}</strong>.
              Esta tela atualiza sozinha.
            </p>
          </div>
        )}

        {phase.kind === 'portal' && <PortalBody portal={phase.portal} busy={busy} actions={p} />}

        {(phase.kind === 'portal' || phase.kind === 'pending') && who && (
          <SwitchPlayer label={who} busy={busy} onConfirm={p.switchPlayer} />
        )}
      </section>
    </main>
  );
}
