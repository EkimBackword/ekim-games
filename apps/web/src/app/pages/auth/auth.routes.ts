import { Routes } from '@angular/router';
import { anonymousGuard } from '../../core/guards/auth.guard';

export const authRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./auth-page/auth-page').then((module) => module.AuthPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'login' },
      {
        path: 'login',
        canActivate: [anonymousGuard],
        loadComponent: () =>
          import('./login-page/login-page').then(
            (module) => module.LoginPage,
          ),
        title: 'Вход — Ekim Games',
      },
      {
        path: 'register',
        canActivate: [anonymousGuard],
        loadComponent: () =>
          import('./register-page/register-page').then(
            (module) => module.RegisterPage,
          ),
        title: 'Регистрация — Ekim Games',
      },
    ],
  },
];
