/**
 * Gera ícones PNG e ecrãs de arranque a partir de assets/icons/icon.svg.
 * Ferramenta de desenvolvimento (Playwright + Chromium). A app não a usa.
 *
 * Uso: node tools/generate-assets.mjs
 */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const BG = '#090B10';
const TEXT = '#F5F7FA';
const MUTED = '#929BAC';

const svg = await readFile(join(ROOT, 'assets/icons/icon.svg'), 'utf8');
const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const ICONS = [
  { file: 'assets/icons/apple-touch-icon.png', size: 180 },
  { file: 'assets/icons/icon-192.png', size: 192 },
  { file: 'assets/icons/icon-512.png', size: 512 },
  { file: 'assets/icons/favicon-32.png', size: 32 },
  // "maskable": o desenho tem de caber na zona segura (80 %) — reduzimos o glifo com margem de cor
  { file: 'assets/icons/icon-maskable-512.png', size: 512, maskable: true },
];

// iPhone 17 Pro Max: 440 × 956 pt @3x → 1320 × 2868 px
const SPLASH = [
  { file: 'assets/splash/iphone-pro-max-portrait.png', w: 1320, h: 2868 },
  { file: 'assets/splash/iphone-pro-max-landscape.png', w: 2868, h: 1320 },
];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const icon of ICONS) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  const inner = icon.maskable ? '72%' : '100%';
  await page.setContent(`<html><body style="margin:0;background:#5468F0;display:grid;place-items:center;width:${icon.size}px;height:${icon.size}px;overflow:hidden">
    <img src="${dataUri}" style="width:${inner};height:${inner};${icon.maskable ? 'border-radius:0' : ''}"></body></html>`);
  await page.waitForTimeout(50);
  await page.screenshot({ path: join(ROOT, icon.file), omitBackground: false });
}

for (const s of SPLASH) {
  await page.setViewportSize({ width: s.w / 3, height: s.h / 3 });
  await page.setContent(`<html><body style="margin:0;background:${BG};width:100vw;height:100vh;display:grid;place-items:center;font-family:-apple-system,'Segoe UI',Roboto,sans-serif">
    <div style="display:grid;justify-items:center;gap:20px">
      <img src="${dataUri}" style="width:112px;height:112px;border-radius:26px;box-shadow:0 18px 40px rgba(0,0,0,.45)">
      <div style="color:${TEXT};font-size:22px;font-weight:700;letter-spacing:-0.02em">IPTV Player</div>
      <div style="color:${MUTED};font-size:13px">A carregar…</div>
    </div></body></html>`);
  await page.waitForTimeout(50);
  // deviceScaleFactor 3 → resolução física exata
  const ctx = await browser.newContext({ viewport: { width: s.w / 3, height: s.h / 3 }, deviceScaleFactor: 3 });
  const p3 = await ctx.newPage();
  await p3.setContent(await page.content());
  await p3.waitForTimeout(50);
  await p3.screenshot({ path: join(ROOT, s.file) });
  await ctx.close();
}

await browser.close();
console.log('Ícones e ecrãs de arranque gerados.');
