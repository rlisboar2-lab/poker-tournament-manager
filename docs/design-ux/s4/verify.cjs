const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.S4_PLAYWRIGHT || 'C:/Users/rlisb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

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
const entries = ['Ana Exemplo', 'Bruno Exemplo', 'Carla de Albuquerque Exemplo', 'Diego Exemplo', 'Elisa Exemplo', 'Felipe Exemplo']
  .map((name, index) => ({ name, buyins: 1, rebuys: 0, addons: 0, table: 1, seat: index + 1 }));
const fixture = {
  config, entries, payoutPct: [.5, .3, .2], screen: 'setup',
  clock: { status: 'idle', anchorMs: 0, pausedElapsedMs: 0 },
};
const themes = {
  escuro: { bg: '#101715', panel: '#18221e', panel2: '#202d26', border: '#43584a', text: '#f2f5f3', muted: '#a8b7ae', accent: '#238454', accent2: '#296a52', danger: '#f07878', gold: '#d8b46a' },
  claro: { bg: '#f6f8fa', panel: '#ffffff', panel2: '#eef1f4', border: '#d0d7de', text: '#1f2328', muted: '#57606a', accent: '#1a7f37', accent2: '#0969da', danger: '#cf222e', gold: '#805600' },
  feltro: { bg: '#0b2e1f', panel: '#10402c', panel2: '#155238', border: '#387d5e', text: '#eaf5ee', muted: '#9dbfad', accent: '#1a7f37', accent2: '#205f44', danger: '#ffa0a0', gold: '#f2c94c' },
};
const fonts = ['sistema', 'arial', 'verdana', 'trebuchet', 'georgia', 'courier', 'mono', 'impact'];
const viewports = [
  { id: '320', width: 320, height: 800 }, { id: '360', width: 360, height: 800 },
  { id: '390', width: 390, height: 844 }, { id: '640-zoom200-equivalente', width: 640, height: 450 },
  { id: '768', width: 768, height: 1024 }, { id: '1280', width: 1280, height: 900 },
  { id: '1920', width: 1920, height: 1080 }, { id: '844x390', width: 844, height: 390 },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.S4_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'],
  });
  const result = { date: new Date().toISOString(), browser: await browser.version(), assertions: {}, screens: {}, errors: [], blocked: [] };

  const makeContext = async ({ saved = fixture, theme = null, viewport = { width: 390, height: 844 }, auth = false, breakQr = false } = {}) => {
    const context = await browser.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (breakQr && requestUrl.pathname.endsWith('/pix-qr.png')) return route.abort();
      if (requestUrl.hostname !== '127.0.0.1') {
        result.blocked.push(route.request().url());
        return route.abort();
      }
      if (auth && requestUrl.pathname === '/supabase/auth/v1/token') {
        const now = Math.floor(Date.now() / 1000);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          access_token: 'fixture-access-token', token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
          refresh_token: 'fixture-refresh-token',
          user: { id: '00000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated',
            email: 'rod@example.test', email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {},
            created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        }) });
      }
      if (auth && requestUrl.pathname === '/supabase/rest/v1/sub_players') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
          { id: '00000000-0000-4000-8000-000000000010', display_name: 'Jogador cadastrado' },
          { id: '00000000-0000-4000-8000-000000000011', display_name: 'Ana Exemplo' },
        ]) });
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

  const watchErrors = (page) => page.on('pageerror', (error) => result.errors.push(error.message));
  const inspect = async (page, id) => {
    const geometry = await page.evaluate(() => ({
      viewportWidth: innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      controlsBelowMinimum: [...document.querySelectorAll('button, input, select')]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.height < 44;
        }).map((element) => ({ text: element.textContent?.trim(), height: element.getBoundingClientRect().height })),
      unlabeledFields: [...document.querySelectorAll('input:not([type="hidden"]), select')]
        .filter((element) => !element.labels?.length && !element.getAttribute('aria-label'))
        .map((element) => element.id || element.outerHTML.slice(0, 80)),
    }));
    result.screens[id] = geometry;
    return geometry;
  };

  const setupContext = await makeContext();
  const setup = await setupContext.newPage();
  watchErrors(setup);
  await setup.goto('http://127.0.0.1:5173/offline/');
  await setup.getByRole('heading', { name: 'Configuração do torneio' }).waitFor();
  const fieldIds = ['setup-name', 'setup-start', 'setup-target-duration', 'setup-level-duration', 'setup-smallest-chip',
    'setup-initial-sb', 'setup-initial-bb', 'setup-stack-bb', 'setup-stack-chips', 'setup-buyin-value', 'setup-rebuy-value',
    'setup-addon-value', 'setup-rebuy-chips', 'setup-addon-chips', 'setup-max-rebuys', 'setup-addon-enabled',
    'setup-late-level', 'setup-ante-enabled', 'setup-break-level-0', 'setup-break-minutes-0'];
  result.assertions.setup = {
    sectionOrder: await setup.locator('.setup-section-title').allTextContents(),
    allFieldsPresent: (await Promise.all(fieldIds.map((id) => setup.locator(`#${id}`).count()))).every((count) => count === 1),
    payoutInitiallyClosed: !(await setup.locator('.payout-collapsible').getAttribute('open')),
    autoLate: await setup.getByText('auto · late').count(),
    backDisabled: await setup.getByRole('button', { name: /Voltar/ }).isDisabled(),
  };
  await setup.screenshot({ path: path.join(evidence, 'configuracao-390.png'), fullPage: true });
  await inspect(setup, 'configuracao-390');
  await setup.setViewportSize({ width: 1280, height: 900 });
  await setup.screenshot({ path: path.join(evidence, 'configuracao-1280.png'), fullPage: true });
  await inspect(setup, 'configuracao-1280');
  await setup.setViewportSize({ width: 390, height: 844 });

  await setup.locator('.payout-collapsible summary').click();
  result.assertions.payout = { initialRows: await setup.locator('.payout-table tbody tr').count() };
  await setup.locator('#payout-percent-0').fill('60');
  result.assertions.payout.valueFromPercent = await setup.locator('#payout-value-0').inputValue();
  await setup.locator('#payout-value-0').fill('24');
  result.assertions.payout.percentFromValue = await setup.locator('#payout-percent-0').inputValue();
  result.assertions.payout.warningVisible = await setup.getByText(/ajuste para 100%/).count();
  await setup.getByRole('button', { name: 'Posição', exact: true }).click();
  result.assertions.payout.rowsAfterAdd = await setup.locator('.payout-table tbody tr').count();
  await setup.getByRole('button', { name: 'Remover 4ª posição' }).click();
  result.assertions.payout.rowsAfterRemove = await setup.locator('.payout-table tbody tr').count();
  await setup.locator('#payout-percent-0').fill('50');
  await setup.locator('#payout-percent-0').blur();
  await setup.screenshot({ path: path.join(evidence, 'premiacao-390.png'), fullPage: true });
  await setup.locator('.payout-panel').screenshot({ path: path.join(evidence, 'premiacao-painel-390.png') });

  await setup.getByRole('button', { name: 'Adicionar intervalo' }).click();
  result.assertions.breaks = { afterAdd: await setup.locator('.break-row').count() };
  await setup.getByRole('button', { name: 'Remover intervalo 2' }).click();
  result.assertions.breaks.afterRemove = await setup.locator('.break-row').count();
  const preservedStart = await setup.locator('#setup-start').inputValue();
  await setup.getByRole('button', { name: /Estrutura Quadra/ }).click();
  result.assertions.presets = {
    quadraName: await setup.locator('#setup-name').inputValue(),
    startPreserved: (await setup.locator('#setup-start').inputValue()) === preservedStart,
  };
  await setup.getByRole('button', { name: /Personalizado/ }).click();
  result.assertions.presets.customName = await setup.locator('#setup-name').inputValue();
  await setupContext.close();

  const playersContext = await makeContext({ saved: { ...fixture, screen: 'players' } });
  const players = await playersContext.newPage();
  watchErrors(players);
  await players.goto('http://127.0.0.1:5173/offline/');
  await players.getByRole('heading', { name: 'Participantes e entradas' }).waitFor();
  result.assertions.players = { initialRows: await players.locator('.players-table tbody tr').count() };
  await players.screenshot({ path: path.join(evidence, 'participantes-390.png'), fullPage: true });
  await players.locator('#player-name').fill('Ána Exemplo');
  await players.keyboard.press('Enter');
  result.assertions.players.duplicateBlocked = (await players.locator('.players-table tbody tr').count()) === 6;
  result.assertions.players.duplicateMessage = await players.getByRole('alert').textContent();
  await players.locator('#player-name').fill('Gabi Exemplo');
  await players.keyboard.press('Enter');
  result.assertions.players.rowsAfterEnter = await players.locator('.players-table tbody tr').count();
  const firstStepper = players.locator('.players-table tbody tr').first().locator('.stepper');
  await firstStepper.getByRole('button', { name: /Aumentar Buy-ins/ }).click();
  result.assertions.players.buyinsAfterPlus = await firstStepper.locator('output').textContent();
  await firstStepper.getByRole('button', { name: /Diminuir Buy-ins/ }).click();
  result.assertions.players.buyinsAfterMinus = await firstStepper.locator('output').textContent();
  await inspect(players, 'participantes-390');
  await playersContext.close();

  const emptyPlayersContext = await makeContext({ saved: { ...fixture, screen: 'players', entries: [] } });
  const emptyPlayers = await emptyPlayersContext.newPage();
  watchErrors(emptyPlayers);
  await emptyPlayers.goto('http://127.0.0.1:5173/offline/');
  result.assertions.players.empty = await emptyPlayers.getByText('Nenhum jogador ainda.').count();
  await emptyPlayersContext.close();

  const authContext = await makeContext({ saved: { ...fixture, screen: 'players', entries: [entries[0]] }, auth: true });
  const known = await authContext.newPage();
  watchErrors(known);
  await known.goto('http://127.0.0.1:5173/auth/');
  await known.locator('#login-email').fill('rod@example.test');
  await known.locator('#login-password').fill('senha-local');
  await known.getByRole('button', { name: 'Entrar' }).click();
  const knownButton = known.getByRole('button', { name: '+ Jogador cadastrado' });
  await knownButton.waitFor();
  await knownButton.focus();
  await known.keyboard.press('Space');
  result.assertions.knownPlayer = {
    chipVisible: true,
    added: await known.getByText('Jogador cadastrado', { exact: true }).count(),
  };
  await authContext.close();

  const buyinContext = await makeContext({ saved: { ...fixture, screen: 'buyin' } });
  const buyin = await buyinContext.newPage();
  watchErrors(buyin);
  await buyin.goto('http://127.0.0.1:5173/offline/');
  await buyin.getByRole('heading', { name: 'Cobrança dos buy-ins' }).waitFor();
  result.assertions.buyin = {
    rows: await buyin.locator('.buyin-table tbody tr').count(),
    qrLoaded: await buyin.locator('.buyin-qr img').evaluate((image) => image.complete && image.naturalWidth > 0),
    total: await buyin.locator('.buyin-total .kpi').textContent(),
    confirmEnabled: await buyin.locator('.buyin-confirm').isEnabled(),
  };
  await buyin.screenshot({ path: path.join(evidence, 'cobranca-390.png'), fullPage: true });
  await inspect(buyin, 'cobranca-390');
  await buyin.locator('.buyin-confirm').click();
  result.assertions.buyin.opensLiveWithoutStarting =
    await buyin.getByRole('button', { name: /Iniciar/ }).count();
  await buyinContext.close();

  const emptyBuyinContext = await makeContext({ saved: { ...fixture, screen: 'buyin', entries: [] } });
  const emptyBuyin = await emptyBuyinContext.newPage();
  watchErrors(emptyBuyin);
  await emptyBuyin.goto('http://127.0.0.1:5173/offline/');
  result.assertions.buyin.emptyMessage = await emptyBuyin.getByText('Nenhum jogador selecionado na tela anterior.').count();
  result.assertions.buyin.emptyDisabled = await emptyBuyin.locator('.buyin-confirm').isDisabled();
  await emptyBuyinContext.close();

  const fallbackContext = await makeContext({ saved: { ...fixture, screen: 'buyin' }, breakQr: true });
  const fallback = await fallbackContext.newPage();
  watchErrors(fallback);
  await fallback.goto('http://127.0.0.1:5173/offline/');
  await fallback.getByText(/Adicione a imagem/).waitFor();
  result.assertions.buyin.fallbackVisible = true;
  result.assertions.buyin.fallbackStillConfirmable = await fallback.locator('.buyin-confirm').isEnabled();
  await fallbackContext.close();

  const liveContext = await makeContext({ saved: { ...fixture, screen: 'live' } });
  const live = await liveContext.newPage();
  watchErrors(live);
  await live.goto('http://127.0.0.1:5173/offline/');
  await live.getByRole('button', { name: 'Mesa', exact: true }).click();
  await live.getByRole('heading', { name: /Mesa ao vivo/ }).waitFor();
  result.assertions.liveCompatibility = {
    playerRows: await live.locator('.players-table--live tbody tr').count(),
    buyinStepper: await live.locator('.players-table--live .stepper').count(),
  };
  await live.getByRole('button', { name: /Configurações/ }).click();
  await live.getByRole('heading', { name: 'Configuração do torneio' }).waitFor();
  result.assertions.liveCompatibility.notice = await live.getByText('Torneio em andamento.', { exact: true }).count();
  result.assertions.liveCompatibility.payoutOpen = await live.locator('.payout-collapsible').evaluate((details) => details.open);
  await liveContext.close();

  result.assertions.matrix = [];
  const matrix = [
    ...viewports.map((viewport) => ({ themeId: 'escuro', viewport })),
    ...['claro', 'feltro'].flatMap((themeId) => viewports.filter((viewport) => ['390', '1280'].includes(viewport.id)).map((viewport) => ({ themeId, viewport }))),
  ];
  for (const screen of ['setup', 'players', 'buyin']) {
    for (const item of matrix) {
      const context = await makeContext({
        saved: { ...fixture, screen },
        theme: { colors: themes[item.themeId], font: 'sistema', clockFont: 'sistema', clockZoom: 1 },
        viewport: item.viewport,
      });
      const page = await context.newPage();
      watchErrors(page);
      await page.goto('http://127.0.0.1:5173/offline/');
      const geometry = await inspect(page, `matrix-${screen}-${item.themeId}-${item.viewport.id}`);
      result.assertions.matrix.push({ screen, theme: item.themeId, viewport: item.viewport.id,
        fits: geometry.pageWidth <= geometry.viewportWidth && geometry.controlsBelowMinimum.length === 0 && geometry.unlabeledFields.length === 0 });
      await context.close();
    }
  }

  result.assertions.fonts = [];
  for (const font of fonts) {
    const context = await makeContext({
      saved: fixture,
      theme: { colors: themes.escuro, font, clockFont: 'sistema', clockZoom: 1 },
      viewport: { width: 320, height: 800 },
    });
    const page = await context.newPage();
    watchErrors(page);
    await page.goto('http://127.0.0.1:5173/offline/');
    const geometry = await inspect(page, `font-${font}-320`);
    result.assertions.fonts.push({ font, fits: geometry.pageWidth <= geometry.viewportWidth && geometry.controlsBelowMinimum.length === 0 });
    await context.close();
  }

  const expectedSections = ['Dados do torneio', 'Stack e blinds', 'Financeiro', 'Late check-in e ante', 'Intervalos'];
  result.assertions.pass =
    JSON.stringify(result.assertions.setup.sectionOrder) === JSON.stringify(expectedSections) &&
    result.assertions.setup.allFieldsPresent && result.assertions.setup.payoutInitiallyClosed &&
    result.assertions.setup.autoLate === 1 && result.assertions.setup.backDisabled &&
    result.assertions.payout.initialRows === 3 && result.assertions.payout.valueFromPercent === '36' &&
    result.assertions.payout.percentFromValue === '40' && result.assertions.payout.warningVisible === 1 && result.assertions.payout.rowsAfterAdd === 4 &&
    result.assertions.payout.rowsAfterRemove === 3 && result.assertions.breaks.afterAdd === 2 &&
    result.assertions.breaks.afterRemove === 1 && result.assertions.presets.quadraName === 'FREEPLAY 1K GTD' &&
    result.assertions.presets.startPreserved && result.assertions.presets.customName === 'Home Game' &&
    result.assertions.players.initialRows === 6 && result.assertions.players.duplicateBlocked &&
    result.assertions.players.duplicateMessage.includes('já está na lista') && result.assertions.players.rowsAfterEnter === 7 &&
    result.assertions.players.buyinsAfterPlus === '2' && result.assertions.players.buyinsAfterMinus === '1' &&
    result.assertions.players.empty === 1 && result.assertions.knownPlayer.added >= 1 &&
    result.assertions.buyin.rows === 6 && result.assertions.buyin.qrLoaded && result.assertions.buyin.total.includes('60,00') &&
    result.assertions.buyin.confirmEnabled && result.assertions.buyin.opensLiveWithoutStarting === 1 &&
    result.assertions.buyin.emptyMessage === 1 && result.assertions.buyin.emptyDisabled &&
    result.assertions.buyin.fallbackVisible && result.assertions.buyin.fallbackStillConfirmable &&
    result.assertions.liveCompatibility.playerRows === 6 && result.assertions.liveCompatibility.buyinStepper >= 6 &&
    result.assertions.liveCompatibility.notice === 1 && result.assertions.liveCompatibility.payoutOpen &&
    result.assertions.matrix.every((item) => item.fits) && result.assertions.fonts.every((item) => item.fits) &&
    Object.values(result.screens).every((screen) => screen.pageWidth <= screen.viewportWidth &&
      screen.controlsBelowMinimum.length === 0 && screen.unlabeledFields.length === 0) &&
    result.errors.length === 0 && result.blocked.length === 0;

  fs.writeFileSync(path.join(evidence, 'verificacao-s4.json'), JSON.stringify(result, null, 2));
  await browser.close();
  console.log(JSON.stringify({ pass: result.assertions.pass, assertions: result.assertions, errors: result.errors, blocked: result.blocked }, null, 2));
  if (!result.assertions.pass) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
