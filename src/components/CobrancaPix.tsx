// src/components/CobrancaPix.tsx
// Cobrança PIX reutilizável para buy-in/rebuy/add-on (REDESIGN.md S12).
// A transação só é aplicada no clique de "✓ Pago" — o chamador decide o que
// fazer (incrementar buyins/rebuys/addons, recalibrar blinds etc.) em onPago.
import { useState } from 'react';
import { brl } from '../utils/format';

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
  const [ok, setOk] = useState(true);
  return (
    <div className="qr-overlay" onClick={onCancelar}>
      <div className="qr-card" onClick={(e) => e.stopPropagation()}>
        <h2>{TITULO[tipo]} · {jogador}</h2>
        <p className="kpi">{brl(valor)}</p>
        {ok ? (
          <img src="/pix-qr.png" alt="QR PIX para pagamento" onError={() => setOk(false)} />
        ) : (
          <p className="warn">
            Adicione a imagem em <code>public/pix-qr.png</code> e faça o push.
          </p>
        )}
        <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <button className="ghost" onClick={onCancelar}>Cancelar</button>
          <button className="primary" onClick={onPago}>✓ Pago (PIX ou dinheiro)</button>
        </div>
      </div>
    </div>
  );
}
