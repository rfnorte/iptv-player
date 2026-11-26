/**
 * Motores de reprodução.
 *
 *  native  — o browser reproduz diretamente (HLS no Safari/iPhone, MP4 em todos)
 *  hlsjs   — hls.js sobre Media Source (browsers sem HLS nativo, ex.: Chrome em PC)
 *
 * Escolha: HLS → nativo se existir, senão hls.js. Outros formatos → nativo.
 * hls.js é carregado apenas quando necessário (nunca no iPhone).
 */
import { detectCapabilities } from './capabilities.js';

const HLS_EXT = new Set(['m3u8', 'm3u']);
const DIRECT_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'mp3', 'aac', 'm4a', 'ogg', 'ogv']);

let hlsModule = null;
async function loadHls() {
  hlsModule ??= import('../../vendor/hls.js/hls.min.mjs').then((m) => m.default);
  return hlsModule;
}

/** 'hls' | 'direct' | 'unknown' (sem extensão: comum em canais em direto). */
export function streamType(ext) {
  if (!ext) return 'unknown';
  if (HLS_EXT.has(ext)) return 'hls';
  if (DIRECT_EXT.has(ext)) return 'direct';
  return 'unknown';
}

/**
 * Liga um endereço ao elemento <video>.
 * @returns {Promise<{engine: 'native'|'hlsjs', hls?: any, destroy: () => void}>}
 */
export async function attach(video, url, { ext, onFatal, onTracks, force } = {}) {
  const caps = detectCapabilities();
  const type = streamType(ext);
  // force: 'native' | 'hlsjs' — apenas para diagnóstico/testes
  const useNative = type === 'direct' || (force ? force === 'native' : (caps.nativeHls || !caps.mse));

  if (useNative) {
    video.src = url;
    video.load();
    return {
      engine: 'native',
      destroy() {
        video.removeAttribute('src');
        video.load();
      },
    };
  }

  const Hls = await loadHls();
  if (!Hls.isSupported()) {
    video.src = url;
    return { engine: 'native', destroy() { video.removeAttribute('src'); video.load(); } };
  }

  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 30,
    maxBufferLength: 30,
    // Não enviar cookies/credenciais do browser para servidores de terceiros.
    xhrSetup: (xhr) => { xhr.withCredentials = false; },
  });
  let mediaRecoveries = 0;
  hls.on(Hls.Events.ERROR, (_e, data) => {
    if (!data.fatal) return;
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
      mediaRecoveries++;
      hls.recoverMediaError();
      return;
    }
    onFatal?.({
      network: data.type === Hls.ErrorTypes.NETWORK_ERROR,
      detail: data.details,
      status: data.response?.code ?? null,
    });
  });
  const emitTracks = () => onTracks?.();
  hls.on(Hls.Events.MANIFEST_PARSED, emitTracks);
  hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, emitTracks);
  hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, emitTracks);
  hls.loadSource(url);
  hls.attachMedia(video);

  return {
    engine: 'hlsjs',
    hls,
    destroy() {
      hls.destroy();
      video.removeAttribute('src');
      video.load();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Faixas de áudio e legendas (normalizadas entre motores)             */
/* ------------------------------------------------------------------ */

/** @returns {{id: number, label: string, lang: string, active: boolean}[]} */
export function audioTracks(video, session) {
  if (session?.hls) {
    return session.hls.audioTracks.map((t, i) => ({ id: i, label: t.name || t.lang || `Faixa ${i + 1}`, lang: t.lang ?? '', active: i === session.hls.audioTrack }));
  }
  const list = video.audioTracks;
  if (!list) return [];
  return Array.from({ length: list.length }, (_, i) => list[i]).map((t, i) => ({ id: i, label: t.label || t.language || `Faixa ${i + 1}`, lang: t.language ?? '', active: t.enabled }));
}

export function setAudioTrack(video, session, id) {
  if (session?.hls) { session.hls.audioTrack = id; return; }
  const list = video.audioTracks;
  if (!list) return;
  for (let i = 0; i < list.length; i++) list[i].enabled = i === id;
}

/** id -1 = legendas desligadas. */
export function textTracks(video, session) {
  if (session?.hls) {
    return session.hls.subtitleTracks.map((t, i) => ({ id: i, label: t.name || t.lang || `Legenda ${i + 1}`, lang: t.lang ?? '', active: session.hls.subtitleDisplay && i === session.hls.subtitleTrack }));
  }
  const list = video.textTracks;
  if (!list) return [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
    out.push({ id: i, label: t.label || t.language || `Legenda ${out.length + 1}`, lang: t.language ?? '', active: t.mode === 'showing' });
  }
  return out;
}

export function setTextTrack(video, session, id) {
  if (session?.hls) {
    session.hls.subtitleDisplay = id >= 0;
    session.hls.subtitleTrack = id;
    return;
  }
  const list = video.textTracks;
  if (!list) return;
  for (let i = 0; i < list.length; i++) {
    if (list[i].kind === 'subtitles' || list[i].kind === 'captions') list[i].mode = i === id ? 'showing' : 'disabled';
  }
}
