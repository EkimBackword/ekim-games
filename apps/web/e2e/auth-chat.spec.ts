import { expect, test } from '@playwright/test';
import {
  controlScheduledRefresh,
  runScheduledRefresh,
} from './scheduled-refresh';

test('гость переключает формы с клавиатуры и возвращается через историю', async ({
  page,
}) => {
  const registerUrl = '/register?utm_source=invite';
  await page.goto(registerUrl);
  const login = page.getByRole('link', { name: 'Вход', exact: true });
  const register = page.getByRole('link', { name: 'Регистрация', exact: true });
  await expect(register).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Подтверждение пароля')).toBeVisible();
  await login.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/login$/);
  await expect(login).toHaveAttribute('aria-current', 'page');
  await expect(page.getByLabel('Подтверждение пароля')).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(registerUrl);
  await expect(register).toHaveAttribute('aria-current', 'page');
});

test('формы сохраняют светлую цветовую схему при тёмной настройке браузера', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('tuiDark', 'true'));
  for (const path of ['/login', '/register']) {
    await page.goto(path);
    const nickname = page.getByLabel('Никнейм');
    await nickname.fill('ThemeCheck');
    await expect(page.locator('body')).not.toHaveAttribute('tuiTheme', 'dark');
    await expect(nickname).toHaveCSS('color-scheme', /^light(?: only)?$/);
    await nickname.evaluate((input) =>
      input.setAttribute('chrome-autofilled', ''),
    );
    await expect(nickname).toHaveCSS('box-shadow', /rgb\(255, 245, 192\)/);
  }
});

test('a guest can register, chat, log out, and sign in again', async ({
  page,
}) => {
  const nickname = `Browser${Date.now()}`;
  const password = 'browser-test-password';
  const message = `Playwright message ${Date.now()}`;

  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Регистрация', exact: true }).click();
  await expect(page).toHaveURL(/\/register$/);

  await page.locator('#nickname').fill(nickname);
  await page.locator('#password').fill(password);
  await page.locator('#confirm-password').fill(password);
  const registerResponse = page.waitForResponse((response) =>
    response.url().endsWith('/api/auth/register'),
  );
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  expect((await registerResponse).status()).toBe(201);

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Общий чат' })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('body')).not.toHaveAttribute('tuiTheme', 'dark');
  await expect(page.locator('.online-badge')).toContainText('Онлайн');
  await expect(page.locator('.page-shell')).toHaveCSS(
    'background-image',
    /wood\.webp/,
  );
  await expect(page.getByRole('region', { name: 'Общий чат' })).toHaveCSS(
    'border-image-source',
    /parchment-9slice\.png/,
  );
  await page.locator('#message').fill(message);
  const sendButton = page.getByRole('button', { name: 'Отправить' });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();
  await expect(
    page.locator('article.message').filter({ hasText: message }),
  ).toBeVisible();

  await page.setViewportSize({ width: 320, height: 640 });
  const history = page.getByLabel('Сообщения чата');
  await expect(history).toHaveCSS('overflow-y', 'auto');
  await expect(sendButton).toBeInViewport();
  const longMessage = Array.from(
    { length: 35 },
    (_, index) => `Строка ${index + 1}`,
  ).join('\n');
  await page.locator('#message').fill(longMessage);
  await sendButton.click();
  await expect(history.getByText('Строка 35', { exact: false })).toBeVisible();
  await page.mouse.move(0, 0);
  const logout = page.getByRole('button', { name: 'Выйти' });
  await expect(logout).toHaveCSS('background-color', 'rgb(255, 242, 220)');
  await expect(logout).toHaveCSS('color', 'rgb(54, 36, 25)');
  const dimensions = await history.evaluate((element) => {
    element.scrollTop = 0;
    const root = document.documentElement;
    return {
      pageFits:
        root.scrollWidth === innerWidth && root.scrollHeight === innerHeight,
      historyScrolls: element.scrollHeight > element.clientHeight,
    };
  });
  expect(dimensions).toEqual({ pageFits: true, historyScrolls: true });
  await expect(sendButton).toBeInViewport();
  const latest = page.getByRole('button', { name: 'К новым сообщениям' });
  await expect(latest).toBeInViewport();
  await latest.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toHaveText('К новым сообщениям');
  await latest.click();
  await expect(latest).toHaveCount(0);
  await expect(history.locator('article').last()).toBeInViewport();

  const historyHeight = await history.evaluate(
    (element) => element.scrollHeight,
  );
  await page.setViewportSize({ width: 320, height: historyHeight + 640 });
  await expect
    .poll(() => history.evaluate((element) => element.scrollTop))
    .toBe(0);
  await expect(latest).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 640 });
  await expect(latest).toBeInViewport();
  expect(await history.evaluate((element) => element.scrollTop)).toBe(0);

  await logout.click();
  await expect(page).toHaveURL(/\/login$/);
  await page.locator('#nickname').fill(nickname);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.locator('article.message').filter({ hasText: message }),
  ).toBeVisible();
  await expect(
    history.getByText('Строка 35', { exact: false }),
  ).toBeInViewport();
  await expect
    .poll(() =>
      history.evaluate(
        (element) =>
          element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(1);
  await expect(latest).toHaveCount(0);
});

