/**
 * Servidor estático mínimo para desenvolvimento e testes (sem dependências).
 * Uso: node tests/serve.mjs [porta]   →  http://localhost:5173
 * (localhost é tratado como contexto seguro: Service Worker funciona sem HTTPS.)
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.mjs.map': 'application/json',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m3u': 'audio/x-mpegurl',
  '.ts': 'video/mp2t',
  '.vtt': 'text/vtt; charset=utf-8',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
};

/**
 * @param {number} port
 * @param {{mocks?: boolean, cors?: boolean}} [opts] mocks: rotas /__mock/* para testes
 */
export function startServer(port = 5173, { mocks = false, cors = true } = {}) {
  const server = createServer(async (req, res) => {
    try {
      if (mocks) {
        const { handleMock } = await import('./mocks.mjs');
        if (await handleMock(req, res, { cors })) return;
      }
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = normalize(join(ROOT, urlPath));
      if (!file.startsWith(ROOT + sep) && file !== ROOT) { res.writeHead(403).end(); return; }
      if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      const type = TYPES[extname(file)] ?? 'application/octet-stream';
      // Pedidos parciais (Range): necessários para saltar dentro de ficheiros MP4, como no GitHub Pages.
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      if (range) {
        const start = range[1] ? Number(range[1]) : body.length - Number(range[2]);
        const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        if (start >= body.length || start < 0 || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${body.length}` }).end(); return; }
        res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${body.length}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
        res.end(body.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2]) || 5173;
  await startServer(port);
  console.log(`IPTV Player em http://localhost:${port}`);
}
