import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable, throwError } from 'rxjs';
import { authResponseSchema, type AuthUser } from 'contracts';

export interface AuthSession {
  accessToken: string;
  user: AuthUser;
}

@Injectable({ providedIn: 'root' })
export class AuthApiService {
  private readonly http = inject(HttpClient);

  register(nickname: string, password: string): Observable<AuthSession> {
    return this.authenticate('register', nickname, password);
  }

  login(nickname: string, password: string): Observable<AuthSession> {
    return this.authenticate('login', nickname, password);
  }

  logout(): Observable<void> {
    return this.http.post<void>(
      '/api/auth/logout',
      {},
      {
        withCredentials: true,
        headers: { 'x-csrf-token': this.csrfToken() ?? '' },
      },
    );
  }

  refresh(): Observable<AuthSession> {
    const csrfToken = this.csrfToken();
    if (!csrfToken) {
      return throwError(() => new Error('CSRF-токен отсутствует'));
    }

    return this.http
      .post<unknown>(
        '/api/auth/refresh',
        {},
        {
          withCredentials: true,
          headers: { 'x-csrf-token': csrfToken },
        },
      )
      .pipe(map((response) => authResponseSchema.parse(response)));
  }

  csrfToken(): string | null {
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
    return this.http
      .post<unknown>(
        `/api/auth/${action}`,
        { nickname, password },
        { withCredentials: true },
      )
      .pipe(map((response) => authResponseSchema.parse(response)));
  }
}
