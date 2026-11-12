import { Routes } from '@angular/router';

import {
  authenticatedUserMatchGuard,
  unauthenticatedUserMatchGuard,
} from './core/guards/auth.guard';

export const appRoutes: Routes = [
  {
    path: 'logout-error',
    loadComponent: () =>
      import('./pages/auth/logout-error-page').then(
        (module) => module.LogoutErrorPage,
      ),
    title: 'Ошибка выхода — Ekim Games',
  },
  {
    path: '',
    canMatch: [authenticatedUserMatchGuard],
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/home/home-page').then((module) => module.HomePage),
    title: 'Главное меню — Ekim Games',
  },
  {
    path: '',
    canMatch: [unauthenticatedUserMatchGuard],
    loadChildren: () =>
      import('./pages/auth/auth.routes').then((module) => module.authRoutes),
  },
  { path: '**', redirectTo: '' },
];
