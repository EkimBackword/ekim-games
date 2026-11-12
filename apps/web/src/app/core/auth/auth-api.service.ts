import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { defer, firstValueFrom, map, Observable, throwError } from 'rxjs';
import { authResponseSchema, type AuthUser } from 'contracts';
import { HttpErrorService } from '../errors/http-error.service';

export interface AuthSession {
  accessToken: string;
  user: AuthUser;
}

@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);
  private readonly errors = inject(HttpErrorService);

  register(nickname: string, password: string): Observable<AuthSession> {
    return this.authenticate('register', nickname, password);
  }

  login(nickname: string, password: string): Observable<AuthSession> {
    return this.authenticate('login', nickname, password);
  }

  logout(): Observable<void> {
    return this.withCookieLock(() =>
      this.http.post<void>(
        '/api/auth/logout',
        {},
        {
          withCredentials: true,
          timeout: 15_000,
          headers: { 'x-csrf-token': this.csrfToken() ?? '' },
        },
      ),
    );
  }

  refresh(): Observable<AuthSession> {
    return this.withCookieLock(() => {
      const csrfToken = this.csrfToken();
      if (!csrfToken) {
        return throwError(() => new Error('CSRF-токен отсутствует'));
      }

      return this.http.post<unknown>(
        '/api/auth/refresh',
        {},
        {
          withCredentials: true,
          timeout: 15_000,
          headers: { 'x-csrf-token': csrfToken },
        },
      );
    }).pipe(map((response) => authResponseSchema.parse(response)));
  }

  private csrfToken(): string | null {
    const value = document.cookie
      .split('; ')
      .find((cookie) => cookie.startsWith('eg_csrf='))
      ?.slice('eg_csrf='.length);
    return value ? decodeURIComponent(value) : null;
  }

  private authenticate(
    action: 'login' | 'register',
    nickname: string,
    password: string,
  ): Observable<AuthSession> {
    return this.withCookieLock(() =>
      this.http.post<unknown>(
        `/api/auth/${action}`,
        { nickname, password },
        { withCredentials: true, timeout: 15_000 },
      ),
    ).pipe(map((response) => authResponseSchema.parse(response)));
  }

  private withCookieLock<T>(request: () => Observable<T>): Observable<T> {
    return defer(() => {
      const locks = globalThis.navigator?.locks;
      if (!locks) {
        const message =
          'Для работы с сессией нужен браузер с поддержкой Web Locks и защищённое подключение.';
        this.errors.show(message);
        return throwError(() => new Error(message));
      }

      return locks.request('ekim-games:auth-cookies', () =>
        firstValueFrom(request()),
      );
    });
  }
}
