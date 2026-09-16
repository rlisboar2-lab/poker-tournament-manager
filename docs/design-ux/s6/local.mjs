// S6: builds e servidor locais, sem ler .env e sem tocar o dist do aplicativo.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const outRoot = path.resolve(root, '../.s6-local');
const evidence = path.join(root, 'docs/design-ux/s6/evidencias');
const watchMock = path.join(root, 'docs/design-ux/s6/watch-supabase.mock.ts');
fs.mkdirSync(evidence, { recursive: true });

const buildApp = async ({ base, outDir, mockWatch = false }) => {
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
  const { default: react } = await import('@vitejs/plugin-react');
  const watchPlugin = {
    name: 's6-watch-supabase-mock',
    enforce: 'pre',
    resolveId(source, importer) {
      const normalized = importer?.replaceAll('\\', '/');
      if (mockWatch && source === '../lib/supabase' && normalized?.endsWith('/src/components/WatchView.tsx')) {
        return watchMock;
      }
      return null;
    },
  };
  await build({
    root,
    base,
    configFile: false,
    envDir: false,
    plugins: [watchPlugin, react()],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    },
    build: { outDir, emptyOutDir: true },
  });
};

if (process.argv[2] === 'build') {
  const started = performance.now();
  const offlineDir = path.join(outRoot, 'offline');
  const watchDir = path.join(outRoot, 'watch');
  await buildApp({ base: '/offline/', outDir: offlineDir });
  await buildApp({ base: '/watch/', outDir: watchDir, mockWatch: true });

  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else {
        const contents = fs.readFileSync(file);
        files.push({
          file: path.relative(offlineDir, file).replaceAll('\\', '/'),
          bytes: contents.length,
          gzipBytes: gzipSync(contents).length,
        });
      }
    }
  };
  walk(offlineDir);
  fs.writeFileSync(path.join(evidence, 'peso.json'), JSON.stringify({
    date: new Date().toISOString(),
    buildMs: performance.now() - started,
    mode: 'production; envDir=false; Supabase vazio; gzip local nível 6',
    builds: { offline: files },
  }, null, 2));
} else {
  const mime = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  };

  http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1:5176');
    const parts = url.pathname.split('/').filter(Boolean);
    const target = parts[0] === 'watch' && url.searchParams.get('mode') !== 'offline' ? 'watch' : 'offline';
    const relative = ['watch', 'offline'].includes(parts[0]) ? parts.slice(1).join('/') : parts.join('/');
    const buildRoot = path.join(outRoot, target);
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
  }).listen(5176, '127.0.0.1', () => console.log('S6 local isolada: http://127.0.0.1:5176/offline/'));
}
