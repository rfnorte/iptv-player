/**
 * Parser M3U/M3U8 incremental e tolerante.
 *
 * - Recebe texto por blocos (`feed`), para listas grandes lidas em streaming.
 * - Reconhece #EXTM3U (x-tvg-url/url-tvg), #EXTINF (tvg-id, tvg-name, tvg-logo,
 *   group-title, tvg-chno e outros atributos), #EXTGRP e linhas de URL.
 * - Tolera: BOM, CRLF, atributos com/sem aspas, vírgulas dentro de aspas,
 *   linhas vazias, URL sem #EXTINF, #EXTINF sem URL, metadados incompletos.
 * - Todos os campos são texto não confiável: são limpos de caracteres de
 *   controlo e limitados em comprimento. Nunca são interpretados como HTML.
 */

const MAX_NAME = 300;
const MAX_ATTR = 2048;
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u2028-\\u202e\\ufeff]', 'g');

export function cleanText(value, max = MAX_NAME) {
  return String(value ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Divide "#EXTINF:-1 a="1" b='x,y' c=z,Nome do canal" em { duration, attrs, title }.
 * A vírgula que separa o título é a primeira fora de aspas.
 */
export function parseExtinf(line) {
  const body = line.slice(line.indexOf(':') + 1);
  let quote = null;
  let split = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { if (c === quote) quote = null; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === ',') { split = i; break; }
  }
  const head = split === -1 ? body : body.slice(0, split);
  const title = split === -1 ? '' : body.slice(split + 1);

  const durationMatch = /^\s*(-?\d+(?:\.\d+)?)/.exec(head);
  const attrs = {};
  const re = /([A-Za-z][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"']+))/g;
  let m;
  while ((m = re.exec(head)) !== null) {
    attrs[m[1].toLowerCase()] = cleanText(m[2] ?? m[3] ?? m[4] ?? '', MAX_ATTR);
  }
  return { duration: durationMatch ? Number(durationMatch[1]) : -1, attrs, title: cleanText(title) };
}

/**
 * Valida e normaliza um URL de stream. Devolve null se inválido/não suportado.
 * Endereços relativos ("media/x.m3u8") só são aceites com `baseUrl` (lista
 * obtida por endereço) e resolvidos em relação a ele.
 */
const RELATIVE_PATH = /^[^\s<>"'`{}|\\^]+$/;

export function normalizeStreamUrl(raw, baseUrl) {
  const value = cleanText(raw, 4096);
  if (!value) return { url: null, reason: 'empty' };
  const isAbsolute = /^[a-z][a-z\d+.-]*:/i.test(value);
  // Relativo: só com base e só se parecer um caminho (sem espaços nem marcação HTML).
  if (!isAbsolute && (!baseUrl || !RELATIVE_PATH.test(value))) return { url: null, reason: 'invalid' };
  try {
    const u = isAbsolute ? new URL(value) : new URL(value, baseUrl);
    if (!ALLOWED_PROTOCOLS.has(u.protocol)) return { url: null, reason: 'protocol' };
    return { url: u.href, reason: null };
  } catch {
    return { url: null, reason: 'invalid' };
  }
}

function nameFromUrl(url) {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    return cleanText(decodeURIComponent(last).replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_.]+/g, ' ')) || 'Sem nome';
  } catch {
    return 'Sem nome';
  }
}

export class M3UParser {
  /**
   * @param {(entry: object) => void} onEntry
   * @param {{baseUrl?: string}} [opts] baseUrl: endereço da lista, para resolver URLs relativos
   */
  constructor(onEntry, { baseUrl } = {}) {
    this.onEntry = onEntry;
    this.baseUrl = baseUrl || null;
    this.buffer = '';
    this.pending = null;
    this.pendingGroup = null;
    this.firstLine = true;
    this.stats = { lines: 0, entries: 0, invalid: 0, unsupported: 0, orphanInfo: 0, header: false, hlsTags: 0, html: false };
    this.epgUrls = [];
  }

  feed(text) {
    // Aceita os três formatos de fim de linha: LF (Unix), CRLF (Windows) e CR (Mac antigo).
    // Um CR no fim de um bloco seguido de LF no seguinte gera só uma linha vazia (ignorada).
    this.buffer += text.replace(/\r\n?/g, '\n');
    let idx;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      this.line(line);
    }
    // Proteção contra "linhas" gigantes (ficheiro binário ou HTML minificado)
    if (this.buffer.length > 1_000_000) { this.buffer = ''; this.stats.invalid++; }
  }

  end() {
    if (this.buffer) this.line(this.buffer);
    this.buffer = '';
    if (this.pending) { this.stats.orphanInfo++; this.pending = null; }
    return this.stats;
  }

  line(rawLine) {
    let line = rawLine.replace(/\r$/, '');
    if (this.firstLine) {
      line = line.replace(/^\ufeff/, '');
      this.firstLine = false;
    }
    line = line.trim();
    if (!line) return;
    this.stats.lines++;

    // Página web (HTML/XML) em vez de lista: típico de páginas de erro, login ou do endereço errado.
    if (this.stats.lines === 1 && /^<(!doctype|html|\?xml|head|body)\b/i.test(line)) this.stats.html = true;
    if (this.stats.html) return;

    if (line.startsWith('#')) {
      const upper = line.slice(0, 8).toUpperCase();
      if (upper.startsWith('#EXTM3U')) {
        this.stats.header = true;
        const { attrs } = parseExtinf(`#EXTM3U:${line.slice(7)}`);
        for (const k of ['x-tvg-url', 'url-tvg', 'tvg-url']) {
          if (attrs[k]) this.epgUrls.push(...attrs[k].split(',').map((s) => s.trim()).filter(Boolean));
        }
      } else if (upper.startsWith('#EXTINF')) {
        if (this.pending) this.stats.orphanInfo++;
        this.pending = parseExtinf(line);
      } else if (/^#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/i.test(line)) {
        this.stats.hlsTags++;
      } else if (upper.startsWith('#EXTGRP')) {
        this.pendingGroup = cleanText(line.slice(line.indexOf(':') + 1));
      }
      // #EXTVLCOPT, #KODIPROP, #EXT-X-* e comentários: ignorados de forma segura
      return;
    }

    // Endereços relativos apenas em listas M3U verdadeiras (com cabeçalho #EXTM3U).
    const { url, reason } = normalizeStreamUrl(line, this.stats.header ? this.baseUrl : null);
    const info = this.pending;
    const group = this.pendingGroup;
    this.pending = null;
    this.pendingGroup = null;

    if (!url) {
      if (reason === 'protocol') this.stats.unsupported++;
      else this.stats.invalid++;
      return;
    }

    const a = info?.attrs ?? {};
    const name = info?.title || cleanText(a['tvg-name']) || nameFromUrl(url);
    this.stats.entries++;
    this.onEntry({
      name,
      url,
      tvgId: cleanText(a['tvg-id'], 200) || null,
      tvgName: cleanText(a['tvg-name']) || null,
      logo: a['tvg-logo'] || a.logo || null,
      group: cleanText(a['group-title'] ?? group ?? '') || null,
      chno: Number.parseInt(a['tvg-chno'] ?? a['channel-number'], 10) || null,
      duration: info?.duration ?? -1,
    });
  }
}

/** Conveniência para texto completo (testes, ficheiros pequenos). */
export function parseM3U(text, opts) {
  const entries = [];
  const parser = new M3UParser((e) => entries.push(e), opts);
  parser.feed(text);
  const stats = parser.end();
  return { entries, stats, epgUrls: parser.epgUrls };
}
