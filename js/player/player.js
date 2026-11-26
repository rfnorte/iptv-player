/**
 * Leitor de vídeo — interface própria, minimalista, adaptada ao iPhone.
 *
 * - Vertical: vídeo no topo + informação e lista de canais por baixo.
 * - Horizontal: vídeo em ecrã inteiro (modo imersivo) com controlos sobrepostos.
 * - "Ecrã inteiro" no iPhone usa o modo nativo da Apple (a única opção do iOS).
 * - Só mostra controlos suportados (AirPlay, PiP, legendas, áudio, volume).
 * - Direto: reconexão automática com espera crescente. VOD: barra de progresso.
 *
 * Nada aqui finge sucesso: o estado "a reproduzir" só aparece com o evento
 * real `playing` do elemento de vídeo.
 */
import { html, render, on, vars } from '../core/dom.js';
import { formatTime, programmeProgress } from '../core/format.js';
import { icon } from '../ui/components/icons.js';
import { openSheet, lockScroll, unlockScroll } from '../ui/components/overlay.js';
import { channelLogo } from '../ui/components/cards.js';
import { detectCapabilities } from './capabilities.js';
import { attach, audioTracks, setAudioTrack, textTracks, setTextTrack } from './engine.js';
import { resolveStream } from './stream-source.js';

const MAX_RETRIES = 5;
const CHROME_HIDE_MS = 3500;
const STALL_TIMEOUT_MS = 20_000;

let current = null;

export const isPlayerOpen = () => Boolean(current);
export function closePlayer() { current?.close(); }

