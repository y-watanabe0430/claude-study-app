import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
createServer((req, res) => {
  const u = new URL(req.url, 'http://x').pathname;
  if (!u.startsWith('/claude-study-app/')) { res.writeHead(404); return res.end('nf'); }
  let rel = u.slice('/claude-study-app/'.length) || 'index.html';
  const p = join(dist, rel);
  if (!existsSync(p)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': types[extname(p)] ?? 'application/octet-stream' });
  res.end(readFileSync(p));
}).listen(4173, () => console.log('listening 4173'));
