import { Injectable } from '@nestjs/common';
import {
  chatHistoryResponseSchema,
  chatMessageSchema,
  createChatMessageRequestSchema,
  type ChatMessage,
} from 'contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.service';
import { parseRequest } from '../validation/parse-request';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async history(): Promise<ChatMessage[]> {
    const rows = await this.prisma.chatMessage.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      include: { user: { select: { nickname: true } } },
    });
    return chatHistoryResponseSchema.parse(
      rows.reverse().map((row) => this.toMessage(row)),
    );
  }

  async create(user: AuthenticatedUser, raw: unknown): Promise<ChatMessage> {
    const { text } = parseRequest(createChatMessageRequestSchema, raw);
    const row = await this.prisma.chatMessage.create({
      data: { userId: user.id, text },
      include: { user: { select: { nickname: true } } },
    });
    return chatMessageSchema.parse(this.toMessage(row));
  }

  private toMessage(row: {
    id: string;
    text: string;
    createdAt: Date;
    user: { nickname: string };
  }): ChatMessage {
    return {
      id: row.id,
      authorNickname: row.user.nickname,
      text: row.text,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
