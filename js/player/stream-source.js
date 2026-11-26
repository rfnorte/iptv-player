/**
 * Endereço de reprodução de um item (canal, filme ou episódio).
 *
 * Listas M3U: o endereço vem da própria lista.
 * Xtream: o endereço é construído no momento, com as credenciais decifradas,
 * e nunca é guardado. Canais em direto pedidos em HLS (.m3u8): é o único
 * formato de direto que o Safari reproduz.
 */
import { getSource, getCredentials } from '../data/sources.js';
import { buildStreamUrl } from '../iptv/xtream-api.js';

/** Formatos de ficheiro que o Safari do iPhone não reproduz. */
const UNSUPPORTED_ON_IOS = new Set(['mkv', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'divx', 'xvid']);

export function extensionOf(url) {
  try {
    const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export const canPlay = (play) => Boolean(play && (play.url || play.streamId));

/**
 * @param {{kind: 'live'|'movie'|'episode', sourceId: string, url?: string, streamId?: string, extension?: string}} play
 * @returns {Promise<{url: string, ext: string|null, isLive: boolean, likelyUnsupported: boolean, insecure: boolean}>}
 */
export async function resolveStream(play) {
  if (!canPlay(play)) throw new Error('Este conteúdo não tem endereço de reprodução (dados de demonstração).');
  let url = play.url;
  if (!url) {
    const source = await getSource(play.sourceId);
    if (!source) throw new Error('A lista deste conteúdo já não existe.');
    const c = await getCredentials(source);
    url = buildStreamUrl(c.server, c.username, c.password, play.kind, play.streamId, play.extension);
  }
  const ext = extensionOf(url) ?? play.extension ?? null;
  return {
    url,
    ext,
    isLive: play.kind === 'live',
    likelyUnsupported: Boolean(ext && UNSUPPORTED_ON_IOS.has(ext)),
    insecure: url.startsWith('http:') && typeof location !== 'undefined' && location.protocol === 'https:',
  };
}
