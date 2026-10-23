import { inject, Injectable, signal } from '@angular/core';
import {
  catchError,
  finalize,
  map,
  Observable,
  of,
  shareReplay,
  Subscription,
  switchMap,
  tap,
  timer,
} from 'rxjs';
import type { AuthUser } from 'contracts';

import { AuthApiService, type AuthSession } from './auth-api.service';

@Injectable({ providedIn: 'root' })
export class AuthStoreService {
  readonly user = signal<AuthUser | null>(null);
  readonly accessToken = signal<string | null>(null);

  private refreshTimer: Subscription | null = null;
  private sessionRestore$: Observable<boolean> | null = null;
  private readonly api = inject(AuthApiService);

  restoreSession(): Observable<boolean> {
    if (this.user() !== null) return of(true);
    if (this.sessionRestore$) return this.sessionRestore$;

    this.sessionRestore$ = this.api.refresh().pipe(
      tap((session) => this.setSession(session)),
      map(() => true),
      catchError(() => {
        this.clear();
        return of(false);
      }),
      finalize(() => (this.sessionRestore$ = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    return this.sessionRestore$;
  }

  register(nickname: string, password: string): Observable<void> {
    return this.api.register(nickname, password).pipe(
      tap((session) => this.setSession(session)),
      map(() => undefined),
    );
  }

  login(nickname: string, password: string): Observable<void> {
    return this.api.login(nickname, password).pipe(
      tap((session) => this.setSession(session)),
      map(() => undefined),
    );
  }

  logout(): Observable<void> {
    return this.api.logout().pipe(
      catchError(() => of(undefined)),
      map(() => undefined),
      finalize(() => this.clear()),
    );
  }

  expireSession(): void {
    this.clear();
  }

  private refreshAccess(): Observable<void> {
    return this.api.refresh().pipe(
      tap((session) => this.setSession(session)),
      map(() => undefined),
      catchError(() => {
        this.clear();
        return of(undefined);
      }),
    );
  }

  private setSession(session: AuthSession): void {
    this.accessToken.set(session.accessToken);
    this.user.set(session.user);
    this.refreshTimer?.unsubscribe();
    this.refreshTimer = timer(9 * 60 * 1000)
      .pipe(switchMap(() => this.refreshAccess()))
      .subscribe();
  }

  private clear(): void {
    this.refreshTimer?.unsubscribe();
    this.refreshTimer = null;
    this.accessToken.set(null);
    this.user.set(null);
  }
}
