// src/components/ThemePanel.tsx — painel de personalização visual.
// Toda mudança aplica e salva na hora (preview ao vivo, sem "OK").
import { useState } from 'react';
import {
  applyTheme, clampZoom, loadTheme, saveTheme,
  DEFAULT_THEME, FONTS, THEME_PRESETS, themeColorsEqual, ZOOM_MIN, ZOOM_MAX,
  type ThemeColors, type ThemeConfig,
} from '../theme';
import {
  CloseIcon, MoonIcon, PaletteIcon, ResetIcon, SpadeIcon, SunIcon,
  ZoomInIcon, ZoomOutIcon,
} from './Icons';

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
  const activePreset = THEME_PRESETS.find((preset) => themeColorsEqual(preset.colors, theme.colors))?.id;

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
      <div
        className="theme-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="theme-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="theme-header">
          <div>
            <span className="theme-eyebrow">Aparência</span>
            <h2 id="theme-title"><PaletteIcon /> Personalização visual</h2>
          </div>
          <button type="button" className="ghost icon-button" aria-label="Fechar personalização" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <section className="theme-section" aria-labelledby="theme-presets-title">
          <h3 id="theme-presets-title">Temas prontos</h3>
          <div className="theme-presets">
          {THEME_PRESETS.map((p) => (
            <button
              type="button"
              key={p.id}
              className={`theme-preset ${activePreset === p.id ? 'selected' : ''}`}
              aria-pressed={activePreset === p.id}
              onClick={() => patch({ colors: { ...p.colors } })}
            >
              {p.id === 'escuro' && <MoonIcon />}
              {p.id === 'claro' && <SunIcon />}
              {p.id === 'feltro' && <SpadeIcon />}
              <span>{p.label.replace(/^\S+\s/, '')}</span>
            </button>
          ))}
          </div>
        </section>

        <section className="theme-section" aria-labelledby="theme-colors-title">
          <h3 id="theme-colors-title">Cores</h3>
          <p className="notice">As mudanças são aplicadas e salvas no momento da escolha.</p>
          <div className="theme-colors">
            {COLOR_FIELDS.map(({ key, label }) => {
              const inputId = `theme-color-${key}`;
              return (
                <div className="theme-color-field" key={key}>
                  <label htmlFor={inputId}>{label}</label>
                  <div className="theme-color-control">
                    <input id={inputId} type="color" value={theme.colors[key]}
                      onChange={(e) => setColor(key, e.target.value)} />
                    <code>{theme.colors[key].toUpperCase()}</code>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="theme-section" aria-labelledby="theme-type-title">
          <h3 id="theme-type-title">Tipografia</h3>
          <div className="grid theme-fonts">
            <div>
              <label htmlFor="theme-app-font">Fonte do aplicativo</label>
              <select id="theme-app-font" value={theme.font} onChange={(e) => patch({ font: e.target.value })}>
              {FONTS.map((f) => (
                <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>{f.label}</option>
              ))}
              </select>
            </div>
            <div>
              <label htmlFor="theme-clock-font">Fonte do relógio (visor)</label>
              <select id="theme-clock-font" value={theme.clockFont} onChange={(e) => patch({ clockFont: e.target.value })}>
              {FONTS.map((f) => (
                <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>{f.label}</option>
              ))}
              </select>
            </div>
          </div>
        </section>

        <section className="theme-section" aria-labelledby="theme-zoom-title">
          <div className="theme-zoom-heading">
            <h3 id="theme-zoom-title">Zoom do relógio</h3>
            <output htmlFor="theme-clock-zoom">{Math.round(theme.clockZoom * 100)}%</output>
          </div>
          <div className="theme-zoom-controls">
            <button type="button" className="ghost icon-button" title="Diminuir o visor" aria-label="Diminuir o visor"
              onClick={() => patch({ clockZoom: clampZoom(theme.clockZoom - 0.1) })}><ZoomOutIcon /></button>
            <input id="theme-clock-zoom" type="range" min={ZOOM_MIN} max={ZOOM_MAX} step={0.05}
              aria-label="Zoom do relógio" value={theme.clockZoom}
              onChange={(e) => patch({ clockZoom: clampZoom(Number(e.target.value)) })} />
            <button type="button" className="ghost icon-button" title="Aumentar o visor" aria-label="Aumentar o visor"
              onClick={() => patch({ clockZoom: clampZoom(theme.clockZoom + 0.1) })}><ZoomInIcon /></button>
            <button type="button" className="ghost" onClick={() => patch({ clockZoom: 1 })}>100%</button>
          </div>
          <p className="notice">
            Vale para o visor normal e a tela cheia; os controles do relógio também ajustam.
            Se o número estourar a tela, reduza o zoom.
          </p>
        </section>

        <div className="theme-actions">
          <button type="button" className="danger" onClick={restaurar}><ResetIcon /> Restaurar padrão</button>
          <button type="button" className="primary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
