// src/components/PixQr.tsx
// QR de pagamento (PIX) exibido discretamente no relógio.
// A imagem deve ficar em public/pix-qr.png — se faltar, o componente some.
import { useState } from 'react';

export default function PixQr({ size = 96 }: { size?: number }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <div className="pix-qr" title="Pague aqui buy-in / rebuy / add-on (PIX)">
      <img
        src="/pix-qr.png"
        alt="QR PIX para pagamentos"
        width={size}
        height={size}
        onError={() => setOk(false)}
      />
      <span className="pix-qr-label">PIX · buy-in / rebuy / add-on</span>
    </div>
  );
}
