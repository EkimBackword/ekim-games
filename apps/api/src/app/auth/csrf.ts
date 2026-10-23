import { ForbiddenException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

export const REFRESH_COOKIE = 'eg_refresh';
export const CSRF_COOKIE = 'eg_csrf';
export const CSRF_HEADER = 'x-csrf-token';
export const csrfCookieOptions = () => ({
  ...cookieOptions(),
  httpOnly: false,
  path: '/' as const,
});

export function assertCsrf(request: Request): void {
  const cookie = request.cookies?.[CSRF_COOKIE];
  const header = request.header(CSRF_HEADER);
  if (
    typeof cookie !== 'string' ||
    typeof header !== 'string' ||
    cookie.length !== header.length ||
    !timingSafeEqual(Buffer.from(cookie), Buffer.from(header))
  ) {
    throw new ForbiddenException('Токен CSRF не совпадает');
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure:
      process.env.COOKIE_SECURE === 'true' ||
      process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/api/auth',
  };
}
