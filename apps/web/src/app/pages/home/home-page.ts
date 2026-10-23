import { DatePipe } from '@angular/common';
import { Component, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TuiButton, TuiInput, TuiLabel } from '@taiga-ui/core';
import { AuthStoreService } from '../../core/auth/auth-store.service';
import { ChatStoreService } from '../../core/chat/chat-store.service';

@Component({
  imports: [DatePipe, FormsModule, TuiButton, TuiInput, TuiLabel],
  providers: [ChatStoreService],
  selector: 'eg-home-page',
  templateUrl: './home-page.html',
  styleUrl: './home-page.css',
})
export class HomePage {
  protected readonly auth = inject(AuthStoreService);
  protected readonly chat = inject(ChatStoreService);
  protected draft = '';

  constructor() {
    effect((onCleanup) => {
      const token = this.auth.accessToken();

      if (token) {
        void this.chat.connect(token);
      } else {
        this.chat.disconnect();
      }

      onCleanup(() => {
        this.chat.disconnect();
      });
    });
  }

  sendMessage(): void {
    if (!this.draft.trim()) return;
    if (this.chat.send(this.draft)) this.draft = '';
  }
}
