// src/utils/format.ts
export function brl(n: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n || 0);
}

export function chips(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(Math.round(n || 0));
}

export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}
