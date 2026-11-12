import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type WebSocketRoute,
} from '@playwright/test';
import { z } from 'zod';
import {
  chatSocketEvents,
  reconcileChatRequestSchema,
  sendChatMessageSchema,
} from 'contracts';
import { randomUUID } from 'node:crypto';
import {
  controlScheduledRefresh,
  runScheduledRefresh,
} from './scheduled-refresh';

const password = 'browser-test-password';
const chatHeading = { name: 'Общий чат' };
const sendButton = { name: 'Отправить', exact: true };

test.describe.configure({ mode: 'default' });
const nickname = `Tab${randomUUID().slice(0, 12)}`;

test.beforeAll(async ({ request }) => {
  const response = await request.post('/api/auth/register', {
    data: { nickname, password },
  });
  expect(response.status()).toBe(201);
});

async function login(page: Page) {
  const response = await page.request.post('/api/auth/login', {
    data: { nickname, password },
  });
  expect(response.status()).toBe(201);
}

function message(text: string, id = randomUUID()) {
  return {
    id,
    text,
    authorNickname: 'Author',
    createdAt: new Date().toISOString(),
  };
}

function connectMock(
  socket: WebSocketRoute,
  onPacket: (packet: string) => void,
) {
  socket.onMessage((frame) => {
    const packet = String(frame);
    if (packet.startsWith('40/chat,')) {
      socket.send('40/chat,{"sid":"mock-chat"}');
    } else {
      onPacket(packet);
    }
  });
  socket.send(
    '0{"sid":"mock-engine","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":16384}',
  );
}

function sendEvent(socket: WebSocketRoute, value: object) {
  socket.send(`42/chat,${JSON.stringify(['chat:message-created', value])}`);
}

test('выходит из активного чата и закрывает сокет', async ({ page }) => {
  await login(page);
  const opened = page.waitForEvent('websocket', (socket) =>
    socket.url().includes('/socket.io/'),
  );
  await page.goto('/');
  const socket = await opened;
  await expect(page.locator('.online-badge')).toContainText('Онлайн');
  const closed = socket.waitForEvent('close');
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('.account-bar')).toHaveCount(0);
  await closed;
});

const logoutScenarios = [
  { mode: 'http', prepare: async () => undefined, destination: /\/$/ },
  {
    mode: 'network',
    prepare: (context: BrowserContext) => context.clearCookies(),
    destination: /\/login$/,
  },
];
for (const { mode, prepare, destination } of logoutScenarios) {
  test(`показывает ошибку logout при сбое ${mode} и проверяет сессию по ссылке`, async ({
    page,
    context,
  }) => {
    await login(page);
    const opened = page.waitForEvent('websocket', (socket) =>
      socket.url().includes('/socket.io/'),
    );
    await page.goto('/');
    const socket = await opened;
    await expect(page.locator('.online-badge')).toContainText('Онлайн');
    await page.route('**/api/auth/logout', (route) =>
      mode === 'http' ? route.fulfill({ status: 500 }) : route.abort('failed'),
    );
    const closed = socket.waitForEvent('close');
    await page.getByRole('button', { name: 'Выйти' }).click();
    await expect(page).toHaveURL(/\/logout-error$/);
    await expect(
      page.getByText('Не удалось подтвердить выход на сервере', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator('.account-bar')).toHaveCount(0);
    await closed;
    await prepare(context);
    await page.locator('main a[href="/"]').click();
    await expect(page).toHaveURL(destination);
  });
}

test('поздний refresh после начала logout не восстанавливает локальную авторизацию', async ({
  page,
}) => {
  await login(page);
  await controlScheduledRefresh(page);
  await page.goto('/');
  await expect(page.locator('.online-badge')).toContainText('Онлайн');
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const logoutStarted = Promise.withResolvers<void>();
  const finishLogout = Promise.withResolvers<void>();
  await page.route('**/api/auth/refresh', async (route) => {
    entered.resolve();
    await release.promise;
    await route.continue();
  });
  await page.route('**/api/auth/logout', async (route) => {
    logoutStarted.resolve();
    await finishLogout.promise;
    await route.continue();
  });
  try {
    await runScheduledRefresh(page);
    await entered.promise;
    await page.getByRole('button', { name: 'Выйти' }).click();
    await expect(page.locator('.account-bar')).toHaveCount(0);
    await expect(page.getByRole('heading', chatHeading)).toHaveCount(0);
    release.resolve();
    await logoutStarted.promise;
    await expect(page.locator('.account-bar')).toHaveCount(0);
    await expect(page.getByRole('heading', chatHeading)).toHaveCount(0);
  } finally {
    release.resolve();
    finishLogout.resolve();
  }
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.locator('.account-bar')).toHaveCount(0);
});

