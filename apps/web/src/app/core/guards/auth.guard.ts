import { inject } from '@angular/core';
import { Router, type CanActivateFn, type CanMatchFn } from '@angular/router';
import { map } from 'rxjs';
import { AuthStoreService } from '../auth/auth-store.service';

export const authenticatedUserMatchGuard: CanMatchFn = () => {
  const auth = inject(AuthStoreService);
  return auth
    .restoreSession()
    .pipe(map(() => auth.user() !== null));
};

export const unauthenticatedUserMatchGuard: CanMatchFn = () => {
  const auth = inject(AuthStoreService);
  return auth
    .restoreSession()
    .pipe(map(() => auth.user() === null));
};

export const anonymousGuard: CanActivateFn = () => {
  const auth = inject(AuthStoreService);
  const router = inject(Router);

  return auth.restoreSession().pipe(
    map(() =>
      auth.user() !== null ? router.createUrlTree(['/']) : true,
    ),
  );
};
