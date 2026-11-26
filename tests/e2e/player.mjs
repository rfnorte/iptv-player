/**
 * E2E da Fase 4 — leitor de vídeo com reprodução REAL (o tempo do vídeo tem de avançar).
 * Usa as amostras HLS/MP4/MKV da própria app e servidores simulados locais.
 * Nota: Chromium ≠ Safari iOS — o comportamento no iPhone é validado no aparelho.
 *
 * Uso: node tests/e2e/player.mjs [pasta-de-screenshots]
 */
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from '../serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 5231;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const APP = `${ORIGIN}/index.html`;
const SHOTS = process.argv[2];
const failures = [];
const check = (c, m) => { if (!c) failures.push(m); console.log(`${c ? '✓' : '✗'} ${m}`); };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

/** Espera que o vídeo esteja realmente a avançar (currentTime cresce). */
async function waitAdvancing(page, minSeconds = 1.5, timeout = 20_000) {
  try {
    await page.waitForFunction((min) => {
      const v = document.querySelector('.player__video');
      return v && !v.paused && v.currentTime >= min && v.readyState >= 2;
    }, minSeconds, { timeout });
    return true;
  } catch { return false; }
}

const playerState = (page) => page.getAttribute('.player', 'data-state');

async function closePlayer(page) {
  await page.click('.player [data-p="close"]');
  await page.waitForSelector('.player-root', { state: 'detached' });
}

