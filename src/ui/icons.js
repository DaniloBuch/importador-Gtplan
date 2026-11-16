/**
 * Ícones de UI do CBS Design System: subconjunto Lucide v0.544.0 (licença ISC),
 * traço 1.75px, copiado de components/core/iconPaths.jsx do design system.
 * O DS proíbe emoji e caracteres unicode como ícone; use sempre esta função.
 */
const LUCIDE = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  download: '<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
  'file-text': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'grid-2x2': '<path d="M12 3v18"/><path d="M3 12h18"/><rect x="3" y="3" width="18" height="18" rx="2"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  'rotate-ccw': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
};

export function icon(name, extraClass = '') {
  const body = LUCIDE[name];
  if (!body) {
    console.warn(`Ícone desconhecido: ${name}`);
    return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" stroke-dasharray="3 3"/></svg>';
  }
  return `<svg class="icon ${extraClass}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}
