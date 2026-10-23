import {
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthStoreService } from '../auth/auth-store.service';

function shouldAttachAccessToken(request: HttpRequest<unknown>): boolean {
  return (
    request.url.startsWith('/api/') &&
    !request.url.startsWith('/api/auth/')
  );
}

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const accessToken = inject(AuthStoreService).accessToken();

  if (
    !accessToken ||
    !shouldAttachAccessToken(request) ||
    request.headers.has('Authorization')
  ) {
    return next(request);
  }

  return next(
    request.clone({
      setHeaders: { Authorization: `Bearer ${accessToken}` },
    }),
  );
};
