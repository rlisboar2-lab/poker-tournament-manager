// S3: builds e servidor locais, sem ler .env e sem tocar o dist do aplicativo.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outRoot = path.resolve(root, '../.s3-local');
const evidence = path.join(root, 'docs/design-ux/s3/evidencias');
fs.mkdirSync(evidence, { recursive: true });

const builds = [
  { id: 'home', url: '', key: '' },
  { id: 'login', url: 'http://127.0.0.1:5173/supabase', key: 'fixture-anon-key' },
];

if (process.argv[2] === 'build') {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
  const { default: react } = await import('@vitejs/plugin-react');
  const started = performance.now();
  const outputs = {};

  for (const item of builds) {
    const outDir = path.join(outRoot, item.id);
    await build({
      root,
      base: `/${item.id}/`,
      configFile: false,
      envDir: false,
      plugins: [react()],
      define: {
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(item.url),
        'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(item.key),
      },
      build: { outDir, emptyOutDir: true },
    });

    const files = [];
    const walk = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(file);
        else {
          const contents = fs.readFileSync(file);
          files.push({
            file: path.relative(outDir, file).replaceAll('\\', '/'),
            bytes: contents.length,
            gzipBytes: gzipSync(contents).length,
          });
        }
      }
    };
    walk(outDir);
    outputs[item.id] = files;
  }

  fs.writeFileSync(path.join(evidence, 'peso.json'), JSON.stringify({
    date: new Date().toISOString(),
    buildMs: performance.now() - started,
    mode: 'production; envDir=false; variantes Supabase vazio e fixture local; gzip local nível 6',
    builds: outputs,
  }, null, 2));
} else {
  const mime = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  };

  http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1:5173');
    const parts = url.pathname.split('/').filter(Boolean);
    const buildId = builds.some((item) => item.id === parts[0]) ? parts[0] : 'home';
    const buildRoot = path.join(outRoot, buildId);
    const relative = parts.slice(1).join('/');
    let file = path.resolve(buildRoot, relative || 'index.html');
    if (!file.startsWith(`${buildRoot}${path.sep}`) && file !== buildRoot) {
      response.writeHead(403).end();
      return;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(buildRoot, 'index.html');
    response.writeHead(200, {
      'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    response.end(fs.readFileSync(file));
  }).listen(5173, '127.0.0.1', () => console.log('S3 local isolada: http://127.0.0.1:5173/home/ e /login/'));
}
