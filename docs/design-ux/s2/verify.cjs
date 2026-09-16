const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.S2_PLAYWRIGHT || 'C:/Users/rlisb/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const evidence = path.resolve(__dirname, 'evidencias');
fs.mkdirSync(evidence, { recursive: true });

const expected = {
  escuro: { bg: '#101715', panel: '#18221e', panel2: '#202d26', border: '#43584a', text: '#f2f5f3', muted: '#a8b7ae', accent: '#238454', accent2: '#296a52', danger: '#f07878', gold: '#d8b46a' },
  claro: { bg: '#f6f8fa', panel: '#ffffff', panel2: '#eef1f4', border: '#d0d7de', text: '#1f2328', muted: '#57606a', accent: '#1a7f37', accent2: '#0969da', danger: '#cf222e', gold: '#805600' },
  feltro: { bg: '#0b2e1f', panel: '#10402c', panel2: '#155238', border: '#387d5e', text: '#eaf5ee', muted: '#9dbfad', accent: '#1a7f37', accent2: '#205f44', danger: '#ffa0a0', gold: '#f2c94c' },
};

const legacy = {
  colors: { bg: '#0d1117', panel: '#161b22', panel2: '#1c232c', border: '#30363d', text: '#e6edf3', muted: '#8b949e', accent: '#2ea043', accent2: '#3b82f6', danger: '#f85149', gold: '#e3b341' },
  font: 'verdana', clockFont: 'courier', clockZoom: 1.4,
};

