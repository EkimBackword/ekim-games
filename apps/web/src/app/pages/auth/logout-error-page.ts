import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';

@Component({
  imports: [RouterLink, TuiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'eg-logout-error-page',
  template: `
    <h1>Не удалось подтвердить выход на сервере</h1>
    <a tuiButton appearance="flat" routerLink="/">Перейти на главную</a>
  `,
})
export class LogoutErrorPage {}
