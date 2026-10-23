import {
  ChangeDetectionStrategy,
  Component,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  selector: 'eg-auth-page',
  styleUrl: './auth-page.css',
  templateUrl: './auth-page.html',
})
export class AuthPage {}
