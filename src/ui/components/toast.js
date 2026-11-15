/**
 * toast.js — notificações não-bloqueantes.
 */
const STYLES = {
  info: 'bg-slate-700 border-slate-500',
  success: 'bg-emerald-700 border-emerald-500',
  error: 'bg-rose-700 border-rose-500',
  warning: 'bg-amber-700 border-amber-500',
};

export function showToast(message, type = 'info', timeout = 4500) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = Object.assign(document.createElement('div'), { id: 'toast-host' });
    host.className = 'fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `px-4 py-3 rounded-lg border text-sm text-white shadow-lg transition-opacity ${STYLES[type] ?? STYLES.info}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, timeout);
}
