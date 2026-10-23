import { z } from 'zod';

/** Данные, которые клиент передаёт для отправки сообщения в общий чат. */
export const nicknameSchema = z
  .string()
  .trim()
  .min(3)
  .max(24)
  .regex(/^[\p{L}\p{N}_.-]+$/u);

export const passwordSchema = z.string().min(12).max(128);

export const createChatMessageRequestSchema = z.strictObject({
  text: z.string().trim().min(1).max(2000),
});

export type CreateChatMessageRequest = z.infer<
  typeof createChatMessageRequestSchema
>;

/** Сообщение, возвращаемое API или рассылаемое участникам чата. */
export const chatMessageSchema = z.strictObject({
  id: z.uuid(),
  authorNickname: nicknameSchema,
  text: z.string().min(1).max(2000),
  createdAt: z.iso.datetime(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** Ответ REST API со списком сообщений. */
export const chatHistoryResponseSchema = z.array(chatMessageSchema);

export type ChatHistoryResponse = z.infer<typeof chatHistoryResponseSchema>;
