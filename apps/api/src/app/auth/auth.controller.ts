import { randomBytes } from 'node:crypto';

import {
  authResponseSchema,
  loginRequestSchema,
  registerRequestSchema,
} from 'contracts';
import type {
  Request,
  Response,
} from 'express';

import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  Throttle,
  ThrottlerGuard,
} from '@nestjs/throttler';

import { parseRequest } from '../validation/parse-request';
import {
  AuthService,
  type SessionAuthResponse,
} from './auth.service';
import {
  assertCsrf,
  cookieOptions,
  CSRF_COOKIE,
  csrfCookieOptions,
  REFRESH_COOKIE,
} from './csrf';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseRequest(registerRequestSchema, body);
    const session = await this.auth.register(input.nickname, input.password);
    return this.setSessionCookies(session, response);
  }

  @Post('login')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parseRequest(loginRequestSchema, body);
    const session = await this.auth.login(input.nickname, input.password);
    return this.setSessionCookies(session, response);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertCsrf(request);
    const token = request.cookies?.[REFRESH_COOKIE];
    if (typeof token !== 'string') {
      await this.clearCookies(response);
      throw new UnauthorizedException('Не удалось обновить токен сессии');
    }
    try {
      const session = await this.auth.refresh(token);
      return this.setSessionCookies(session, response);
    } catch (error) {
      await this.clearCookies(response);
      throw error;
    }
  }

  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertCsrf(request);
    try {
      await this.auth.logout(request.cookies?.[REFRESH_COOKIE]);
    } finally {
      await this.clearCookies(response);
    }
    return { success: true };
  }

  private setSessionCookies(session: SessionAuthResponse, response: Response) {
    response.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...cookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    response.cookie(CSRF_COOKIE, randomBytes(32).toString('base64url'), {
      ...csrfCookieOptions(),
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return authResponseSchema.parse({
      accessToken: session.accessToken,
      user: session.user,
    });
  }

  private async clearCookies(response: Response): Promise<void> {
    response.clearCookie(REFRESH_COOKIE, cookieOptions());
    response.clearCookie(CSRF_COOKIE, csrfCookieOptions());
  }
}
