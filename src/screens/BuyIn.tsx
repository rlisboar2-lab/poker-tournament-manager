// src/screens/BuyIn.tsx
// Tela 3 do wizard de criação (REDESIGN.md S12): QR PIX + confirmação de
// pagamento em bloco. Sem ledger de pendência — todo mundo paga, um clique
// único libera o início do torneio.
import { useState } from 'react';
import type { LocalEntry } from '../services/tournaments';
import { brl } from '../utils/format';
import { CheckIcon } from '../components/Icons';

interface Props {
  entries: LocalEntry[];
  buyInValue: number;
  onConfirm: () => void;
}

export default function BuyIn({ entries, buyInValue, onConfirm }: Props) {
  const [ok, setOk] = useState(true);
  const total = entries.length * buyInValue;

  return (
    <div className="panel buyin-panel">
      <div className="buyin-heading">
        <span className="setup-eyebrow">Confirmação de pagamento</span>
        <h2>Cobrança dos buy-ins</h2>
        <p className="notice">Confira participantes e valor antes de iniciar o torneio.</p>
      </div>

      <div className="buyin-layout">
        <div className="buyin-qr">
          {ok ? (
            <img src="/pix-qr.png" alt="QR PIX para pagamento dos buy-ins"
              onError={() => setOk(false)} />
          ) : (
            <p className="warn">
              Adicione a imagem em <code>public/pix-qr.png</code> e faça o push.
            </p>
          )}
        </div>

        <div className="buyin-summary">
          <div className="buyin-participants-heading">
            <h3>Participantes</h3>
            <span className="pill">{entries.length} jogador(es)</span>
          </div>
          {entries.length === 0 ? (
            <p className="notice buyin-empty">Nenhum jogador selecionado na tela anterior.</p>
          ) : (
            <div className="table-wrap buyin-table-wrap">
              <table className="buyin-table responsive-card-table">
                <thead><tr><th>Jogador</th><th>Buy-in</th></tr></thead>
                <tbody>
                  {entries.map((e, i) => (
                    <tr key={i}>
                      <td data-label="Jogador"><strong>{e.name}</strong></td>
                      <td data-label="Buy-in">{brl(buyInValue * e.buyins)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="buyin-total">
            <span className="notice">Total a receber</span>
            <div className="kpi">{brl(total)}</div>
            <span className="notice">{entries.length} jogador(es) · {brl(buyInValue)} cada</span>
          </div>

          <button type="button" className="primary buyin-confirm"
            disabled={entries.length === 0} onClick={onConfirm}>
            <CheckIcon size={20} /> Todos pagaram — iniciar torneio
          </button>
        </div>
      </div>
    </div>
  );
}
