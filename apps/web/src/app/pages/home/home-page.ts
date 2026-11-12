import { DatePipe } from '@angular/common';
import {
  afterNextRender,
  Component,
  effect,
  inject,
  Injector,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  TuiButton,
  TuiHint,
  TuiIcon,
  TuiInput,
  TuiLabel,
} from '@taiga-ui/core';
import { AuthStoreService } from '../../core/auth/auth-store.service';
import { ChatStoreService } from '../../core/chat/chat-store.service';

@Component({
  imports: [
    DatePipe,
    FormsModule,
    TuiButton,
    TuiHint,
    TuiIcon,
    TuiInput,
    TuiLabel,
  ],
  providers: [ChatStoreService],
  selector: 'eg-home-page',
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePage {
  private readonly injector = inject(Injector);
  protected readonly auth = inject(AuthStoreService);
  protected readonly chat = inject(ChatStoreService);
  protected readonly focusedStatus = signal<string | null>(null);
  protected readonly statuses = {
    sending: { label: 'Отправляется', icon: '@tui.clock' },
    sent: { label: 'Отправлено', icon: '@tui.check' },
    failed: { label: 'Не отправлено', icon: '@tui.triangle-alert' },
  };
  protected draft = '';

  constructor() {
    effect(() => {
      const token = this.auth.accessToken();
      untracked(() => {
        if (token) this.chat.setToken(token);
        else this.chat.disconnect();
      });
    });
  }

  sendMessage(messageList: HTMLDivElement): void {
    const user = this.auth.user();
    if (!user || !this.draft.trim()) return;
    if (!this.chat.send(this.draft, user.nickname)) return;

    this.draft = '';
    afterNextRender(
      {
        earlyRead: () => messageList.scrollHeight,
        write: (bottom) => {
          messageList.scrollTop = bottom;
        },
      },
      { injector: this.injector },
    );
  }
}
