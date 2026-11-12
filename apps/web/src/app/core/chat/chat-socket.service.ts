import { Injectable } from '@angular/core';
import { io, type Socket } from 'socket.io-client';
import { Subject } from 'rxjs';
import {
  chatAuthAckSchema,
  chatSendAckSchema,
  chatSocketEvents,
  chatSocketServerPayloadSchemas,
  type ChatDelivery,
  type SendChatMessage,
} from 'contracts';

@Injectable({ providedIn: 'root' })
export class ChatSocketService {
  readonly connectionChanges = new Subject<boolean>();
  readonly messages = new Subject<ChatDelivery>();
  readonly errors = new Subject<string>();

  private socket: Socket | null = null;
  private token: string | null = null;
  private authorizationUpdate = 0;

  setToken(accessToken: string): void {
    if (this.token === accessToken) return;
    this.token = accessToken;
    const socket = this.socket;
    if (!socket) {
      this.connect();
      return;
    }
    if (socket.connected) {
      void this.updateAuthorization(socket, accessToken);
    } else if (!socket.active) {
      socket.connect();
    }
  }

  async send(input: SendChatMessage) {
    if (!this.socket?.connected) return null;
    try {
      const ack: unknown = await this.socket.volatile
        .timeout(5000)
        .emitWithAck(chatSocketEvents.sendMessage, input);
      const parsed = chatSendAckSchema.safeParse(ack);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.token = null;
    this.authorizationUpdate += 1;
    socket?.disconnect();
    socket?.removeAllListeners();
  }

  private connect(): void {
    let handshakeToken: string | null = null;
    const socket = io('/chat', {
      auth: (callback) => {
        handshakeToken = this.token;
        callback({ accessToken: handshakeToken });
      },
      autoConnect: false,
      transports: ['websocket'],
    });
    this.socket = socket;
    socket.on('connect', () => {
      if (this.token && this.token !== handshakeToken) {
        void this.updateAuthorization(socket, this.token);
      }
      this.connectionChanges.next(true);
    });
    socket.on('disconnect', (reason) => {
      if (socket !== this.socket) return;
      this.authorizationUpdate += 1;
      this.connectionChanges.next(false);
      if (reason === 'io server disconnect' && this.hasUnexpiredToken())
        socket.connect();
    });
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
    socket.connect();
  }

  private async updateAuthorization(
    socket: Socket,
    accessToken: string,
  ): Promise<void> {
    const update = ++this.authorizationUpdate;
    try {
      const response: unknown = await socket
        .timeout(5000)
        .emitWithAck(chatSocketEvents.updateAuth, { accessToken });
      if (chatAuthAckSchema.parse(response).ok) return;
    } catch {
      // При неопределённом результате повторный handshake проверит актуальный токен.
    }
    if (
      this.socket === socket &&
      update === this.authorizationUpdate &&
      socket.connected
    ) {
      socket.disconnect();
      if (this.hasUnexpiredToken()) socket.connect();
    }
  }

  private hasUnexpiredToken(): boolean {
    const payload = this.token?.split('.')[1];
    if (!payload) return false;
    try {
      const claims: unknown = JSON.parse(
        atob(payload.replace(/-/g, '+').replace(/_/g, '/')),
      );
      return (
        typeof claims === 'object' &&
        claims !== null &&
        'exp' in claims &&
        typeof claims.exp === 'number' &&
        claims.exp * 1000 > Date.now()
      );
    } catch {
      return false;
    }
  }
}
