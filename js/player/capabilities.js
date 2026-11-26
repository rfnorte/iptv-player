/**
 * Capacidades reais do dispositivo/browser para reprodução.
 * Regra do projeto: a interface só mostra funcionalidades suportadas.
 */

let cached = null;

function volumeIsControllable() {
  // No iOS o volume é físico: video.volume ignora escritas e fica em 1.
  const v = document.createElement('video');
  try {
    v.volume = 0.5;
    return Math.abs(v.volume - 0.5) < 0.01;
  } catch {
    return false;
  }
}

export function detectCapabilities() {
  if (cached) return cached;
  const v = document.createElement('video');
  const can = (type) => v.canPlayType(type) !== '';
  const ua = navigator.userAgent;
  const ios = /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);

  cached = {
    ios,
    nativeHls: can('application/vnd.apple.mpegurl') || can('application/x-mpegURL'),
    mse: typeof window.ManagedMediaSource !== 'undefined' || typeof window.MediaSource !== 'undefined',
    h264: can('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
    hevc: can('video/mp4; codecs="hvc1.1.6.L93.B0"'),
    mkv: can('video/x-matroska'),
    airplay: typeof window.WebKitPlaybackTargetAvailabilityEvent !== 'undefined',
    pip: Boolean(document.pictureInPictureEnabled)
      || (typeof v.webkitSupportsPresentationMode === 'function' && v.webkitSupportsPresentationMode('picture-in-picture')),
    nativeFullscreen: typeof v.webkitEnterFullscreen === 'function',
    elementFullscreen: Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled),
    volume: volumeIsControllable(),
    mediaSession: 'mediaSession' in navigator,
    secureContext: window.isSecureContext,
    https: location.protocol === 'https:',
  };
  return cached;
}

/** Linhas para o ecrã de diagnóstico. */
export function describeCapabilities(c = detectCapabilities()) {
  return [
    ['HLS nativo', c.nativeHls, 'Motor preferido no iPhone (AirPlay, PiP, ecrã inteiro nativo).'],
    ['Media Source (hls.js)', c.mse, 'Alternativa usada em computadores sem HLS nativo.'],
    ['H.264 / AAC', c.h264, 'Formato mais comum em IPTV.'],
    ['HEVC (H.265)', c.hevc, 'Depende do aparelho e da fonte.'],
    ['MKV', c.mkv, 'O Safari do iPhone não reproduz MKV.'],
    ['AirPlay', c.airplay, 'Enviar para Apple TV / televisores compatíveis.'],
    ['Picture-in-Picture', c.pip, 'Vídeo numa janela flutuante.'],
    ['Ecrã inteiro nativo do iOS', c.nativeFullscreen, 'Usa os controlos da Apple (legendas, áudio, AirPlay).'],
    ['Volume controlável pela app', c.volume, 'No iPhone o volume é físico (botões laterais).'],
    ['Informação no ecrã bloqueado', c.mediaSession, 'Título e controlos no ecrã bloqueado / Centro de Controlo.'],
    ['Página em HTTPS', c.https, 'Necessário para instalar a app; bloqueia pedidos a servidores HTTP.'],
  ];
}
