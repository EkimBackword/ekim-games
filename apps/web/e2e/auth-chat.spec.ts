import { expect, test } from '@playwright/test';
import {
  controlScheduledRefresh,
  runScheduledRefresh,
} from './scheduled-refresh';

test('a guest can register, chat, log out, and sign in again', async ({
  page,
}) => {
  const nickname = `Browser${Date.now()}`;
  const password = 'browser-test-password';
  const message = `Playwright message ${Date.now()}`;

  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Создать аккаунт' }).click();
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
  await expect(page.locator('.online-badge')).toContainText('Онлайн');
  await page.locator('#message').fill(message);
  const sendButton = page.getByRole('button', { name: 'Отправить' });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();
  await expect(
    page.locator('article.message').filter({ hasText: message }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.locator('#nickname').fill(nickname);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Войти' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.locator('article.message').filter({ hasText: message }),
  ).toBeVisible();
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
