import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  Router,
  RouterLink,
} from '@angular/router';

import {
  catchError,
  EMPTY,
  finalize,
  switchMap,
  tap,
} from 'rxjs';

import {
  TuiButton,
  TuiIcon,
  TuiInput,
  TuiLabel,
} from '@taiga-ui/core';
import {
  TuiButtonLoading,
  TuiPassword,
} from '@taiga-ui/kit';

import { AuthStoreService } from '../../../core/auth/auth-store.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TuiButton,
    TuiButtonLoading,
    TuiInput,
    TuiIcon,
    TuiLabel,
    TuiPassword,
  ],
  selector: 'eg-login-page',
  styleUrl: '../auth-form.css',
  templateUrl: './login-page.html',
})
export class LoginPage {
  protected readonly loading = signal(false);
  protected readonly formError = signal<string | null>(null);
  private readonly formBuilder = inject(NonNullableFormBuilder);
  protected readonly form = this.formBuilder.group({
    nickname: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(24)]],
    password: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(128)]],
  });

  private readonly auth = inject(AuthStoreService);
  private readonly router = inject(Router);

  submit(): void {
    if (this.loading()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { nickname, password } = this.form.getRawValue();
    this.loading.set(true);
    this.formError.set(null);
    this.auth
      .login(nickname, password)
      .pipe(
        tap(() => this.form.controls.password.reset()),
        switchMap(() => this.router.navigateByUrl('/')),
        catchError(() => {
          this.formError.set(
            'Не удалось войти. Проверьте данные и доступность сервера.',
          );
          return EMPTY;
        }),
        finalize(() => this.loading.set(false)),
      )
      .subscribe();
  }
}
