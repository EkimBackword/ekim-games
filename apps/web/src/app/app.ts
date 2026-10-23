import {
  Component,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';

import {
  switchMap,
} from 'rxjs';

import {
  TuiButton,
  TuiRoot,
} from '@taiga-ui/core';

import { AuthStoreService } from './core/auth/auth-store.service';
import { HttpErrorService } from './core/errors/http-error.service';
import { NetworkStatusService } from './core/network/network-status.service';

@Component({
  imports: [RouterLink, RouterOutlet, TuiButton, TuiRoot],
  selector: 'eg-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly networkStatus = inject(NetworkStatusService);
  protected readonly online = toSignal(this.networkStatus.isOnline$, {
    requireSync: true,
  });
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
