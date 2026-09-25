// src/components/OperationalQueue.tsx
// Filas do torneio persistente (fluxo 2) no admin: identificações para validar,
// pedidos de compra para confirmar/rejeitar e liberações ativas. Nada aqui
// mexe em fichas: cada botão chama uma RPC e a tela só muda com a releitura
// do servidor.

import { useState } from 'react';
import type { OperationalState } from '../hooks/useOperationalTournament';
import type { AdminPurchaseRequest, OperationalSnapshot, PendingSession } from '../services/operational';
import type { KnownPlayer } from '../services/tournaments';
import { activeAuthorizations, openPurchases, pendingClaims } from '../utils/operational-live';
import { nameKey } from '../utils/seating';
import { brl } from '../utils/format';

const KIND_LABEL = { buyin: 'Buy-in', rebuy: 'Rebuy', addon: 'Add-on' } as const;

const hhmm = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';

export function OperationalMessages({ op }: { op: OperationalState }) {
  if (!op.error && !op.notice) return null;
  return (
    <div className="op-messages">
      {op.error && <p className="notice op-error" role="alert">⚠ {op.error}</p>}
      {op.notice && <p className="notice" role="status">{op.notice}</p>}
      <button type="button" className="ghost" onClick={op.dismiss}>OK</button>
    </div>
  );
}

// ── Identificações ────────────────────────────────────────────────────────

function ClaimRow({ claim, op, knownPlayers }: { claim: PendingSession; op: OperationalState; knownPlayers: KnownPlayer[] }) {
  // Nome já cadastrado (mesma chave, sem acento/caixa) vem pré-selecionado.
  const match = knownPlayers.find((p) => nameKey(p.display_name) === nameKey(claim.claimed_name));
  const [target, setTarget] = useState<string>(match?.id ?? 'new');
  const [newName, setNewName] = useState(claim.claimed_name.trim());
  const valid = target !== 'new' || newName.trim().length > 0;

  return (
    <li className="op-item">
      <div className="op-item-head">
        <strong>“{claim.claimed_name}”</strong>
        <span className="notice">pediu às {hhmm(claim.created_at)}</span>
      </div>
      <div className="op-item-controls">
        <label className="sr-only" htmlFor={`claim-${claim.id}`}>Quem é {claim.claimed_name}</label>
        <select id={`claim-${claim.id}`} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="new">Jogador novo</option>
          {knownPlayers.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
        </select>
        {target === 'new' && (
          <input aria-label="Nome do jogador novo" value={newName} maxLength={80}
            onChange={(e) => setNewName(e.target.value)} />
        )}
        <button type="button" className="primary" disabled={op.busy || !valid}
          onClick={() => op.resolveClaim(claim.id, target === 'new' ? { newDisplayName: newName } : { playerId: target })}>
          Validar
        </button>
      </div>
    </li>
  );
}

export function ClaimQueue({ snapshot, op, knownPlayers }: { snapshot: OperationalSnapshot; op: OperationalState; knownPlayers: KnownPlayer[] }) {
  const claims = pendingClaims(snapshot);
  if (claims.length === 0) return null;
  return (
    <section className="op-section" aria-labelledby="op-claims">
      <h3 id="op-claims">Identificações para validar <span className="pill late">{claims.length}</span></h3>
      <p className="notice">Confira quem é antes de validar: o aparelho passa a agir em nome desse jogador.</p>
      <ul className="op-list">
        {claims.map((c) => <ClaimRow key={c.id} claim={c} op={op} knownPlayers={knownPlayers} />)}
      </ul>
    </section>
  );
}

// ── Pedidos ───────────────────────────────────────────────────────────────

/** Rejeitar pede motivo (vai para o jogador). Dois passos, sem confirm(). */
export function RejectControl({ request, op }: { request: AdminPurchaseRequest; op: OperationalState }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) {
    return <button type="button" className="ghost" disabled={op.busy} onClick={() => setOpen(true)}>Rejeitar</button>;
  }
  return (
    <div className="op-reject">
      <input aria-label={`Motivo da rejeição de ${request.display_name}`} placeholder="Motivo (ex.: PIX não caiu)"
        value={reason} maxLength={200} autoFocus onChange={(e) => setReason(e.target.value)} />
      <button type="button" className="danger" disabled={op.busy || !reason.trim()}
        onClick={() => op.reject(request.id, reason)}>Rejeitar pedido</button>
      <button type="button" className="ghost" onClick={() => { setOpen(false); setReason(''); }}>Voltar</button>
    </div>
  );
}

export function RequestStatus({ r }: { r: AdminPurchaseRequest }) {
  return r.status === 'payment_reported'
    ? <span className="pill late">PIX informado {hhmm(r.payment_reported_at)}</span>
    : <span className="pill">Aguardando PIX</span>;
}

function PurchaseRow({ r, op }: { r: AdminPurchaseRequest; op: OperationalState }) {
  return (
    <li className="op-item">
      <div className="op-item-head">
        <strong>{r.display_name}</strong>
        <RequestStatus r={r} />
      </div>
      <span className="notice">
        {KIND_LABEL[r.kind]} · {r.offer_name} · {brl(r.price)} · {r.chips_granted.toLocaleString('pt-BR')} fichas
        {r.kind === 'rebuy' && r.rebuy_units > 1 ? ` · ${r.rebuy_units} unidades` : ''}
      </span>
      <div className="op-item-controls">
        <button type="button" className="primary" disabled={op.busy}
          title="Confira o PIX no banco antes: confirmar lança fichas e dinheiro."
          onClick={() => op.confirm(r.id, r.version)}>
          Confirmar pagamento
        </button>
        <RejectControl request={r} op={op} />
      </div>
    </li>
  );
}

/** Aba "Pedidos" do console ao vivo. */
export function LiveQueue({ snapshot, op, knownPlayers }: { snapshot: OperationalSnapshot; op: OperationalState; knownPlayers: KnownPlayer[] }) {
  const purchases = openPurchases(snapshot);
  const auths = activeAuthorizations(snapshot);
  const nameOf = (participantId: string) =>
    snapshot.participants.find((p) => p.id === participantId)?.display_name ?? '—';

  return (
    <div className="panel op-panel">
      <div className="op-panel-head">
        <h2>Pedidos do portal</h2>
        <button type="button" className="ghost" disabled={op.busy} onClick={op.refresh}>Recarregar</button>
      </div>
      <OperationalMessages op={op} />
      <ClaimQueue snapshot={snapshot} op={op} knownPlayers={knownPlayers} />

      <section className="op-section" aria-labelledby="op-purchases">
        <h3 id="op-purchases">Rebuys e add-ons <span className="pill">{purchases.length}</span></h3>
        {purchases.length === 0
          ? <p className="notice">Nenhum pedido em aberto. Libere rebuy/add-on pela barra de ações.</p>
          : <ul className="op-list">{purchases.map((r) => <PurchaseRow key={r.id} r={r} op={op} />)}</ul>}
      </section>

      {auths.length > 0 && (
        <section className="op-section" aria-labelledby="op-auths">
          <h3 id="op-auths">Liberados, esperando o jogador pedir</h3>
          <ul className="op-list">
            {auths.map((a) => (
              <li key={a.id} className="op-item op-item--row">
                <span><strong>{nameOf(a.participant_id)}</strong> · {KIND_LABEL[a.kind]}</span>
                <button type="button" className="ghost" disabled={op.busy}
                  onClick={() => op.revoke(a.id, 'revogada pelo organizador')}>Revogar</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
