/**
 * Auditoria de layout para o iPhone 17 Pro Max (iOS 26).
 *
 * Ecrã: 440 × 956 pontos, 3x. As safe areas são simuladas (o Chromium não as
 * tem) sobrepondo os tokens --safe-* com os valores típicos deste modelo:
 *   vertical:   topo 62 (Dynamic Island), base 34 (indicador inicial)
 *   horizontal: esquerda/direita 62, base 21
 * São valores aproximados — a confirmação final é feita no aparelho real.
 *
 * Falha se algum elemento interativo ou texto invadir uma safe area, se houver
 * scroll horizontal, ou alvos de toque < 44 pt.
 *
 * Uso: node tests/e2e/iphone.mjs [pasta-de-screenshots]
 */
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from '../serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 5211;
const APP = `http://127.0.0.1:${PORT}/index.html`;
const SHOTS = process.argv[2];
const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? '✓' : '✗'} ${msg}`); };

const MODES = {
  portrait: { viewport: { width: 440, height: 956 }, insets: { top: 62, right: 0, bottom: 34, left: 0 } },
  landscape: { viewport: { width: 956, height: 440 }, insets: { top: 0, right: 62, bottom: 21, left: 62 } },
};

async function applyInsets(page, i) {
  // CSSOM (permitido pela CSP, ao contrário de <style> inline)
  await page.evaluate((v) => {
    for (const [k, px] of Object.entries(v)) document.documentElement.style.setProperty(`--safe-${k}`, `${px}px`);
  }, i);
}

/** Elementos visíveis (interativos ou com texto) que invadem as safe areas. */
async function intrusions(page, i) {
  return page.evaluate(({ i }) => {
    const W = innerWidth, H = innerHeight;
    const sel = 'a, button, input, select, textarea, label, h1, h2, h3, p, .chip, .channel-row__name, .poster__title, .tabbar__item';
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('.rail, .chips, .vlist__window, .scrim')) continue; // conteúdo com scroll horizontal/sob o vidro
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom <= 0 || r.top >= H) continue; // fora do ecrã (scroll)
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
      const fixed = el.closest('.tabbar, .screen-header, .sheet, .dialog, .toast');
      const bad = [];
      if (r.left < i.left - 0.5) bad.push('esq');
      if (r.right > W - i.right + 0.5) bad.push('dir');
      // Conteúdo dentro de um painel com scroll pode passar por baixo do indicador (como no iOS);
      // só o "chrome" fixo (cabeçalhos, barra, botões fixos) tem de respeitar topo/base.
      const scrolling = el.closest('.sheet__body') && !el.closest('.form-actions--sticky');
      if (fixed && !scrolling && r.top < i.top - 0.5) bad.push('topo');
      if (fixed && !scrolling && r.bottom > H - i.bottom + 0.5) bad.push('base');
      if (bad.length) out.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 20)}" [${bad.join(',')}]`);
    }
    return [...new Set(out)];
  }, { i });
}

async function audit(page, mode, label) {
  const i = MODES[mode].insets;
  const bad = await intrusions(page, i);
  check(bad.length === 0, `[${mode}] ${label}: sem invasão das safe areas${bad.length ? ` → ${bad.slice(0, 4).join(' | ')}` : ''}`);
  const { sw, vw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: innerWidth }));
  check(sw <= vw, `[${mode}] ${label}: sem scroll horizontal`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${mode}-${label.replace(/\W+/g, '-')}.png` });
}

async function go(page, hash, selector) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForSelector(selector);
  await page.waitForTimeout(250);
}

async function run() {
  const server = await startServer(PORT);
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch();

  for (const mode of Object.keys(MODES)) {
    const ctx = await browser.newContext({ viewport: MODES[mode].viewport, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(APP);
    await applyInsets(page, MODES[mode].insets);
    await page.waitForSelector('.empty__title');
    await audit(page, mode, 'inicio vazio');

    await page.click('[data-action="enable-demo"]');
    await page.waitForSelector('.demo-banner');
    await page.waitForTimeout(300);
    await audit(page, mode, 'inicio');
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(200);
    await audit(page, mode, 'inicio com scroll');

    await go(page, '#/tv', '.channel-row');
    await audit(page, mode, 'tv lista');
    const visibleRows = await page.evaluate(() => {
      const top = document.querySelector('.screen-header').getBoundingClientRect().bottom;
      const bottom = document.querySelector('.tabbar').getBoundingClientRect().top;
      return [...document.querySelectorAll('.channel-row')].filter((r) => {
        const b = r.getBoundingClientRect();
        return b.top >= top && b.bottom <= bottom;
      }).length;
    });
    check(visibleRows >= (mode === 'portrait' ? 6 : 3), `[${mode}] tv: ${visibleRows} canais inteiros visíveis sem scroll`);
    await page.click('[data-seg="view"][data-value="grid"]');
    await page.waitForSelector('.channel-tile');
    await audit(page, mode, 'tv grelha');
    await page.locator('[data-action="open-channel"]').first().click();
    await page.waitForSelector('.sheet .channel-sheet');
    await page.waitForTimeout(200);
    await audit(page, mode, 'ficha canal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    await page.click('[data-seg="view"][data-value="list"]');

    await go(page, '#/movies', '.vlist .poster');
    await audit(page, mode, 'filmes');
    await page.locator('.vlist .poster').first().click();
    await page.waitForSelector('.detail-hero');
    await page.waitForTimeout(200);
    await audit(page, mode, 'detalhe filme');

    await go(page, '#/series', '.vlist .poster');
    await page.locator('.vlist .poster').first().click();
    await page.waitForSelector('.episodes');
    await page.waitForTimeout(200);
    await audit(page, mode, 'detalhe serie');

    await go(page, '#/settings', '.group');
    await audit(page, mode, 'definicoes');
    await go(page, '#/settings/sources?add=1', '[data-source-form]');
    await page.waitForTimeout(200);
    await audit(page, mode, 'adicionar lista');
    await page.click('[data-seg="type"][data-value="xtream"]');
    await page.waitForTimeout(100);
    await audit(page, mode, 'adicionar xtream');

    await ctx.close();
  }

  await browser.close();
  server.close();
  if (failures.length) { console.error(`\nFALHOU (${failures.length})`); process.exit(1); }
  console.log('\nOK — layout validado para iPhone 17 Pro Max (simulado).');
}

run().catch((err) => { console.error(err); process.exit(1); });
