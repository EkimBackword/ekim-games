import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { chatMessageSchema, type ChatMessage } from 'contracts';

import { ChatApiService } from './chat-api.service';
import { ChatSocketService } from './chat-socket.service';

@Injectable()
export class ChatStoreService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly api = inject(ChatApiService);
  private readonly socket = inject(ChatSocketService);

  readonly messages = signal<ChatMessage[]>([]);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly connected = this.socket.connected;

  private connectSequence = 0;

  constructor() {
    this.socket.messages
      .pipe(takeUntilDestroyed())
      .subscribe((message) => this.addMessage(message));
    this.socket.errors
      .pipe(takeUntilDestroyed())
      .subscribe((message) => this.error.set(message));
    this.destroyRef.onDestroy(() => this.disconnect());
  }

  async connect(accessToken: string): Promise<void> {
    const sequence = ++this.connectSequence;
    this.socket.disconnect();
    this.error.set(null);
    this.loading.set(true);

    try {
      const history = await firstValueFrom(this.api.getMessages());
      if (sequence !== this.connectSequence) return;
      this.messages.set(history);
      this.socket.connect(accessToken);
    } catch {
      if (sequence === this.connectSequence) {
        this.error.set('Не удалось загрузить историю чата');
      }
    } finally {
      if (sequence === this.connectSequence) this.loading.set(false);
    }
  }

  send(text: string): void {
    const parsed = chatMessageSchema.shape.text.safeParse(text.trim());
    if (!parsed.success) {
      this.error.set('Сообщение должно содержать от 1 до 2000 символов');
      return;
    }
    if (!this.socket.send(parsed.data)) {
      this.error.set('Нет соединения с чатом');
      return;
    }
    this.error.set(null);
  }

  disconnect(): void {
    this.connectSequence += 1;
    this.socket.disconnect();
    this.messages.set([]);
    this.error.set(null);
    this.loading.set(false);
  }

  private addMessage(message: ChatMessage): void {
    this.messages.update((messages) =>
      messages.some((item) => item.id === message.id)
        ? messages
        : [...messages, message].slice(-50),
    );
  }
}
