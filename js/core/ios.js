/**
 * Ajustes específicos do iPhone / iOS Safari.
 *
 * - :active só funciona no iOS Safari se houver um listener de toque no documento.
 * - Teclado virtual: o iOS não encolhe o layout; calculamos a altura ocupada pelo
 *   teclado (visualViewport) para os painéis subirem acima dele.
 * - Gesto de voltar: numa PWA instalada não existe o gesto nativo do Safari, por
 *   isso implementamos o deslizar a partir da margem esquerda.
 */

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function enableActiveStates() {
  document.addEventListener('touchstart', () => {}, { passive: true });
}

function trackKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.style.setProperty('--keyboard-inset', `${Math.round(inset)}px`);
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  // Campo focado dentro de um painel: garantir que fica visível acima do teclado.
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t instanceof HTMLElement && t.matches('input, select, textarea') && t.closest('.sheet__body')) {
      setTimeout(() => t.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
    }
  });
}

/**
 * Deslizar da margem esquerda → voltar atrás (apenas na app instalada, em ecrãs
 * com botão "voltar" e sem painéis abertos).
 */
function enableEdgeSwipeBack(view) {
  if (!isStandalone()) return;
  const EDGE = 24;
  const TRIGGER = 90;
  let start = null;
  let dx = 0;

  const backButton = () => (document.querySelector('.overlay-root') ? null : view.querySelector('[data-action="back"]'));

  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    const safeLeft = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-left')) || 0;
    if (e.touches.length !== 1 || t.clientX > EDGE + safeLeft || !backButton()) { start = null; return; }
    start = { x: t.clientX, y: t.clientY, locked: false };
    dx = 0;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!start) return;
    const t = e.touches[0];
    dx = t.clientX - start.x;
    const dy = Math.abs(t.clientY - start.y);
    if (!start.locked) {
      if (dy > 12 && dy > dx) { start = null; return; } // é um scroll vertical
      if (dx > 8) { start.locked = true; view.classList.add('is-swiping'); }
    }
    if (start?.locked) {
      const p = Math.max(0, dx);
      view.style.transform = `translateX(${p * 0.6}px)`;
      view.style.opacity = String(1 - Math.min(0.35, p / 800));
    }
  }, { passive: true });

  const end = () => {
    if (!start?.locked) { start = null; return; }
    view.classList.remove('is-swiping');
    view.classList.add('is-swipe-release');
    view.style.transform = '';
    view.style.opacity = '';
    setTimeout(() => view.classList.remove('is-swipe-release'), 400);
    if (dx > TRIGGER) backButton()?.click();
    start = null;
  };
  document.addEventListener('touchend', end, { passive: true });
  document.addEventListener('touchcancel', end, { passive: true });
}

export function setupIOS(view) {
  enableActiveStates();
  trackKeyboard();
  enableEdgeSwipeBack(view);
  document.documentElement.classList.toggle('is-standalone', isStandalone());
}
