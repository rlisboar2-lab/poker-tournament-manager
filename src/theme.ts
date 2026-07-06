// src/theme.ts — personalização visual (cores, fontes e zoom do relógio).
// O tema vira variáveis CSS no <html>; o index.css já usa essas variáveis,
// então nada da lógica do app muda. Guardado em localStorage SEPARADO do
// torneio: "Novo torneio" não apaga a personalização.

export interface ThemeColors {
  bg: string;      // fundo da página
  panel: string;   // painéis
  panel2: string;  // campos e caixas internas
  border: string;  // bordas
  text: string;    // texto principal
  muted: string;   // texto secundário
  accent: string;  // botões / destaque (verde padrão)
  accent2: string; // abas / destaque secundário (azul padrão)
  danger: string;  // alertas / perigo
  gold: string;    // blinds / dourado
}

export interface ThemeConfig {
  colors: ThemeColors;
  font: string;      // id em FONTS — fonte geral do app
  clockFont: string; // id em FONTS — fonte do visor (tempo/blinds)
  clockZoom: number; // multiplicador do tamanho do visor
}

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.5;

// Fontes seguras (já instaladas no aparelho — sem baixar nada).
export const FONTS: { id: string; label: string; stack: string }[] = [
  { id: 'sistema', label: 'Padrão do sistema', stack: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { id: 'arial', label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet MS', stack: "'Trebuchet MS', 'Segoe UI', sans-serif" },
  { id: 'georgia', label: 'Georgia (serifada)', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'courier', label: 'Courier New (máquina)', stack: "'Courier New', Courier, monospace" },
  { id: 'mono', label: 'Monoespaçada (Consolas)', stack: "ui-monospace, Consolas, 'Courier New', monospace" },
  { id: 'impact', label: 'Impact (grossa)', stack: "Impact, 'Arial Black', sans-serif" },
];

export const DEFAULT_THEME: ThemeConfig = {
  colors: {
    bg: '#0d1117', panel: '#161b22', panel2: '#1c232c', border: '#30363d',
    text: '#e6edf3', muted: '#8b949e', accent: '#2ea043', accent2: '#3b82f6',
    danger: '#f85149', gold: '#e3b341',
  },
  font: 'sistema',
  clockFont: 'sistema',
  clockZoom: 1,
};

// Combinações prontas de cores (a fonte e o zoom não mudam ao aplicar).
export const THEME_PRESETS: { id: string; label: string; colors: ThemeColors }[] = [
  { id: 'escuro', label: '🌙 Escuro (padrão)', colors: { ...DEFAULT_THEME.colors } },
  {
    id: 'claro', label: '☀️ Claro',
    colors: {
      bg: '#f6f8fa', panel: '#ffffff', panel2: '#eef1f4', border: '#d0d7de',
      text: '#1f2328', muted: '#57606a', accent: '#1a7f37', accent2: '#0969da',
      danger: '#cf222e', gold: '#9a6700',
    },
  },
  {
    id: 'feltro', label: '♠️ Feltro verde',
    colors: {
      bg: '#0b2e1f', panel: '#10402c', panel2: '#155238', border: '#1e6b49',
      text: '#eaf5ee', muted: '#9dbfad', accent: '#2ea043', accent2: '#3b82f6',
      danger: '#f85149', gold: '#f2c94c',
    },
  },
];

const THEME_KEY = 'ptm_theme_v1';

export function clampZoom(z: number): number {
  const v = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  return Math.round(v * 100) / 100;
}

export function loadTheme(): ThemeConfig {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return DEFAULT_THEME;
    const t = JSON.parse(raw) as Partial<ThemeConfig>;
    return {
      colors: { ...DEFAULT_THEME.colors, ...(t.colors ?? {}) },
      font: typeof t.font === 'string' ? t.font : DEFAULT_THEME.font,
      clockFont: typeof t.clockFont === 'string' ? t.clockFont : DEFAULT_THEME.clockFont,
      clockZoom: clampZoom(typeof t.clockZoom === 'number' ? t.clockZoom : 1),
    };
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(t: ThemeConfig) {
  try { localStorage.setItem(THEME_KEY, JSON.stringify(t)); } catch { /* quota */ }
}

function stackOf(id: string): string {
  return (FONTS.find((f) => f.id === id) ?? FONTS[0]).stack;
}

// Aplica o tema sobrescrevendo as variáveis CSS do :root.
export function applyTheme(t: ThemeConfig) {
  const s = document.documentElement.style;
  s.setProperty('--bg', t.colors.bg);
  s.setProperty('--panel', t.colors.panel);
  s.setProperty('--panel-2', t.colors.panel2);
  s.setProperty('--border', t.colors.border);
  s.setProperty('--text', t.colors.text);
  s.setProperty('--muted', t.colors.muted);
  s.setProperty('--accent', t.colors.accent);
  s.setProperty('--accent-2', t.colors.accent2);
  s.setProperty('--danger', t.colors.danger);
  s.setProperty('--gold', t.colors.gold);
  s.setProperty('--font', stackOf(t.font));
  s.setProperty('--clock-font', stackOf(t.clockFont));
  s.setProperty('--clock-zoom', String(t.clockZoom));
}

// Ajuste rápido do zoom (botões 🔍 do relógio): aplica e persiste na hora.
export function adjustClockZoom(delta: number): number {
  const t = loadTheme();
  t.clockZoom = clampZoom(t.clockZoom + delta);
  saveTheme(t);
  applyTheme(t);
  return t.clockZoom;
}
