/**
 * dom.js — utilitários mínimos de DOM compartilhados pelos componentes.
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto para interpolar com segurança em templates HTML. */
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const $ = (selector, root = document) => root.querySelector(selector);

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export function show(el, visible = true) {
  el.classList.toggle('hidden', !visible);
}
