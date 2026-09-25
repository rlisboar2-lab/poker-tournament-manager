// src/components/CobrancaPix.tsx
// Cobrança reutilizável para buy-in/rebuy/add-on (REDESIGN.md S12). Sem QR desde a
// S26: o pagamento é conferido pelo admin antes do clique.
// A transação só é aplicada no clique de "✓ Pago" — o chamador decide o que
// fazer (incrementar buyins/rebuys/addons, recalibrar blinds etc.) em onPago.
import { brl } from '../utils/format';
import { CheckIcon } from './Icons';

const TITULO: Record<Tipo, string> = {
  buyin: 'Buy-in',
  rebuy: 'Rebuy',
  addon: 'Add-on',
};

export type Tipo = 'buyin' | 'rebuy' | 'addon';

interface Props {
  tipo: Tipo;
  jogador: string;
  valor: number;
  onPago: () => void;
  onCancelar: () => void;
}

export default function CobrancaPix({ tipo, jogador, valor, onPago, onCancelar }: Props) {
  const titleId = `payment-title-${tipo}`;
  return (
    <div className="qr-overlay" onClick={onCancelar}>
      <div className="qr-card payment-card" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
        <span className="setup-eyebrow">Confirmar pagamento</span>
        <h2 id={titleId}>{TITULO[tipo]} · {jogador}</h2>
        <p className="kpi payment-value">{brl(valor)}</p>
        <div className="payment-actions">
          <button className="ghost" onClick={onCancelar}>Cancelar</button>
          <button className="primary" onClick={onPago}><CheckIcon size={19} /> Pago (PIX ou dinheiro)</button>
        </div>
      </div>
    </div>
  );
}
