// S1: build isolado, sem ler .env, sem substituir dist do aplicativo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.resolve(root, '../.s1-local/dist');
const evidence = path.join(root, 'docs/design-ux/evidencias');
fs.mkdirSync(evidence, {recursive:true});
if (process.argv[2] === 'build') {
  const {build} = await import(pathToFileURL(path.join(root,'node_modules/vite/dist/node/index.js')));
  const {default:react} = await import('@vitejs/plugin-react');
  const started = performance.now();
  await build({root, configFile:false, envDir:false, plugins:[react()], define:{'import.meta.env.VITE_SUPABASE_URL':'""','import.meta.env.VITE_SUPABASE_ANON_KEY':'""'}, build:{outDir:out,emptyOutDir:false}});
  const files = [];
  const walk = dir => { for(const d of fs.readdirSync(dir,{withFileTypes:true})) { const p=path.join(dir,d.name); if(d.isDirectory())walk(p);else { const b=fs.readFileSync(p);files.push({file:path.relative(out,p).replaceAll('\\','/'),bytes:b.length,gzipBytes:gzipSync(b).length,sha256:createHash('sha256').update(b).digest('hex')});}}};
  walk(out);
  fs.writeFileSync(path.join(evidence,'peso.json'),JSON.stringify({date:new Date().toISOString(),node:process.version,buildMs:performance.now()-started,mode:'production; envDir=false; Supabase empty; gzip level default (6)',files},null,2));
} else {
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.json':'application/json'};
  http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1:5173');
    const base=url.pathname.startsWith('/references/')?path.join(root,'docs/design-ux/referencias'):out;
    const rel=url.pathname.startsWith('/references/')?url.pathname.slice(12):url.pathname;
    let p=path.resolve(base,'.'+(rel.startsWith('/')?rel:'/'+rel));
    if(!p.startsWith(base+path.sep)&&p!==base){res.writeHead(403);res.end();return;}
    if(!fs.existsSync(p)||fs.statSync(p).isDirectory())p=path.join(base,'index.html');
    if(!fs.existsSync(p)){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(p)]||'application/octet-stream','Cache-Control':'no-store'});res.end(fs.readFileSync(p));
  }).listen(5173,'127.0.0.1',()=>console.log('S1 local isolated: http://127.0.0.1:5173'));
}
