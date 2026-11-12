import { inject, Injectable, signal } from '@angular/core';
import {
  catchError,
  defer,
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
  readonly loggingOut = signal(false);

  private generation = 0;
  private refreshTimer: Subscription | null = null;
  private sessionRefresh$: Observable<boolean> | null = null;
  private readonly api = inject(AuthApiService);

  restoreSession(): Observable<boolean> {
    if (this.loggingOut()) return of(false);
    if (this.user() !== null) return of(true);
    return this.refreshSession();
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

  logout(): Observable<boolean> {
    return defer(() => {
      this.loggingOut.set(true);
      this.clear();
      return this.api.logout().pipe(
        map(() => true),
        catchError(() => of(false)),
        finalize(() => this.loggingOut.set(false)),
      );
    });
  }

  expireSession(): void {
    this.clear();
  }

  private refreshSession(): Observable<boolean> {
    if (this.sessionRefresh$) return this.sessionRefresh$;

    const generation = this.generation;
    this.sessionRefresh$ = this.api.refresh().pipe(
      map((session) => {
        if (generation !== this.generation) return false;
        this.setSession(session);
        return true;
      }),
      catchError(() => {
        if (generation === this.generation) this.clear();
        return of(false);
      }),
      finalize(() => (this.sessionRefresh$ = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    return this.sessionRefresh$;
  }

  private setSession(session: AuthSession): void {
    this.accessToken.set(session.accessToken);
    this.user.set(session.user);
    this.refreshTimer?.unsubscribe();
    this.refreshTimer = timer(9 * 60 * 1000)
      .pipe(switchMap(() => this.refreshSession()))
      .subscribe();
  }

  private clear(): void {
    this.generation += 1;
    this.refreshTimer?.unsubscribe();
    this.refreshTimer = null;
    this.accessToken.set(null);
    this.user.set(null);
  }
}
