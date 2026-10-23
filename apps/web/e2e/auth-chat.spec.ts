import { expect, test } from '@playwright/test';

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
