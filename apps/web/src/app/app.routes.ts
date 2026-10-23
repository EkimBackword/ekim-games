import { Routes } from '@angular/router';

import {
  authenticatedUserMatchGuard,
  unauthenticatedUserMatchGuard,
} from './core/guards/auth.guard';

export const appRoutes: Routes = [
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
