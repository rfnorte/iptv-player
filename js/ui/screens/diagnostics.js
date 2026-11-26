/**
 * Diagnóstico de reprodução: capacidades do aparelho, streams de teste,
 * teste de um endereço qualquer e relatório copiável (sem dados pessoais).
 */
import { html, render, on } from '../../core/dom.js';
import { validateSourceUrl } from '../../core/validate.js';
import { APP_VERSION } from '../../config.js';
import { createSource, listSources } from '../../data/sources.js';
import { detectCapabilities, describeCapabilities } from '../../player/capabilities.js';
import { openPlayer } from '../../player/player.js';
import { extensionOf } from '../../player/stream-source.js';
import { screenHeader, mountHeader } from '../components/header.js';
import { segmented, setSegmented } from '../components/controls.js';
import { icon } from '../components/icons.js';
import { toast } from '../components/toast.js';
import { openImportSheet } from '../import-sheet.js';
import { bindCommonActions } from '../shared.js';

const local = (path) => new URL(`assets/test/${path}`, location.href).href;

/** Streams públicos de teste (sem direitos de terceiros) + amostras da própria app. */
const TESTS = [
  { id: 'local-hls', name: 'Amostra da app — HLS com 2 áudios e legendas', note: 'Servida pela própria app (HTTPS). Deve funcionar sempre.', url: () => local('media/master.m3u8'), live: true },
  { id: 'local-mp4', name: 'Amostra da app — filme MP4', note: 'Ficheiro MP4 (H.264/AAC).', url: () => local('filme-teste.mp4'), live: false },
  { id: 'local-mkv', name: 'Amostra da app — filme MKV', note: 'Esperado: aviso de formato não suportado no iPhone.', url: () => local('filme-teste.mkv'), live: false },
  { id: 'apple-ts', name: 'Apple — BipBop 16:9 (HLS TS)', note: 'Stream de teste público da Apple, com legendas.', url: () => 'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8', live: true },
  { id: 'apple-fmp4', name: 'Apple — avançado fMP4', note: 'Vários áudios, legendas e qualidades (inclui HEVC).', url: () => 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8', live: true },
  { id: 'mux', name: 'Mux — Big Buck Bunny (HLS)', note: 'Stream de teste público usado pela comunidade.', url: () => 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', live: true },
  { id: 'http', name: 'Apple BipBop por HTTP (mixed content)', note: 'Responde à pergunta: o iPhone reproduz vídeo HTTP dentro de uma app HTTPS? (Atenção: o servidor da Apple também tem HTTPS e o Safari pode atualizar o pedido automaticamente.)', url: () => 'http://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_16x9/bipbop_16x9_variant.m3u8', live: true },
];

const results = new Map(); // por sessão: id → relatório

function resultLine(r) {
  if (!r) return '';
  if (r.ok) {
    const parts = [`motor ${r.engine === 'hlsjs' ? 'hls.js' : 'nativo'}`];
    if (r.firstFrameMs) parts.push(`${(r.firstFrameMs / 1000).toFixed(1)} s até à imagem`);
    if (r.width) parts.push(`${r.width}×${r.height}`);
    if (r.audioTracks > 1) parts.push(`${r.audioTracks} áudios`);
    if (r.textTracks) parts.push(`${r.textTracks} legendas`);
    return html`<span class="diag-result diag-result--ok">${icon('check', { size: 'sm' })}Reproduziu · ${parts.join(' · ')}</span>`;
  }
  return html`<span class="diag-result diag-result--error">${icon('alert', { size: 'sm' })}${r.error ?? 'Falhou'}</span>`;
}

function capsMarkup() {
  return html`
    <div class="group__list">
      ${describeCapabilities().map(([label, ok, note]) => html`
        <div class="cell">
          <span class="cell__icon ${ok ? '' : 'cell__icon--neutral'}">${icon(ok ? 'check' : 'close', { size: 'sm' })}</span>
          <span class="cell__body"><span class="cell__title">${label}</span><span class="cell__subtitle">${note}</span></span>
          <span class="cell__value">${ok ? 'Sim' : 'Não'}</span>
        </div>`)}
    </div>`;
}

function testsMarkup() {
  return html`
    <div class="group__list">
      ${TESTS.map((t) => html`
        <div class="cell cell--stack" data-test-row="${t.id}">
          <span class="cell__body">
            <span class="cell__title">${t.name}</span>
            <span class="cell__subtitle">${t.note}</span>
            <span data-test-result="${t.id}">${resultLine(results.get(t.id))}</span>
          </span>
          <button class="btn btn--secondary btn--sm" type="button" data-run-test="${t.id}">${icon('play', { size: 'sm' })}<span>Testar</span></button>
        </div>`)}
    </div>`;
}

function buildReport() {
  const c = detectCapabilities();
  const lines = [
    `IPTV Player ${APP_VERSION} — diagnóstico de reprodução`,
    `Data: ${new Date().toLocaleString('pt-PT')}`,
    `Aparelho: ${c.ios ? 'iOS' : 'outro'} · ${navigator.userAgent.replace(/\([^)]*\)/, '(…)')}`,
    `Ecrã: ${screen.width}×${screen.height} @${devicePixelRatio}x · app instalada: ${navigator.standalone === true || matchMedia('(display-mode: standalone)').matches ? 'sim' : 'não'}`,
    '',
    'Capacidades:',
    ...describeCapabilities().map(([l, ok]) => `  ${ok ? '✓' : '✗'} ${l}`),
    '',
    'Testes:',
  ];
  for (const [id, r] of results) {
    const name = TESTS.find((t) => t.id === id)?.name ?? 'Endereço personalizado';
    lines.push(`  ${r.ok ? '✓' : '✗'} ${name} [${r.scheme ?? '?'}] — ${r.ok ? `motor ${r.engine}, ${r.firstFrameMs} ms, ${r.width}×${r.height}, áudios ${r.audioTracks}, legendas ${r.textTracks}` : r.error}`);
  }
  if (!results.size) lines.push('  (nenhum teste executado)');
  return lines.join('\n');
}

async function renderScreen(ctx) {
  const { outlet } = ctx;
  const caps = detectCapabilities();
  let engine = 'auto';

  render(outlet, html`
    ${screenHeader({ title: 'Diagnóstico', back: { fallback: '/settings', label: 'Voltar às definições' } })}
    <div class="stack">
      <section class="group">
        <h2 class="group__title">Este aparelho</h2>
        ${capsMarkup()}
      </section>

      <section class="group">
        <h2 class="group__title">Streams de teste</h2>
        ${testsMarkup()}
        <p class="group__footer">Os streams da Apple e da Mux são públicos e destinam-se a testes. Precisam de internet.</p>
      </section>

      <section class="group">
        <h2 class="group__title">Testar um endereço</h2>
        <div class="group__list diag-custom">
          <div class="field">
            <label class="field__label" for="diag-url">Endereço de um stream (.m3u8, .mp4…)</label>
            <input class="input" id="diag-url" type="url" inputmode="url" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="https://…/stream.m3u8">
            <p class="field__msg" data-msg-for="diag-url"></p>
            <span data-test-result="custom"></span>
          </div>
          <button class="btn btn--primary btn--block" type="button" data-run-custom>${icon('play', { size: 'sm' })}<span>Testar endereço</span></button>
          <p class="field__hint">O endereço não é guardado. Não cole endereços com a sua password em locais partilhados.</p>
        </div>
      </section>

      ${caps.mse ? html`
        <section class="group">
          <h2 class="group__title">Motor de reprodução</h2>
          <div class="group__list diag-custom">
            ${segmented('engine', [{ value: 'auto', label: 'Automático' }, { value: 'hlsjs', label: 'hls.js' }, { value: 'native', label: 'Nativo' }], engine, { label: 'Motor', block: true })}
          </div>
          <p class="group__footer">Para comparar motores. No iPhone, "Automático" usa o HLS nativo do Safari (recomendado).</p>
        </section>` : ''}

      <section class="group">
        <h2 class="group__title">Lista de teste</h2>
        <div class="group__list diag-custom">
          <p class="text-secondary">Adiciona uma lista com estes streams às Listas IPTV, para testar o percurso completo: importar → TV → reproduzir.</p>
          <button class="btn btn--secondary btn--block" type="button" data-add-test-list>${icon('plus', { size: 'sm' })}<span>Adicionar lista de teste</span></button>
        </div>
      </section>

      <button class="btn btn--gradient btn--lg btn--block" type="button" data-copy-report>${icon('share', { size: 'sm' })}<span>Copiar relatório</span></button>
      <p class="field__hint">O relatório inclui apenas capacidades do aparelho e resultados dos testes (sem endereços completos, listas ou credenciais).</p>
    </div>`);

  const setResult = (id, r) => {
    results.set(id, r);
    const slot = outlet.querySelector(`[data-test-result="${id}"]`);
    if (slot) render(slot, resultLine(r));
  };

  const run = (id, url, live) => {
    openPlayer({
      title: id === 'custom' ? 'Teste de endereço' : TESTS.find((t) => t.id === id).name,
      subtitle: 'Diagnóstico',
      play: { kind: live ? 'live' : 'movie', url, sourceId: null },
      isLive: live,
      force: engine === 'auto' ? undefined : engine,
      onReport: (r) => setResult(id, r),
    });
  };

  const offs = [
    bindCommonActions(outlet, ctx),
    mountHeader(outlet),
    on(outlet, 'click', '[data-run-test]', (e, b) => {
      const t = TESTS.find((x) => x.id === b.dataset.runTest);
      run(t.id, t.url(), t.live);
    }),
    on(outlet, 'click', '[data-run-custom]', () => {
      const input = outlet.querySelector('#diag-url');
      const msg = outlet.querySelector('[data-msg-for="diag-url"]');
      const r = validateSourceUrl(input.value);
      if (!r.ok) { msg.className = 'field__msg field__msg--error'; msg.textContent = r.error; return; }
      msg.textContent = '';
      const ext = extensionOf(r.url);
      run('custom', r.url, !(ext && ['mp4', 'm4v', 'mov', 'mkv', 'avi', 'webm'].includes(ext)));
    }),
    on(outlet, 'click', '[data-seg="engine"]', (e, b) => { engine = b.dataset.value; setSegmented(outlet, 'engine', engine); }),
    on(outlet, 'click', '[data-add-test-list]', async () => {
      const url = local('streams-teste.m3u');
      const existing = (await listSources()).find((s) => s.name === 'Streams de teste');
      if (existing) { toast('A lista de teste já existe em Listas IPTV.'); ctx.router.go(`/settings/sources/${encodeURIComponent(existing.id)}`); return; }
      const s = await createSource({ type: 'm3u-url', name: 'Streams de teste', url, refreshHours: 0 });
      openImportSheet(s.id);
    }),
    on(outlet, 'click', '[data-copy-report]', async () => {
      try {
        await navigator.clipboard.writeText(buildReport());
        toast('Relatório copiado. Pode colá-lo numa mensagem.', { type: 'success' });
      } catch {
        toast('Não foi possível copiar automaticamente.', { type: 'error' });
      }
    }),
  ];
  return () => offs.forEach((off) => off());
}

export const diagnosticsScreen = { render: renderScreen };
