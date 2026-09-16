// src/components/SetupPanel.tsx
import type { AppConfig } from '../App';
import { CHIP_DENOMINATIONS, initialStack } from '../utils/poker-math';
import { chips } from '../utils/format';
import { PlusIcon, ResetIcon, SettingsIcon, StructureIcon, TrashIcon } from './Icons';
import PayoutsPanel from './PayoutsPanel';

interface Props {
  config: AppConfig;
  onChange: (patch: Partial<AppConfig>) => void;
  onRestoreDefaults?: () => void;
  onPreset?: (name: 'custom' | 'quadra') => void;
  // Premiação embutida como bloco recolhível (REDESIGN.md S12) — a etapa
  // `payouts` não existe mais como tela própria.
  prizePool?: number;
  playerCount?: number;
  // Nível em que o late check-in fecha — o intervalo 'late' mostra este número.
  lateLevel?: number;
  payoutPct?: number[];
  onPayoutChange?: (p: number[]) => void;
  // Modo ao vivo: mesmo painel aberto como aba do torneio em andamento.
  // Avisa o que a edição afeta e já abre a premiação.
  live?: boolean;
}

export default function SetupPanel({
  config, onChange, onRestoreDefaults, onPreset,
  prizePool, playerCount, lateLevel, payoutPct, onPayoutChange, live,
}: Props) {
  const s = config.setup;
  const setSetup = (patch: Partial<AppConfig['setup']>) =>
    onChange({ setup: { ...s, ...patch } });

  const num = (v: string) => Number(v) || 0;

  return (
    <div className={`panel setup-panel${live ? ' setup-panel--live' : ''}`}>
      <div className="setup-header">
        <div>
          <span className="setup-eyebrow">Preparação</span>
          <h2>Configuração do torneio</h2>
        </div>
        {onRestoreDefaults && (
          <button type="button" className="ghost" onClick={onRestoreDefaults}>
            <ResetIcon size={18} /> Restaurar padrão
          </button>
        )}
      </div>
      {live && (
        <p className="notice setup-live-notice">
          <strong>Torneio em andamento.</strong> Editar aqui recalibra a estrutura a partir do nível atual:
          os níveis já jogados ficam congelados e o BB nunca desce abaixo do que a mesa já viu.
          Valores de buy-in, rebuy e add-on recalculam o pote e os prêmios na hora.
        </p>
      )}

      <section className="setup-section setup-section--first" aria-labelledby="setup-data-heading">
        <h3 id="setup-data-heading" className="setup-section-title">Dados do torneio</h3>
        {onPreset && (
          <div className="setup-presets" aria-labelledby="setup-presets-label">
            <p id="setup-presets-label" className="setup-presets-label">
              Estruturas prontas <span>(aplicam e continuam editáveis)</span>
            </p>
            <div className="setup-preset-actions">
              <button type="button" className="ghost" onClick={() => onPreset('custom')}>
                <SettingsIcon size={18} /> Personalizado (curva automática)
              </button>
              <button type="button" className="ghost" onClick={() => onPreset('quadra')}>
                <StructureIcon size={18} /> Estrutura Quadra
              </button>
            </div>
          </div>
        )}
        <div className="setup-grid">
          <div className="setup-field">
            <label htmlFor="setup-name">Nome do torneio</label>
            <input id="setup-name" value={config.name} onChange={(e) => onChange({ name: e.target.value })} />
          </div>
          <div className="setup-field">
            <label htmlFor="setup-start">Início</label>
            <input
              id="setup-start"
              type="datetime-local"
              value={config.start_time}
              onChange={(e) => onChange({ start_time: e.target.value })}
            />
          </div>
          <div className="setup-field">
            <label htmlFor="setup-target-duration">Duração total alvo (min)</label>
            <input id="setup-target-duration" type="number" value={config.target_time_minutos}
              onChange={(e) => onChange({ target_time_minutos: num(e.target.value) })} />
          </div>
          <div className="setup-field">
            <label htmlFor="setup-level-duration">Duração de cada nível (min)</label>
            <input id="setup-level-duration" type="number" value={config.duracao_bloco_nivel}
              onChange={(e) => onChange({ duracao_bloco_nivel: num(e.target.value) })} />
          </div>
        </div>
      </section>

      <section className="setup-section" aria-labelledby="setup-stack-heading">
        <h3 id="setup-stack-heading" className="setup-section-title">Stack e blinds</h3>
        <div className="setup-grid">
          <div className="setup-field">
            <label htmlFor="setup-smallest-chip">Ficha mínima</label>
            <select id="setup-smallest-chip" value={s.smallest_chip} onChange={(e) => setSetup({ smallest_chip: num(e.target.value) })}>
              {CHIP_DENOMINATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="setup-field">
            <label htmlFor="setup-initial-sb">Small Blind inicial</label>
            <input id="setup-initial-sb" type="number" value={s.initial_sb} onChange={(e) => setSetup({ initial_sb: num(e.target.value) })} />
          </div>
          <div className="setup-field">
            <label htmlFor="setup-initial-bb">Big Blind inicial</label>
            <input id="setup-initial-bb" type="number" value={s.initial_bb} onChange={(e) => setSetup({ initial_bb: num(e.target.value) })} />
          </div>
          <div className="setup-field">
            <label htmlFor="setup-stack-bb">Stack inicial (em BBs)</label>
            <input id="setup-stack-bb" type="number" value={s.stack_bb} onChange={(e) => setSetup({ stack_bb: num(e.target.value) })} />
          </div>
          <div className="setup-field setup-field--computed">
            <label htmlFor="setup-stack-chips">Stack inicial (fichas)</label>
            <input id="setup-stack-chips" value={chips(initialStack(s))} readOnly />
          </div>
        </div>
      </section>

      <section className="setup-section" aria-labelledby="setup-finance-heading">
        <h3 id="setup-finance-heading" className="setup-section-title">Financeiro</h3>
        <div className="setup-grid">
          <div className="setup-field">
            <label htmlFor="setup-buyin-value">Valor do Buy-in (R$)</label>
            <input id="setup-buyin-value" type="number" value={config.buy_in_value} onChange={(e) => onChange({ buy_in_value: num(e.target.value) })} />
          </div>
          <div className="setup-field">
            <label htmlFor="setup-rebuy-value">Valor do Rebuy (R$)</label>
            <input id="setup-rebuy-value" type="number" value={config.rebuy_value} onChange={(e) => onChange({ rebuy_value: num(e.target.value) })} />
          </div>
          <div className="setup-field">
            <label htmlFor="setup-addon-value">Valor do Add-on (R$)</label>
            <input id="setup-addon-value" type="number" value={config.addon_value} onChange={(e) => onChange({ addon_value: num(e.target.value) })} />
          </div>
          <div className="setup-field">
            <label htmlFor="setup-rebuy-chips">Fichas por Rebuy</label>
            <input id="setup-rebuy-chips" type="number" value={config.chips_per_rebuy} onChange={(e) => onChange({ chips_per_rebuy: num(e.target.value) })} />
          </div>
          <div className="setup-field">
            <label htmlFor="setup-addon-chips">Fichas por Add-on</label>
            <input id="setup-addon-chips" type="number" value={config.chips_per_addon} onChange={(e) => onChange({ chips_per_addon: num(e.target.value) })} />
          </div>
          <div className="setup-field">
            <label htmlFor="setup-max-rebuys">Máx. de rebuys por jogador (0 = sem limite)</label>
            <input id="setup-max-rebuys" type="number" min={0} value={config.max_rebuys} onChange={(e) => onChange({ max_rebuys: Math.max(0, num(e.target.value)) })} />
          </div>
          <div className="setup-field">
            <label htmlFor="setup-addon-enabled">Add-on disponível?</label>
            <select id="setup-addon-enabled" value={config.addon_enabled ? '1' : '0'} onChange={(e) => onChange({ addon_enabled: e.target.value === '1' })}>
              <option value="1">Sim</option>
              <option value="0">Não</option>
            </select>
          </div>
        </div>
        <p className="notice setup-helper">Maletas disponíveis: fichas de {CHIP_DENOMINATIONS.join(', ')}.</p>
      </section>

      <section className="setup-section" aria-labelledby="setup-late-heading">
        <h3 id="setup-late-heading" className="setup-section-title">Late check-in e ante</h3>
        <div className="setup-grid setup-grid--two">
          <div className="setup-field">
            <label htmlFor="setup-late-level">Nível em que o late check-in fecha</label>
            <input id="setup-late-level" type="number" min={1} value={config.late_checkin_level}
              onChange={(e) => onChange({ late_checkin_level: Math.max(1, num(e.target.value)) })} />
          </div>
          <div className="setup-field">
            <label htmlFor="setup-ante-enabled">Ante (BB dobrado)</label>
            <select id="setup-ante-enabled" value={config.ante_enabled ? '1' : '0'}
              onChange={(e) => onChange({ ante_enabled: e.target.value === '1' })}>
              <option value="1">Ativado</option>
              <option value="0">Desativado</option>
            </select>
          </div>
        </div>
      </section>

      <section className="setup-section" aria-labelledby="setup-breaks-heading">
        <h3 id="setup-breaks-heading" className="setup-section-title">Intervalos</h3>
        {config.breaks.length === 0 && (
          <p className="notice setup-empty">Nenhum intervalo. Adicione um abaixo (ex.: depois do nível 4, 10 min).</p>
        )}
        <div className="break-list">
          {config.breaks.map((b, i) => (
            <div className="break-row" key={i}>
              <div className="setup-field">
                <label htmlFor={`setup-break-level-${i}`}>Depois do nível</label>
                <div className="break-level-control">
                  {/* 'late' = colado no fim do late check-in: acompanha a curva sozinho.
                      Digitar um número aqui fixa o intervalo e desliga esse acompanhamento. */}
                  <input id={`setup-break-level-${i}`} type="number" min={1}
                    value={b.after_level === 'late' ? (lateLevel ?? 1) : b.after_level}
                    onChange={(e) => {
                      const breaks = config.breaks.map((x, idx) => idx === i ? { ...x, after_level: Math.max(1, num(e.target.value)) } : x);
                      onChange({ breaks });
                    }} />
                  {b.after_level === 'late' && (
                    <span className="pill" title="Acompanha o late check-in automaticamente">auto · late</span>
                  )}
                </div>
              </div>
              <div className="setup-field">
                <label htmlFor={`setup-break-minutes-${i}`}>Duração (min)</label>
                <input id={`setup-break-minutes-${i}`} type="number" min={1} value={b.minutes}
                  onChange={(e) => {
                    const breaks = config.breaks.map((x, idx) => idx === i ? { ...x, minutes: Math.max(1, num(e.target.value)) } : x);
                    onChange({ breaks });
                  }} />
              </div>
              <button type="button" className="danger icon-button break-remove"
                aria-label={`Remover intervalo ${i + 1}`} title="Remover intervalo"
                onClick={() => onChange({ breaks: config.breaks.filter((_, idx) => idx !== i) })}>
                <TrashIcon size={18} />
              </button>
            </div>
          ))}
        </div>
        <button type="button" className="ghost" onClick={() => onChange({ breaks: [...config.breaks, { after_level: 4, minutes: 10 }] })}>
          <PlusIcon size={18} /> Adicionar intervalo
        </button>
      </section>

      {payoutPct && onPayoutChange && (
        <details className="collapsible payout-collapsible" open={live}>
          <summary>Premiação</summary>
          <PayoutsPanel prizePool={prizePool ?? 0} playerCount={playerCount ?? 0}
            percentuais={payoutPct} onChange={onPayoutChange} />
        </details>
      )}
    </div>
  );
}