test('восстановление и плановый refresh используют cookie по очереди', async ({
  context,
  page,
}) => {
  await controlScheduledRefresh(page);
  await page.goto('/register');
  await page.locator('#nickname').fill(`Tabs${Date.now()}`);
  await page.locator('#password').fill('browser-test-password');
  await page.locator('#confirm-password').fill('browser-test-password');
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  const chatHeading = { name: 'Общий чат' };
  await expect(page.getByRole('heading', chatHeading)).toBeVisible();

  const restoredTab = await context.newPage();
  const delayed = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const refreshUrl = '**/api/auth/refresh';
  await restoredTab.route(refreshUrl, async (route) => {
    delayed.resolve();
    await release.promise;
    await route.continue();
  });

  const restored = restoredTab.waitForResponse(refreshUrl);
  const scheduled = page.waitForResponse(refreshUrl);
  const responses = Promise.all([restored, scheduled]);
  let scheduledRequestSent = false;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/auth/refresh'))
      scheduledRequestSent = true;
  });

  const restoring = restoredTab.goto('/');
  let sentBeforeRelease: boolean;
  try {
    await delayed.promise;
    await runScheduledRefresh(page);
    await expect
      .poll(async () => {
        const pending = await page.evaluate(async () => {
          const locks = await navigator.locks.query();
          return locks.pending?.some(
            ({ name }) => name === 'ekim-games:auth-cookies',
          );
        });
        return Boolean(pending) || scheduledRequestSent;
      })
      .toBe(true);
    sentBeforeRelease = scheduledRequestSent;
  } finally {
    release.resolve();
    await restoring;
  }

  const [first, second] = await responses;
  expect(sentBeforeRelease).toBe(false);
  expect(first.status()).toBe(201);
  expect(second.status()).toBe(201);
  const rotatedCookies = (await first.headerValues('set-cookie')).map(
    (cookie) => cookie.split(';')[0],
  );
  const sentCookies = (await second.request().headerValue('cookie'))?.split(
    '; ',
  );
  for (const cookieName of ['eg_refresh', 'eg_csrf']) {
    const rotated = rotatedCookies.find((cookie) =>
      cookie.startsWith(`${cookieName}=`),
    );
    expect(Boolean(rotated && sentCookies?.includes(rotated))).toBe(true);
  }
  const csrf = await second.request().headerValue('x-csrf-token');
  expect(rotatedCookies.includes(`eg_csrf=${csrf}`)).toBe(true);

  await expect(page.getByRole('heading', chatHeading)).toBeVisible();
  await expect(restoredTab.getByRole('heading', chatHeading)).toBeVisible();
});
