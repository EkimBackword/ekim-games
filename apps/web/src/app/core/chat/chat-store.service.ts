import {
  DestroyRef,
  computed,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import {
  CHAT_RECONCILE_BATCH_SIZE,
  chatMessageSchema,
  type ChatDelivery,
  type ChatMessage,
  type OwnChatMessage,
  type SendChatMessage,
} from 'contracts';
import { ChatApiService } from './chat-api.service';
import { ChatSocketService } from './chat-socket.service';

type SendStatus = 'sending' | 'sent' | 'failed';

interface OutgoingMessage extends SendChatMessage {
  authorNickname: string;
  createdAt: string;
  status: SendStatus;
  serverId?: string;
}

function compareMessages(a: ChatMessage, b: ChatMessage): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : Number(a.id !== b.id);
}

@Injectable()
export class ChatStoreService {
  private readonly api = inject(ChatApiService);
  private readonly socket = inject(ChatSocketService);
  private readonly messages = signal<ChatMessage[]>([]);
  private readonly outgoing = signal(new Map<string, OutgoingMessage>());
  private readonly uncertain = new Set<string>();
  private position: string | null = null;
  private generation = 0;
  private connection = 0;
  private socketConnected = false;
  private reconciling = false;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private reconcileTimer?: ReturnType<typeof setTimeout>;

  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly loadingEarlier = signal(false);
  readonly before = signal<string | null>(null);
  readonly connected = signal(false);

  readonly entries = computed(() => {
    const byServerId = new Map<string, OutgoingMessage>();
    const pending: OutgoingMessage[] = [];
    for (const attempt of this.outgoing().values()) {
      if (attempt.serverId) {
        byServerId.set(attempt.serverId, attempt);
      } else {
        pending.push(attempt);
      }
    }

    const entries = this.messages().map((message) => {
      const attempt = byServerId.get(message.id);
      return {
        ...message,
        key: attempt?.clientMessageId ?? message.id,
        attemptId: attempt?.clientMessageId,
        status: attempt?.status,
      };
    });
    for (const attempt of pending) {
      entries.push({
        ...attempt,
        id: attempt.clientMessageId,
        key: attempt.clientMessageId,
        attemptId: attempt.clientMessageId,
      });
    }
    return entries.sort(compareMessages);
  });

  constructor() {
    this.socket.messages
      .pipe(takeUntilDestroyed())
      .subscribe((message) => this.receive(message));
    this.socket.errors
      .pipe(takeUntilDestroyed())
      .subscribe((message) => this.error.set(message));
    this.socket.connectionChanges
      .pipe(takeUntilDestroyed())
      .subscribe((connected) => {
        const connection = ++this.connection;
        this.socketConnected = connected;
        this.connected.set(false);
        clearTimeout(this.recoveryTimer);
        clearTimeout(this.reconcileTimer);
        if (connected) {
          this.error.set(null);
          void this.recover(connection);
        } else {
          for (const attempt of this.outgoing().values()) {
            if (attempt.status === 'sending')
              this.uncertain.add(attempt.clientMessageId);
          }
        }
      });
    inject(DestroyRef).onDestroy(() => this.disconnect());
  }

  setToken(accessToken: string): void {
    this.socket.setToken(accessToken);
  }

  async loadEarlier(): Promise<void> {
    const before = this.before();
    if (!before || this.loadingEarlier()) return;
    const generation = this.generation;
    this.loadingEarlier.set(true);
    try {
      const page = await firstValueFrom(this.api.getMessages(before));
      if (generation !== this.generation) return;
      this.merge(page.messages);
      this.before.set(page.before);
    } catch {
      if (generation === this.generation)
        this.error.set('Не удалось загрузить более ранние сообщения');
    } finally {
      if (generation === this.generation) this.loadingEarlier.set(false);
    }
  }

  send(text: string, authorNickname: string): boolean {
    if (!this.connected()) return false;
    const parsed = chatMessageSchema.shape.text.safeParse(text.trim());
    if (!parsed.success) {
      this.error.set('Сообщение должно содержать от 1 до 2000 символов');
      return false;
    }
    void this.submit({
      text: parsed.data,
      clientMessageId: crypto.randomUUID(),
      authorNickname,
      createdAt: new Date().toISOString(),
      status: 'sending',
    });
    return true;
  }

  retry(clientMessageId: string): void {
    const attempt = this.outgoing().get(clientMessageId);
    if (!this.connected() || attempt?.status !== 'failed') return;
    void this.submit({ ...attempt, status: 'sending' });
  }

