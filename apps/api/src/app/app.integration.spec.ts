import { json } from 'express';
import cookieParser from 'cookie-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';

describe('API integration: auth and chat', () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { bodyParser: false });
    app.use(json({ limit: '16kb' }));
    app.use(cookieParser());
    app.enableCors({ origin: process.env.WEB_ORIGIN, credentials: true });
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') {
      throw new Error('API test server did not bind to a TCP port');
    }
    baseUrl = `http://127.0.0.1:${address.port}/api`;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
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
