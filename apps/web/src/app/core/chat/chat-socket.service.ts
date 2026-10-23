import { Injectable, signal } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import { Subject } from 'rxjs';
import {
  chatSocketEvents,
  chatSocketServerPayloadSchemas,
  type ChatMessage,
} from 'contracts';

@Injectable({ providedIn: 'root' })
export class ChatSocketService {
  readonly connected = signal(false);
  readonly messages = new Subject<ChatMessage>();
  readonly errors = new Subject<string>();

  private socket: Socket | null = null;

  connect(accessToken: string): void {
    this.disconnect();

    const socket = io('/chat', {
      auth: { accessToken },
      transports: ['websocket'],
    });
    socket.on('connect', () => this.connected.set(true));
    socket.on('disconnect', () => this.connected.set(false));
    socket.on(chatSocketEvents.messageCreated, (payload: unknown) => {
      const result =
        chatSocketServerPayloadSchemas[
          chatSocketEvents.messageCreated
        ].safeParse(payload);
      if (result.success) this.messages.next(result.data);
    });
    socket.on(chatSocketEvents.error, (payload: unknown) => {
      const result =
        chatSocketServerPayloadSchemas[chatSocketEvents.error].safeParse(
          payload,
        );
      if (result.success) this.errors.next(result.data.message);
    });
    socket.on('connect_error', () =>
      this.errors.next('Соединение с чатом потеряно'),
    );

    this.socket = socket;
  }

  send(text: string): boolean {
    if (!this.socket?.connected) return false;
    this.socket.emit(chatSocketEvents.sendMessage, { text });
    return true;
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connected.set(false);
  }
}
