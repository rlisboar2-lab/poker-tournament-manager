// Requer Playwright já disponível; nenhum download/instalação.
const {chromium}=require(process.env.S1_PLAYWRIGHT || 'C:/Users/rlisb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../evidencias');
const config={name:'Mesa de sexta · demonstração',start_time:'2026-09-11T20:00',setup:{smallest_chip:5,initial_sb:5,initial_bb:10,stack_bb:300},target_time_minutos:300,duracao_bloco_nivel:20,buy_in_value:10,rebuy_value:15,addon_value:20,chips_per_rebuy:3000,chips_per_addon:3000,max_rebuys:1,addon_enabled:false,late_checkin_level:'auto',ante_enabled:true,ante_start_level:'auto',breaks:[{after_level:'late',minutes:15}]};
const entries=['Ana Exemplo','Bruno Exemplo','Carla de Albuquerque Exemplo','Diego Exemplo','Elisa Exemplo','Felipe Exemplo'].map((name,i)=>({name,buyins:1,rebuys:0,addons:0,table:1,seat:i+1}));
const fixture={config,entries,payoutPct:[.5,.3,.2],screen:'live',clock:{status:'idle',anchorMs:0,pausedElapsedMs:0}};
fs.writeFileSync(path.join(out,'fixture.json'),JSON.stringify(fixture,null,2));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.S1_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking','--disable-component-update','--no-first-run']});
 const result={date:new Date().toISOString(),browser:await browser.version(),platform:process.platform,viewport:{width:1280,height:900},dpr:1,cpuThrottle:1,network:'loopback; no-store; no throttling; external requests aborted',loads:[],captures:[],errors:[],blocked:[]};
 async function context(){const c=await browser.newContext({viewport:result.viewport,deviceScaleFactor:1,locale:'pt-BR',timezoneId:'America/Sao_Paulo',serviceWorkers:'block'});await c.route('**/*',r=>{if(new URL(r.request().url()).hostname!=='127.0.0.1'){result.blocked.push(r.request().url());return r.abort();}return r.continue();});return c;}
 for(let i=0;i<7;i++){
  const c=await context(),p=await c.newPage();
  await p.addInitScript(()=>{window.__lcp=0;new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lcp=e.startTime}).observe({type:'largest-contentful-paint',buffered:true});});
  await p.goto('http://127.0.0.1:5173');await p.getByRole('button',{name:'● Criar torneio'}).waitFor();await p.waitForTimeout(500);
  const m=await p.evaluate(()=>({dcl:performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd,load:performance.getEntriesByType('navigation')[0].loadEventEnd,fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,lcp:window.__lcp,transfer:performance.getEntriesByType('resource').map(r=>({name:new URL(r.name).pathname,transferSize:r.transferSize,decodedBodySize:r.decodedBodySize}))}));
  m.createToPaint=await p.evaluate(()=>new Promise(resolve=>{const t=performance.now();[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Criar torneio')).click();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(performance.now()-t)));}));
  result.loads.push(m);await c.close();
 }
 const c=await context();let p=await c.newPage();
 async function seed(screen,extras={}){await p.close();p=await c.newPage();p.on('pageerror',e=>result.errors.push(e.message));await p.addInitScript(v=>{localStorage.clear();localStorage.setItem('ptm_state_v2',JSON.stringify(v))},{...fixture,screen,...extras});await p.goto('http://127.0.0.1:5173');await p.locator('.app').waitFor();await p.waitForTimeout(150);}
 async function shot(name,width=1280,height=900){await p.setViewportSize({width,height});await p.screenshot({path:path.join(out,name+'.png'),fullPage:true});result.captures.push({name,width,height,geometry:await p.evaluate(()=>({pageWidth:document.documentElement.scrollWidth,viewport:innerWidth,tables:[...document.querySelectorAll('.table-wrap')].map(e=>({width:e.clientWidth,scroll:e.scrollWidth})),bar:document.querySelector('.live-actions-bar')?.getBoundingClientRect().toJSON(),appPadding:getComputedStyle(document.querySelector('.app')).paddingBottom}))});}
 await seed('home',{entries:[]});await shot('atual-inicio-1280');await shot('atual-inicio-390',390,844);
 await seed('setup');await shot('atual-configuracao-1280');await shot('atual-configuracao-390',390,844);await p.locator('summary').click();await shot('atual-premiacao-390',390,844);
 await seed('players');await shot('atual-jogadores-390',390,844);
 await seed('buyin');await shot('atual-buyin-390',390,844);
 await seed('live');await shot('atual-console-1280');await shot('atual-console-390',390,844);await shot('atual-console-360',360,800);
 await p.getByRole('button',{name:'Mesa',exact:true}).click();await shot('atual-mesa-390',390,844);
 await p.getByRole('button',{name:'Relógio',exact:true}).click();await p.getByRole('button',{name:'⛶ Tela cheia'}).click();await shot('atual-telacheia-844x390',844,390);
 for(let i=0;i<15;i++)await p.getByTitle('Aumentar o visor').click();await shot('atual-telacheia-zoom250-844x390',844,390);
 await seed('finish',{entries:entries.map((e,i)=>({...e,eliminated:i>0,final_placement:i+1}))});await shot('atual-finalizacao-390',390,844);
 await seed('ranking');await shot('atual-ranking-offline-390',390,844);
 await seed('historico');await shot('atual-historico-offline-390',390,844);
 await seed('home');await p.getByTitle('Personalização visual').click();await shot('atual-personalizacao-390',390,844);
 await seed('home',{clock:{status:'paused',anchorMs:0,pausedElapsedMs:120000,savedAtMs:Date.now()}});await shot('atual-retomada-1280');
 await c.close();await browser.close();fs.writeFileSync(path.join(out,'medicoes.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({runs:result.loads.length,captures:result.captures.length,errors:result.errors,blocked:result.blocked}));
})().catch(e=>{console.error(e);process.exit(1)});
