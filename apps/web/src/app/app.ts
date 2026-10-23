import {
  Component,
  inject,
} from '@angular/core';
import {
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';

import { switchMap } from 'rxjs';

import {
  TuiButton,
  TuiRoot,
} from '@taiga-ui/core';

import { AuthStoreService } from './core/auth/auth-store.service';
import { HttpErrorService } from './core/errors/http-error.service';

@Component({
  imports: [RouterLink, RouterOutlet, TuiButton, TuiRoot],
  selector: 'eg-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly auth = inject(AuthStoreService);
  protected readonly httpErrors = inject(HttpErrorService);
  private readonly router = inject(Router);

  logout(): void {
    this.auth
      .logout()
      .pipe(switchMap(() => this.router.navigateByUrl('/login')))
      .subscribe();
  }
}
