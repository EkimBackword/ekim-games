import {
  chatSocketClientPayloadSchemas,
  chatSocketEvents,
  type ChatAuthAck,
  type ChatMessage,
  type ChatSendAck,
  type OwnChatMessage,
} from 'contracts';
import type { Namespace, Socket } from 'socket.io';
import { OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { AuthService, type AccessSession } from '../auth/auth.service';
import { ChatService } from './chat.service';

interface SocketAuthorization {
  session: AccessSession;
  token: string;
  timer: ReturnType<typeof setTimeout>;
}

@WebSocketGateway({
  namespace: '/chat',
  cors: {
    origin: (origin, callback) => {
      const allowedOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:4200';
      callback(null, !origin || origin === allowedOrigin);
    },
    credentials: true,
  },
  maxHttpBufferSize: 16_384,
})
export class ChatGateway implements OnGatewayInit, OnModuleDestroy {
  private readonly authorizations = new Map<Socket, SocketAuthorization>();
  private readonly socketsBySession = new Map<string, Set<Socket>>();
  private readonly sendsByUser = new Map<string, number[]>();
  private readonly authUpdatesBySocket = new WeakMap<Socket, number[]>();
  private readonly revokedSubscription;

  constructor(
    private readonly auth: AuthService,
    private readonly chat: ChatService,
  ) {
    this.revokedSubscription = auth.sessionRevoked.subscribe((sid) => {
      for (const client of this.socketsBySession.get(sid) ?? [])
        this.close(client);
    });
  }

  afterInit(namespace: Namespace): void {
    namespace.use((client, next) => {
      void this.admit(client, next);
    });
  }

  onModuleDestroy(): void {
    this.revokedSubscription.unsubscribe();
    for (const client of this.authorizations.keys()) this.close(client);
  }

  publish(
    message: ChatMessage,
    author?: { id: string; message: OwnChatMessage },
  ): void {
    for (const client of this.authorizations.keys()) {
      const authorization = this.liveAuthorization(client);
      if (!authorization) continue;
      const delivery =
        author?.id === authorization.session.id ? author.message : message;
      client.emit(chatSocketEvents.messageCreated, delivery);
    }
  }

  @SubscribeMessage(chatSocketEvents.updateAuth)
  async updateAuth(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<ChatAuthAck> {
    const current = this.liveAuthorization(client);
    const input =
      chatSocketClientPayloadSchemas[chatSocketEvents.updateAuth].safeParse(
        payload,
      );
    if (!current || !this.allowAuthUpdate(client) || !input.success)
      return { ok: false };
    try {
      return await this.auth.authorizeSocket(
        input.data.accessToken,
        (session) => {
          if (
            current !== this.liveAuthorization(client) ||
            session.sid !== current.session.sid
          ) {
            return { ok: false };
          }
          this.setAuthorization(client, session, input.data.accessToken);
          return { ok: true };
        },
      );
    } catch {
      return { ok: false };
    }
  }

  @SubscribeMessage(chatSocketEvents.sendMessage)
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<ChatSendAck> {
    const authorization = this.liveAuthorization(client);
    if (!authorization) return { ok: false, error: 'Нет активной сессии' };
    if (!this.allowSend(authorization.session.id)) {
      return this.reject(client, 'Слишком много сообщений. Попробуйте позже');
    }

    const parsed =
      chatSocketClientPayloadSchemas[chatSocketEvents.sendMessage].safeParse(
        payload,
      );
    if (!parsed.success) return this.reject(client, 'Некорректное сообщение');

    try {
      await this.auth.validateAccess(authorization.token);
    } catch {
      if (this.authorizations.get(client) === authorization) this.close(client);
      return { ok: false, error: 'Нет активной сессии' };
    }
    const current = this.liveAuthorization(client);
    if (!current) return { ok: false, error: 'Нет активной сессии' };
    const user = current.session;
    try {
      const result = await this.chat.send(user, parsed.data);
      if (result.created) {
        const { id, text, createdAt, authorNickname } = result.message;
        this.publish(
          { id, text, createdAt, authorNickname },
          { id: user.id, message: result.message },
        );
      }
      return { ok: true, message: result.message };
    } catch {
      return this.reject(client, 'Не удалось отправить сообщение');
    }
  }

  private async admit(
    client: Socket,
    next: (error?: Error) => void,
  ): Promise<void> {
    const token = client.handshake.auth.accessToken;
    if (typeof token !== 'string' || token.length > 4096) {
      next(new Error('Нет активной сессии'));
      return;
    }
    try {
      await this.auth.authorizeSocket(token, (session) => {
        if (client.conn.readyState !== 'open') return;
        const remove = () => this.remove(client);
        client.conn.once('close', remove);
        client.once('disconnect', () => {
          client.conn.off('close', remove);
          remove();
        });
        this.setAuthorization(client, session, token);
        next();
      });
    } catch {
      next(new Error('Нет активной сессии'));
    }
  }

  private setAuthorization(
    client: Socket,
    session: AccessSession,
    token: string,
  ): void {
    const previous = this.authorizations.get(client);
    if (previous) clearTimeout(previous.timer);
    const authorization: SocketAuthorization = {
      session,
      token,
      timer: setTimeout(
        () => {
          if (this.authorizations.get(client) === authorization)
            this.close(client);
        },
        session.exp * 1000 - Date.now(),
      ),
    };
    this.authorizations.set(client, authorization);
    const sockets = this.socketsBySession.get(session.sid) ?? new Set<Socket>();
    sockets.add(client);
    this.socketsBySession.set(session.sid, sockets);
  }

  private liveAuthorization(client: Socket): SocketAuthorization | undefined {
    const authorization = this.authorizations.get(client);
    if (!authorization) return undefined;
    if (authorization.session.exp * 1000 <= Date.now()) {
      this.close(client);
      return undefined;
    }
    return client.connected ? authorization : undefined;
  }

  private remove(client: Socket): void {
    const authorization = this.authorizations.get(client);
    if (!authorization) return;
    clearTimeout(authorization.timer);
    this.authorizations.delete(client);
    const sid = authorization.session.sid;
    const sockets = this.socketsBySession.get(sid);
    sockets?.delete(client);
    if (!sockets?.size) this.socketsBySession.delete(sid);
  }

  private close(client: Socket): void {
    this.remove(client);
    if (client.connected) client.disconnect(true);
    else client.conn.close();
  }

  private reject(client: Socket, error: string): ChatSendAck {
    if (this.liveAuthorization(client))
      client.emit(chatSocketEvents.error, { message: error });
    return { ok: false, error };
  }

  private allowSend(userId: string): boolean {
    const now = Date.now();
    const recent = (this.sendsByUser.get(userId) ?? []).filter(
      (time) => now - time < 10_000,
    );
    if (recent.length >= 5) {
      this.sendsByUser.set(userId, recent);
      return false;
    }
    recent.push(now);
    this.sendsByUser.set(userId, recent);
    if (this.sendsByUser.size > 10_000) {
      for (const [id, times] of this.sendsByUser) {
        if (times.every((time) => now - time >= 10_000))
          this.sendsByUser.delete(id);
      }
    }
    return true;
  }

  private allowAuthUpdate(client: Socket): boolean {
    const now = Date.now();
    const recent = (this.authUpdatesBySocket.get(client) ?? []).filter(
      (time) => now - time < 10_000,
    );
    this.authUpdatesBySocket.set(client, recent);
    if (recent.length >= 10) return false;
    recent.push(now);
    return true;
  }
}
