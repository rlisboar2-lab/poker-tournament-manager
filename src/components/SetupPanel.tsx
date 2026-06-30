// src/components/SetupPanel.tsx
import type { AppConfig } from '../App';
import { CHIP_DENOMINATIONS, initialStack } from '../utils/poker-math';
import { chips } from '../utils/format';

interface Props {
  config: AppConfig;
  onChange: (patch: Partial<AppConfig>) => void;
}

export default function SetupPanel({ config, onChange }: Props) {
  const s = config.setup;
  const setSetup = (patch: Partial<AppConfig['setup']>) =>
    onChange({ setup: { ...s, ...patch } });

  const num = (v: string) => Number(v) || 0;

  return (
    <div className="panel">
      <h2>Setup do Torneio</h2>
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
    </div>
  );
}
