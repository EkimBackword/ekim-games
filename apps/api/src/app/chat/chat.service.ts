import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  chatBeforeSchema,
  chatMessageSchema,
  chatRecoveryQuerySchema,
  createChatMessageRequestSchema,
  ownChatMessageSchema,
  reconcileChatRequestSchema,
  type ChatMessage,
  type ChatRecoveryResponse,
  type OwnChatMessage,
  type SendChatMessage,
} from 'contracts';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.service';
import { parseRequest } from '../validation/parse-request';
import type { Prisma } from '../../generated/prisma/client';

const PAGE_SIZE = 50;
const INCLUDE_AUTHOR = { user: { select: { nickname: true } } } as const;

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async history(rawBefore: unknown) {
    const before =
      rawBefore === undefined
        ? undefined
        : parseRequest(chatBeforeSchema, rawBefore);
    return this.prisma.$transaction(
      async (tx) => {
        const { position } = await tx.chatPosition.findUniqueOrThrow({
          where: { id: 1 },
        });
        const anchor = before
          ? await tx.chatMessage.findUnique({
              where: { id: before },
              select: { id: true, createdAt: true },
            })
          : null;
        if (before && !anchor)
          throw new BadRequestException('Некорректный курсор истории');
        const rows = await tx.chatMessage.findMany({
          where: anchor
            ? {
                OR: [
                  { createdAt: { lt: anchor.createdAt } },
                  { createdAt: anchor.createdAt, id: { lt: anchor.id } },
                ],
              }
            : undefined,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: PAGE_SIZE + 1,
          include: INCLUDE_AUTHOR,
        });
        const page = rows.slice(0, PAGE_SIZE).reverse();
        return {
          messages: page.map((row) => this.toMessage(row)),
          before: rows.length > PAGE_SIZE ? page[0]?.id : undefined,
          position: position.toString(),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async recover(
    user: AuthenticatedUser,
    rawQuery: unknown,
  ): Promise<ChatRecoveryResponse> {
    const query = parseRequest(chatRecoveryQuerySchema, rawQuery);
    const after = BigInt(query.after);
    return this.prisma.$transaction(
      async (tx) => {
        const { position } = await tx.chatPosition.findUniqueOrThrow({
          where: { id: 1 },
        });
        const through =
          query.through === undefined ? position : BigInt(query.through);
        if (after > through || through > position) {
          throw new BadRequestException('Некорректный диапазон восстановления');
        }
        const rows = await tx.chatMessage.findMany({
          where: { position: { gt: after, lte: through } },
          orderBy: { position: 'asc' },
          take: PAGE_SIZE + 1,
          include: INCLUDE_AUTHOR,
        });
        const page = rows.slice(0, PAGE_SIZE);
        const next =
          rows.length > PAGE_SIZE
            ? (page.at(-1)?.position ?? through)
            : through;
        return {
          messages: page.map((row) =>
            row.userId === user.id && row.clientMessageId !== null
              ? this.toOwnMessage(row)
              : this.toMessage(row),
          ),
          next: next.toString(),
          through: through.toString(),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async create(user: AuthenticatedUser, raw: unknown): Promise<ChatMessage> {
    const { text } = parseRequest(createChatMessageRequestSchema, raw);
    return this.prisma.$transaction(async (tx) =>
      this.toMessage(await this.insert(tx, user.id, text)),
    );
  }

  async send(user: AuthenticatedUser, input: SendChatMessage) {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "ChatPosition" WHERE id = 1 FOR UPDATE`;
        const previous = await tx.chatMessage.findUnique({
          where: {
            userId_clientMessageId: {
              userId: user.id,
              clientMessageId: input.clientMessageId,
            },
          },
          include: INCLUDE_AUTHOR,
        });
        if (previous && previous.text !== input.text) {
          throw new ConflictException(
            'Идентификатор уже использован для другого сообщения',
          );
        }
        const row =
          previous ??
          (await this.insert(tx, user.id, input.text, input.clientMessageId));
        return { created: !previous, message: this.toOwnMessage(row) };
      },
      { isolationLevel: 'ReadCommitted' },
    );
  }

  async reconcile(
    user: AuthenticatedUser,
    raw: unknown,
  ): Promise<OwnChatMessage[]> {
    const { clientMessageIds } = parseRequest(reconcileChatRequestSchema, raw);
    const rows = await this.prisma.chatMessage.findMany({
      where: { userId: user.id, clientMessageId: { in: clientMessageIds } },
      include: INCLUDE_AUTHOR,
    });
    return rows.map((row) => this.toOwnMessage(row));
  }

  private async insert(
    tx: Prisma.TransactionClient,
    userId: string,
    text: string,
    clientMessageId?: string,
  ) {
    const { position } = await tx.chatPosition.update({
      where: { id: 1 },
      data: { position: { increment: 1 } },
    });
    return tx.chatMessage.create({
      data: { userId, text, position, clientMessageId },
      include: INCLUDE_AUTHOR,
    });
  }

  private toMessage(row: {
    id: string;
    text: string;
    createdAt: Date;
    user: { nickname: string };
  }): ChatMessage {
    return chatMessageSchema.parse({
      id: row.id,
      authorNickname: row.user.nickname,
      text: row.text,
      createdAt: row.createdAt.toISOString(),
    });
  }

  private toOwnMessage(
    row: Parameters<ChatService['toMessage']>[0] & {
      clientMessageId: string | null;
    },
  ) {
    return ownChatMessageSchema.parse({
      ...this.toMessage(row),
      clientMessageId: row.clientMessageId,
    });
  }
}
