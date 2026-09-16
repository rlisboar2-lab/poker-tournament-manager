// S2: build e servidor locais, sem ler .env e sem tocar o dist do aplicativo.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.resolve(root, '../.s2-local/dist');
const evidence = path.join(root, 'docs/design-ux/s2/evidencias');
fs.mkdirSync(evidence, { recursive: true });

if (process.argv[2] === 'build') {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
  const { default: react } = await import('@vitejs/plugin-react');
  const started = performance.now();
  await build({
    root,
    configFile: false,
    envDir: false,
    plugins: [react()],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': '""',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
    },
    build: { outDir: out, emptyOutDir: true },
  });
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else {
        const contents = fs.readFileSync(file);
        files.push({
          file: path.relative(out, file).replaceAll('\\', '/'),
          bytes: contents.length,
          gzipBytes: gzipSync(contents).length,
        });
      }
    }
  };
  walk(out);
  fs.writeFileSync(path.join(evidence, 'peso.json'), JSON.stringify({
    date: new Date().toISOString(),
    buildMs: performance.now() - started,
    mode: 'production; envDir=false; Supabase vazio; gzip local nível 6',
    files,
  }, null, 2));
} else {
  const mime = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
  };
  http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1:5173');
    let file = path.resolve(out, `.${url.pathname}`);
    if (!file.startsWith(`${out}${path.sep}`) && file !== out) {
      response.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(out, 'index.html');
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(fs.readFileSync(file));
  }).listen(5173, '127.0.0.1', () => console.log('S2 local isolada: http://127.0.0.1:5173'));
}
