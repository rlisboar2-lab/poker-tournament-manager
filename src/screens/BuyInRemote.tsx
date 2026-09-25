// src/screens/BuyInRemote.tsx
// Tela 3 com torneio persistente (fluxo 2, S24): os buy-ins vêm do portal.
// O admin valida identificações, revisa o lote e aperta um botão único que
// confirma exatamente essa lista e inicia o relógio no servidor. A mesa local
// só é montada depois da resposta do banco, com a âncora do runtime.

import type { OperationalState } from '../hooks/useOperationalTournament';
import type { OperationalSnapshot } from '../services/operational';
import type { KnownPlayer } from '../services/tournaments';
import { ClaimQueue, OperationalMessages, RejectControl, RequestStatus } from '../components/OperationalQueue';
import { openBuyins } from '../utils/operational-live';
import { brl } from '../utils/format';
import { CheckIcon } from '../components/Icons';

interface Props {
  op: OperationalState;
  knownPlayers: KnownPlayer[];
  onStarted: (snapshot: OperationalSnapshot) => void;
}

export default function BuyInRemote({ op, knownPlayers, onStarted }: Props) {
  const { ref, snapshot, busy } = op;
  if (!ref) return null;
  const snap = snapshot?.tournament.id === ref.tournamentId ? snapshot : null;
  const link = ref.publicId ? `${window.location.origin}/jogar/${ref.publicId}` : null;

  // Já iniciado no servidor (resposta perdida, outro aparelho): a mesa vem de lá.
  if (ref.publicStatus === 'running') {
    return (
      <div className="panel buyin-panel">
        <h2>Torneio já iniciado no servidor</h2>
        <p className="notice">Os buy-ins foram confirmados e o relógio começou no servidor. Abra o relógio com esse estado.</p>
        <OperationalMessages op={op} />
        <button type="button" className="primary buyin-confirm" disabled={busy || !snap?.runtime}
          onClick={() => snap && onStarted(snap)}>
          Abrir relógio com o estado do servidor
        </button>
      </div>
    );
  }

  if (!snap) {
    return (
      <div className="panel buyin-panel">
        <h2>Buy-ins pelo portal</h2>
        <OperationalMessages op={op} />
        <button type="button" className="ghost" disabled={busy} onClick={op.refresh}>Carregar do servidor</button>
      </div>
    );
  }

  const lote = openBuyins(snap);
  const total = lote.reduce((s, r) => s + r.price, 0);
  const reported = lote.filter((r) => r.status === 'payment_reported').length;
  const requesting = new Set(lote.map((r) => r.participant_id));
  const withoutRequest = snap.participants.filter((p) => p.status === 'pending_buyin' && !requesting.has(p.id));

  const start = async () => {
    const ids = lote.map((r) => r.id);
    if (!confirm(
      `Confirmar ${ids.length} buy-in(s) (${brl(total)}) e iniciar o torneio agora?\n\n` +
      'Confira os PIX no banco antes. A inscrição fecha e quem não estiver nesta lista sai do torneio.'
    )) return;
    const started = await op.startBatch(ids);
    if (started?.runtime) onStarted(started);
  };

  return (
    <div className="panel buyin-panel">
      <div className="buyin-heading">
        <span className="setup-eyebrow">Buy-ins pelo portal</span>
        <h2>Revisar o lote e iniciar</h2>
        <p className="notice">
          Os jogadores pedem buy-in pelo link e informam o PIX. Confira no banco, rejeite o que não caiu e
          confirme o lote de uma vez: o relógio começa no servidor.
        </p>
        {link && <p className="notice">Link: <code>{link}</code></p>}
        <p className="notice">A lista da tela Jogadores não entra aqui: só vale quem pediu buy-in pelo link.</p>
      </div>

      <OperationalMessages op={op} />
      <ClaimQueue snapshot={snap} op={op} knownPlayers={knownPlayers} />

      <section className="op-section" aria-labelledby="op-batch">
        <div className="buyin-participants-heading">
          <h3 id="op-batch">Lote de buy-ins</h3>
          <span className="pill">{lote.length} pedido(s) · {reported} com PIX informado</span>
        </div>
        {lote.length === 0 ? (
          <p className="notice buyin-empty">Nenhum pedido de buy-in ainda. Esta tela atualiza sozinha.</p>
        ) : (
          <ul className="op-list">
            {lote.map((r) => (
              <li key={r.id} className="op-item">
                <div className="op-item-head">
                  <strong>{r.display_name}</strong>
                  <RequestStatus r={r} />
                </div>
                <span className="notice">{r.offer_name} · {brl(r.price)} · {r.chips_granted.toLocaleString('pt-BR')} fichas</span>
                <div className="op-item-controls"><RejectControl request={r} op={op} /></div>
              </li>
            ))}
          </ul>
        )}
        {withoutRequest.length > 0 && (
          <p className="notice">
            Validados sem pedido de buy-in (saem do torneio se ele começar agora):{' '}
            {withoutRequest.map((p) => p.display_name).join(', ')}.
          </p>
        )}
      </section>

      <div className="buyin-total">
        <span className="notice">Total do lote</span>
        <div className="kpi">{brl(total)}</div>
      </div>
      <button type="button" className="primary buyin-confirm" disabled={busy || lote.length === 0} onClick={start}>
        <CheckIcon size={20} /> {busy ? 'Confirmando…' : `Confirmar ${lote.length} buy-in(s) e iniciar torneio`}
      </button>
      <button type="button" className="ghost" disabled={busy} onClick={op.refresh} style={{ marginTop: 8 }}>
        Recarregar do servidor
      </button>
    </div>
  );
}