test('две вкладки обновляют авторизацию, восстанавливают разрыв и теряют сокеты при выходе', async ({
  page,
  context,
}) => {
  await login(page);
  await controlScheduledRefresh(page);
  const connections: WebSocketRoute[] = [];
  const handshakes: string[] = [];
  const updated = Promise.withResolvers<string>();
  const reconnect = Promise.withResolvers<void>();
  await page.routeWebSocket('**/socket.io/**', (socket) => {
    connections.push(socket);
    const server = socket.connectToServer();
    socket.onMessage((frame) => {
      const packet = String(frame);
      if (packet.startsWith('40/chat,')) {
        handshakes.push(
          JSON.parse(packet.slice('40/chat,'.length)).accessToken,
        );
        if (handshakes.length > 1) {
          void reconnect.promise.then(() => server.send(frame));
          return;
        }
      }
      const update = /^42\/chat,\d+(\["chat:update-auth".*)$/.exec(packet);
      if (update) updated.resolve(JSON.parse(update[1])[1].accessToken);
      server.send(frame);
    });
  });
  await page.goto('/');
  const otherTab = await context.newPage();
  const otherOpened = otherTab.waitForEvent('websocket', (socket) =>
    socket.url().includes('/socket.io/'),
  );
  await otherTab.goto('/');
  const otherSocket = await otherOpened;
  await expect(page.locator('.online-badge')).toContainText('Онлайн');
  await expect(otherTab.locator('.online-badge')).toContainText('Онлайн');

  const rotated = page.waitForResponse('**/api/auth/refresh');
  await runScheduledRefresh(page);
  expect((await rotated).status()).toBe(201);
  const renewedToken = await updated.promise;
  expect(renewedToken === handshakes[0]).toBe(false);
  expect(connections).toHaveLength(1);
  const refreshedMessage = `После refresh ${randomUUID()}`;
  await page.locator('#message').fill(refreshedMessage);
  await page.getByRole('button', sendButton).click();
  await expect(
    otherTab.getByText(refreshedMessage, { exact: true }),
  ).toBeVisible();
  await connections[0].close();
  const missed = `Во время разрыва ${randomUUID()}`;
  try {
    await expect.poll(() => handshakes.length).toBe(2);
    await expect(page.locator('.online-badge')).not.toContainText('Онлайн');
    await otherTab.locator('#message').fill(missed);
    await otherTab.getByRole('button', sendButton).click();
    await expect(
      otherTab
        .locator('article')
        .filter({ hasText: missed })
        .getByLabel('Отправлено'),
    ).toBeVisible();
  } finally {
    reconnect.resolve();
  }
  await expect(page.locator('.online-badge')).toContainText('Онлайн');
  await expect(page.getByText(missed, { exact: true })).toHaveCount(1);
  expect(handshakes[1] === renewedToken).toBe(true);
  const closed = otherSocket.waitForEvent('close');
  await otherTab.getByRole('button', { name: 'Выйти' }).click();
  await expect(otherTab).toHaveURL(/\/login$/);
  await closed;
  await expect(page.locator('.online-badge')).not.toContainText('Онлайн');
});

test('сохраняет раннюю историю и черновик при повторном разрыве посреди восстановления', async ({
  page,
}) => {
  await login(page);
  const earlier = message('Ранняя история');
  const initial = message('Начальный снимок');
  const firstGap = message('Граница первого подключения');
  const live = message('Событие во время восстановления');
  const gaps = Array.from({ length: 52 }, (_, index) =>
    message(`Пропуск ${index}`),
  );
  const connections: WebSocketRoute[] = [];
  await page.route('**/api/chat/messages*', (route) => {
    const before = new URL(route.request().url()).searchParams.get('before');
    return route.fulfill({
      json: before ? [earlier] : [initial],
      headers: before
        ? {}
        : { 'x-chat-before': initial.id, 'x-chat-position': '1' },
    });
  });
  const blocked = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const cursors: string[] = [];
  await page.route('**/api/chat/messages/recovery?*', async (route) => {
    const after =
      new URL(route.request().url()).searchParams.get('after') ?? '';
    cursors.push(after);
    if (after === '1') {
      await route.fulfill({
        json: { messages: [firstGap], next: '2', through: '2' },
      });
    } else if (after === '2') {
      const connection = connections.at(-1);
      if (!connection) throw new Error('Сокет восстановления не открылся');
      sendEvent(connection, live);
      await route.fulfill({
        json: { messages: gaps.slice(0, 50), next: '52', through: '55' },
      });
    } else {
      if (cursors.filter((cursor) => cursor === '52').length === 1) {
        blocked.resolve();
        await release.promise;
      }
      await route.fulfill({
        json: {
          messages: [...gaps.slice(50), live],
          next: '55',
          through: '55',
        },
      });
    }
  });
  await page.routeWebSocket('**/socket.io/**', (socket) => {
    connections.push(socket);
    connectMock(socket, () => undefined);
  });
  await page.goto('/');
  await expect(page.getByText(firstGap.text, { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Загрузить более ранние сообщения' })
    .click();
  await expect(page.getByText(earlier.text, { exact: true })).toBeVisible();
  await page.locator('#message').fill('Черновик');
  await connections[0].close();
  await expect(page.getByRole('button', sendButton)).toBeDisabled();
  try {
    await blocked.promise;
    await connections[1].close();
  } finally {
    release.resolve();
  }
  for (const value of [earlier, initial, firstGap, ...gaps, live]) {
    await expect(page.getByText(value.text, { exact: true })).toHaveCount(1);
  }
  await expect(page.locator('#message')).toHaveValue('Черновик');
  await expect(page.getByRole('button', sendButton)).toBeEnabled();
  expect(cursors.slice(0, 4)).toEqual(['1', '2', '52', '52']);
});

test('сверяет потерянный ACK и вручную повторяет ту же попытку', async ({
  page,
}) => {
  await login(page);
  await page.clock.install();
  await page.route('**/api/chat/messages', (route) =>
    route.fulfill({ json: [], headers: { 'x-chat-position': '0' } }),
  );
  let recovered:
    (ReturnType<typeof message> & { clientMessageId: string }) | undefined;
  await page.route('**/api/chat/messages/recovery?*', (route) =>
    route.fulfill({
      json: recovered
        ? { messages: [recovered], next: '1', through: '1' }
        : { messages: [], next: '0', through: '0' },
    }),
  );
  const sent: { text: string; clientMessageId: string }[] = [];
  const persisted = new Map<string, ReturnType<typeof message>>();
  let reconcileFails = true;
  await page.route('**/api/chat/messages/reconcile', (route) => {
    if (reconcileFails) return route.fulfill({ status: 503 });
    const { clientMessageIds } = reconcileChatRequestSchema.parse(
      route.request().postDataJSON(),
    );
    return route.fulfill({
      json: clientMessageIds.flatMap((clientMessageId) => {
        const value = persisted.get(clientMessageId);
        return value ? [{ ...value, clientMessageId }] : [];
      }),
    });
  });
  await page.routeWebSocket('**/socket.io/**', (socket) =>
    connectMock(socket, (packet) => {
      const match = /^42\/chat,(\d+)(\[.*)$/.exec(packet);
      if (!match) return;
      const [event, payload] = z
        .tuple([z.string(), z.unknown()])
        .parse(JSON.parse(match[2]));
      if (event !== chatSocketEvents.sendMessage) return;
      const input = sendChatMessageSchema.parse(payload);
      sent.push(input);
      if (input.text === 'Сохранено без ACK') {
        persisted.set(input.clientMessageId, message(input.text));
      } else if (input.text === 'Сохранено перед разрывом') {
        recovered = {
          ...message(input.text),
          clientMessageId: input.clientMessageId,
        };
        void socket.close();
      } else if (sent.filter(({ text }) => text === input.text).length === 2) {
        const saved = {
          ...message(input.text),
          clientMessageId: input.clientMessageId,
        };
        sendEvent(socket, saved);
        socket.send(
          `43/chat,${match[1]}${JSON.stringify([{ ok: true, message: saved }])}`,
        );
      }
    }),
  );
  await page.goto('/');
  const draft = page.locator('#message');
  for (const text of ['Сохранено без ACK', 'Не дошло']) {
    await draft.fill(text);
    await page.getByRole('button', sendButton).click();
    await expect(
      page
        .locator('article')
        .filter({ hasText: text })
        .getByLabel('Отправляется'),
    ).toBeVisible();
  }
  const failed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/reconcile') && response.status() === 503,
  );
  await page.clock.runFor(6000);
  await failed;
  expect(sent).toHaveLength(2);
  reconcileFails = false;
  await page.clock.runFor(6000);
  const saved = page
    .locator('article')
    .filter({ hasText: 'Сохранено без ACK' });
  await expect(saved.getByLabel('Отправлено')).toBeVisible();
  const missing = page.locator('article').filter({ hasText: 'Не дошло' });
  const error = missing.getByLabel('Не отправлено');
  await expect(error).toBeVisible();
  await error.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Не отправлено');
  await error.focus();
  await expect(page.getByRole('tooltip')).toHaveText('Не отправлено');
  const retry = missing.getByRole('button', { name: 'Отправить повторно' });
  expect(sent).toHaveLength(2);
  await retry.focus();
  await retry.press('Enter');
  await expect(missing.getByLabel('Отправлено')).toBeVisible();
  await expect(
    page.locator('article').filter({ hasText: 'Не дошло' }),
  ).toHaveCount(1);
  expect(sent[2]).toEqual(sent[1]);
  await expect(missing.getByRole('status')).toHaveText('Отправлено');

  reconcileFails = true;
  await draft.fill('Сохранено перед разрывом');
  await page.getByRole('button', sendButton).click();
  const afterReconnect = page
    .locator('article')
    .filter({ hasText: 'Сохранено перед разрывом' });
  await expect(afterReconnect.getByLabel('Отправлено')).toBeVisible();
  await expect(afterReconnect).toHaveCount(1);
});
