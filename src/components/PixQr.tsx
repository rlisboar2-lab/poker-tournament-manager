// src/components/PixQr.tsx
// QR de pagamento (PIX) em overlay centralizado e grande.
// A imagem deve ficar em public/pix-qr.png — se faltar, mostra aviso.
import { useState } from 'react';

export default function PixQr({ onClose }: { onClose: () => void }) {
  const [ok, setOk] = useState(true);
  return (
    <div className="qr-overlay" onClick={onClose}>
      <div className="qr-card" onClick={(e) => e.stopPropagation()}>
        <h2>PIX · buy-in / rebuy / add-on</h2>
        {ok ? (
          <img src="/pix-qr.png" alt="QR PIX para pagamentos" onError={() => setOk(false)} />
        ) : (
          <p className="warn">
            Adicione a imagem em <code>public/pix-qr.png</code> e faça o push.
          </p>
        )}
        <button className="primary" onClick={onClose}>Fechar</button>
      </div>
    </div>
  );
}
