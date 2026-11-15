/**
 * dropzone.js — componente de upload por arrastar-e-soltar (reutilizável).
 *
 * Uso:
 *   const dz = createDropzone(el, { title, accept: ['.csv'], onChange: file => ... });
 *   dz.setFile(file); dz.getFile(); dz.reset();
 */
import { escapeHtml, formatBytes } from '../dom.js';

const ICON_UPLOAD = `<svg class="w-10 h-10" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V3m0 0L7.5 7.5M12 3l4.5 4.5M3 15.75v2.25A2.25 2.25 0 005.25 20.25h13.5A2.25 2.25 0 0021 18v-2.25"/></svg>`;
const ICON_FILE = `<svg class="w-10 h-10" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"/></svg>`;

/**
 * @param {HTMLElement} root
 * @param {{title:string, subtitle?:string, badge?:string, accept:string[], onChange?:(file:File|null)=>void, onError?:(msg:string)=>void}} opts
 */
export function createDropzone(root, { title, subtitle = '', badge = '', accept, onChange = () => {}, onError = () => {} }) {
  let file = null;

  root.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <h3 class="font-semibold text-slate-100">${escapeHtml(title)}</h3>
      ${badge ? `<span class="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">${escapeHtml(badge)}</span>` : ''}
    </div>
    <div data-zone tabindex="0" role="button" aria-label="${escapeHtml(title)}"
      class="relative flex flex-col items-center justify-center gap-2 h-48 rounded-xl border-2 border-dashed
             border-slate-600 bg-slate-800/40 text-slate-400 cursor-pointer transition
             hover:border-sky-500 hover:text-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-500">
      <div data-icon>${ICON_UPLOAD}</div>
      <p data-label class="text-sm text-center px-4">Arraste o arquivo aqui ou <span class="text-sky-400 underline">clique para escolher</span></p>
      <p data-meta class="text-xs text-slate-500">${escapeHtml(subtitle)} · Aceita ${accept.join(', ')}</p>
      <button data-clear type="button" class="hidden absolute top-2 right-2 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-rose-600 text-slate-200">Remover</button>
      <input data-input type="file" class="hidden" accept="${accept.join(',')}">
    </div>`;

  const zone = root.querySelector('[data-zone]');
  const input = root.querySelector('[data-input]');
  const label = root.querySelector('[data-label]');
  const meta = root.querySelector('[data-meta]');
  const icon = root.querySelector('[data-icon]');
  const clearBtn = root.querySelector('[data-clear]');

  const isAccepted = (f) => accept.some((ext) => f.name.toLowerCase().endsWith(ext));

  function render() {
    const filled = !!file;
    zone.classList.toggle('border-emerald-500', filled);
    zone.classList.toggle('text-emerald-300', filled);
    zone.classList.toggle('border-slate-600', !filled);
    clearBtn.classList.toggle('hidden', !filled);
    icon.innerHTML = filled ? ICON_FILE : ICON_UPLOAD;
    label.innerHTML = filled
      ? `<span class="font-medium break-all">${escapeHtml(file.name)}</span>`
      : 'Arraste o arquivo aqui ou <span class="text-sky-400 underline">clique para escolher</span>';
    meta.textContent = filled ? formatBytes(file.size) : `${subtitle} · Aceita ${accept.join(', ')}`;
  }

  function setFile(f) {
    if (f && !isAccepted(f)) {
      onError(`Formato inválido para "${title}". Use: ${accept.join(', ')}`);
      return;
    }
    file = f ?? null;
    render();
    onChange(file);
  }

  zone.addEventListener('click', (e) => { if (e.target !== clearBtn) input.click(); });
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { setFile(input.files[0]); input.value = ''; });
  clearBtn.addEventListener('click', (e) => { e.stopPropagation(); setFile(null); });

  ['dragenter', 'dragover'].forEach((evt) => zone.addEventListener(evt, (e) => {
    e.preventDefault();
    zone.classList.add('border-sky-400', 'bg-sky-500/10');
  }));
  ['dragleave', 'drop'].forEach((evt) => zone.addEventListener(evt, (e) => {
    e.preventDefault();
    zone.classList.remove('border-sky-400', 'bg-sky-500/10');
  }));
  zone.addEventListener('drop', (e) => setFile(e.dataTransfer.files[0]));

  return { getFile: () => file, setFile, reset: () => setFile(null) };
}
