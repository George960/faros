// ─────────────────────────────────────────────────────────────
// src/theme.ts — ΦΑΡΟΣ tactical palette
// ─────────────────────────────────────────────────────────────
export const T = {
  bg: '#080b0a',
  bg2: '#0d1714',
  panel: 'rgba(10,18,15,0.55)',
  border: '#1c2a25',
  text: '#dfeae6',
  dim: '#5fa389',
  faint: '#4f6b63',
  accent: '#6fe3b4',
  accent2: '#f5e6a8',
  green: '#5fd3a8',
  danger: '#ff5a5a',
  dangerBg: 'rgba(120,20,20,0.35)',
  mono: 'monospace',
};

export const PEER_COLORS = ['#5fd3a8', '#f0a868', '#7ab8f5', '#c98bdb', '#e8d35f', '#6fe3b4'];
export const colorFor = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PEER_COLORS[h % PEER_COLORS.length];
};