  disconnect(): void {
    this.generation += 1;
    this.connection += 1;
    this.socketConnected = false;
    clearTimeout(this.recoveryTimer);
    clearTimeout(this.reconcileTimer);
    this.socket.disconnect();
    this.position = null;
    this.reconciling = false;
    this.uncertain.clear();
    this.outgoing.set(new Map());
    this.messages.set([]);
    this.connected.set(false);
    this.before.set(null);
    this.error.set(null);
    this.loading.set(false);
    this.loadingEarlier.set(false);
  }

  private async recover(connection: number): Promise<void> {
    try {
      if (this.position === null) {
        this.loading.set(true);
        const page = await firstValueFrom(this.api.getMessages());
        if (connection !== this.connection) return;
        this.merge(page.messages);
        this.before.set(page.before);
        this.position = page.position;
        this.loading.set(false);
      }

      let through: string | undefined;
      do {
        const after = this.position;
        if (after === null) throw new Error('Позиция истории отсутствует');
        const page = await firstValueFrom(this.api.recover(after, through));
        if (connection !== this.connection) return;
        if (
          (through !== undefined && page.through !== through) ||
          BigInt(page.next) < BigInt(after) ||
          BigInt(page.next) > BigInt(page.through) ||
          (page.next === after && page.next !== page.through)
        ) {
          throw new Error('Некорректная страница восстановления');
        }
        for (const message of page.messages) {
          if ('clientMessageId' in message) this.confirm(message);
        }
        this.merge(page.messages);
        this.position = page.next;
        through = page.through;
      } while (this.position !== through);

      this.error.set(null);
      this.connected.set(true);
      void this.reconcile();
    } catch {
      if (connection !== this.connection) return;
      this.loading.set(false);
      this.error.set('Не удалось восстановить историю чата');
      this.recoveryTimer = setTimeout(() => {
        if (connection === this.connection) void this.recover(connection);
      }, 2000);
    }
  }

  private async submit(attempt: OutgoingMessage): Promise<void> {
    const { clientMessageId, text } = attempt;
    this.updateAttempt(attempt);
    this.error.set(null);
    const ack = await this.socket.send({ clientMessageId, text });
    if (this.outgoing().get(clientMessageId) !== attempt) return;
    if (ack?.ok && ack.message.clientMessageId === clientMessageId) {
      this.receive(ack.message);
    } else if (ack?.ok === false) {
      this.fail(attempt);
    } else {
      this.uncertain.add(clientMessageId);
      void this.reconcile();
    }
  }

  private async reconcile(): Promise<void> {
    if (
      !this.connected() ||
      !this.socketConnected ||
      this.reconciling ||
      this.uncertain.size === 0
    )
      return;
    const generation = this.generation;
    this.reconciling = true;
    clearTimeout(this.reconcileTimer);
    const ids = [...this.uncertain].slice(0, CHAT_RECONCILE_BATCH_SIZE);
    const attempts = new Map(ids.map((id) => [id, this.outgoing().get(id)]));
    let retryDelay = 0;
    try {
      const confirmed = await firstValueFrom(this.api.reconcile(ids));
      if (generation !== this.generation) return;
      const confirmedIds = new Set(
        confirmed.map((message) => message.clientMessageId),
      );
      for (const message of confirmed) this.receive(message);
      for (const [id, attempt] of attempts) {
        if (
          attempt &&
          !confirmedIds.has(id) &&
          this.outgoing().get(id) === attempt
        ) {
          this.fail(attempt);
        }
      }
    } catch {
      retryDelay = 2000;
    } finally {
      if (generation === this.generation) {
        this.reconciling = false;
        if (this.uncertain.size > 0 && this.connected()) {
          this.reconcileTimer = setTimeout(
            () => void this.reconcile(),
            retryDelay,
          );
        }
      }
    }
  }

  private receive(message: ChatDelivery): void {
    if ('clientMessageId' in message) this.confirm(message);
    this.merge([message]);
  }

  private confirm(message: OwnChatMessage): void {
    const attempt = this.outgoing().get(message.clientMessageId);
    if (!attempt) return;
    this.uncertain.delete(message.clientMessageId);
    this.updateAttempt({ ...attempt, serverId: message.id, status: 'sent' });
  }

  private fail(attempt: OutgoingMessage): void {
    this.uncertain.delete(attempt.clientMessageId);
    this.updateAttempt({ ...attempt, status: 'failed' });
  }

  private updateAttempt(attempt: OutgoingMessage): void {
    this.outgoing.update((current) =>
      new Map(current).set(attempt.clientMessageId, attempt),
    );
  }

  private merge(incoming: ChatMessage[]): void {
    if (!incoming.length) return;
    this.messages.update((current) => {
      const byId = new Map(current.map((message) => [message.id, message]));
      for (const message of incoming) byId.set(message.id, message);
      return [...byId.values()];
    });
  }
}
