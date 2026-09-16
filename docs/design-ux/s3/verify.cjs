const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.S3_PLAYWRIGHT || 'C:/Users/rlisb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const evidence = path.resolve(__dirname, 'evidencias');
fs.mkdirSync(evidence, { recursive: true });

const config = {
  name: 'Mesa de sexta · demonstração', start_time: '2026-09-15T20:00',
  setup: { smallest_chip: 5, initial_sb: 5, initial_bb: 10, stack_bb: 300 },
  target_time_minutos: 300, duracao_bloco_nivel: 20,
  buy_in_value: 10, rebuy_value: 15, addon_value: 20,
  chips_per_rebuy: 3000, chips_per_addon: 3000, max_rebuys: 1,
  addon_enabled: false, late_checkin_level: 'auto', ante_enabled: true,
  ante_start_level: 'auto', breaks: [{ after_level: 'late', minutes: 15 }],
};
const entries = ['Ana Exemplo', 'Bruno Exemplo', 'Carla Exemplo', 'Diego Exemplo', 'Elisa Exemplo', 'Felipe Exemplo']
  .map((name, index) => ({ name, buyins: 1, rebuys: 0, addons: 0, table: 1, seat: index + 1 }));
const fixture = {
  config, entries, payoutPct: [.5, .3, .2], screen: 'home',
  clock: { status: 'idle', anchorMs: 0, pausedElapsedMs: 0 },
};
const leaderboard = [
  { display_name: 'Ana Exemplo', points: 120, total_winnings: 400, total_invested: 210, roi: 90.4, events: 4 },
  { display_name: 'Bruno Exemplo com nome muito longo', points: 95, total_winnings: 300, total_invested: 200, roi: 50, events: 4 },
  { display_name: 'Carla Exemplo', points: 80, total_winnings: 220, total_invested: 180, roi: 22.2, events: 3 },
];
const themes = {
  escuro: { bg: '#101715', panel: '#18221e', panel2: '#202d26', border: '#43584a', text: '#f2f5f3', muted: '#a8b7ae', accent: '#238454', accent2: '#296a52', danger: '#f07878', gold: '#d8b46a' },
  claro: { bg: '#f6f8fa', panel: '#ffffff', panel2: '#eef1f4', border: '#d0d7de', text: '#1f2328', muted: '#57606a', accent: '#1a7f37', accent2: '#0969da', danger: '#cf222e', gold: '#805600' },
  feltro: { bg: '#0b2e1f', panel: '#10402c', panel2: '#155238', border: '#387d5e', text: '#eaf5ee', muted: '#9dbfad', accent: '#1a7f37', accent2: '#205f44', danger: '#ffa0a0', gold: '#f2c94c' },
};
const fonts = ['sistema', 'arial', 'verdana', 'trebuchet', 'georgia', 'courier', 'mono', 'impact'];
const matrixViewports = [
  { id: '320', width: 320, height: 800 }, { id: '360', width: 360, height: 800 },
  { id: '390', width: 390, height: 844 }, { id: '768', width: 768, height: 1024 },
  { id: '1280-zoom200-equivalente', width: 640, height: 450 },
  { id: '1280', width: 1280, height: 900 }, { id: '1920', width: 1920, height: 1080 },
  { id: '844x390', width: 844, height: 390 },
];

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.S3_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'],
  });
  const result = {
    date: new Date().toISOString(), browser: await browser.version(),
    assertions: {}, screens: {}, errors: [], blocked: [],
  };

  const makeContext = async ({ online = false, saved = null, theme = null, viewport = { width: 390, height: 844 } } = {}) => {
    const context = await browser.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block' });
    let loginAttempt = 0;
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') {
        result.blocked.push(route.request().url());
        return route.abort();
      }
      if (online && url.pathname === '/supabase/auth/v1/token') {
        loginAttempt += 1;
        if (loginAttempt === 1) {
          return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({
            error: 'invalid_grant', error_description: 'Credenciais inválidas para a verificação local.',
          }) });
        }
        await pause(250);
        const now = Math.floor(Date.now() / 1000);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          access_token: 'fixture-access-token', token_type: 'bearer', expires_in: 3600,
          expires_at: now + 3600, refresh_token: 'fixture-refresh-token',
          user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
            email: 'rod@example.test', email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {},
            created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        }) });
      }
      if (online && url.pathname === '/supabase/rest/v1/rpc/player_leaderboard') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(leaderboard) });
      }
      return route.continue();
    });
    await context.addInitScript(({ savedValue, themeValue }) => {
      localStorage.clear();
      if (savedValue) localStorage.setItem('ptm_state_v2', JSON.stringify(savedValue));
      if (themeValue) localStorage.setItem('ptm_theme_v1', JSON.stringify(themeValue));
    }, { savedValue: saved, themeValue: theme });
    return context;
  };

  const inspect = async (page, id) => {
    const geometry = await page.evaluate(() => ({
      viewportWidth: innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      controlsBelowMinimum: [...document.querySelectorAll('button, input, select')]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.height < 44;
        }).map((element) => ({ text: element.textContent?.trim(), height: element.getBoundingClientRect().height })),
    }));
    result.screens[id] = geometry;
    return geometry;
  };

  const offlineContext = await makeContext({ saved: { ...fixture, entries: [], config: { ...config, name: 'Home Game' } } });
  const home = await offlineContext.newPage();
  home.on('pageerror', (error) => result.errors.push(error.message));
  await home.goto('http://127.0.0.1:5173/home/');
  await home.getByRole('button', { name: /Criar torneio/ }).waitFor();
  await home.mouse.move(0, 0);
  result.assertions.emptyHome = {
    resume: await home.getByRole('button', { name: /Retomar torneio/ }).count(),
    podium: await home.getByRole('heading', { name: 'Pódio' }).count(),
    homeAction: await home.getByRole('button', { name: /Início/ }).count(),
    personalize: await home.getByRole('button', { name: /Personalizar/ }).count(),
    newTournament: await home.getByRole('button', { name: /Novo torneio/ }).count(),
    signOut: await home.getByRole('button', { name: 'Sair' }).count(),
  };
  await home.screenshot({ path: path.join(evidence, 'inicio-vazio-390.png'), fullPage: true });
  await inspect(home, 'inicio-vazio-390');
  await home.setViewportSize({ width: 1280, height: 900 });
  await home.screenshot({ path: path.join(evidence, 'inicio-vazio-1280.png'), fullPage: true });
  await inspect(home, 'inicio-vazio-1280');
  await offlineContext.close();

  const longName = 'Torneio beneficente dos amigos do bairro Jardim das Palmeiras — edição comemorativa';
  const resumeContext = await makeContext({ saved: {
    ...fixture, config: { ...config, name: longName },
    clock: { status: 'paused', anchorMs: 0, pausedElapsedMs: 120000, savedAtMs: Date.now() },
  }, viewport: { width: 320, height: 800 } });
  const resume = await resumeContext.newPage();
  resume.on('pageerror', (error) => result.errors.push(error.message));
  await resume.goto('http://127.0.0.1:5173/home/');
  await resume.getByRole('button', { name: /Retomar torneio/ }).waitFor();
  await resume.mouse.move(0, 0);
  result.assertions.resume = await resume.evaluate((expectedName) => {
    const resumeName = document.querySelector('.home-resume-name');
    const appTitle = document.querySelector('.app-title');
    return {
      fullName: resumeName?.textContent === expectedName,
      nameFits: resumeName.scrollWidth <= resumeName.clientWidth,
      titleFits: appTitle.scrollWidth <= appTitle.clientWidth,
      firstHomeChild: document.querySelector('.home')?.firstElementChild?.classList.contains('home-resume'),
    };
  }, longName);
  await resume.screenshot({ path: path.join(evidence, 'retomada-nome-longo-320.png'), fullPage: true });
  await inspect(resume, 'retomada-nome-longo-320');
  await resume.setViewportSize({ width: 1280, height: 900 });
  await resume.screenshot({ path: path.join(evidence, 'retomada-nome-longo-1280.png'), fullPage: true });
  await inspect(resume, 'retomada-nome-longo-1280');
  await resumeContext.close();

  result.assertions.matrix = [];
  for (const [themeId, colors] of Object.entries(themes)) {
    for (const viewport of matrixViewports) {
      const context = await makeContext({
        saved: { ...fixture, config: { ...config, name: longName }, clock: { status: 'paused', anchorMs: 0, pausedElapsedMs: 120000, savedAtMs: Date.now() } },
        theme: { colors, font: 'sistema', clockFont: 'sistema', clockZoom: 1 },
        viewport,
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => result.errors.push(error.message));
      await page.goto('http://127.0.0.1:5173/home/');
      await page.getByRole('button', { name: /Retomar torneio/ }).waitFor();
      const screen = await inspect(page, `matrix-${themeId}-${viewport.id}`);
      result.assertions.matrix.push({
        theme: themeId, viewport: viewport.id,
        fits: screen.pageWidth <= screen.viewportWidth && screen.controlsBelowMinimum.length === 0,
      });
      await context.close();
    }
  }

  result.assertions.fonts = [];
  for (const font of fonts) {
    const context = await makeContext({
      saved: { ...fixture, config: { ...config, name: longName }, clock: { status: 'paused', anchorMs: 0, pausedElapsedMs: 120000, savedAtMs: Date.now() } },
      theme: { colors: themes.escuro, font, clockFont: 'sistema', clockZoom: 1 },
      viewport: { width: 320, height: 800 },
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => result.errors.push(error.message));
    await page.goto('http://127.0.0.1:5173/home/');
    await page.getByRole('button', { name: /Retomar torneio/ }).waitFor();
    result.assertions.fonts.push(await page.evaluate((id) => {
      const name = document.querySelector('.home-resume-name');
      const title = document.querySelector('.app-title');
      return { font: id, fits: document.documentElement.scrollWidth <= innerWidth && name.scrollWidth <= name.clientWidth && title.scrollWidth <= title.clientWidth };
    }, font));
    await context.close();
  }

  const flowContext = await makeContext({ saved: { ...fixture, screen: 'setup' } });
  const flow = await flowContext.newPage();
  flow.on('pageerror', (error) => result.errors.push(error.message));
  await flow.goto('http://127.0.0.1:5173/home/');
  await flow.getByRole('button', { name: /Finalizar torneio/ }).waitFor();
  await flow.evaluate(() => scrollTo(0, 0));
  await flow.mouse.move(0, 0);
  result.assertions.header = {
    start: await flow.getByRole('button', { name: /Início/ }).count(),
    personalize: await flow.getByRole('button', { name: /Personalizar/ }).count(),
    finish: await flow.getByRole('button', { name: /Finalizar torneio/ }).count(),
    newTournament: await flow.getByRole('button', { name: /Novo torneio/ }).count(),
  };
  await flow.screenshot({ path: path.join(evidence, 'cabecalho-completo-390.png'), fullPage: true });
  await inspect(flow, 'cabecalho-completo-390');
  await flowContext.close();

  const onlineContext = await makeContext({ online: true });
  const login = await onlineContext.newPage();
  login.on('pageerror', (error) => result.errors.push(error.message));
  await login.goto('http://127.0.0.1:5173/login/');
  await login.getByRole('heading', { name: 'Entrar' }).waitFor();
  result.assertions.login = {
    emailAutocomplete: await login.locator('#login-email').getAttribute('autocomplete'),
    passwordAutocomplete: await login.locator('#login-password').getAttribute('autocomplete'),
    help: await login.getByText('Novos acessos são criados pelo administrador do aplicativo.').count(),
  };
  await login.screenshot({ path: path.join(evidence, 'login-390.png'), fullPage: true });
  await inspect(login, 'login-390');
  await login.setViewportSize({ width: 1280, height: 900 });
  await login.screenshot({ path: path.join(evidence, 'login-1280.png'), fullPage: true });
  await inspect(login, 'login-1280');
  await login.setViewportSize({ width: 390, height: 844 });

  await login.locator('#login-email').fill('rod@example.test');
  await login.locator('#login-password').fill('senha-incorreta');
  await login.getByRole('button', { name: 'Entrar' }).click();
  await login.getByRole('alert').waitFor();
  result.assertions.login.errorVisible = await login.getByRole('alert').isVisible();

  await login.locator('#login-password').fill('senha-local');
  await login.getByRole('button', { name: 'Entrar' }).click();
  await login.waitForFunction(() => document.querySelector('.login-submit')?.disabled === true);
  result.assertions.login.busy = {
    disabled: await login.locator('.login-submit').isDisabled(),
    text: await login.locator('.login-submit').textContent(),
  };
  await login.getByRole('heading', { name: 'Pódio' }).waitFor();
  await login.evaluate(() => scrollTo(0, 0));
  await login.mouse.move(0, 0);
  result.assertions.rankedHome = await login.evaluate(() => {
    const home = document.querySelector('.home');
    const create = document.querySelector('.home-create');
    const podium = document.querySelector('.podium-mini');
    return {
      cards: document.querySelectorAll('.podium-mini-card').length,
      createBeforePodium: [...home.children].indexOf(create) < [...home.children].indexOf(podium),
      signOut: [...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Sair'),
    };
  });
  await login.screenshot({ path: path.join(evidence, 'inicio-podio-390.png'), fullPage: true });
  await inspect(login, 'inicio-podio-390');
  await login.setViewportSize({ width: 1280, height: 900 });
  await login.evaluate(() => scrollTo(0, 0));
  await login.screenshot({ path: path.join(evidence, 'inicio-podio-1280.png'), fullPage: true });
  await inspect(login, 'inicio-podio-1280');
  await login.emulateMedia({ reducedMotion: 'reduce' });
  result.assertions.reducedMotion = await login.locator('.home-create').evaluate((element) => getComputedStyle(element).transitionDuration);
  await login.locator('.podium-mini').focus();
  await login.keyboard.press('Space');
  await login.getByRole('heading', { name: 'Ranking de jogadores' }).waitFor();
  result.assertions.keyboardPodium = true;
  await onlineContext.close();

  result.assertions.pass =
    result.assertions.emptyHome.resume === 0 && result.assertions.emptyHome.podium === 0 &&
    result.assertions.emptyHome.homeAction === 0 && result.assertions.emptyHome.personalize === 1 &&
    result.assertions.emptyHome.newTournament === 1 && result.assertions.emptyHome.signOut === 0 &&
    result.assertions.resume.fullName && result.assertions.resume.nameFits && result.assertions.resume.titleFits &&
    result.assertions.resume.firstHomeChild &&
    result.assertions.matrix.every((item) => item.fits) &&
    result.assertions.fonts.every((item) => item.fits) &&
    Object.values(result.assertions.header).every((count) => count === 1) &&
    result.assertions.login.emailAutocomplete === 'username' &&
    result.assertions.login.passwordAutocomplete === 'current-password' && result.assertions.login.help === 1 &&
    result.assertions.login.errorVisible && result.assertions.login.busy.disabled &&
    result.assertions.login.busy.text.trim() === 'Entrando…' &&
    result.assertions.rankedHome.cards === 3 && result.assertions.rankedHome.createBeforePodium &&
    result.assertions.rankedHome.signOut && result.assertions.keyboardPodium &&
    Number.parseFloat(result.assertions.reducedMotion) <= 0.001 &&
    Object.values(result.screens).every((screen) =>
      screen.pageWidth <= screen.viewportWidth && screen.controlsBelowMinimum.length === 0
    ) && result.errors.length === 0 && result.blocked.length === 0;

  fs.writeFileSync(path.join(evidence, 'verificacao-s3.json'), JSON.stringify(result, null, 2));
  await browser.close();
  console.log(JSON.stringify({ pass: result.assertions.pass, assertions: result.assertions, errors: result.errors, blocked: result.blocked }, null, 2));
  if (!result.assertions.pass) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