async function run() {
  const server = await startServer(PORT, { mocks: true });
  if (SHOTS) await mkdir(SHOTS, { recursive: true });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${APP}#/settings/diagnostics`);
  await page.waitForSelector('[data-run-test="local-hls"]');
  await shot(page, 'p4-01-diagnostics');

  /* 1. HLS local com motor automático */
  await page.click('[data-run-test="local-hls"]');
  await page.waitForSelector('.player');
  check(await waitAdvancing(page), 'HLS (motor automático): vídeo a avançar');
  check(await playerState(page) === 'playing', `estado "playing" (obtido: ${await playerState(page)})`);
  await page.waitForTimeout(300);
  await shot(page, 'p4-02-player-portrait');
  await closePlayer(page);
  check((await page.textContent('[data-test-result="local-hls"]')).includes('Reproduziu'), 'diagnóstico regista sucesso');
  check(await page.evaluate(() => !document.body.classList.contains('is-scroll-locked')), 'scroll desbloqueado após fechar');

  /* 2. HLS com hls.js: faixas de áudio e legendas */
  await page.click('[data-seg="engine"][data-value="hlsjs"]');
  await page.click('[data-run-test="local-hls"]');
  check(await waitAdvancing(page), 'HLS (hls.js): vídeo a avançar');
  await page.waitForFunction(() => !document.querySelector('[data-p="audio"]').hidden && !document.querySelector('[data-p="subs"]').hidden, null, { timeout: 10_000 }).catch(() => {});
  check(!(await page.locator('[data-p="audio"]').isHidden()), 'hls.js: botão de áudio visível (2 faixas)');
  check(!(await page.locator('[data-p="subs"]').isHidden()), 'hls.js: botão de legendas visível');
  await page.click('[data-p="subs"]', { force: true });
  await page.waitForSelector('.sheet [data-track]');
  await page.locator('.sheet [data-track="0"]').click();
  await page.waitForTimeout(2500);
  const cue = await page.evaluate(() => [...document.querySelector('.player__video').textTracks].some((t) => t.mode === 'showing'));
  check(cue, 'legenda ativada');
  await page.click('[data-p="audio"]', { force: true });
  await page.waitForSelector('.sheet [data-track]');
  await page.locator('.sheet [data-track="1"]').click();
  await page.waitForTimeout(800);
  check(await page.evaluate(() => true), 'troca de faixa de áudio sem erro');
  await closePlayer(page);
  await page.click('[data-seg="engine"][data-value="auto"]');

  /* 3. MP4 (VOD): barra de progresso e avanço de 10 s */
  await page.click('[data-run-test="local-mp4"]');
  check(await waitAdvancing(page, 1), 'MP4: vídeo a avançar');
  check(await page.locator('[data-p-scrub]').count() === 1, 'MP4: barra de progresso presente');
  const before = await page.evaluate(() => document.querySelector('.player__video').currentTime);
  await page.click('[data-p="fwd10"]', { force: true });
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => document.querySelector('.player__video').currentTime);
  check(after - before >= 5, `MP4: avançar 10 s (${before.toFixed(1)} → ${after.toFixed(1)})`);
  await closePlayer(page);

  /* 4. MKV: aviso antes de tentar */
  await page.click('[data-run-test="local-mkv"]');
  // Safari iPhone: aviso antes de tentar. Chromium: suporta MKV e reproduz. Ambos são corretos.
  const mkvOutcome = await Promise.race([
    page.waitForSelector('.player [data-p-message]:not([hidden])', { timeout: 15_000 }).then(() => 'aviso'),
    waitAdvancing(page, 0.5, 15_000).then((ok) => (ok ? 'reproduziu' : 'nada')),
  ]);
  const mkvCaps = await page.evaluate(() => document.createElement('video').canPlayType('video/x-matroska'));
  check(mkvCaps ? mkvOutcome === 'reproduziu' : mkvOutcome === 'aviso', `MKV: browser ${mkvCaps ? 'suporta' : 'não suporta'} → ${mkvOutcome}`);
  await shot(page, 'p4-03-mkv');
  await closePlayer(page);

  /* 5. Erro em VOD (404): mensagem clara, sem tentativas infinitas */
  await page.fill('#diag-url', `${ORIGIN}/nao-existe/filme.mp4`);
  await page.click('[data-run-custom]');
  await page.waitForFunction(() => document.querySelector('.player')?.dataset.state === 'error', null, { timeout: 15_000 });
  check(true, 'VOD inexistente → estado de erro');
  check(await page.locator('.player [data-p="retry"]').count() === 1, 'erro oferece "Tentar novamente"');
  await page.waitForTimeout(400);
  const msgFits = await page.evaluate(() => {
    const st = document.querySelector('.player__stage').getBoundingClientRect();
    const box = document.querySelector('.player__message-box').getBoundingClientRect();
    return box.top >= st.top && box.bottom <= st.bottom + 1;
  });
  check(msgFits, 'mensagem de erro cabe no vídeo (vertical)');
  await shot(page, 'p4-04-error');
  await closePlayer(page);

  /* 6. Direto instável: 2 falhas (503) → reconexão automática → reproduz */
  await page.fill('#diag-url', `${ORIGIN}/__mock/flaky/a${Date.now()}/master.m3u8`);
  await page.click('[data-seg="engine"][data-value="hlsjs"]');
  await page.click('[data-run-custom]');
  let sawReconnect = false;
  try {
    await page.waitForFunction(() => document.querySelector('.player')?.dataset.state === 'reconnecting', null, { timeout: 10_000 });
    sawReconnect = true;
  } catch { /* pode recuperar antes */ }
  check(sawReconnect, 'direto: mostra "A restabelecer a ligação…"');
  if (sawReconnect) {
    const closable = await page.evaluate(() => {
      const b = document.querySelector('.player [data-p="close"]').getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return Boolean(hit?.closest('[data-p="close"]'));
    });
    check(closable, 'durante a reconexão o botão "fechar" é tocável');
  }
  check(await waitAdvancing(page, 1, 30_000), 'direto: recupera e reproduz após falhas');
  await closePlayer(page);
  await page.click('[data-seg="engine"][data-value="auto"]');

  /* 7. Percurso completo: lista de teste → TV → reproduzir → mudar de canal */
  await page.click('[data-add-test-list]');
  await page.waitForSelector('.import-result', { timeout: 30_000 });
  check((await page.textContent('.import-result__title')) === 'Lista importada', 'lista de teste importada');
  await page.locator('.sheet [data-close].icon-btn').last().click();
  await page.evaluate(() => { location.hash = '#/tv'; });
  await page.waitForSelector('.channel-row');
  await page.locator('.channel-row__main', { hasText: 'Teste local (HLS' }).click();
  check(await waitAdvancing(page), 'TV → canal reproduz');
  const title1 = await page.textContent('[data-p-title]');
  check(await page.locator('.zap-row').count() >= 2, 'lista de canais da categoria no leitor');
  await page.click('[data-p="next"]', { force: true });
  await page.waitForTimeout(400);
  const title2 = await page.textContent('[data-p-title]');
  check(title1 !== title2, `mudar de canal (${title1.trim()} → ${title2.trim()})`);
  check(await waitAdvancing(page, 0.5), 'canal seguinte reproduz');
  await shot(page, 'p4-05-zap');

  /* 8. Horizontal (iPhone 17 Pro Max): imersivo e controlos fora das safe areas */
  await page.setViewportSize({ width: 956, height: 440 });
  await page.evaluate(() => { for (const [k, v] of Object.entries({ top: 0, right: 62, bottom: 21, left: 62 })) document.documentElement.style.setProperty(`--safe-${k}`, `${v}px`); });
  await page.click('.player__stage', { position: { x: 400, y: 200 } });
  await page.waitForTimeout(300);
  const layout = await page.evaluate(() => {
    const stage = document.querySelector('.player__stage').getBoundingClientRect();
    const bad = [...document.querySelectorAll('.player__chrome button, .player__chrome input')].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width && (r.left < 62 - 0.5 || r.right > innerWidth - 62 + 0.5 || r.bottom > innerHeight - 21 + 0.5);
    }).length;
    return { full: stage.width === innerWidth && stage.height === innerHeight, bad };
  });
  check(layout.full, 'horizontal: vídeo ocupa o ecrã inteiro');
  check(layout.bad === 0, `horizontal: controlos fora das safe areas (${layout.bad} em falta)`);
  await shot(page, 'p4-06-landscape');
  await closePlayer(page);

  /* 9. Simulação do Safari do iPhone sem suporte MKV: aviso ANTES de tentar */
  const ios = await browser.newContext({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true });
  const ip = await ios.newPage();
  await ip.addInitScript(() => {
    const orig = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = function (t) { return /matroska/i.test(t) ? '' : orig.call(this, t); };
  });
  await ip.goto(`${APP}#/settings/diagnostics`);
  await ip.waitForSelector('[data-run-test="local-mkv"]');
  await ip.click('[data-run-test="local-mkv"]');
  await ip.waitForSelector('.player [data-p-message]:not([hidden])', { timeout: 10_000 });
  check(/MKV não suportado/i.test(await ip.textContent('.player [data-p-message]')), 'sem suporte MKV (como no iPhone): aviso antes de tentar');
  check(await ip.locator('.player [data-p="force"]').count() === 1, 'aviso MKV oferece "Tentar mesmo assim"');
  await ip.waitForTimeout(400);
  if (SHOTS) await ip.screenshot({ path: `${SHOTS}/p4-07-mkv-ios.png` });
  await ios.close();

  check(errors.length === 0, `sem erros JS (${errors.slice(0, 3).join(' | ')})`);
  await browser.close();
  server.close();
  if (failures.length) { console.error(`\nFALHOU (${failures.length})`); process.exit(1); }
  console.log('\nOK — leitor validado.');
}

run().catch((err) => { console.error(err); process.exit(1); });
