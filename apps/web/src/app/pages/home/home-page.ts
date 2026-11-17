import { DatePipe } from '@angular/common';
import {
  afterRenderEffect,
  Component,
  ElementRef,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
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
  private readonly messageList =
    viewChild<ElementRef<HTMLDivElement>>('messageList');
  private initializedList?: HTMLDivElement;
  protected readonly auth = inject(AuthStoreService);
  protected readonly chat = inject(ChatStoreService);
  protected readonly atLatest = signal(true);
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

    afterRenderEffect({
      earlyRead: () => {
        const list = this.messageList()?.nativeElement;
        const entries = this.chat.entries();
        const loading = this.chat.loading();
        if (!list || loading || !entries.length) return;

        return {
          list,
          bottom:
            this.initializedList !== list || untracked(this.atLatest)
              ? list.scrollHeight
              : null,
        };
      },
      write: (scroll) => {
        const position = scroll();
        if (position && position.bottom !== null) {
          position.list.scrollTop = position.bottom;
          this.initializedList = position.list;
        }
        return position;
      },
      read: (scroll) => {
        const list = scroll()?.list;
        if (list) this.updateScrollPosition(list);
      },
    });

    afterRenderEffect({
      read: (onCleanup) => {
        const list = this.messageList()?.nativeElement;
        if (!list) return;

        const observer = new ResizeObserver(() =>
          this.updateScrollPosition(list),
        );
        observer.observe(list);
        onCleanup(() => observer.disconnect());
      },
    });
  }

  protected updateScrollPosition(list: HTMLDivElement): void {
    this.atLatest.set(
      list.scrollHeight - list.clientHeight - list.scrollTop <= 1,
    );
  }

  protected scrollToLatest(list: HTMLDivElement): void {
    list.focus({ preventScroll: true });
    list.scrollTop = list.scrollHeight;
    this.updateScrollPosition(list);
  }

  sendMessage(): void {
    const user = this.auth.user();
    if (!user || !this.draft.trim()) return;
    if (!this.chat.send(this.draft, user.nickname)) return;

    this.draft = '';
    this.atLatest.set(true);
  }
}
