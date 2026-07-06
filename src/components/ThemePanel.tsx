// src/components/ThemePanel.tsx — painel de personalização visual.
// Toda mudança aplica e salva na hora (preview ao vivo, sem "OK").
import { useState } from 'react';
import {
  applyTheme, clampZoom, loadTheme, saveTheme,
  DEFAULT_THEME, FONTS, THEME_PRESETS, ZOOM_MIN, ZOOM_MAX,
  type ThemeColors, type ThemeConfig,
} from '../theme';

const COLOR_FIELDS: { key: keyof ThemeColors; label: string }[] = [
  { key: 'bg', label: 'Fundo' },
  { key: 'panel', label: 'Painéis' },
  { key: 'panel2', label: 'Campos e caixas' },
  { key: 'border', label: 'Bordas' },
  { key: 'text', label: 'Texto' },
  { key: 'muted', label: 'Texto secundário' },
  { key: 'accent', label: 'Botões / destaque' },
  { key: 'accent2', label: 'Abas / secundário' },
  { key: 'danger', label: 'Alertas / perigo' },
  { key: 'gold', label: 'Blinds / dourado' },
];

export default function ThemePanel({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useState<ThemeConfig>(loadTheme);

  const update = (t: ThemeConfig) => { setTheme(t); applyTheme(t); saveTheme(t); };
  const patch = (p: Partial<ThemeConfig>) => update({ ...theme, ...p });
  const setColor = (key: keyof ThemeColors, value: string) =>
    patch({ colors: { ...theme.colors, [key]: value } });
  const restaurar = () => {
    if (!confirm('Restaurar o visual padrão? Suas cores, fontes e zoom voltam ao original.')) return;
    update({ ...DEFAULT_THEME, colors: { ...DEFAULT_THEME.colors } });
  };

  return (
    <div className="qr-overlay" onClick={onClose}>
      <div className="theme-card" onClick={(e) => e.stopPropagation()}>
        <h2>🎨 Personalização visual</h2>

        <label>Temas prontos</label>
        <div className="quick-add" style={{ marginBottom: 14 }}>
          {THEME_PRESETS.map((p) => (
            <button key={p.id} className="chip" onClick={() => patch({ colors: { ...p.colors } })}>
              {p.label}
            </button>
          ))}
        </div>

        <label>Cores (toque para escolher)</label>
        <div className="theme-colors">
          {COLOR_FIELDS.map(({ key, label }) => (
            <div key={key}>
              <label>{label}</label>
              <input type="color" value={theme.colors[key]}
                onChange={(e) => setColor(key, e.target.value)} />
            </div>
          ))}
        </div>

        <div className="grid" style={{ marginTop: 14 }}>
          <div>
            <label>Fonte do aplicativo</label>
            <select value={theme.font} onChange={(e) => patch({ font: e.target.value })}>
              {FONTS.map((f) => (
                <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label>Fonte do relógio (visor)</label>
            <select value={theme.clockFont} onChange={(e) => patch({ clockFont: e.target.value })}>
              {FONTS.map((f) => (
                <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>{f.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label>Zoom do relógio: {Math.round(theme.clockZoom * 100)}%</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <button className="ghost" title="Diminuir"
              onClick={() => patch({ clockZoom: clampZoom(theme.clockZoom - 0.1) })}>−</button>
            <input type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.05}
              value={theme.clockZoom} style={{ flex: 1 }}
              onChange={(e) => patch({ clockZoom: clampZoom(Number(e.target.value)) })} />
            <button className="ghost" title="Aumentar"
              onClick={() => patch({ clockZoom: clampZoom(theme.clockZoom + 0.1) })}>＋</button>
            <button className="ghost" onClick={() => patch({ clockZoom: 1 })}>100%</button>
          </div>
          <p className="notice">
            Vale para o visor normal e a tela cheia (botões 🔍 no relógio também ajustam).
            Se o número estourar a tela, reduza o zoom.
          </p>
        </div>

        <div className="row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
          <button className="danger" onClick={restaurar}>↺ Restaurar padrão</button>
          <button className="primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