function fmtClock(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '--:--';
  const s = Math.floor(sec % 60);
  const m = Math.floor((sec / 60) % 60);
  const h = Math.floor(sec / 3600);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Mensagem compreensível a partir do erro do elemento de vídeo / hls.js. */
function explainFailure(info, stream) {
  if (stream?.insecure && (info.network || info.unsupported)) {
    return {
      title: 'O iPhone bloqueou este vídeo',
      text: 'O servidor do vídeo usa HTTP (sem cifra) e a app é servida por HTTPS. O Safari não permite esta combinação.',
      hint: 'Só se resolve com um endereço HTTPS do fornecedor ou com um intermediário (proxy).',
    };
  }
  if (stream?.likelyUnsupported) {
    return { title: `Formato ${stream.ext?.toUpperCase()} não suportado`, text: 'O Safari do iPhone não reproduz este formato de ficheiro.', hint: 'Procure outra versão do conteúdo (MP4 ou HLS), se o fornecedor a tiver.' };
  }
  if (info.decode) return { title: 'Não foi possível descodificar o vídeo', text: 'O codec usado pela fonte não é suportado por este aparelho.', hint: null };
  if (info.unsupported) return { title: 'Stream não suportado', text: 'O endereço não devolveu um vídeo que este aparelho consiga reproduzir (pode ser um formato incompatível, uma página de erro ou um link expirado).', hint: null };
  if (info.network) {
    const status = info.status ? ` (erro ${info.status})` : '';
    return { title: 'Falha de rede', text: `Não foi possível obter o vídeo do servidor${status}.`, hint: 'Verifique a ligação à internet. O canal pode estar temporariamente indisponível.' };
  }
  return { title: 'Erro de reprodução', text: info.message || 'Ocorreu um erro inesperado.', hint: null };
}

function chromeMarkup(opts, caps) {
  const live = opts.isLive;
  const zap = live && opts.neighbours?.length > 1;
  return html`
    <div class="player__top">
      <button class="player-btn" type="button" data-p="close" aria-label="Fechar leitor">${icon('minimize')}</button>
      <div class="player__titles">
        <div class="player__title truncate" data-p-title>${opts.title}</div>
        <div class="player__subtitle truncate" data-p-subtitle>${opts.subtitle ?? ''}</div>
      </div>
      <div class="player__actions">
        ${caps.airplay ? html`<button class="player-btn" type="button" data-p="airplay" aria-label="AirPlay" hidden>${icon('airplay')}</button>` : ''}
        ${caps.pip ? html`<button class="player-btn" type="button" data-p="pip" aria-label="Picture-in-Picture">${icon('pip')}</button>` : ''}
      </div>
    </div>
    <div class="player__center">
      ${zap ? html`<button class="player-btn player-btn--md" type="button" data-p="prev" aria-label="Canal anterior">${icon('prev')}</button>` : ''}
      ${!live ? html`<button class="player-btn player-btn--md" type="button" data-p="back10" aria-label="Recuar 10 segundos">${icon('back10')}</button>` : ''}
      <button class="player-btn player-btn--lg" type="button" data-p="toggle" aria-label="Reproduzir">${icon('play')}</button>
      ${!live ? html`<button class="player-btn player-btn--md" type="button" data-p="fwd10" aria-label="Avançar 10 segundos">${icon('fwd10')}</button>` : ''}
      ${zap ? html`<button class="player-btn player-btn--md" type="button" data-p="next" aria-label="Canal seguinte">${icon('next')}</button>` : ''}
    </div>
    <div class="player__bottom">
      ${live
        ? html`<span class="badge badge--live player__live">${icon('live', { size: 'sm' })}Ao vivo</span><span class="player__spacer"></span>`
        : html`
          <span class="player__time" data-p-time>0:00</span>
          <input class="player__scrub" type="range" min="0" max="1000" step="1" value="0" data-p-scrub aria-label="Posição">
          <span class="player__time" data-p-duration>--:--</span>`}
      <div class="player__tools">
        <button class="player-btn" type="button" data-p="subs" aria-label="Legendas" hidden>${icon('captions')}</button>
        <button class="player-btn" type="button" data-p="audio" aria-label="Faixa de áudio" hidden>${icon('audio')}</button>
        <button class="player-btn" type="button" data-p="mute" aria-label="Silenciar">${icon('volume')}</button>
        ${caps.volume ? html`<input class="player__volume" type="range" min="0" max="100" value="100" data-p-volume aria-label="Volume">` : ''}
        ${caps.nativeFullscreen || caps.elementFullscreen ? html`<button class="player-btn" type="button" data-p="fullscreen" aria-label="Ecrã inteiro">${icon('fullscreen')}</button>` : ''}
      </div>
    </div>`;
}

function infoMarkup(opts) {
  const epg = opts.epg;
  const now = epg?.now;
  return html`
    <div class="player-info__head">
      ${opts.logoItem ? channelLogo(opts.logoItem) : ''}
      <div class="player-info__titles">
        <h2 class="player-info__title">${opts.title}</h2>
        ${opts.subtitle ? html`<div class="text-secondary">${opts.subtitle}</div>` : ''}
      </div>
    </div>
    ${now ? html`
      <div class="programme programme--now">
        <div class="programme__label">Agora</div>
        <div class="programme__title">${now.title}</div>
        <div class="programme__time">${formatTime(now.start)} – ${formatTime(now.stop)}</div>
        <span class="progress" data-vars="${vars({ progress: programmeProgress(now.start, now.stop) })}"></span>
      </div>` : ''}
    ${opts.description ? html`<p class="text-secondary player-info__desc">${opts.description}</p>` : ''}
    ${opts.neighbours?.length > 1 ? html`
      <h3 class="section-header__title player-info__section">Canais · ${opts.subtitle ?? ''}</h3>
      <ul class="zap-list">
        ${opts.neighbours.slice(0, 300).map((c, i) => html`
          <li><button class="zap-row ${i === opts.index ? 'is-current' : ''}" type="button" data-zap="${i}" ${i === opts.index ? html`aria-current="true"` : ''}>
            ${channelLogo(c)}
            <span class="zap-row__body"><span class="zap-row__name truncate">${c.name}</span>
              <span class="zap-row__now truncate">${c.epg?.now?.title ?? ''}</span></span>
            ${i === opts.index ? html`<span class="badge badge--accent">A ver</span>` : ''}
          </button></li>`)}
      </ul>` : ''}`;
}

function openTrackSheet(title, tracks, { allowOff, onPick }) {
  openSheet({
    title,
    content: html`
      <div class="group__list">
        ${allowOff ? html`<button class="cell" type="button" data-track="-1"><span class="cell__body"><span class="cell__title">Desligadas</span></span>${tracks.some((t) => t.active) ? '' : html`<span class="cell__value">${icon('check', { size: 'sm' })}</span>`}</button>` : ''}
        ${tracks.map((t) => html`
          <button class="cell" type="button" data-track="${t.id}">
            <span class="cell__body"><span class="cell__title">${t.label}</span>${t.lang ? html`<span class="cell__subtitle">${t.lang}</span>` : ''}</span>
            ${t.active ? html`<span class="cell__value">${icon('check', { size: 'sm' })}</span>` : ''}
          </button>`)}
      </div>`,
    onMount(body, sheet) {
      return on(body, 'click', '[data-track]', (e, b) => { onPick(Number(b.dataset.track)); sheet.close(); });
    },
  });
}

/**
 * Abre o leitor.
 * @param {{
 *   title: string, subtitle?: string, play: object, isLive: boolean, artwork?: string|null,
 *   logoItem?: object, epg?: object, description?: string,
 *   neighbours?: object[], index?: number,   // canais para navegação rápida (direto)
 *   force?: 'native'|'hlsjs', onReport?: (r: object) => void, onClose?: () => void
 * }} opts
 */
export function openPlayer(opts) {
  current?.close();
  const caps = detectCapabilities();
  const root = document.createElement('div');
  root.className = 'player-root';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', `Leitor: ${opts.title}`);

  render(root, html`
    <div class="player" data-state="loading">
      <div class="player__stage" data-p-stage>
        <video class="player__video" playsinline webkit-playsinline x-webkit-airplay="allow" preload="auto"></video>
        <div class="player__shade" aria-hidden="true"></div>
        <div class="player__spinner" aria-hidden="true"></div>
        <div class="player__message" data-p-message hidden></div>
        <div class="player__chrome" data-p-chrome></div>
      </div>
      <div class="player__info" data-p-info></div>
    </div>`);
  (document.getElementById('overlays') ?? document.body).append(root);
  lockScroll();

  const el = root.querySelector('.player');
  const stage = root.querySelector('[data-p-stage]');
  const video = root.querySelector('video');
  const chrome = root.querySelector('[data-p-chrome]');
  const message = root.querySelector('[data-p-message]');
  const info = root.querySelector('[data-p-info]');
  const previousFocus = document.activeElement;

  let state = { ...opts };
  let session = null;
  let stream = null;
  let attempts = 0;
  let retryTimer = null;
  let stallTimer = null;
  let hideTimer = null;
  let closed = false;
  let loadToken = 0;
  let scrubbing = false;
  let report = null;
  const offs = [];

  const q = (sel) => root.querySelector(sel);
  const setState = (s) => { el.dataset.state = s; updateToggle(); };

  function paintChrome() {
    render(chrome, chromeMarkup(state, caps));
    render(info, infoMarkup(state));
    root.querySelector('.zap-row.is-current')?.scrollIntoView({ block: 'center' });
  }

  function updateToggle() {
    const btn = q('[data-p="toggle"]');
    if (!btn) return;
    const playing = !video.paused && !video.ended;
    btn.setAttribute('aria-label', playing ? 'Pausa' : 'Reproduzir');
    btn.querySelector('svg').outerHTML = icon(playing ? 'pause' : 'play').value;
  }

  function showChrome(autoHide = true) {
    el.classList.add('is-chrome');
    clearTimeout(hideTimer);
    if (autoHide && !video.paused) hideTimer = setTimeout(() => el.classList.remove('is-chrome'), CHROME_HIDE_MS);
  }

  function showMessage(m, actions) {
    message.hidden = false;
    render(message, html`
      <div class="player__message-box">
        <div class="player__message-title">${m.title}</div>
        ${m.text ? html`<p>${m.text}</p>` : ''}
        ${m.hint ? html`<p class="player__message-hint">${m.hint}</p>` : ''}
        ${actions ?? ''}
      </div>`);
  }
  const hideMessage = () => { message.hidden = true; render(message, ''); };

  function finishReport(ok, extra = {}) {
    if (!report || report.done) return;
    report.done = true;
    Object.assign(report, { ok, ...extra, width: video.videoWidth || null, height: video.videoHeight || null,
      audioTracks: audioTracks(video, session).length, textTracks: textTracks(video, session).length });
    opts.onReport?.({ ...report });
  }

  function updateTrackButtons() {
    const subs = q('[data-p="subs"]');
    const aud = q('[data-p="audio"]');
    if (subs) subs.hidden = textTracks(video, session).length === 0;
    if (aud) aud.hidden = audioTracks(video, session).length < 2;
  }

  function setMediaSession() {
    if (!caps.mediaSession) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: state.title,
        artist: state.subtitle ?? '',
        album: 'IPTV Player',
        artwork: state.artwork ? [{ src: state.artwork, sizes: '512x512' }] : [{ src: 'assets/icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
      });
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', () => video.play());
      ms.setActionHandler('pause', () => video.pause());
      if (state.isLive && state.neighbours?.length > 1) {
        ms.setActionHandler('previoustrack', () => zap(-1));
        ms.setActionHandler('nexttrack', () => zap(1));
      } else if (!state.isLive) {
        ms.setActionHandler('seekbackward', () => seekBy(-10));
        ms.setActionHandler('seekforward', () => seekBy(10));
      }
    } catch { /* opcional */ }
  }

  async function load({ forceTry = false } = {}) {
    const token = ++loadToken;
    clearTimeout(retryTimer);
    clearTimeout(stallTimer);
    hideMessage();
    setState('loading');
    session?.destroy();
    session = null;
    report = { url: null, engine: null, startedAt: performance.now(), done: false };

    try {
      stream = await resolveStream(state.play);
    } catch (err) {
      if (token !== loadToken) return;
      setState('error');
      showMessage({ title: 'Não é possível reproduzir', text: err.message });
      finishReport(false, { error: err.message });
      return;
    }
    if (token !== loadToken || closed) return;
    report.url = stream.url.replace(/\/\/[^/]+/, '//…');
    report.scheme = stream.url.split(':')[0];

    if (stream.likelyUnsupported && !caps.mkv && !forceTry) {
      setState('error');
      const m = explainFailure({}, stream);
      showMessage(m, html`<div class="player__message-actions"><button class="btn btn--secondary" type="button" data-p="force">Tentar mesmo assim</button></div>`);
      finishReport(false, { error: m.title });
      return;
    }

    try {
      session = await attach(video, stream.url, {
        ext: stream.ext,
        force: state.force,
        onFatal: (f) => handleFailure({ network: f.network, unsupported: !f.network, status: f.status, message: f.detail }),
        onTracks: updateTrackButtons,
      });
    } catch (err) {
      handleFailure({ message: err.message });
      return;
    }
    if (token !== loadToken || closed) { session?.destroy(); return; }
    report.engine = session.engine;
    setMediaSession();
    try {
      await video.play();
    } catch (err) {
      if (err?.name === 'NotAllowedError') { setState('paused'); showChrome(false); }
      // outros erros chegam pelo evento "error"
    }
  }

  function handleFailure(infoErr) {
    if (closed) return;
    clearTimeout(stallTimer);
    const transient = state.isLive && !stream?.insecure && !stream?.likelyUnsupported && (infoErr.network || infoErr.stall);
    if (transient && attempts < MAX_RETRIES) {
      attempts++;
      const delay = Math.min(16, 2 ** (attempts - 1)) * 1000;
      setState('reconnecting');
      showMessage({ title: 'A restabelecer a ligação…', text: `Tentativa ${attempts} de ${MAX_RETRIES}.` });
      retryTimer = setTimeout(() => load(), delay);
      return;
    }
    setState('error');
    const m = explainFailure(infoErr, stream);
    showMessage(m, html`<div class="player__message-actions">
      <button class="btn btn--primary" type="button" data-p="retry">Tentar novamente</button>
      <button class="btn btn--secondary" type="button" data-p="close">Fechar</button></div>`);
    finishReport(false, { error: m.title });
    showChrome(false);
  }

  function seekBy(sec) {
    if (!Number.isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration - 0.5, video.currentTime + sec));
    showChrome();
  }

  async function zap(delta) {
    const list = state.neighbours;
    if (!list?.length) return;
    const index = (state.index + delta + list.length) % list.length;
    const c = list[index];
    state = { ...state, index, title: c.name, play: c.play, logoItem: c, epg: c.epg, artwork: c.logo ?? null };
    attempts = 0;
    paintChrome();
    root.setAttribute('aria-label', `Leitor: ${c.name}`);
    showChrome();
    await load();
  }

  async function toggleFullscreen() {
    try {
      if (caps.nativeFullscreen && caps.ios) { video.webkitEnterFullscreen(); return; }
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        await (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.());
      } else {
        await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
      }
    } catch { /* recusado pelo browser */ }
  }

  async function togglePip() {
    try {
      if (typeof video.webkitSetPresentationMode === 'function' && caps.ios) {
        video.webkitSetPresentationMode(video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
      } else if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await video.requestPictureInPicture();
      }
    } catch { /* indisponível para esta fonte */ }
  }

  /* ---------------- Eventos do vídeo ---------------- */
  const vOn = (type, fn) => { video.addEventListener(type, fn); offs.push(() => video.removeEventListener(type, fn)); };
  vOn('playing', () => {
    clearTimeout(stallTimer);
    attempts = 0;
    hideMessage();
    setState('playing');
    showChrome();
    if (report && !report.done) finishReport(true, { firstFrameMs: Math.round(performance.now() - report.startedAt) });
  });
  vOn('pause', () => { if (el.dataset.state === 'playing') setState('paused'); showChrome(false); });
  vOn('waiting', () => {
    if (el.dataset.state === 'error') return;
    setState('buffering');
    clearTimeout(stallTimer);
    if (state.isLive) stallTimer = setTimeout(() => handleFailure({ stall: true, network: true }), STALL_TIMEOUT_MS);
  });
  vOn('ended', () => { if (state.isLive) handleFailure({ network: true, stall: true }); else { setState('ended'); showChrome(false); } });
  vOn('error', () => {
    const e = video.error;
    if (!e || !session) return;
    handleFailure({ network: e.code === 2, decode: e.code === 3, unsupported: e.code === 4, message: e.message });
  });
  vOn('loadedmetadata', () => {
    updateTrackButtons();
    const d = q('[data-p-duration]');
    if (d) d.textContent = fmtClock(video.duration);
  });
  vOn('timeupdate', () => {
    if (state.isLive || scrubbing) return;
    const t = q('[data-p-time]');
    const s = q('[data-p-scrub]');
    if (t) t.textContent = fmtClock(video.currentTime);
    if (s && Number.isFinite(video.duration) && video.duration > 0) s.value = String(Math.round((video.currentTime / video.duration) * 1000));
  });
  vOn('volumechange', () => {
    const m = q('[data-p="mute"]');
    if (m) { m.querySelector('svg').outerHTML = icon(video.muted || video.volume === 0 ? 'mute' : 'volume').value; m.setAttribute('aria-label', video.muted ? 'Ativar som' : 'Silenciar'); }
  });
  if (caps.airplay) {
    vOn('webkitplaybacktargetavailabilitychanged', (e) => { const b = q('[data-p="airplay"]'); if (b) b.hidden = e.availability !== 'available'; });
  }
  if (video.audioTracks) { video.audioTracks.onaddtrack = updateTrackButtons; video.audioTracks.onremovetrack = updateTrackButtons; }
  if (video.textTracks) { video.textTracks.onaddtrack = updateTrackButtons; video.textTracks.onremovetrack = updateTrackButtons; }

  /* ---------------- Controlos ---------------- */
  offs.push(on(root, 'click', '[data-p]', (e, b) => {
    e.stopPropagation();
    const a = b.dataset.p;
    if (a === 'close') api.close();
    else if (a === 'toggle') { if (video.paused || video.ended) video.play().catch(() => {}); else video.pause(); }
    else if (a === 'back10') seekBy(-10);
    else if (a === 'fwd10') seekBy(10);
    else if (a === 'prev') zap(-1);
    else if (a === 'next') zap(1);
    else if (a === 'retry') { attempts = 0; load(); }
    else if (a === 'force') load({ forceTry: true });
    else if (a === 'mute') video.muted = !video.muted;
    else if (a === 'fullscreen') toggleFullscreen();
    else if (a === 'pip') togglePip();
    else if (a === 'airplay') video.webkitShowPlaybackTargetPicker?.();
    else if (a === 'subs') openTrackSheet('Legendas', textTracks(video, session), { allowOff: true, onPick: (id) => setTextTrack(video, session, id) });
    else if (a === 'audio') openTrackSheet('Áudio', audioTracks(video, session), { allowOff: false, onPick: (id) => setAudioTrack(video, session, id) });
    showChrome();
  }));
  offs.push(on(root, 'click', '[data-zap]', (e, b) => zap(Number(b.dataset.zap) - state.index)));
  offs.push(on(root, 'input', '[data-p-scrub]', (e, s) => {
    scrubbing = true;
    if (Number.isFinite(video.duration)) q('[data-p-time]').textContent = fmtClock((Number(s.value) / 1000) * video.duration);
    showChrome(false);
  }));
  offs.push(on(root, 'change', '[data-p-scrub]', (e, s) => {
    scrubbing = false;
    if (Number.isFinite(video.duration)) video.currentTime = (Number(s.value) / 1000) * video.duration;
    showChrome();
  }));
  offs.push(on(root, 'input', '[data-p-volume]', (e, s) => { video.volume = Number(s.value) / 100; video.muted = false; }));

  // Toque no vídeo mostra/esconde os controlos.
  const onStageClick = (e) => {
    if (e.target instanceof Element && e.target.closest('button, input, [data-p-message]')) return;
    if (el.classList.contains('is-chrome') && !video.paused) { el.classList.remove('is-chrome'); clearTimeout(hideTimer); }
    else showChrome();
  };
  stage.addEventListener('click', onStageClick);
  offs.push(() => stage.removeEventListener('click', onStageClick));

  // Deslizar para baixo sobre o vídeo fecha o leitor.
  let swipe = null;
  const onTouchStart = (e) => {
    if (e.touches.length !== 1 || (e.target instanceof Element && e.target.closest('input'))) return;
    swipe = { y: e.touches[0].clientY, x: e.touches[0].clientX };
  };
  const onTouchEnd = (e) => {
    if (!swipe) return;
    const t = e.changedTouches[0];
    if (t.clientY - swipe.y > 120 && Math.abs(t.clientX - swipe.x) < 80) api.close();
    swipe = null;
  };
  stage.addEventListener('touchstart', onTouchStart, { passive: true });
  stage.addEventListener('touchend', onTouchEnd, { passive: true });
  offs.push(() => { stage.removeEventListener('touchstart', onTouchStart); stage.removeEventListener('touchend', onTouchEnd); });

  const onKey = (e) => {
    if (document.querySelector('.overlay-root')) return; // painel de faixas aberto
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); api.close(); }
    else if (k === ' ' || k === 'k') { e.preventDefault(); q('[data-p="toggle"]')?.click(); }
    else if (k === 'ArrowLeft') { if (state.isLive) zap(-1); else seekBy(-10); }
    else if (k === 'ArrowRight') { if (state.isLive) zap(1); else seekBy(10); }
    else if (k === 'f') toggleFullscreen();
    else if (k === 'm') video.muted = !video.muted;
  };
  document.addEventListener('keydown', onKey);
  offs.push(() => document.removeEventListener('keydown', onKey));

  // Ao voltar à app, um canal em direto retoma no momento atual.
  let wasPlaying = false;
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') wasPlaying = !video.paused;
    else if (state.isLive && wasPlaying && video.paused) load();
  };
  document.addEventListener('visibilitychange', onVisibility);
  offs.push(() => document.removeEventListener('visibilitychange', onVisibility));

  const api = {
    close() {
      if (closed) return;
      closed = true;
      loadToken++;
      clearTimeout(retryTimer); clearTimeout(stallTimer); clearTimeout(hideTimer);
      if (report && !report.done) finishReport(false, { error: 'Fechado antes de reproduzir' });
      try { if (document.pictureInPictureElement === video) document.exitPictureInPicture(); } catch { /* ignora */ }
      video.pause();
      session?.destroy();
      offs.forEach((off) => off());
      if (caps.mediaSession) {
        try { navigator.mediaSession.metadata = null; } catch { /* ignora */ }
      }
      root.remove();
      unlockScroll();
      if (previousFocus instanceof HTMLElement && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
      if (current === api) current = null;
      opts.onClose?.();
    },
    get video() { return video; },
  };
  current = api;

  paintChrome();
  showChrome(false);
  requestAnimationFrame(() => root.classList.add('is-open'));
  q('[data-p="toggle"]')?.focus({ preventScroll: true });
  load();
  return api;
}
