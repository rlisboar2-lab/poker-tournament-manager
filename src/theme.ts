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
    bg: '#101715', panel: '#18221e', panel2: '#202d26', border: '#43584a',
    text: '#f2f5f3', muted: '#a8b7ae', accent: '#238454', accent2: '#296a52',
    danger: '#f07878', gold: '#d8b46a',
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
      danger: '#cf222e', gold: '#805600',
    },
  },
  {
    id: 'feltro', label: '♠️ Feltro verde',
    colors: {
      bg: '#0b2e1f', panel: '#10402c', panel2: '#155238', border: '#387d5e',
      text: '#eaf5ee', muted: '#9dbfad', accent: '#1a7f37', accent2: '#205f44',
      danger: '#ffa0a0', gold: '#f2c94c',
    },
  },
];

const THEME_KEY = 'ptm_theme_v1';

interface SemanticColors {
  onAccent: string;
  onAccent2: string;
  controlBorder: string;
  positiveText: string;
  focusRing: string;
}

const PRESET_SEMANTICS: Record<string, SemanticColors> = {
  escuro: {
    onAccent: '#ffffff', onAccent2: '#ffffff', controlBorder: '#6d8175',
    positiveText: '#8ed7ad', focusRing: '#d8b46a',
  },
  claro: {
    onAccent: '#ffffff', onAccent2: '#ffffff', controlBorder: '#748078',
    positiveText: '#176b32', focusRing: '#0969da',
  },
  feltro: {
    onAccent: '#ffffff', onAccent2: '#ffffff', controlBorder: '#84ac95',
    positiveText: '#b0e8bf', focusRing: '#f2c94c',
  },
};

type Rgb = { r: number; g: number; b: number };

function parseHex(value: string): Rgb | null {
  const match = /^#([\da-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex({ r, g, b }: Rgb): string {
  const channel = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function mixHex(from: string, to: string, amount: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  if (!a || !b) return from;
  return toHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

function luminance(value: string): number {
  const rgb = parseHex(value);
  if (!rgb) return 0;
  const channel = (v: number) => {
    const n = v / 255;
    return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

function minimumContrast(color: string, backgrounds: string[]): number {
  return Math.min(...backgrounds.map((background) => contrastRatio(color, background)));
}

function ensureContrast(color: string, backgrounds: string[], minimum: number): string {
  if (minimumContrast(color, backgrounds) >= minimum) return color.toLowerCase();
  const targets = ['#000000', '#ffffff'];
  const target = targets.sort(
    (a, b) => minimumContrast(b, backgrounds) - minimumContrast(a, backgrounds),
  )[0];
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixHex(color, target, step / 20);
    if (minimumContrast(candidate, backgrounds) >= minimum) return candidate;
  }
  return target;
}

export function themeColorsEqual(a: ThemeColors, b: ThemeColors): boolean {
  return (Object.keys(a) as (keyof ThemeColors)[])
    .every((key) => a[key].toLowerCase() === b[key].toLowerCase());
}

export function semanticColorsFor(colors: ThemeColors): SemanticColors {
  const preset = THEME_PRESETS.find((item) => themeColorsEqual(item.colors, colors));
  if (preset) return PRESET_SEMANTICS[preset.id];
  const surfaces = [colors.panel, colors.panel2];
  return {
    onAccent: contrastRatio('#ffffff', colors.accent) >= contrastRatio('#000000', colors.accent)
      ? '#ffffff' : '#000000',
    onAccent2: contrastRatio('#ffffff', colors.accent2) >= contrastRatio('#000000', colors.accent2)
      ? '#ffffff' : '#000000',
    controlBorder: ensureContrast(colors.border, surfaces, 3),
    positiveText: ensureContrast(colors.accent, surfaces, 4.5),
    focusRing: ensureContrast(colors.gold, [colors.bg, ...surfaces], 3),
  };
}

function cloneTheme(theme: ThemeConfig): ThemeConfig {
  return { ...theme, colors: { ...theme.colors } };
}

export function clampZoom(z: number): number {
  const v = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  return Math.round(v * 100) / 100;
}

export function loadTheme(): ThemeConfig {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return cloneTheme(DEFAULT_THEME);
    const t = JSON.parse(raw) as Partial<ThemeConfig>;
    return {
      colors: { ...DEFAULT_THEME.colors, ...(t.colors ?? {}) },
      font: typeof t.font === 'string' ? t.font : DEFAULT_THEME.font,
      clockFont: typeof t.clockFont === 'string' ? t.clockFont : DEFAULT_THEME.clockFont,
      clockZoom: clampZoom(typeof t.clockZoom === 'number' ? t.clockZoom : 1),
    };
  } catch {
    return cloneTheme(DEFAULT_THEME);
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
  const semantic = semanticColorsFor(t.colors);
  s.setProperty('color-scheme', contrastRatio('#ffffff', t.colors.bg) >= contrastRatio('#000000', t.colors.bg) ? 'dark' : 'light');
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
  s.setProperty('--on-accent', semantic.onAccent);
  s.setProperty('--on-accent-2', semantic.onAccent2);
  s.setProperty('--control-border', semantic.controlBorder);
  s.setProperty('--positive-text', semantic.positiveText);
  s.setProperty('--focus-ring', semantic.focusRing);
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
