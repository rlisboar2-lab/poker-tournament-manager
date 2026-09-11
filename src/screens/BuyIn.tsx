// src/screens/BuyIn.tsx
// Tela 3 do wizard de criação (REDESIGN.md S12): QR PIX + confirmação de
// pagamento em bloco. Sem ledger de pendência — todo mundo paga, um clique
// único libera o início do torneio.
import { useState } from 'react';
import type { LocalEntry } from '../services/tournaments';
import { brl } from '../utils/format';

interface Props {
  entries: LocalEntry[];
  buyInValue: number;
  onConfirm: () => void;
}

export default function BuyIn({ entries, buyInValue, onConfirm }: Props) {
  const [ok, setOk] = useState(true);
  const total = entries.length * buyInValue;

  return (
    <div className="panel">
      <h2>Cobrança dos buy-ins</h2>
      {ok ? (
        <img src="/pix-qr.png" alt="QR PIX para pagamento dos buy-ins"
          style={{ width: 'min(78vw, 380px)', height: 'auto', background: '#fff', borderRadius: 12, padding: 10 }}
          onError={() => setOk(false)} />
      ) : (
        <p className="warn">
          Adicione a imagem em <code>public/pix-qr.png</code> e faça o push.
        </p>
      )}

      {entries.length === 0 ? (
        <p className="notice">Nenhum jogador selecionado na tela anterior.</p>
      ) : (
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Jogador</th><th>Buy-in</th></tr></thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}><td>{e.name}</td><td>{brl(buyInValue * e.buyins)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
        <div className="kpi">{brl(total)}</div>
        <span className="notice">{entries.length} jogador(es) · {brl(buyInValue)} cada</span>
      </div>

      <button className="primary" style={{ marginTop: 14, width: '100%' }}
        disabled={entries.length === 0} onClick={onConfirm}>
        ✓ Todos pagaram — iniciar torneio
      </button>
    </div>
  );
}
