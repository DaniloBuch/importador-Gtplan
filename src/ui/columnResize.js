/**
 * Colunas com largura ajustável, como numa planilha.
 * - Arraste a borda direita do cabeçalho para alargar/estreitar.
 * - Duplo clique na borda ajusta a coluna ao conteúdo visível.
 * - As larguras ficam salvas neste navegador (localStorage).
 * A última coluna (Observação) fica com o espaço que sobrar.
 */

const DEFAULT_KEY = 'gtplan_col_widths_v1';
const LAST_COL_MIN = 240;

function readSaved(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null');
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function writeSaved(key, val) {
  try {
    if (val) localStorage.setItem(key, JSON.stringify(val));
    else localStorage.removeItem(key);
  } catch {
    // storage bloqueado: só não lembra
  }
}

/**
 * @param {HTMLTableElement} table
 * @param {{ storageKey?: string, minWidth?: number, skip?: number[], onChange?: (customized:boolean)=>void }} [opts]
 */
export function enableColumnResize(table, opts = {}) {
  const key = opts.storageKey || DEFAULT_KEY;
  const minWidth = opts.minWidth || 44;
  const skip = new Set(opts.skip || [0]);
  const onChange = opts.onChange || (() => {});
  const cols = [...table.querySelectorAll('colgroup col')];
  const ths = [...table.querySelectorAll('thead th')];
  const lastIdx = cols.length - 1;
  const defaults = cols.map((c) => parseFloat(c.style.width) || 0);

  const widths = () => cols.map((c, i) => (i === lastIdx ? 0 : parseFloat(c.style.width) || defaults[i]));

  const applyTableMin = () => {
    const sum = widths().reduce((a, b) => a + b, 0);
    table.style.minWidth = `${Math.round(sum + LAST_COL_MIN)}px`;
  };

  const setWidth = (i, w) => {
    cols[i].style.width = `${Math.round(Math.max(minWidth, Math.min(w, 900)))}px`;
  };

  const isCustomized = () =>
    widths().some((w, i) => i !== lastIdx && !skip.has(i) && Math.round(w) !== Math.round(defaults[i]));

  const save = () => {
    writeSaved(key, isCustomized() ? widths() : null);
    onChange(isCustomized());
  };

  // Restaura larguras salvas (se o layout de colunas não mudou)
  const saved = readSaved(key);
  if (saved && saved.length === cols.length) {
    saved.forEach((w, i) => {
      if (i !== lastIdx && !skip.has(i) && w > 0) setWidth(i, w);
    });
  }
  applyTableMin();
  onChange(isCustomized());

  /** Largura que cabe o conteúdo visível da coluna (para o duplo clique). */
  const fitWidth = (i) => {
    let max = 0;
    const measure = (cell) => {
      if (!cell) return;
      // Mede o conteúdo sem corte: elementos truncados informam a largura total em scrollWidth
      let need = cell.scrollWidth;
      cell.querySelectorAll('.truncate, .motive-picker-label, .cell-input').forEach((el) => {
        const extra = el.scrollWidth - el.clientWidth;
        if (extra > 0) need = Math.max(need, cell.clientWidth + extra);
      });
      max = Math.max(max, need);
    };
    measure(ths[i]);
    table.querySelectorAll('tbody tr').forEach((tr) => measure(tr.children[i]));
    return max + 12;
  };

  ths.forEach((th, i) => {
    if (skip.has(i) || i === lastIdx) return;
    const handle = document.createElement('span');
    handle.className = 'col-resizer';
    handle.title = 'Arraste para mudar a largura · duplo clique ajusta ao conteúdo';
    handle.setAttribute('aria-hidden', 'true');
    th.appendChild(handle);

    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = th.getBoundingClientRect().width;
      handle.setPointerCapture(e.pointerId);
      table.classList.add('is-resizing');
      const move = (ev) => {
        setWidth(i, startW + (ev.clientX - startX));
        applyTableMin();
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        table.classList.remove('is-resizing');
        save();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    });

    handle.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setWidth(i, fitWidth(i));
      applyTableMin();
      save();
    });
  });

  return {
    reset() {
      cols.forEach((c, i) => {
        if (i !== lastIdx && defaults[i]) c.style.width = `${defaults[i]}px`;
      });
      applyTableMin();
      save();
    }
  };
}
