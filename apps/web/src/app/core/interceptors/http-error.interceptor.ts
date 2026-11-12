import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthStoreService } from '../auth/auth-store.service';
import { HttpErrorService } from '../errors/http-error.service';

function isApiRequest(url: string): boolean {
  return url.startsWith('/api/');
}

export const httpErrorInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthStoreService);
  const errors = inject(HttpErrorService);
  const router = inject(Router);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || !isApiRequest(request.url)) {
        return throwError(() => error);
      }

      if (error.status === 0) {
        errors.show(
          'Не удалось связаться с сервером. Проверьте подключение к интернету.',
        );
        return throwError(() => error);
      }

      switch (error.status) {
        case 401: {
          const token = auth.accessToken();
          const currentSessionRequest =
            request.url === '/api/auth/refresh' ||
            (token !== null &&
              request.headers.get('Authorization') === `Bearer ${token}`);
          if (currentSessionRequest && !auth.loggingOut()) {
            auth.expireSession();
            void router.navigateByUrl('/login');
          }
          break;
        }
        case 403:
          errors.show('Недостаточно прав для выполнения действия.');
          break;
        case 500:
          errors.show('На сервере произошла ошибка. Попробуйте позже.');
          break;
      }

      return throwError(() => error);
    }),
  );
};
