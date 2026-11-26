/**
 * Gesto "deslizar da margem esquerda para voltar" (apenas na app instalada).
 * Simula o modo instalado do iOS (navigator.standalone) e toques reais via CDP.
 * Uso: node tests/e2e/gestures.mjs
 */
import { createRequire } from 'node:module';
import { startServer } from '../serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const failures = [];
const check = (c, m) => { if (!c) failures.push(m); console.log(`${c ? '✓' : '✗'} ${m}`); };

const server = await startServer(5222);
const browser = await chromium.launch();

async function scenario(standalone) {
  const ctx = await browser.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  if (standalone) await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const swipe = async (points) => { await touch('touchStart', ...points[0]); for (const pt of points.slice(1)) await touch('touchMove', ...pt); await touch('touchEnd'); await page.waitForTimeout(500); };

  await page.goto('http://127.0.0.1:5222/index.html');
  await page.click('[data-action="enable-demo"]');
  await page.evaluate(() => { location.hash = '#/movies'; });
  await page.waitForSelector('.vlist .poster');
  await page.locator('.vlist .poster').first().click();
  await page.waitForSelector('.detail-hero');
  const detail = await page.evaluate(() => location.hash);

  await swipe(Array.from({ length: 10 }, (_, k) => [12, 500 - k * 20]));
  check(await page.evaluate(() => location.hash) === detail, `[${standalone ? 'instalada' : 'Safari'}] deslize vertical junto à margem não volta atrás`);

  await swipe(Array.from({ length: 15 }, (_, k) => [10 + k * 15, 505]));
  const after = await page.evaluate(() => location.hash);
  if (standalone) check(after === '#/movies', '[instalada] deslize da margem esquerda volta ao ecrã anterior');
  else check(after === detail, '[Safari] gesto próprio desativado (o Safari tem o seu gesto nativo)');
  await ctx.close();
}

await scenario(true);
await scenario(false);
await browser.close();
server.close();
if (failures.length) { console.error(`\nFALHOU (${failures.length})`); process.exit(1); }
console.log('\nOK — gestos validados.');
