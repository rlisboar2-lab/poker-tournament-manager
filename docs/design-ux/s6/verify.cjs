const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.S6_PLAYWRIGHT || 'C:/Users/rlisb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

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
const viewports = [
  { id: '320x800', width: 320, height: 800 },
  { id: '390x844', width: 390, height: 844 },
  { id: '768x1024', width: 768, height: 1024 },
  { id: '1280x900', width: 1280, height: 900 },
  { id: '1920x1080', width: 1920, height: 1080 },
  { id: '844x390', width: 844, height: 390 },
];

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.S6_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'],
  });
  const result = { date: new Date().toISOString(), browser: await browser.version(), fullscreen: [], watch: [], states: {}, errors: [], blocked: [] };

  const makeContext = async ({ viewport, themeId = 'escuro', clockZoom = 1, disableNativeFullscreen = true } = {}) => {
    const context = await browser.newContext({ viewport, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block' });
    await context.route('**/*', async (route) => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.hostname !== '127.0.0.1') {
        result.blocked.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await context.addInitScript(({ savedValue, themeValue, disableNative }) => {
      localStorage.clear();
      localStorage.setItem('ptm_state_v2', JSON.stringify(savedValue));
      localStorage.setItem('ptm_theme_v1', JSON.stringify(themeValue));
      if (disableNative) Object.defineProperty(Element.prototype, 'requestFullscreen', { configurable: true, value: undefined });
    }, {
      savedValue: fixture,
      themeValue: { colors: themes[themeId], font: 'sistema', clockFont: 'sistema', clockZoom },
      disableNative: disableNativeFullscreen,
    });
    return context;
  };

  const watchErrors = (page) => page.on('pageerror', (error) => result.errors.push(error.message));
  const takeGeometry = async (page, mode) => page.evaluate((viewMode) => {
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const overlaps = (a, b) => !!a && !!b && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
    const panel = document.querySelector(viewMode === 'fullscreen' ? '.clock-panel.fs' : '.watch .clock-panel');
    const stage = panel?.querySelector('.clock-stage');
    const readout = panel?.querySelector('.clock-readout');
    const controls = panel?.querySelector('.clock-command-deck');
    const footer = panel?.querySelector('.watch-footer');
    const qr = panel?.querySelector('.corner-qr');
    const header = panel?.querySelector('.clock-top');
    const primaryButtons = [...(panel?.querySelectorAll('button') ?? [])].filter((button) => {
      const value = button.getBoundingClientRect();
      return value.width > 0 && value.height > 0;
    });
    const panelRect = rect(panel);
    const stageRect = rect(stage);
    const controlsRect = rect(controls);
    const footerRect = rect(footer);
    const qrRect = rect(qr);
    const headerRect = rect(header);
    const qrImage = panel?.querySelector('.corner-qr img');
    const readoutStyle = readout ? getComputedStyle(readout) : null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      page: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      panel: panelRect,
      stage: stageRect,
      controls: controlsRect,
      footer: footerRect,
      qr: qrRect,
      header: headerRect,
      panelInsideViewport: !!panelRect && panelRect.left >= -1 && panelRect.top >= -1 && panelRect.right <= innerWidth + 1 && panelRect.bottom <= innerHeight + 1,
      zonesSeparated: viewMode === 'fullscreen'
        ? !!stageRect && !!controlsRect && !!qrRect && stageRect.bottom <= Math.min(controlsRect.top, qrRect.top) + 1 && !overlaps(controlsRect, qrRect)
        : !!headerRect && !!stageRect && !!footerRect && headerRect.bottom <= stageRect.top + 1 && stageRect.bottom <= footerRect.top + 1,
      controlsInside: primaryButtons.every((button) => {
        const value = button.getBoundingClientRect();
        return !!panelRect && value.left >= panelRect.left - 1 && value.top >= panelRect.top - 1 && value.right <= panelRect.right + 1 && value.bottom <= panelRect.bottom + 1;
      }),
      controlsBelowMinimum: primaryButtons.filter((button) => button.getBoundingClientRect().height < 44).map((button) => button.textContent?.trim()),
      readout: readout ? {
        clientWidth: readout.clientWidth, clientHeight: readout.clientHeight,
        scrollWidth: readout.scrollWidth, scrollHeight: readout.scrollHeight,
        overflowX: readoutStyle.overflowX, overflowY: readoutStyle.overflowY,
      } : null,
      qrWhite: qrImage ? getComputedStyle(qrImage).backgroundColor === 'rgb(255, 255, 255)' : false,
      qrSquare: qrImage ? Math.abs(qrImage.getBoundingClientRect().width - qrImage.getBoundingClientRect().height) <= 1 : false,
      qrVisible: !!qrRect && qrRect.width >= 72 && qrRect.height >= 72,
      status: header?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      title: panel?.querySelector('.watch-title')?.textContent?.trim() ?? '',
      time: panel?.querySelector('.clock-big')?.textContent?.trim() ?? '',
      blinds: panel?.querySelector('.blinds')?.textContent?.trim() ?? '',
      ante: panel?.querySelector('.ante')?.textContent?.trim() ?? '',
    };
  }, mode);

  const fullscreenMatrix = [
    ...viewports.flatMap((viewport) => [.5, 1, 2.5].map((clockZoom) => ({ viewport, clockZoom, themeId: 'escuro' }))),
    ...['claro', 'feltro'].flatMap((themeId) => viewports.filter((item) => ['390x844', '1280x900'].includes(item.id)).map((viewport) => ({ viewport, clockZoom: 1, themeId }))),
  ];
  for (const item of fullscreenMatrix) {
    const context = await makeContext(item);
    const page = await context.newPage();
    watchErrors(page);
    await page.goto('http://127.0.0.1:5176/offline/');
    await page.getByRole('button', { name: 'Tela cheia', exact: true }).click();
    await page.locator('.clock-panel.fs').waitFor();
    const geometry = await takeGeometry(page, 'fullscreen');
    const pass = geometry.page.width <= geometry.viewport.width + 1 && geometry.panelInsideViewport && geometry.zonesSeparated &&
      geometry.controlsInside && geometry.controlsBelowMinimum.length === 0 && geometry.qrWhite && geometry.qrSquare && geometry.qrVisible &&
      ['auto', 'scroll'].includes(geometry.readout.overflowX) && ['auto', 'scroll'].includes(geometry.readout.overflowY);
    const id = `${item.themeId}-${item.viewport.id}-zoom${item.clockZoom}`;
    result.fullscreen.push({ id, pass, geometry });
    if (['escuro-320x800-zoom2.5', 'escuro-844x390-zoom1', 'escuro-1920x1080-zoom1'].includes(id)) {
      await page.screenshot({ path: path.join(evidence, `tela-cheia-${id}.png`), fullPage: false });
    }
    await context.close();
  }

  const watchMatrix = [
    ...viewports.flatMap((viewport) => [.5, 1, 2.5].map((clockZoom) => ({ viewport, clockZoom, themeId: 'escuro' }))),
    ...['claro', 'feltro'].map((themeId) => ({ viewport: viewports[1], clockZoom: 1, themeId })),
  ];
  for (const item of watchMatrix) {
    const context = await makeContext(item);
    const page = await context.newPage();
    watchErrors(page);
    await page.goto('http://127.0.0.1:5176/watch/fixture');
    await page.locator('.watch-title').waitFor();
    const geometry = await takeGeometry(page, 'watch');
    const pass = geometry.page.width <= geometry.viewport.width + 1 && geometry.panelInsideViewport && geometry.zonesSeparated &&
      geometry.controlsInside && geometry.qrWhite && geometry.qrSquare && geometry.qrVisible && geometry.status.includes('Em andamento') &&
      geometry.title.includes('excepcionalmente longo') && ['auto', 'scroll'].includes(geometry.readout.overflowX) &&
      ['auto', 'scroll'].includes(geometry.readout.overflowY);
    const id = `${item.themeId}-${item.viewport.id}-zoom${item.clockZoom}`;
    result.watch.push({ id, pass, geometry });
    if (['escuro-320x800-zoom2.5', 'escuro-844x390-zoom1', 'escuro-1920x1080-zoom1'].includes(id)) {
      await page.screenshot({ path: path.join(evidence, `transmissao-${id}.png`), fullPage: false });
    }
    await context.close();
  }

  const stateContext = await makeContext({ viewport: { width: 390, height: 844 } });
  const statePage = await stateContext.newPage();
  watchErrors(statePage);
  await statePage.goto('http://127.0.0.1:5176/watch/intervalo');
  await statePage.getByText('Intervalo', { exact: true }).first().waitFor();
  result.states.interval = {
    label: await statePage.locator('.break-label').textContent(),
    time: await statePage.locator('.clock-big').textContent(),
    status: await statePage.locator('.watch-header').textContent(),
  };
  await statePage.screenshot({ path: path.join(evidence, 'transmissao-intervalo-390x844.png'), fullPage: false });
  await stateContext.close();

  const errorContext = await makeContext({ viewport: { width: 390, height: 844 } });
  const errorPage = await errorContext.newPage();
  watchErrors(errorPage);
  await errorPage.goto('http://127.0.0.1:5176/watch/indisponivel?mode=offline');
  await errorPage.getByRole('heading', { name: 'Não foi possível abrir a transmissão' }).waitFor();
  result.states.unavailable = {
    message: await errorPage.locator('.watch-connection').textContent(),
    pageWidth: await errorPage.evaluate(() => document.documentElement.scrollWidth),
  };
  await errorPage.screenshot({ path: path.join(evidence, 'transmissao-indisponivel-390x844.png'), fullPage: false });
  await errorContext.close();

  result.states.qrOverlays = [];
  for (const viewport of [{ id: '320x480', width: 320, height: 480 }, { id: '844x390', width: 844, height: 390 }]) {
    const context = await makeContext({ viewport });
    const page = await context.newPage();
    watchErrors(page);
    await page.goto('http://127.0.0.1:5176/offline/');
    await page.getByRole('button', { name: 'Mostrar QR', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'PIX · buy-in / rebuy / add-on' });
    await dialog.waitFor();
    const geometry = await dialog.evaluate((element) => {
      element.scrollTop = 0;
      const card = element.getBoundingClientRect();
      const image = element.querySelector('img').getBoundingClientRect();
      const button = element.querySelector('button').getBoundingClientRect();
      return {
        card: { top: card.top, right: card.right, bottom: card.bottom, left: card.left },
        image: { top: image.top, right: image.right, bottom: image.bottom, left: image.left, width: image.width, height: image.height },
        button: { top: button.top, right: button.right, bottom: button.bottom, left: button.left, height: button.height },
        scrollable: element.scrollHeight >= element.clientHeight,
        imageInside: image.left >= card.left - 1 && image.right <= card.right + 1 && image.top >= card.top - 1 && image.bottom <= card.bottom + 1,
        buttonReachable: button.top >= card.top - 1 && button.bottom <= card.bottom + 1,
        imageSquare: Math.abs(image.width - image.height) <= 1,
        whiteArea: getComputedStyle(element.querySelector('img')).backgroundColor === 'rgb(255, 255, 255)',
      };
    });
    const pass = geometry.imageInside && geometry.buttonReachable && geometry.imageSquare && geometry.whiteArea && geometry.button.height >= 44;
    result.states.qrOverlays.push({ viewport: viewport.id, pass, geometry });
    await page.screenshot({ path: path.join(evidence, `qr-overlay-${viewport.id}.png`), fullPage: false });
    await context.close();
  }

  const nativeContext = await makeContext({ viewport: { width: 1280, height: 900 }, disableNativeFullscreen: false });
  const nativePage = await nativeContext.newPage();
  watchErrors(nativePage);
  await nativePage.goto('http://127.0.0.1:5176/offline/');
  await nativePage.getByRole('button', { name: 'Tela cheia', exact: true }).click();
  await nativePage.locator('.clock-panel.fs').waitFor();
  result.states.nativeFullscreen = await nativePage.evaluate(() => ({
    apiAvailable: document.fullscreenEnabled,
    entered: !!document.fullscreenElement,
    cssFallbackActive: !!document.querySelector('.clock-panel.fs'),
  }));
  if (result.states.nativeFullscreen.entered) {
    await nativePage.getByRole('button', { name: 'Sair', exact: true }).click();
    await nativePage.getByRole('button', { name: 'Tela cheia', exact: true }).waitFor();
    result.states.nativeFullscreen.exitedWithButton = !await nativePage.locator('.clock-panel.fs').count() &&
      !await nativePage.evaluate(() => document.fullscreenElement);
  }
  await nativeContext.close();

  result.pass = result.fullscreen.every((item) => item.pass) && result.watch.every((item) => item.pass) &&
    result.states.interval.label.includes('Intervalo') && result.states.interval.status.includes('Em andamento') &&
    result.states.unavailable.message.includes('Transmissão indisponível') && result.states.unavailable.pageWidth <= 390 &&
    result.states.qrOverlays.every((item) => item.pass) &&
    result.errors.length === 0 && result.blocked.length === 0;

  fs.writeFileSync(path.join(evidence, 'verificacao-s6.json'), JSON.stringify(result, null, 2));
  await browser.close();
  console.log(JSON.stringify({
    pass: result.pass,
    fullscreen: `${result.fullscreen.filter((item) => item.pass).length}/${result.fullscreen.length}`,
    watch: `${result.watch.filter((item) => item.pass).length}/${result.watch.length}`,
    states: result.states,
    errors: result.errors,
    blocked: result.blocked,
  }, null, 2));
  if (!result.pass) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
