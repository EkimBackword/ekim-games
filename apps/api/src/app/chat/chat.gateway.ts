import {
  chatSocketEvents,
  createChatMessageRequestSchema,
} from 'contracts';
import type {
  Server,
  Socket,
} from 'socket.io';

import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

import {
  type AuthenticatedUser,
  AuthService,
} from '../auth/auth.service';
import { ChatService } from './chat.service';

type ChatSocket = Socket & { data: { accessToken?: string } };

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
export class ChatGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly sendsByUser = new Map<string, number[]>();

  constructor(
    private readonly auth: AuthService,
    private readonly chat: ChatService,
  ) {}

  publish(message: Awaited<ReturnType<ChatService['create']>>): void {
    this.server.emit(chatSocketEvents.messageCreated, message);
  }

  async handleConnection(client: ChatSocket): Promise<void> {
    const token = client.handshake.auth?.accessToken;
    if (typeof token !== 'string' || token.length > 4096) {
      client.disconnect(true);
      return;
    }
    try {
      await this.auth.validateAccess(token);
      client.data.accessToken = token;
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage(chatSocketEvents.sendMessage)
  async sendMessage(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() payload: unknown,
  ): Promise<void> {
    const token = client.data.accessToken;
    if (!token) {
      client.disconnect(true);
      return;
    }
    let user: AuthenticatedUser;
    try {
      user = await this.auth.validateAccess(token);
    } catch {
      client.disconnect(true);
      return;
    }
    const parsed = createChatMessageRequestSchema.safeParse(payload);
    if (!parsed.success) {
      client.emit(chatSocketEvents.error, { message: 'Некорректное сообщение' });
      return;
    }
    if (!this.allowSend(user.id)) {
      client.emit(chatSocketEvents.error, { message: 'Слишком много сообщений. Попробуйте позже' });
      return;
    }
    try {
      const message = await this.chat.create(user, parsed.data);
      this.publish(message);
    } catch {
      client.emit(chatSocketEvents.error, {
        message: 'Не удалось отправить сообщение',
      });
    }
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
}