const rgb = (value) => {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const luminance = (value) => rgb(value).map((channel) => {
  const n = channel / 255;
  return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.S2_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--disable-background-networking', '--disable-component-update', '--no-first-run'],
  });
  const result = { date: new Date().toISOString(), browser: await browser.version(), assertions: {}, themes: {}, errors: [], blocked: [] };

  const makeContext = async (storage) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', serviceWorkers: 'block' });
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).hostname !== '127.0.0.1') {
        result.blocked.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    await context.addInitScript((value) => {
      if (sessionStorage.getItem('ptm_s2_seeded') !== '1') {
        localStorage.clear();
        if (value) localStorage.setItem('ptm_theme_v1', value);
        sessionStorage.setItem('ptm_s2_seeded', '1');
      }
    }, storage ?? null);
    return context;
  };

  const context = await makeContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => result.errors.push(error.message));
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('button', { name: 'Personalizar' }).click();
  await page.getByRole('dialog', { name: 'Personalização visual' }).waitFor();

  result.assertions.controlCounts = {
    colors: await page.locator('input[type="color"]').count(),
    appFonts: await page.locator('#theme-app-font option').count(),
    clockFonts: await page.locator('#theme-clock-font option').count(),
    zoomMin: await page.locator('#theme-clock-zoom').getAttribute('min'),
    zoomMax: await page.locator('#theme-clock-zoom').getAttribute('max'),
    zoomStep: await page.locator('#theme-clock-zoom').getAttribute('step'),
  };

  const captureTheme = async (id, buttonName) => {
    if (buttonName) await page.getByRole('button', { name: buttonName, exact: true }).click();
    await page.waitForTimeout(180);
    const data = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const card = document.querySelector('.theme-card').getBoundingClientRect();
      const variable = (name) => root.getPropertyValue(name).trim().toLowerCase();
      return {
        saved: JSON.parse(localStorage.getItem('ptm_theme_v1')),
        css: {
          bg: variable('--bg'), panel: variable('--panel'), panel2: variable('--panel-2'),
          border: variable('--border'), text: variable('--text'), muted: variable('--muted'),
          accent: variable('--accent'), accent2: variable('--accent-2'), danger: variable('--danger'), gold: variable('--gold'),
          onAccent: variable('--on-accent'), onAccent2: variable('--on-accent-2'),
          controlBorder: variable('--control-border'), positiveText: variable('--positive-text'), focusRing: variable('--focus-ring'),
        },
        geometry: { left: card.left, right: card.right, top: card.top, bottom: card.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, pageWidth: document.documentElement.scrollWidth },
      };
    });
    data.contrast = {
      text: contrast(data.css.text, data.css.panel2),
      muted: contrast(data.css.muted, data.css.panel2),
      primary: contrast(data.css.onAccent, data.css.accent),
      secondary: contrast(data.css.onAccent2, data.css.accent2),
      control: contrast(data.css.controlBorder, data.css.panel2),
      positive: contrast(data.css.positiveText, data.css.panel2),
      focus: Math.min(contrast(data.css.focusRing, data.css.bg), contrast(data.css.focusRing, data.css.panel), contrast(data.css.focusRing, data.css.panel2)),
    };
    result.themes[id] = data;
    await page.screenshot({ path: path.join(evidence, `tema-${id}-390.png`), fullPage: true });
    await page.getByRole('button', { name: 'Fechar personalização' }).click();
    const homeButton = page.getByRole('button', { name: /Início/ });
    if (await homeButton.count()) await homeButton.click();
    await page.getByRole('button', { name: /Criar torneio/ }).click();
    await page.getByRole('heading', { name: 'Setup do Torneio' }).waitFor();
    data.foundationGeometry = await page.evaluate(() => ({
      viewportWidth: innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      controlsBelowMinimum: [...document.querySelectorAll('button, input, select')]
        .filter((element) => element.getBoundingClientRect().height < 44).length,
    }));
    await page.screenshot({ path: path.join(evidence, `fundacao-${id}-configuracao-390.png`), fullPage: true });
    await page.getByRole('button', { name: 'Personalizar' }).click();
    await page.getByRole('dialog', { name: 'Personalização visual' }).waitFor();
  };

  await captureTheme('escuro');
  await page.locator('.theme-card').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(evidence, 'tema-escuro-controles-390.png') });
  await page.locator('.theme-card').evaluate((element) => { element.scrollTop = 0; });
  await captureTheme('claro', 'Claro');
  await captureTheme('feltro', 'Feltro verde');

  await page.selectOption('#theme-app-font', 'georgia');
  await page.selectOption('#theme-clock-font', 'mono');
  await page.locator('#theme-clock-zoom').focus();
  for (let step = 0; step < 7; step += 1) await page.keyboard.press('ArrowRight');
  await page.reload();
  await page.getByRole('button', { name: 'Personalizar' }).click();
  result.assertions.persisted = {
    font: await page.locator('#theme-app-font').inputValue(),
    clockFont: await page.locator('#theme-clock-font').inputValue(),
    clockZoom: await page.locator('#theme-clock-zoom').inputValue(),
    colors: JSON.parse(await page.evaluate(() => localStorage.getItem('ptm_theme_v1'))).colors,
  };

  const closeButton = page.getByRole('button', { name: 'Fechar personalização' });
  await page.keyboard.press('Tab');
  await closeButton.focus();
  result.assertions.focus = await closeButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset, outlineColor: style.outlineColor };
  });
  result.assertions.disabled = await closeButton.evaluate((element) => {
    element.disabled = true;
    const style = getComputedStyle(element);
    const value = { borderStyle: style.borderStyle, opacity: style.opacity, cursor: style.cursor };
    element.disabled = false;
    return value;
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  result.assertions.reducedMotion = await closeButton.evaluate((element) => getComputedStyle(element).transitionDuration);
  await context.close();

  const legacyRaw = JSON.stringify(legacy);
  const legacyContext = await makeContext(legacyRaw);
  const legacyPage = await legacyContext.newPage();
  legacyPage.on('pageerror', (error) => result.errors.push(error.message));
  await legacyPage.goto('http://127.0.0.1:5173');
  result.assertions.legacy = await legacyPage.evaluate((raw) => {
    const style = getComputedStyle(document.documentElement);
    return {
      storageUnchanged: localStorage.getItem('ptm_theme_v1') === raw,
      appliedBg: style.getPropertyValue('--bg').trim().toLowerCase(),
      appliedFont: style.getPropertyValue('--font').trim(),
      appliedZoom: style.getPropertyValue('--clock-zoom').trim(),
      derivedControlBorder: style.getPropertyValue('--control-border').trim().toLowerCase(),
    };
  }, legacyRaw);
  await legacyContext.close();

  result.assertions.pass =
    result.assertions.controlCounts.colors === 10 &&
    result.assertions.controlCounts.appFonts === 8 &&
    result.assertions.controlCounts.clockFonts === 8 &&
    result.assertions.controlCounts.zoomMin === '0.5' &&
    result.assertions.controlCounts.zoomMax === '2.5' &&
    result.assertions.controlCounts.zoomStep === '0.05' &&
    result.assertions.persisted.font === 'georgia' &&
    result.assertions.persisted.clockFont === 'mono' &&
    result.assertions.persisted.clockZoom === '1.35' &&
    result.assertions.legacy.storageUnchanged &&
    result.assertions.legacy.appliedBg === legacy.colors.bg &&
    Object.entries(expected).every(([id, colors]) => Object.entries(colors).every(([key, value]) => result.themes[id].css[key] === value)) &&
    Object.values(result.themes).every((theme) =>
      theme.geometry.left >= 0 && theme.geometry.right <= theme.geometry.viewportWidth && theme.geometry.pageWidth <= theme.geometry.viewportWidth &&
      theme.foundationGeometry.pageWidth <= theme.foundationGeometry.viewportWidth && theme.foundationGeometry.controlsBelowMinimum === 0 &&
      theme.contrast.text >= 4.5 && theme.contrast.muted >= 4.5 && theme.contrast.primary >= 4.5 && theme.contrast.secondary >= 4.5 &&
      theme.contrast.control >= 3 && theme.contrast.positive >= 4.5 && theme.contrast.focus >= 3
    ) &&
    result.assertions.focus.outlineWidth === '3px' &&
    result.assertions.focus.outlineOffset === '3px' &&
    result.assertions.disabled.borderStyle === 'dashed' &&
    result.assertions.disabled.opacity === '1' &&
    Number.parseFloat(result.assertions.reducedMotion) <= 0.001 &&
    result.errors.length === 0 && result.blocked.length === 0;

  fs.writeFileSync(path.join(evidence, 'verificacao-temas.json'), JSON.stringify(result, null, 2));
  await browser.close();
  console.log(JSON.stringify({ pass: result.assertions.pass, errors: result.errors, blocked: result.blocked, contrast: Object.fromEntries(Object.entries(result.themes).map(([id, value]) => [id, value.contrast])) }, null, 2));
  if (!result.assertions.pass) process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
