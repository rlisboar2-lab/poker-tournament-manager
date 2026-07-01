// src/components/SetupPanel.tsx
import type { AppConfig } from '../App';
import { CHIP_DENOMINATIONS, initialStack } from '../utils/poker-math';
import { chips } from '../utils/format';

interface Props {
  config: AppConfig;
  onChange: (patch: Partial<AppConfig>) => void;
  onRestoreDefaults?: () => void;
}

export default function SetupPanel({ config, onChange, onRestoreDefaults }: Props) {
  const s = config.setup;
  const setSetup = (patch: Partial<AppConfig['setup']>) =>
    onChange({ setup: { ...s, ...patch } });

  const num = (v: string) => Number(v) || 0;

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Setup do Torneio</h2>
        {onRestoreDefaults && (
          <button className="ghost" onClick={onRestoreDefaults}>↺ Restaurar padrão</button>
        )}
      </div>
      <div className="grid">
        <div>
          <label>Nome do torneio</label>
          <input value={config.name} onChange={(e) => onChange({ name: e.target.value })} />
        </div>
        <div>
          <label>Início</label>
          <input
            type="datetime-local"
            value={config.start_time}
            onChange={(e) => onChange({ start_time: e.target.value })}
          />
        </div>
        <div>
          <label>Duração total alvo (min)</label>
          <input type="number" value={config.target_time_minutos}
            onChange={(e) => onChange({ target_time_minutos: num(e.target.value) })} />
        </div>
        <div>
          <label>Duração de cada nível (min)</label>
          <input type="number" value={config.duracao_bloco_nivel}
            onChange={(e) => onChange({ duracao_bloco_nivel: num(e.target.value) })} />
        </div>
      </div>

      <h2 style={{ marginTop: 20 }}>Stack & Blinds</h2>
      <div className="grid">
        <div>
          <label>Ficha mínima</label>
          <select value={s.smallest_chip} onChange={(e) => setSetup({ smallest_chip: num(e.target.value) })}>
            {CHIP_DENOMINATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label>Small Blind inicial</label>
          <input type="number" value={s.initial_sb} onChange={(e) => setSetup({ initial_sb: num(e.target.value) })} />
        </div>
        <div>
          <label>Big Blind inicial</label>
          <input type="number" value={s.initial_bb} onChange={(e) => setSetup({ initial_bb: num(e.target.value) })} />
        </div>
        <div>
          <label>Stack inicial (em BBs)</label>
          <input type="number" value={s.stack_bb} onChange={(e) => setSetup({ stack_bb: num(e.target.value) })} />
        </div>
        <div>
          <label>Stack inicial (fichas)</label>
          <input value={chips(initialStack(s))} readOnly />
        </div>
      </div>

      <h2 style={{ marginTop: 20 }}>Financeiro</h2>
      <div className="grid">
        <div>
          <label>Valor do Buy-in (R$)</label>
          <input type="number" value={config.buy_in_value} onChange={(e) => onChange({ buy_in_value: num(e.target.value) })} />
        </div>
        <div>
          <label>Valor do Rebuy (R$)</label>
          <input type="number" value={config.rebuy_value} onChange={(e) => onChange({ rebuy_value: num(e.target.value) })} />
        </div>
        <div>
          <label>Valor do Add-on (R$)</label>
          <input type="number" value={config.addon_value} onChange={(e) => onChange({ addon_value: num(e.target.value) })} />
        </div>
        <div>
          <label>Fichas por Rebuy</label>
          <input type="number" value={config.chips_per_rebuy} onChange={(e) => onChange({ chips_per_rebuy: num(e.target.value) })} />
        </div>
        <div>
          <label>Fichas por Add-on</label>
          <input type="number" value={config.chips_per_addon} onChange={(e) => onChange({ chips_per_addon: num(e.target.value) })} />
        </div>
      </div>
      <p className="notice">Maletas disponíveis: fichas de {CHIP_DENOMINATIONS.join(', ')}.</p>

      <h2 style={{ marginTop: 20 }}>Late check-in & Ante</h2>
      <div className="grid">
        <div>
          <label>Nível em que o late check-in fecha</label>
          <input type="number" min={1} value={config.late_checkin_level}
            onChange={(e) => onChange({ late_checkin_level: Math.max(1, num(e.target.value)) })} />
        </div>
        <div>
          <label>Ante (BB paga dobrado) a partir do late check-in</label>
          <select value={config.ante_enabled ? '1' : '0'}
            onChange={(e) => onChange({ ante_enabled: e.target.value === '1' })}>
            <option value="1">Ativado</option>
            <option value="0">Desativado</option>
          </select>
        </div>
      </div>

      <h2 style={{ marginTop: 20 }}>Intervalos</h2>
      {config.breaks.length === 0 && (
        <p className="notice">Nenhum intervalo. Adicione um abaixo (ex.: depois do nível 4, 10 min).</p>
      )}
      {config.breaks.map((b, i) => (
        <div className="row" key={i} style={{ marginBottom: 8 }}>
          <span className="notice">Depois do nível</span>
          <input type="number" min={1} style={{ width: 80 }} value={b.after_level}
            onChange={(e) => {
              const breaks = config.breaks.map((x, idx) => idx === i ? { ...x, after_level: Math.max(1, num(e.target.value)) } : x);
              onChange({ breaks });
            }} />
          <input type="number" min={1} style={{ width: 90 }} value={b.minutes}
            onChange={(e) => {
              const breaks = config.breaks.map((x, idx) => idx === i ? { ...x, minutes: Math.max(1, num(e.target.value)) } : x);
              onChange({ breaks });
            }} />
          <span className="notice">min</span>
          <button className="danger" onClick={() => onChange({ breaks: config.breaks.filter((_, idx) => idx !== i) })}>✕</button>
        </div>
      ))}
      <button className="ghost" onClick={() => onChange({ breaks: [...config.breaks, { after_level: 4, minutes: 10 }] })}>
        + Adicionar intervalo
      </button>
    </div>
  );
}
