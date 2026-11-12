import { json } from 'express';
import cookieParser from 'cookie-parser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { io, type Socket } from 'socket.io-client';
import { JwtService } from '@nestjs/jwt';
import { authResponseSchema } from 'contracts';
import { AuthService } from './auth/auth.service';
import { ChatService } from './chat/chat.service';
import { PrismaService } from './prisma/prisma.service';

function barrier() {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('API integration: auth and chat', () => {
  let app: INestApplication;
  let baseUrl: string;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    app = await NestFactory.create(AppModule, { bodyParser: false });
    app.use(json({ limit: '16kb' }));
    app.use(cookieParser());
    app.enableCors({ origin: process.env.WEB_ORIGIN, credentials: true });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const prisma = app.get(PrismaService);
    await prisma.chatMessage.deleteMany();
    await prisma.$executeRaw`UPDATE "ChatPosition" SET position = 0 WHERE id = 1`;
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('API test server did not bind to a TCP port');
    }
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  }, 90_000);

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect();
    vi.restoreAllMocks();
    await app?.close();
  });

  async function register() {
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nickname: `Test${randomUUID().slice(0, 12)}`,
        password: 'integration-test-password',
      }),
    });
    expect(response.status).toBe(201);
    return {
      ...authResponseSchema.parse(await response.json()),
      cookies: response.headers
        .getSetCookie()
        .map((line) => line.split(';')[0]),
    };
  }

  function connect(accessToken: string) {
    const socket = io(new URL('/chat', baseUrl).href, {
      auth: { accessToken },
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
    });
    sockets.push(socket);
    return socket;
  }

  function connected(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
      socket.connect();
    });
  }

  function disconnected(socket: Socket): Promise<void> {
    return new Promise((resolve) => socket.once('disconnect', () => resolve()));
  }

  function chat(session: { accessToken: string }, suffix = '', body?: unknown) {
    return fetch(`${baseUrl}/chat/messages${suffix}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function changeSession(
    session: { cookies: string[] },
    action: 'refresh' | 'logout',
  ) {
    return fetch(`${baseUrl}/auth/${action}`, {
      method: 'POST',
      headers: {
        cookie: session.cookies.join('; '),
        'x-csrf-token':
          session.cookies
            .find((cookie) => cookie.startsWith('eg_csrf='))
            ?.slice(8) ?? '',
      },
    });
  }

  it('проверяет handshake, обновляет только тот же sid и отключает неактивный сокет по exp', async () => {
    const owner = await register();
    const other = await register();
    const auth = app.get(AuthService);
    const validate = auth.validateAccess.bind(auth);
    const gate = barrier();
    const entered = barrier();
    const jwt = new JwtService();
    const claims = jwt.decode<{ sid: string }>(owner.accessToken);
    const shortToken = jwt.sign(
      { sub: owner.user.id, sid: claims.sid, typ: 'access' },
      {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: 4,
      },
    );
    const spy = vi
      .spyOn(auth, 'validateAccess')
      .mockImplementation(async (token) => {
        if (token === shortToken) {
          entered.resolve();
          await gate.promise;
        }
        return validate(token);
      });
    const socket = connect(shortToken);
    const seen: unknown[] = [];
    socket.on('chat:message-created', (message) => seen.push(message));
    const handshake = connected(socket);
    try {
      await entered.promise;
      expect((await chat(other, '', { text: 'До допуска' })).status).toBe(201);
    } finally {
      gate.resolve();
      spy.mockRestore();
    }
    await handshake;
    expect(seen).toHaveLength(0);
    const refresh = await changeSession(owner, 'refresh');
    const renewed = authResponseSchema.parse(await refresh.json());
    expect(
      await socket
        .timeout(1000)
        .emitWithAck('chat:update-auth', { accessToken: renewed.accessToken }),
    ).toEqual({ ok: true });
    expect(
      await socket
        .timeout(1000)
        .emitWithAck('chat:update-auth', { accessToken: other.accessToken }),
    ).toEqual({ ok: false });
    expect(socket.connected).toBe(true);
    expect(
      await socket
        .timeout(1000)
        .emitWithAck('chat:update-auth', { accessToken: shortToken }),
    ).toEqual({ ok: true });
    await disconnected(socket);
    expect((await chat(other, '', { text: 'После истечения' })).status).toBe(
      201,
    );
    expect(seen).toHaveLength(0);
  }, 12_000);

  it.each(['logout', 'refresh'] as const)(
    'закрывает два сокета и исключает отозванный sid при %s',
    async (action) => {
      const owner = await register();
      const other = await register();
      const socketsOfOwner = [
        connect(owner.accessToken),
        connect(owner.accessToken),
      ];
      const witness = connect(other.accessToken);
      await Promise.all([...socketsOfOwner, witness].map(connected));
      if (action === 'refresh')
        expect((await changeSession(owner, 'refresh')).status).toBe(201);
      const received: unknown[] = [];
      for (const socket of socketsOfOwner)
        socket.on('chat:message-created', (value) => received.push(value));
      const service = app.get(ChatService);
      const create = service.create.bind(service);
      const entered = barrier();
      const release = barrier();
      const spy = vi
        .spyOn(service, 'create')
        .mockImplementationOnce(async (...args) => {
          const message = await create(...args);
          entered.resolve();
          await release.promise;
          return message;
        });
      const publication = chat(other, '', { text: 'После отзыва' });
      const delivered = new Promise((resolve) =>
        witness.once('chat:message-created', resolve),
      );
      const closed = Promise.all(socketsOfOwner.map(disconnected));
      try {
        await entered.promise;
        const sid = new JwtService().decode<{ sid: string }>(
          owner.accessToken,
        ).sid;
        const prisma = app.get(PrismaService);
        const rowLocked = barrier();
        const releaseRow = barrier();
        const rowLock = prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "RefreshSession" WHERE id = ${sid}::uuid FOR UPDATE`;
          rowLocked.resolve();
          await releaseRow.promise;
        });
        void rowLock.catch(rowLocked.reject);
        await rowLocked.promise;
        const revocation = changeSession(owner, action);
        let rejected: Promise<unknown>;
        try {
          await vi.waitFor(async () => {
            const [result] = await prisma.$queryRaw<{ waiting: boolean }[]>`
            SELECT EXISTS (
              SELECT 1 FROM pg_stat_activity
              WHERE wait_event_type = 'Lock' AND query LIKE '%UPDATE%RefreshSession%'
            ) AS waiting
          `;
            expect(result.waiting).toBe(true);
          });
          const admission = vi.spyOn(app.get(AuthService), 'authorizeSocket');
          rejected = expect(
            connected(connect(owner.accessToken)),
          ).rejects.toBeDefined();
          await vi.waitFor(() => expect(admission).toHaveBeenCalled());
        } finally {
          releaseRow.resolve();
          await rowLock;
        }
        const response = await revocation;
        expect(response.status).toBe(action === 'logout' ? 201 : 401);
        await closed;
        await rejected;
      } finally {
        release.resolve();
        spy.mockRestore();
      }
      expect((await publication).status).toBe(201);
      expect(await delivered).toMatchObject({ text: 'После отзыва' });
      expect(received).toHaveLength(0);
    },
  );

  it('читает историю по исключающей границе и восстанавливает записи до фиксированной позиции', async () => {
    const author = await register();
    const prisma = app.get(PrismaService);
    const service = app.get(ChatService);
    const user = author.user;
    const empty = await chat(author);
    expect(await empty.json()).toEqual([]);
    expect(empty.headers.get('x-chat-position')).toBe('0');
    expect(empty.headers.get('x-chat-before')).toBeNull();
    for (let index = 0; index < 53; index++) {
      await service.create(user, { text: `История ${index}` });
    }
    await prisma.chatMessage.updateMany({
      where: { userId: user.id },
      data: { createdAt: new Date('2030-01-01T00:00:00Z') },
    });
    const initial = await chat(author);
    const before = initial.headers.get('x-chat-before');
    const after = initial.headers.get('x-chat-position');
    const recent = await initial.json();
    expect(recent).toHaveLength(50);
    expect(before).toBe(recent[0].id);
    expect(after).toMatch(/^\d+$/);
    const recoveryStart = await (
      await chat(author, '/recovery?after=0')
    ).json();
    expect(recoveryStart.messages).toHaveLength(50);
    expect(recoveryStart.through).toBe(after);
    await service.create(user, { text: 'Запись после снимка' });
    const recoveryEnd = await (
      await chat(
        author,
        `/recovery?after=${recoveryStart.next}&through=${recoveryStart.through}`,
      )
    ).json();
    expect(recoveryEnd.messages).toHaveLength(3);
    expect(recoveryEnd.next).toBe(after);
    expect(recoveryEnd.messages).not.toContainEqual(
      expect.objectContaining({ text: 'Запись после снимка' }),
    );
    const earlier = await chat(author, `?before=${before}`);
    const previous = await earlier.json();
    expect(previous).toHaveLength(4);
    expect(earlier.headers.get('x-chat-before')).toBeNull();
    expect(previous.map((row: { id: string }) => row.id)).not.toContain(before);
    const recovered = await chat(author, `/recovery?after=${after}`);
    expect(await recovered.json()).toMatchObject({
      messages: [{ text: 'Запись после снимка' }],
      next: expect.stringMatching(/^\d+$/),
      through: expect.stringMatching(/^\d+$/),
    });
  });

  it('мигрирует существующие сообщения с одинаковым временем в порядке id', async () => {
    const migration = readFileSync(
      'apps/api/prisma/migrations/20261111000000_reliable_chat/migration.sql',
      'utf8',
    );
    const prisma = app.get(PrismaService);
    const rollback = new Error('Откат тестовой схемы');
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`CREATE SCHEMA chat_migration_fixture`;
        await tx.$executeRaw`SET LOCAL search_path TO chat_migration_fixture`;
        await tx.$executeRaw`
        CREATE TABLE "ChatMessage" ("id" UUID PRIMARY KEY, "userId" UUID NOT NULL, "createdAt" TIMESTAMPTZ)
      `;
        const first = '00000000-0000-4000-8000-000000000001';
        const second = '00000000-0000-4000-8000-000000000002';
        const author = randomUUID();
        await tx.$executeRaw`
        INSERT INTO "ChatMessage" VALUES
          (${second}::uuid, ${author}::uuid, '2026-11-01'),
          (${first}::uuid, ${author}::uuid, '2026-11-01')
      `;
        for (const statement of migration
          .split(';')
          .map((value) => value.trim())) {
          if (statement && statement !== 'BEGIN' && statement !== 'COMMIT') {
            await tx.$executeRawUnsafe(statement);
          }
        }
        expect(
          await tx.$queryRaw`SELECT id, position, "clientMessageId" FROM "ChatMessage" ORDER BY position`,
        ).toEqual([
          { id: first, position: 1n, clientMessageId: null },
          { id: second, position: 2n, clientMessageId: null },
        ]);
        expect(
          await tx.$queryRaw`SELECT position FROM "ChatPosition" WHERE id = 1`,
        ).toEqual([{ position: 2n }]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it('не подтверждает позицию за незавершённой транзакцией записи', async () => {
    const author = await register();
    const prisma = app.get(PrismaService);
    const ready = barrier();
    const release = barrier();
    const initial = await chat(author);
    const after = initial.headers.get('x-chat-position');
    const transaction = prisma.$transaction(async (tx) => {
      const [counter] = await tx.$queryRaw<{ position: bigint }[]>`
        UPDATE "ChatPosition" SET position = position + 1 WHERE id = 1 RETURNING position
      `;
      await tx.$executeRaw`
        INSERT INTO "ChatMessage" ("id", "userId", "text", "position")
        VALUES (${randomUUID()}::uuid, ${author.user.id}::uuid, 'Транзакция A', ${counter.position})
      `;
      ready.resolve();
      await release.promise;
    });
    void transaction.catch(ready.reject);
    await ready.promise;
    const second = chat(author, '', { text: 'Транзакция B' });
    try {
      const snapshot = await chat(author, `/recovery?after=${after}`);
      expect(await snapshot.json()).toEqual({
        messages: [],
        next: after,
        through: after,
      });
    } finally {
      release.resolve();
      await transaction;
    }
    expect((await second).status).toBe(201);
    const recovered = await chat(author, `/recovery?after=${after}`);
    expect(await recovered.json()).toMatchObject({
      messages: [{ text: 'Транзакция A' }, { text: 'Транзакция B' }],
    });
  });

  it('подтверждает одну запись и рассылку для параллельных повторов и сверяет по автору', async () => {
    const owner = await register();
    const other = await register();
    const after = (await chat(owner)).headers.get('x-chat-position');
    expect(after).not.toBeNull();
    const a = connect(owner.accessToken);
    const b = connect(owner.accessToken);
    const witness = connect(other.accessToken);
    await Promise.all([a, b, witness].map(connected));
    const clientMessageId = randomUUID();
    const input = { clientMessageId, text: 'Одна попытка' };
    const publicEvents: unknown[] = [];
    witness.on('chat:message-created', (value) => publicEvents.push(value));
    const authorEvent = new Promise((resolve) =>
      a.once('chat:message-created', resolve),
    );
    const [first, second] = await Promise.all(
      [a, b].map((socket) =>
        socket.timeout(1000).emitWithAck('chat:send-message', input),
      ),
    );
    expect(first).toMatchObject({ ok: true, message: { ...input } });
    expect(second).toEqual(first);
    expect(await authorEvent).toEqual(first.message);
    expect(
      await b.timeout(1000).emitWithAck('chat:send-message', {
        ...input,
        text: 'Другой текст',
      }),
    ).toMatchObject({ ok: false });
    const reconcile = (session: typeof owner) =>
      chat(session, '/reconcile', { clientMessageIds: [clientMessageId] });
    expect(await (await reconcile(owner)).json()).toEqual([first.message]);
    expect(await (await reconcile(other)).json()).toEqual([]);
    const recoveryPath = `/recovery?after=${after}`;
    await vi.waitFor(() => expect(publicEvents).toHaveLength(1));
    expect(await (await chat(owner, recoveryPath)).json()).toHaveProperty(
      'messages',
      [first.message],
    );
    expect(await (await chat(other, recoveryPath)).json()).toHaveProperty(
      'messages',
      publicEvents,
    );
    expect((await chat(owner, '', { text: 'Обычный REST' })).status).toBe(201);
    await vi.waitFor(() => expect(publicEvents).toHaveLength(2));
    expect(publicEvents[0]).not.toHaveProperty('clientMessageId');
  });

  it('registers, rejects case-insensitive duplicate nicknames, persists chat, and revokes the session', async () => {
    const nickname = `ApiTest${Date.now()}`;
    const password = 'integration-test-password';
    const register = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname, password }),
    });

    expect(register.status).toBe(201);
    const session = (await register.json()) as {
      user: { nickname: string };
    };
    expect(session.user.nickname).toBe(nickname);

    const cookies = register.headers.get('set-cookie') ?? '';
    const refreshCookie = cookies.match(/eg_refresh=([^;,]+)/)?.[0];
    const csrfCookie = cookies.match(/eg_csrf=([^;,]+)/)?.[0];
    const csrfToken = csrfCookie?.slice('eg_csrf='.length);
    expect(refreshCookie).toBeTruthy();
    expect(csrfCookie).toBeTruthy();
    expect(cookies.toLowerCase()).toContain('httponly');
    expect(cookies).toContain('SameSite=Strict');

    const invalidRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `${refreshCookie}; ${csrfCookie}` },
    });
    expect(invalidRefresh.status).toBe(403);

    const refresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        cookie: `${refreshCookie}; ${csrfCookie}`,
        'x-csrf-token': csrfToken ?? '',
      },
    });
    expect(refresh.status).toBe(201);
    const refreshedSession = (await refresh.json()) as {
      accessToken: string;
    };
    const refreshedCookies = refresh.headers.get('set-cookie') ?? '';
    const rotatedRefreshCookie =
      refreshedCookies.match(/eg_refresh=([^;,]+)/)?.[0];
    const rotatedCsrfCookie = refreshedCookies.match(/eg_csrf=([^;,]+)/)?.[0];
    expect(rotatedRefreshCookie).toBeTruthy();
    expect(rotatedRefreshCookie).not.toBe(refreshCookie);

    const duplicate = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: nickname.toLowerCase(), password }),
    });
    expect(duplicate.status).toBe(409);

    const invalidLogin = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname, password: 'incorrect-password' }),
    });
    expect(invalidLogin.status).toBe(401);

    const unauthorizedHistory = await fetch(`${baseUrl}/chat/messages`);
    expect(unauthorizedHistory.status).toBe(401);

    const createMessage = await fetch(`${baseUrl}/chat/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${refreshedSession.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text: 'Integration message' }),
    });
    expect(createMessage.status).toBe(201);

    const history = await fetch(`${baseUrl}/chat/messages`, {
      headers: { authorization: `Bearer ${refreshedSession.accessToken}` },
    });
    expect(history.status).toBe(200);
    expect(await history.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          authorNickname: nickname,
          text: 'Integration message',
        }),
      ]),
    );

    const logout = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: {
        cookie: `${rotatedRefreshCookie}; ${rotatedCsrfCookie}`,
        'x-csrf-token': rotatedCsrfCookie?.slice('eg_csrf='.length) ?? '',
      },
    });
    expect(logout.status).toBe(201);

    const revokedHistory = await fetch(`${baseUrl}/chat/messages`, {
      headers: { authorization: `Bearer ${refreshedSession.accessToken}` },
    });
    expect(revokedHistory.status).toBe(401);

    const replayNickname = `Replay${Date.now()}`;
    const replayRegister = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nickname: replayNickname, password }),
    });
    const replayCookies = replayRegister.headers.get('set-cookie') ?? '';
    const originalReplayCookie =
      replayCookies.match(/eg_refresh=([^;,]+)/)?.[0];
    const originalReplayCsrfCookie =
      replayCookies.match(/eg_csrf=([^;,]+)/)?.[0];
    const originalReplayCsrf = originalReplayCsrfCookie?.slice(
      'eg_csrf='.length,
    );

    const firstRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        cookie: `${originalReplayCookie}; ${originalReplayCsrfCookie}`,
        'x-csrf-token': originalReplayCsrf ?? '',
      },
    });
    expect(firstRefresh.status).toBe(201);
    const replaySession = (await firstRefresh.json()) as {
      accessToken: string;
    };

    const staleRefresh = await fetch(`${baseUrl}/auth/refresh`, {
      method: 'POST',
      headers: {
        cookie: `${originalReplayCookie}; ${originalReplayCsrfCookie}`,
        'x-csrf-token': originalReplayCsrf ?? '',
      },
    });
    expect(staleRefresh.status).toBe(401);

    const replayRevokedHistory = await fetch(`${baseUrl}/chat/messages`, {
      headers: { authorization: `Bearer ${replaySession.accessToken}` },
    });
    expect(replayRevokedHistory.status).toBe(401);
  });
});
