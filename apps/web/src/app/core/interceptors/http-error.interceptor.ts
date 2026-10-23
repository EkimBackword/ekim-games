import {
  HttpErrorResponse,
  HttpInterceptorFn,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthStoreService } from '../auth/auth-store.service';
import { HttpErrorService } from '../errors/http-error.service';

function isApiRequest(url: string): boolean {
  return url.startsWith('/api/');
}

function isCredentialSubmission(url: string): boolean {
  return url === '/api/auth/login' || url === '/api/auth/register';
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

      switch (error.status) {
        case 401:
          if (!isCredentialSubmission(request.url)) {
            auth.expireSession();
            void router.navigateByUrl('/login');
          }
          break;
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
