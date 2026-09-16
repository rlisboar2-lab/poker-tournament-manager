const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.S5_PLAYWRIGHT || 'C:/Users/rlisb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const evidence = path.resolve(__dirname, 'evidencias');
fs.mkdirSync(evidence, { recursive: true });

const config = {
  name: 'Mesa de sexta · demonstração', start_time: '2026-09-15T20:00',
  setup: { smallest_chip: 5, initial_sb: 5, initial_bb: 10, stack_bb: 300 },
  target_time_minutos: 300, duracao_bloco_nivel: 20,
  buy_in_value: 10, rebuy_value: 15, addon_value: 20,
  chips_per_rebuy: 3000, chips_per_addon: 3000, max_rebuys: 1,
  addon_enabled: true, late_checkin_level: 'auto', ante_enabled: true,
  ante_start_level: 'auto', breaks: [{ after_level: 'late', minutes: 15 }],
};
const entries = ['Ana Exemplo', 'Bruno Exemplo', 'Carla de Albuquerque Exemplo', 'Diego Exemplo', 'Elisa Exemplo', 'Felipe Exemplo']
  .map((name, index) => ({ name, buyins: 1, rebuys: 0, addons: 0, table: 1, seat: index + 1 }));
const fixture = {
  config, entries, payoutPct: [.5, .3, .2], screen: 'live',
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
    executablePath: process.env.S5_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'],
  });
  const result = { date: new Date().toISOString(), browser: await browser.version(), assertions: {}, screens: {}, errors: [], blocked: [] };

  const makeContext = async ({ saved = fixture, theme = null, viewport = { width: 390, height: 844 }, breakQr = false } = {}) => {
    const context = await browser.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (breakQr && requestUrl.pathname.endsWith('/pix-qr.png')) return route.abort();
      if (requestUrl.hostname !== '127.0.0.1') {
        result.blocked.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await context.addInitScript(({ savedValue, themeValue }) => {
      localStorage.clear();
      localStorage.setItem('ptm_state_v2', JSON.stringify(savedValue));
      if (themeValue) localStorage.setItem('ptm_theme_v1', JSON.stringify(themeValue));
    }, { savedValue: saved, themeValue: theme });
    return context;
  };

  const watchErrors = (page) => page.on('pageerror', (error) => result.errors.push(error.message));
  const inspect = async (page, id) => {
    const geometry = await page.evaluate(() => {
      const scroll = document.querySelector('.app-scroll');
      const footer = document.querySelector('.live-footer');
      const nav = document.querySelector('.nav-row');
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
      const visibleControls = [...document.querySelectorAll('button, input, select')].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const scrollRect = scroll?.getBoundingClientRect();
      const footerRect = footer?.getBoundingClientRect();
      const navRect = nav?.getBoundingClientRect();
      return {
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        pageWidth: document.documentElement.scrollWidth,
        appHeight: document.querySelector('.app--live')?.getBoundingClientRect().height ?? 0,
        footerPosition: footer ? getComputedStyle(footer).position : null,
        footerMeetsScroll: !!scrollRect && !!footerRect && Math.abs(scrollRect.bottom - footerRect.top) <= 1,
        footerInsideViewport: !!footerRect && footerRect.bottom <= innerHeight + 1 && footerRect.top >= 0,
        navAboveFooterAtScrollEnd: !!navRect && !!scrollRect && navRect.bottom <= scrollRect.bottom + 1,
        scrollable: !!scroll && scroll.scrollHeight > scroll.clientHeight,
        controlsBelowMinimum: visibleControls
          .filter((element) => element.getBoundingClientRect().height < 44)
          .map((element) => ({ text: element.textContent?.trim(), height: element.getBoundingClientRect().height })),
        unlabeledFields: [...document.querySelectorAll('input:not([type="hidden"]), select')]
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && !element.labels?.length && !element.getAttribute('aria-label');
          }).map((element) => element.id || element.outerHTML.slice(0, 80)),
      };
    });
    result.screens[id] = geometry;
    return geometry;
  };

  const functionalContext = await makeContext();
  const page = await functionalContext.newPage();
  watchErrors(page);
  await page.goto('http://127.0.0.1:5174/offline/');
  await page.getByRole('button', { name: 'Iniciar', exact: true }).waitFor();
  result.assertions.initial = {
    status: await page.locator('.clock-top').textContent(),
    quickActions: await page.locator('.live-actions-bar button').count(),
    scheduleRows: await page.locator('.schedule-table tbody tr').count(),
    time: await page.locator('.clock-big').textContent(),
    blinds: await page.locator('.blinds').textContent(),
  };
  await page.screenshot({ path: path.join(evidence, 'console-390.png'), fullPage: false });
  const initialGeometry = await inspect(page, 'console-390');

  await page.getByRole('button', { name: 'Iniciar', exact: true }).click();
  await page.getByRole('button', { name: 'Pausar', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await page.getByRole('button', { name: 'Avançar nível' }).click();
  const levelAfterNext = await page.locator('.clock-top').textContent();
  await page.getByRole('button', { name: 'Voltar nível' }).click();
  const levelAfterPrev = await page.locator('.clock-top').textContent();
  const timeBeforeAdjust = await page.locator('.clock-big').textContent();
  await page.locator('button[title="−1 min"]').click();
  const timeAfterMinus = await page.locator('.clock-big').textContent();
  await page.locator('button[title="+1 min"]').click();
  const timeAfterPlus = await page.locator('.clock-big').textContent();
  let resetDialog = '';
  page.once('dialog', async (dialog) => { resetDialog = dialog.message(); await dialog.dismiss(); });
  await page.getByRole('button', { name: 'Reiniciar relógio' }).click();
  result.assertions.clock = { levelAfterNext, levelAfterPrev, timeBeforeAdjust, timeAfterMinus, timeAfterPlus, resetDialog };

  const initialRows = entries.length;
  await page.getByRole('button', { name: 'Jogador', exact: true }).click();
  const addDialog = page.getByRole('dialog', { name: 'Entrada tardia' });
  await addDialog.getByLabel('Nome do jogador').fill('Gabi Exemplo');
  await addDialog.getByLabel('Nome do jogador').press('Enter');
  await page.getByRole('dialog', { name: /Buy-in · Gabi Exemplo/ }).waitFor();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Mesa', exact: true }).click();
  const rowsAfterCancelledBuyIn = await page.locator('.players-table--live tbody tr').count();
  await page.getByRole('button', { name: 'Relógio', exact: true }).click();

  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.getByRole('dialog', { name: 'Eliminar jogador' }).getByRole('button', { name: /Ana Exemplo/ }).click();
  const undoText = await page.locator('.toast--live').textContent();
  const undoAboveActions = await page.locator('.live-footer').evaluate((footer) =>
    footer.firstElementChild?.classList.contains('toast--live') && footer.lastElementChild?.classList.contains('live-actions-bar'));
  await page.getByRole('button', { name: 'Mesa', exact: true }).click();
  const eliminatedRow = page.locator('.players-table--live tbody tr').filter({ hasText: 'Ana Exemplo' });
  const eliminatedPresentation = {
    marked: await eliminatedRow.evaluate((row) => row.classList.contains('player-row--eliminated')),
    opacity: await eliminatedRow.evaluate((row) => getComputedStyle(row).opacity),
  };
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click();
  await page.getByRole('button', { name: 'Relógio', exact: true }).click();

  await page.getByRole('button', { name: 'Rebuy', exact: true }).click();
  await page.getByRole('dialog', { name: 'Rebuy' }).getByRole('button', { name: /Ana Exemplo/ }).click();
  await page.getByRole('dialog', { name: /Rebuy · Ana Exemplo/ }).getByRole('button', { name: /Pago/ }).click();
  await page.getByRole('button', { name: 'Add-on', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add-on' }).getByRole('button', { name: /Ana Exemplo/ }).click();
  await page.getByRole('dialog', { name: /Add-on · Ana Exemplo/ }).getByRole('button', { name: /Pago/ }).click();
  await page.getByRole('button', { name: 'Mesa', exact: true }).click();
  const anaRow = page.locator('.players-table--live tbody tr').filter({ hasText: 'Ana Exemplo' });
  const anaCounts = await anaRow.locator('output').allTextContents();
  const liveRows = await page.locator('.players-table--live tbody tr').count();
  await page.screenshot({ path: path.join(evidence, 'mesa-390.png'), fullPage: false });
  result.assertions.actions = { initialRows, rowsAfterCancelledBuyIn, undoText, undoAboveActions, eliminatedPresentation, anaCounts, liveRows };

  await page.getByRole('button', { name: 'Relógio', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: path.join(evidence, 'console-1280.png'), fullPage: false });
  await inspect(page, 'console-1280');
  await functionalContext.close();

  const fallbackContext = await makeContext({ viewport: { width: 320, height: 480 }, breakQr: true });
  const fallback = await fallbackContext.newPage();
  watchErrors(fallback);
  await fallback.goto('http://127.0.0.1:5174/offline/');
  await fallback.getByRole('button', { name: 'Jogador', exact: true }).click();
  await fallback.getByLabel('Nome do jogador').fill('Gabi Exemplo');
  await fallback.getByLabel('Nome do jogador').press('Enter');
  const payment = fallback.getByRole('dialog', { name: /Buy-in · Gabi Exemplo/ });
  await payment.getByText(/QR indisponível/).waitFor();
  const modalGeometry = await payment.evaluate((dialog) => {
    dialog.scrollTop = dialog.scrollHeight;
    const rect = dialog.getBoundingClientRect();
    const actions = dialog.querySelector('.payment-actions').getBoundingClientRect();
    return {
      top: rect.top, bottom: rect.bottom, viewportHeight: innerHeight,
      scrollable: dialog.scrollHeight >= dialog.clientHeight,
      actionsReachable: actions.bottom <= rect.bottom + 1,
    };
  });
  result.assertions.fallback = { modalGeometry, cancelEnabled: await payment.getByRole('button', { name: 'Cancelar' }).isEnabled() };
  await fallback.screenshot({ path: path.join(evidence, 'cobranca-fallback-320x480.png'), fullPage: false });
  await fallbackContext.close();

  result.assertions.matrix = [];
  const matrix = [
    ...viewports.map((viewport) => ({ themeId: 'escuro', viewport, clockZoom: 1 })),
    ...['claro', 'feltro'].flatMap((themeId) => viewports.filter((viewport) => ['390', '1280'].includes(viewport.id)).map((viewport) => ({ themeId, viewport, clockZoom: 1 }))),
    { themeId: 'escuro', viewport: viewports[0], clockZoom: .5 },
    { themeId: 'escuro', viewport: viewports[0], clockZoom: 2.5 },
  ];
  for (const item of matrix) {
    const context = await makeContext({
      theme: { colors: themes[item.themeId], font: 'sistema', clockFont: 'sistema', clockZoom: item.clockZoom },
      viewport: item.viewport,
    });
    const matrixPage = await context.newPage();
    watchErrors(matrixPage);
    await matrixPage.goto('http://127.0.0.1:5174/offline/');
    const id = `matrix-${item.themeId}-${item.viewport.id}-zoom${item.clockZoom}`;
    const geometry = await inspect(matrixPage, id);
    result.assertions.matrix.push({ theme: item.themeId, viewport: item.viewport.id, clockZoom: item.clockZoom,
      fits: geometry.pageWidth <= geometry.viewportWidth && Math.abs(geometry.appHeight - geometry.viewportHeight) <= 1 &&
        geometry.footerPosition !== 'fixed' && geometry.footerMeetsScroll && geometry.footerInsideViewport &&
        geometry.navAboveFooterAtScrollEnd && geometry.controlsBelowMinimum.length === 0 && geometry.unlabeledFields.length === 0 });
    await context.close();
  }

  result.assertions.fonts = [];
  for (const font of fonts) {
    const context = await makeContext({
      theme: { colors: themes.escuro, font, clockFont: font, clockZoom: 1 },
      viewport: { width: 320, height: 800 },
    });
    const fontPage = await context.newPage();
    watchErrors(fontPage);
    await fontPage.goto('http://127.0.0.1:5174/offline/');
    const geometry = await inspect(fontPage, `font-${font}-320`);
    result.assertions.fonts.push({ font, fits: geometry.pageWidth <= geometry.viewportWidth && geometry.controlsBelowMinimum.length === 0 });
    await context.close();
  }

  result.assertions.pass =
    result.assertions.initial.status.includes('Pronto') && result.assertions.initial.quickActions === 4 &&
    result.assertions.initial.scheduleRows >= 2 && result.assertions.initial.time === '20:00' &&
    result.assertions.clock.levelAfterNext.includes('Nível 2') && result.assertions.clock.levelAfterPrev.includes('Nível 1') &&
    result.assertions.clock.timeAfterMinus !== result.assertions.clock.timeBeforeAdjust &&
    result.assertions.clock.timeAfterPlus === result.assertions.clock.timeBeforeAdjust && result.assertions.clock.resetDialog.includes('Reiniciar') &&
    result.assertions.actions.rowsAfterCancelledBuyIn === result.assertions.actions.initialRows &&
    result.assertions.actions.undoText.includes('Ana Exemplo') && result.assertions.actions.undoAboveActions &&
    result.assertions.actions.eliminatedPresentation.marked && result.assertions.actions.eliminatedPresentation.opacity === '1' &&
    result.assertions.actions.anaCounts.join(',') === '1,1,1' &&
    result.assertions.actions.liveRows === result.assertions.actions.initialRows &&
    initialGeometry.scrollable && result.assertions.fallback.modalGeometry.actionsReachable && result.assertions.fallback.cancelEnabled &&
    result.assertions.matrix.every((item) => item.fits) && result.assertions.fonts.every((item) => item.fits) &&
    result.errors.length === 0 && result.blocked.length === 0;

  fs.writeFileSync(path.join(evidence, 'verificacao-s5.json'), JSON.stringify(result, null, 2));
  await browser.close();
  console.log(JSON.stringify({ pass: result.assertions.pass, assertions: result.assertions, errors: result.errors, blocked: result.blocked }, null, 2));
  if (!result.assertions.pass) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
