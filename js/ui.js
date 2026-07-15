/* ui.js — 공용 UI 유틸 */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(msg, isErr = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isErr ? ' err' : '');
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

export function openModal(html, onMount) {
  const root = $('#modal-root');
  $('#modal-body').innerHTML = html;
  root.hidden = false;
  if (onMount) onMount($('#modal-body'));
}
export function closeModal() {
  $('#modal-root').hidden = true;
  $('#modal-body').innerHTML = '';
}
document.addEventListener('click', e => {
  if (e.target.matches('[data-close]')) closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

export const fmtDate = iso => {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()} (${'일월화수목금토'[d.getDay()]})`;
};
export const dday = iso => {
  if (!iso) return '';
  const diff = Math.round((new Date(iso) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
  return diff === 0 ? 'D-DAY' : diff > 0 ? `D-${diff}` : `D+${-diff}`;
};

export const STATUS = {
  req: { label: '요청', tag: 'blue' },
  doing: { label: '진행 중', tag: '' },
  confirm: { label: '컨펌중', tag: 'amber' },
  done: { label: '완료', tag: 'gray' },
};
export const PRIORITY = ['🚨긴급', '높음', '중간', '낮음', '보류'];

export function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    if (btn) { const o = btn.textContent; btn.textContent = '복사됨 ✓'; setTimeout(() => btn.textContent = o, 1500); }
    toast('클립보드에 복사했어요');
  });
}
